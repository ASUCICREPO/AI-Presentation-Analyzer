import json
import os
import time
import asyncio
import base64
import boto3
from botocore.exceptions import ClientError
from decimal import Decimal

# ─── Environment ───────────────────────────────────────────────────────
PERSONA_TABLE_NAME = os.environ.get("PERSONA_TABLE_NAME", "")
UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET", "")
WEBSOCKET_API_ENDPOINT = os.environ.get("WEBSOCKET_API_ENDPOINT", "")
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
DEFAULT_VOICE_ID = os.environ.get("DEFAULT_VOICE_ID", "matthew")
SESSION_DURATION_SEC = int(os.environ.get("SESSION_DURATION_SEC", "300"))
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# ─── AWS Clients ───────────────────────────────────────────────────────
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
s3_client = boto3.client("s3", region_name=AWS_REGION)

# Store active sessions (connection_id -> session state)
_active_sessions = {}


class _DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o == int(o) else float(o)
        return super().default(o)


def _get_apigw_management_client(event):
    """Get API Gateway Management API client from WebSocket event context."""
    domain = event.get("requestContext", {}).get("domainName", "")
    stage = event.get("requestContext", {}).get("stage", "")
    if not domain or not stage:
        # Fallback to environment variable
        endpoint_url = WEBSOCKET_API_ENDPOINT.replace("wss://", "https://")
    else:
        endpoint_url = f"https://{domain}/{stage}"
    return boto3.client("apigatewaymanagementapi", endpoint_url=endpoint_url, region_name=AWS_REGION)


def _send_to_connection(apigw_client, connection_id, data):
    """Send data to a WebSocket connection."""
    try:
        apigw_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(data, cls=_DecimalEncoder).encode("utf-8"),
        )
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "GoneException":
            print(f"Connection {connection_id} is gone, cleaning up")
            _cleanup_session(connection_id)
        else:
            print(f"Error sending to connection {connection_id}: {e}")


def _get_persona(persona_id):
    """Fetch persona from DynamoDB."""
    if not PERSONA_TABLE_NAME:
        return None
    table = dynamodb.Table(PERSONA_TABLE_NAME)
    try:
        response = table.get_item(Key={"personaID": persona_id})
        return response.get("Item")
    except ClientError as e:
        print(f"Error fetching persona {persona_id}: {e}")
        return None


def _get_s3_text(bucket, key):
    """Fetch a text file from S3, returning empty string if not found."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read().decode("utf-8")
    except ClientError:
        return ""


def _get_transcript(user_id, date_str, session_id):
    """Load presentation transcript from S3."""
    key = f"{user_id}/{date_str}/{session_id}/transcript.json"
    raw = _get_s3_text(UPLOADS_BUCKET, key)
    if not raw:
        return ""
    try:
        data = json.loads(raw)
        # transcript.json has shape {sessionId, transcripts: [{text, timestamp, isFinal}]}
        transcripts = data.get("transcripts", [])
        return " ".join(t.get("text", "") for t in transcripts if t.get("isFinal", True))
    except (json.JSONDecodeError, KeyError):
        return raw


def _get_custom_instructions(user_id, date_str, session_id):
    """Load custom persona instructions from S3."""
    key = f"{user_id}/{date_str}/{session_id}/CUSTOM_PERSONA_INSTRUCTION.txt"
    return _get_s3_text(UPLOADS_BUCKET, key)


def _save_qa_session(user_id, date_str, session_id, session_data):
    """Save QA session results to S3."""
    key = f"{user_id}/{date_str}/{session_id}/qa_session.json"
    try:
        s3_client.put_object(
            Bucket=UPLOADS_BUCKET,
            Key=key,
            Body=json.dumps(session_data, cls=_DecimalEncoder).encode("utf-8"),
            ContentType="application/json",
        )
        print(f"QA session saved to s3://{UPLOADS_BUCKET}/{key}")
    except ClientError as e:
        print(f"Error saving QA session: {e}")


def _build_system_prompt(persona, custom_instructions, transcript_text):
    """Build the QA-focused system prompt."""
    persona_name = persona.get("name", "Audience Member") if persona else "Audience Member"
    persona_prompt = persona.get("personaPrompt", "You are an engaged and curious audience member.") if persona else "You are an engaged and curious audience member."
    duration_minutes = SESSION_DURATION_SEC // 60

    return f"""You are {persona_name}, an engaged audience member at a presentation Q&A session.

PERSONA CHARACTERISTICS:
{persona_prompt}

CUSTOM INSTRUCTIONS:
{custom_instructions or "Focus on understanding and challenging the presented ideas."}

YOUR GOALS:
1. Ask clarifying questions about unclear or complex points
2. Challenge assumptions and conclusions with critical thinking
3. Explore practical applications of presented concepts
4. Help the presenter think deeper about their topic
5. Maintain the conversation for approximately {duration_minutes} minutes

BEHAVIOR GUIDELINES:
- Start by briefly acknowledging the presentation, then ask your first question
- Ask one focused question at a time
- Listen actively to responses before asking follow-ups
- Reference specific parts of the presentation when possible
- Maintain your persona's communication style
- Be respectful but intellectually rigorous
- Vary question types between clarification, critical analysis, and practical application
- If the presenter gives a short or unclear response, ask a follow-up to dig deeper
- As time progresses, move toward more challenging or synthesizing questions

PRESENTATION TRANSCRIPT:
{transcript_text if transcript_text else "(No transcript available — ask general questions about the presentation topic.)"}
"""


def _cleanup_session(connection_id):
    """Clean up session state for a disconnected connection."""
    session = _active_sessions.pop(connection_id, None)
    if session:
        # Clean up agent resources
        agent = session.get("agent")
        agent_loop = session.get("agent_loop")
        agent_thread = session.get("agent_thread")

        if agent and agent_loop and agent_loop.is_running():
            async def _stop_agent():
                try:
                    await agent.stop()
                except Exception as e:
                    print(f"Error stopping agent during cleanup: {e}")

            asyncio.run_coroutine_threadsafe(_stop_agent(), agent_loop)

        if agent_thread and agent_thread.is_alive():
            agent_thread.join(timeout=1.0)

        # Save QA session data to S3
        qa_data = {
            "session_id": session.get("session_id", ""),
            "start_time": session.get("start_time", ""),
            "end_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "duration_seconds": int(time.time() - session.get("start_epoch", time.time())),
            "persona": {
                "id": session.get("persona_id", ""),
                "name": session.get("persona_name", ""),
            },
            "transcript_entries": session.get("transcript_entries", []),
            "metrics": {
                "total_questions": session.get("question_count", 0),
                "total_responses": session.get("response_count", 0),
                "interruptions": session.get("interruption_count", 0),
            },
        }
        user_id = session.get("user_id", "")
        date_str = session.get("date_str", "")
        sid = session.get("session_id", "")
        if user_id and date_str and sid:
            _save_qa_session(user_id, date_str, sid, qa_data)


# ─── WebSocket Route Handlers ─────────────────────────────────────────

def _handle_connect(event):
    """Handle $connect — initialize session state."""
    connection_id = event["requestContext"]["connectionId"]
    qs = event.get("queryStringParameters") or {}

    persona_id = qs.get("personaId", "")
    session_id = qs.get("sessionId", "")
    user_id = qs.get("userId", "")
    date_str = qs.get("dateStr", time.strftime("%Y-%m-%d", time.gmtime()))
    voice_id = qs.get("voiceId", DEFAULT_VOICE_ID)

    print(f"Connect: connection={connection_id}, persona={persona_id}, session={session_id}")

    # Load persona
    persona = _get_persona(persona_id) if persona_id else None

    # Load transcript and custom instructions
    transcript_text = ""
    custom_instructions = ""
    if user_id and session_id:
        transcript_text = _get_transcript(user_id, date_str, session_id)
        custom_instructions = _get_custom_instructions(user_id, date_str, session_id)

    system_prompt = _build_system_prompt(persona, custom_instructions, transcript_text)

    # Store session state
    _active_sessions[connection_id] = {
        "session_id": session_id,
        "persona_id": persona_id,
        "persona_name": persona.get("name", "Audience Member") if persona else "Audience Member",
        "user_id": user_id,
        "date_str": date_str,
        "voice_id": voice_id,
        "system_prompt": system_prompt,
        "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "start_epoch": time.time(),
        "transcript_entries": [],
        "question_count": 0,
        "response_count": 0,
        "interruption_count": 0,
        "agent_started": False,
    }

    return {"statusCode": 200, "body": "Connected"}


def _handle_disconnect(event):
    """Handle $disconnect — clean up session."""
    connection_id = event["requestContext"]["connectionId"]
    print(f"Disconnect: connection={connection_id}")
    _cleanup_session(connection_id)
    return {"statusCode": 200, "body": "Disconnected"}


def _handle_message(event):
    """Handle $default — process incoming WebSocket messages.

    Message types:
    - { action: "start" }              → Start the QA agent session
    - { action: "audio", data: "..." } → Forward audio chunk (base64 PCM)
    - { action: "end" }                → End the QA session
    - { action: "text", text: "..." }  → Send text input to agent
    """
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event.get("body", "{}"))
    action = body.get("action", "")

    session = _active_sessions.get(connection_id)
    if not session:
        return {"statusCode": 400, "body": "No active session"}

    apigw_client = _get_apigw_management_client(event)

    if action == "start":
        return _handle_start_session(connection_id, session, apigw_client, event)
    elif action == "audio":
        return _handle_audio_input(connection_id, session, body, apigw_client, event)
    elif action == "text":
        return _handle_text_input(connection_id, session, body, apigw_client, event)
    elif action == "end":
        return _handle_end_session(connection_id, session, apigw_client, event)
    else:
        _send_to_connection(apigw_client, connection_id, {
            "type": "error",
            "message": f"Unknown action: {action}",
        })
        return {"statusCode": 400, "body": f"Unknown action: {action}"}


def _handle_start_session(connection_id, session, apigw_client, event):
    """Initialize the Strands BidiAgent and start the QA session."""
    import threading
    from strands.experimental.bidi import BidiAgent
    from strands.experimental.bidi.models import BidiNovaSonicModel
    from strands.experimental.bidi.tools import stop_conversation

    voice_id = session.get("voice_id", DEFAULT_VOICE_ID)

    model = BidiNovaSonicModel(
        model_id=MODEL_ID,
        provider_config={
            "audio": {
                "input_rate": 16000,
                "output_rate": 16000,
                "voice": voice_id,
                "channels": 1,
                "format": "pcm",
            }
        },
        client_config={
            "boto_session": boto3.Session(),
            "region": AWS_REGION,
        },
    )

    agent = BidiAgent(
        model=model,
        tools=[stop_conversation],
        system_prompt=session["system_prompt"],
    )

    # Create a new event loop for the agent
    loop = asyncio.new_event_loop()
    session["agent"] = agent
    session["agent_loop"] = loop
    session["agent_started"] = False  # Will be set to True after agent.start()

    async def _start_agent():
        """Start the agent and mark it as ready."""
        try:
            await agent.start()
            session["agent_started"] = True
            print(f"Agent started for connection {connection_id}")

            # Send session started message
            _send_to_connection(apigw_client, connection_id, {
                "type": "session_started",
                "persona_name": session["persona_name"],
                "session_duration_sec": SESSION_DURATION_SEC,
            })
        except Exception as e:
            print(f"Error starting agent: {e}")
            _send_to_connection(apigw_client, connection_id, {
                "type": "error",
                "message": f"Failed to start agent: {str(e)}",
            })

    async def _process_agent_outputs():
        """Process output events from the agent."""
        try:
            async for output_event in agent.receive():
                event_type = output_event.get("type", "")

                if event_type == "bidi_audio_stream":
                    _send_to_connection(apigw_client, connection_id, {
                        "type": "audio",
                        "data": output_event.get("audio", ""),
                        "format": output_event.get("format", "pcm"),
                        "sample_rate": output_event.get("sample_rate", 16000),
                        "channels": output_event.get("channels", 1),
                    })

                elif event_type == "bidi_transcript_stream":
                    role = output_event.get("role", "")
                    text = output_event.get("transcript", "")
                    is_partial = output_event.get("is_partial", True)

                    _send_to_connection(apigw_client, connection_id, {
                        "type": "transcript",
                        "role": role,
                        "text": text,
                        "is_partial": is_partial,
                    })

                    # Track completed transcript entries
                    if not is_partial and text.strip():
                        session["transcript_entries"].append({
                            "timestamp": time.strftime("%H:%M:%S", time.gmtime(
                                time.time() - session["start_epoch"]
                            )),
                            "role": role,
                            "text": text,
                        })
                        if role == "assistant":
                            session["question_count"] += 1
                        elif role == "user":
                            session["response_count"] += 1

                elif event_type == "bidi_interruption":
                    session["interruption_count"] += 1
                    _send_to_connection(apigw_client, connection_id, {
                        "type": "interruption",
                        "reason": output_event.get("reason", ""),
                    })

                elif event_type == "bidi_connection_close":
                    _send_to_connection(apigw_client, connection_id, {
                        "type": "session_ended",
                        "reason": "agent_closed",
                    })
                    break

                elif event_type == "bidi_error":
                    _send_to_connection(apigw_client, connection_id, {
                        "type": "error",
                        "message": output_event.get("message", "Unknown error"),
                    })

        except Exception as e:
            print(f"Agent output processing error: {e}")
            _send_to_connection(apigw_client, connection_id, {
                "type": "error",
                "message": str(e),
            })
        finally:
            await agent.stop()

    async def _run_agent_tasks():
        """Run both agent start and output processing tasks."""
        await _start_agent()
        await _process_agent_outputs()

    # Run the agent in a background thread to avoid blocking Lambda
    def _run_agent_thread():
        asyncio.set_event_loop(loop)
        loop.run_until_complete(_run_agent_tasks())
        loop.close()

    agent_thread = threading.Thread(target=_run_agent_thread)
    agent_thread.daemon = True
    agent_thread.start()
    session["agent_thread"] = agent_thread

    # Give the agent a moment to start
    time.sleep(0.5)

    return {"statusCode": 200, "body": "Session starting"}


def _handle_audio_input(connection_id, session, body, apigw_client, event):
    """Forward audio chunk to the BidiAgent."""
    agent = session.get("agent")
    agent_loop = session.get("agent_loop")

    if not agent or not session.get("agent_started"):
        _send_to_connection(apigw_client, connection_id, {
            "type": "error",
            "message": "Agent not started. Send { action: 'start' } first.",
        })
        return {"statusCode": 400, "body": "Agent not started"}

    audio_data = body.get("data", "")
    if not audio_data:
        return {"statusCode": 400, "body": "No audio data"}

    # Check session duration
    elapsed = time.time() - session.get("start_epoch", time.time())
    if elapsed >= SESSION_DURATION_SEC:
        _send_to_connection(apigw_client, connection_id, {
            "type": "session_ended",
            "reason": "time_limit",
        })
        return {"statusCode": 200, "body": "Session time limit reached"}

    # Forward audio to agent using the agent's event loop
    async def _send_audio():
        await agent.send({
            "type": "bidi_audio_input",
            "audio": audio_data,
            "format": "pcm",
            "sample_rate": 16000,
            "channels": 1,
        })

    if agent_loop and agent_loop.is_running():
        # Schedule the coroutine on the agent's loop
        asyncio.run_coroutine_threadsafe(_send_audio(), agent_loop)
    else:
        print(f"Warning: Agent loop not running for connection {connection_id}")
        return {"statusCode": 500, "body": "Agent loop not running"}

    return {"statusCode": 200, "body": "Audio received"}


def _handle_text_input(connection_id, session, body, apigw_client, event):
    """Send text input to the BidiAgent."""
    agent = session.get("agent")
    agent_loop = session.get("agent_loop")

    if not agent or not session.get("agent_started"):
        _send_to_connection(apigw_client, connection_id, {
            "type": "error",
            "message": "Agent not started.",
        })
        return {"statusCode": 400, "body": "Agent not started"}

    text = body.get("text", "")
    if not text:
        return {"statusCode": 400, "body": "No text provided"}

    # Forward text to agent using the agent's event loop
    async def _send_text():
        await agent.send(text)

    if agent_loop and agent_loop.is_running():
        # Schedule the coroutine on the agent's loop
        asyncio.run_coroutine_threadsafe(_send_text(), agent_loop)
    else:
        print(f"Warning: Agent loop not running for connection {connection_id}")
        return {"statusCode": 500, "body": "Agent loop not running"}

    return {"statusCode": 200, "body": "Text received"}


def _handle_end_session(connection_id, session, apigw_client, event):
    """Gracefully end the QA session."""
    agent = session.get("agent")
    agent_loop = session.get("agent_loop")
    agent_thread = session.get("agent_thread")

    if agent and agent_loop and agent_loop.is_running():
        # Stop the agent using its event loop
        async def _stop_agent():
            await agent.stop()

        asyncio.run_coroutine_threadsafe(_stop_agent(), agent_loop)

        # Give the thread a moment to clean up
        if agent_thread and agent_thread.is_alive():
            agent_thread.join(timeout=2.0)

    _send_to_connection(apigw_client, connection_id, {
        "type": "session_ended",
        "reason": "user_ended",
    })

    _cleanup_session(connection_id)
    return {"statusCode": 200, "body": "Session ended"}


# ─── Lambda Entry Point ───────────────────────────────────────────────

def lambda_handler(event, context):
    """AWS Lambda handler — routes WebSocket events to handlers.

    Routes:
        $connect    → _handle_connect
        $disconnect → _handle_disconnect
        $default    → _handle_message
    """
    route_key = event.get("requestContext", {}).get("routeKey", "")
    print(f"Route: {route_key}, ConnectionId: {event.get('requestContext', {}).get('connectionId', '')}")

    if route_key == "$connect":
        return _handle_connect(event)
    elif route_key == "$disconnect":
        return _handle_disconnect(event)
    elif route_key == "$default":
        return _handle_message(event)
    else:
        return {"statusCode": 400, "body": f"Unhandled route: {route_key}"}
