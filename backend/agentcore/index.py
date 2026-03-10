from starlette.websockets import WebSocket, WebSocketDisconnect
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.types.events import (
    BidiAudioInputEvent,
    BidiAudioStreamEvent,
    BidiTextInputEvent,
    BidiTranscriptStreamEvent,
    BidiInterruptionEvent,
    BidiResponseCompleteEvent,
)
from strands.experimental.bidi.types.io import BidiInput, BidiOutput, BidiOutputEvent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.hooks.events import BidiMessageAddedEvent
from strands.hooks.registry import HookRegistry
from strands.experimental.bidi.tools import stop_conversation
from bedrock_agentcore import BedrockAgentCoreApp, RequestContext, PingStatus
from typing import Literal
from datetime import datetime, timezone
import asyncio
import boto3
import aioboto3
import os
import json
import time
from jinja2 import Template
from opentelemetry import baggage, context as otel_context

'''
A quick note on voice selection:

US-English voices: "matthew", "tiffany"
UK-English voices: "amy"
French voices: "ambre", "florian"
Italian voices: "beatrice", "lorenzo"
German voices: "greta", "lennart"
Spanish voices: "lupe", "carlos"
'''

VALID_VOICES = ["matthew", "tiffany", "amy", "ambre", "florian", "beatrice", "lorenzo", "greta", "lennart", "lupe", "carlos"]
DEFAULT_VOICE_ID: Literal["matthew", "tiffany", "amy", "ambre", "florian", "beatrice", "lorenzo", "greta", "lennart", "lupe", "carlos"] = os.getenv("VOICE_ID", "matthew")  # Default to "matthew" if not set
REGION = os.getenv("AWS_REGION", "us-east-1") #Always available in Lambda environment, but default to us-east-1 if not set for local development
if DEFAULT_VOICE_ID not in VALID_VOICES:
    raise ValueError(f"Invalid VOICE_ID '{DEFAULT_VOICE_ID}'. Must be one of: {VALID_VOICES}.")
MODEL_ID=os.getenv("MODEL_ID", "amazon.nova-2-sonic-v1:0") #Nova 2 Sonic default for best performance.
SESSION_DURATION_SEC = int(os.getenv("SESSION_DURATION_SEC", "300"))  # 5 minutes default
QA_ANALYTICS_MODEL_ID = os.getenv("QA_ANALYTICS_MODEL_ID", "global.anthropic.claude-haiku-4-5-20251001-v1:0")
_runtime_name = os.getenv("AGENT_RUNTIME_NAME", "")
CLOUDWATCH_LOG_GROUP = f"/aws/bedrock-agentcore/runtimes/{_runtime_name}-DEFAULT" if _runtime_name else ""


def build_qa_system_prompt(persona_name: str, persona_prompt: str, custom_instructions: str, transcript_text: str, session_duration: float) -> str:
    """Build a QA-focused system prompt from persona and presentation context."""
    
    qa_duration = session_duration // 60
    if qa_duration <= 0:
        qa_duration = 1 # Default to 1 minutes of QA

    
    with open("qa_system_prompt.jinja2", "r") as f:
        template_file = f.read()
    template = Template(template_file)
    prompt = template.render(
        persona_name=persona_name,
        persona_prompt=persona_prompt,
        custom_instructions=custom_instructions if custom_instructions else None,
        transcript_text=transcript_text,
        qa_limit=qa_duration
    )
    print(f"Rendered QA system prompt:\n{prompt}")
    return prompt


def create_nova_sonic_model(voice_id: str = None) -> BidiNovaSonicModel:
    """Create a BidiNovaSonicModel with the given voice configuration."""
    voice = voice_id if voice_id and voice_id in VALID_VOICES else DEFAULT_VOICE_ID
    return BidiNovaSonicModel(
        model_id=MODEL_ID,
        provider_config={
            "audio": {
                "input_rate": 16000,
                "output_rate": 16000,
                "voice": voice,
                "channels": 1,
                "format": "pcm"
            }
        },
        client_config={
            "boto_session": boto3.Session(region_name=REGION),
        }
    )


class SessionTimeGuard:
    """Bidi hook that monitors elapsed time after each user message.

    Sets a flag that the I/O input channel reads before yielding the next
    audio frame.  This keeps send() calls out of hook callbacks (which the
    Strands docs treat as observers, not actors).
    """

    def __init__(self, duration_sec: int):
        self._start = time.monotonic()
        self._duration = duration_sec
        # Read by WebSocketBidiInput between audio frames
        self.time_nudge: str | None = None
        self.force_stop = False

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BidiMessageAddedEvent, self.on_message_added)

    async def on_message_added(self, event: BidiMessageAddedEvent):
        """Fires every time a message is added to conversation history."""
        # Only check after the presenter (user) finishes an answer
        if event.message['role'] != 'user':
            return

        elapsed = time.monotonic() - self._start
        remaining = max(0, self._duration - elapsed)

        if remaining <= 0:
            self.time_nudge = (
                "TIME EXPIRED. Thank the presenter briefly and use "
                "stop_conversation immediately."
            )
            self.force_stop = True
        elif remaining <= 30:
            self.time_nudge = (
                f"TIME CHECK: Only {remaining:.0f}s remaining. "
                "This should be your last question. Wrap up and use "
                "stop_conversation soon."
            )


class WebSocketBidiInput(BidiInput):
    """Bridge browser WebSocket audio into BidiAgent input events.

    The browser sends JSON frames: {"action": "audio", "data": "<base64 PCM>"}
    This converts them into BidiAudioInputEvent objects the agent understands.
    The frontend already base64-encodes 16-bit PCM at 16 kHz mono.

    When the client requests analytics, we generate and send them while the
    agent is still running (keeping the WS alive), then the client sends "end".
    """

    def __init__(self, websocket: WebSocket, time_guard: SessionTimeGuard | None = None):
        self._ws = websocket
        self._stopped = False
        self._analytics_requested = asyncio.Event()
        self._time_guard = time_guard

    async def start(self, agent: BidiAgent) -> None:
        self._stopped = False
        self._agent = agent
        await agent.send(BidiTextInputEvent(
            text="Please introduce yourself and begin the Q&A session.",
            role="user"
        ))

    async def _drain_time_nudge(self) -> None:
        """If the time guard flagged a nudge, inject it as a text event
        and optionally force-stop after a grace period."""
        if not self._time_guard or not self._time_guard.time_nudge:
            return

        nudge = self._time_guard.time_nudge
        self._time_guard.time_nudge = None  # consume
        print(f"[SessionTimeGuard] Injecting nudge: {nudge}", flush=True)

        await self._agent.send(BidiTextInputEvent(text=nudge, role="user"))

        if self._time_guard.force_stop:
            # Give the model a short grace period to say goodbye,
            # then hard-terminate the input channel.
            await asyncio.sleep(15)
            print("[SessionTimeGuard] Grace period elapsed, forcing stop", flush=True)
            self._stopped = True
            raise asyncio.CancelledError("session time expired")

    async def __call__(self) -> BidiAudioInputEvent:
        while not self._stopped:
            # Inject any pending time nudge before processing the next frame
            await self._drain_time_nudge()

            try:
                msg = await self._ws.receive_json()
            except WebSocketDisconnect:
                self._stopped = True
                raise asyncio.CancelledError("client disconnected")

            action = msg.get("action", "")
            if action == "audio":
                return BidiAudioInputEvent(
                    audio=msg["data"],
                    format="pcm",
                    sample_rate=16000,
                    channels=1,
                )
            elif action == "get_analytics":
                self._analytics_requested.set()
            elif action == "end":
                self._stopped = True
                raise asyncio.CancelledError("client ended session")
        raise asyncio.CancelledError("input stopped")

    async def stop(self) -> None:
        self._stopped = True


class WebSocketBidiOutput(BidiOutput):
    """Bridge BidiAgent output events back to the browser WebSocket.

    Converts BidiOutputEvent objects into JSON frames the frontend understands:
    - audio  -> {"type": "audio", "data": "<base64 PCM>"}
    - transcript -> {"type": "transcript", "role": ..., "text": ..., "is_partial": ...}
    - interruption -> {"type": "interruption"}

    Also collects finalized transcript entries for post-session analytics.
    """

    def __init__(self, websocket: WebSocket):
        self._ws = websocket
        self.transcript_entries: list[dict] = []

    async def start(self, agent: BidiAgent) -> None:
        pass

    async def __call__(self, event: BidiOutputEvent) -> None:
        try:
            if isinstance(event, BidiAudioStreamEvent):
                await self._ws.send_json({"type": "audio", "data": event.audio})

            elif isinstance(event, BidiTranscriptStreamEvent):
                await self._ws.send_json({
                    "type": "transcript",
                    "role": event.role,
                    "text": event.text,
                    "is_partial": not event.is_final,
                })
                # Collect finalized transcripts for analytics
                if event.is_final and event.text and event.text.strip():
                    self.transcript_entries.append({
                        "role": event.role,
                        "text": event.text.strip(),
                    })

            elif isinstance(event, BidiInterruptionEvent):
                await self._ws.send_json({"type": "interruption"})

            elif isinstance(event, BidiResponseCompleteEvent):
                pass

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[Warning] Failed to send output event: {e}", flush=True)

    async def stop(self) -> None:
        pass


async def load_persona(persona_id: str) -> dict:
    """Load persona configuration from DynamoDB."""
    table_name = os.getenv('PERSONA_TABLE_NAME')
    if not table_name:
        print("PERSONA_TABLE_NAME environment variable not set")
        return {}

    try:
        session = aioboto3.Session()
        async with session.resource('dynamodb', region_name=REGION) as dynamodb:
            table = await dynamodb.Table(table_name)
            response = await table.get_item(Key={'personaID': persona_id})

            if 'Item' not in response:
                print(f"Persona {persona_id} not found in DynamoDB")
                return {}

            return response['Item']
    except Exception as e:
        print(f"Failed to load persona {persona_id}: {e}")
        return {}


async def load_transcript(user_id: str, session_id: str) -> str:
    """Load presentation transcript from S3."""
    bucket_name = os.getenv('UPLOADS_BUCKET')
    if not bucket_name:
        print("UPLOADS_BUCKET environment variable not set")
        return ""
    
    s3_key = f"{user_id}/{session_id}/transcript.json"
    
    try:
        session = aioboto3.Session()
        async with session.client('s3', region_name=REGION) as s3:
            response = await s3.get_object(Bucket=bucket_name, Key=s3_key)
            content = await response['Body'].read()

            # Parse transcript JSON
            transcript_data = json.loads(content)

            # Extract text from transcript entries
            if isinstance(transcript_data, list):
                # Format: [{"text": "...", "timestamp": ...}, ...]
                transcript_text = " ".join([entry.get('text', '') for entry in transcript_data])
            elif isinstance(transcript_data, dict) and 'entries' in transcript_data:
                # Format: {"entries": [...]}
                transcript_text = " ".join([entry.get('text', '') for entry in transcript_data['entries']])
            else:
                transcript_text = str(transcript_data)

            transcript_text = transcript_text.strip()
            print(f"Loaded transcript ({len(transcript_text)} chars) from s3://{bucket_name}/{s3_key}")
            return transcript_text

    except Exception as e:
        print(f"Failed to load transcript from s3://{bucket_name}/{s3_key}: {e}")
        return ""


app = BedrockAgentCoreApp()


@app.ping
def health_check():
    return PingStatus.HEALTHY


async def log_system_prompt_to_cloudwatch(session_id: str, system_prompt: str) -> None:
    """Write the rendered system prompt to a dedicated CloudWatch log stream."""
    if not CLOUDWATCH_LOG_GROUP:
        print("[SystemPromptLog] CLOUDWATCH_LOG_GROUP not set; skipping dedicated log stream")
        return
    stream_name = f"system-prompts/{session_id}"
    try:
        session = aioboto3.Session()
        async with session.client('logs', region_name=REGION) as logs:
            try:
                await logs.create_log_stream(logGroupName=CLOUDWATCH_LOG_GROUP, logStreamName=stream_name)
            except logs.exceptions.ResourceAlreadyExistsException:
                pass
            await logs.put_log_events(
                logGroupName=CLOUDWATCH_LOG_GROUP,
                logStreamName=stream_name,
                logEvents=[{
                    'timestamp': int(datetime.now(timezone.utc).timestamp() * 1000),
                    'message': system_prompt,
                }]
            )
        print(f"[SystemPromptLog] Prompt logged to stream: {CLOUDWATCH_LOG_GROUP}/{stream_name}")
    except Exception as e:
        print(f"[SystemPromptLog] Failed to write to CloudWatch: {e}")


async def generate_qa_analytics(transcript_entries: list[dict], persona_data: dict) -> dict:
    """Generate a concise QA response quality summary using Bedrock."""
    if not transcript_entries:
        return {}

    persona_name = persona_data.get('name', 'Interviewer')
    communication_style = persona_data.get('communicationStyle', 'professional')

    # Build the Q&A conversation text
    conversation = "\n".join(
        f"{'Question' if e['role'] == 'assistant' else 'Answer'}: {e['text']}"
        for e in transcript_entries
    )

    prompt = f"""You are evaluating a Q&A session where {persona_name} asked questions and the presenter responded.

Q&A Transcript:
{conversation}

Evaluate how well the presenter answered each question. Focus on:
- Clarity and directness of responses
- Depth of understanding demonstrated
- Ability to handle challenging questions
- Confidence and composure

Use a {communication_style} tone. Be concise — no long paragraphs."""

    tool_config = {
        "tools": [{
            "toolSpec": {
                "name": "provide_qa_feedback",
                "description": "Provide structured Q&A session feedback",
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": {
                            "overallSummary": {
                                "type": "string",
                                "description": "2-3 sentence overall assessment of Q&A performance"
                            },
                            "responseQuality": {
                                "type": "string",
                                "description": "One of: Excellent, Good, Needs Improvement"
                            },
                            "strengths": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "2-3 short bullet points on what the presenter did well"
                            },
                            "improvements": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "2-3 short bullet points on what could be improved"
                            },
                            "questionBreakdown": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "question": {"type": "string", "description": "Brief paraphrase of the question (under 15 words)"},
                                        "rating": {"type": "string", "description": "One of: Strong, Adequate, Weak"},
                                        "note": {"type": "string", "description": "One sentence on the response quality"}
                                    },
                                    "required": ["question", "rating", "note"]
                                },
                                "description": "Per-question assessment"
                            }
                        },
                        "required": ["overallSummary", "responseQuality", "strengths", "improvements", "questionBreakdown"]
                    }
                }
            }
        }],
        "toolChoice": {"tool": {"name": "provide_qa_feedback"}}
    }

    bedrock = boto3.client('bedrock-runtime', region_name=REGION)
    response = await asyncio.to_thread(
        lambda: bedrock.converse(
            modelId=QA_ANALYTICS_MODEL_ID,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            toolConfig=tool_config
        )
    )

    return response['output']['message']['content'][0]['toolUse']['input']


async def save_qa_analytics(user_id: str, session_id: str, transcript_entries: list[dict], feedback: dict):
    """Save QA transcript and analytics to S3."""
    bucket_name = os.getenv('UPLOADS_BUCKET')
    if not bucket_name:
        print("[Error] [QA Analytics] UPLOADS_BUCKET not set", flush=True)
        return

    s3_prefix = f"{user_id}/{session_id}"

    session = aioboto3.Session()
    async with session.client('s3', region_name=REGION) as s3_client:
        # Save QA transcript
        await s3_client.put_object(
            Bucket=bucket_name,
            Key=f"{s3_prefix}/qa_transcript.json",
            Body=json.dumps(transcript_entries, indent=2),
            ContentType='application/json',
        )

        # Save QA analytics feedback
        result = {
            "status": "completed",
            "sessionId": session_id,
            "qaFeedback": feedback,
            "totalQuestions": sum(1 for e in transcript_entries if e['role'] == 'assistant'),
            "totalResponses": sum(1 for e in transcript_entries if e['role'] == 'user'),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "model": QA_ANALYTICS_MODEL_ID,
        }
        await s3_client.put_object(
            Bucket=bucket_name,
            Key=f"{s3_prefix}/qa_analytics.json",
            Body=json.dumps(result, indent=2),
            ContentType='application/json',
        )
        print(f"[QA Analytics] Saved to s3://{bucket_name}/{s3_prefix}/qa_analytics.json", flush=True)

@app.websocket
async def websocket_handler(websocket, context: RequestContext):
    """WebSocket handler for Q&A sessions.

    Session parameters are delivered via a setup message sent by the client
    immediately after the WebSocket connection is established:
      {"action": "setup", "personaId": "...", "userId": "...",
       "sessionId": "...", "dateStr": "...", "voiceId": "..."}

    This avoids relying on AgentCore's query-param-to-header mapping, which
    strips custom params before they reach the container.
    """
    await websocket.accept()

    # Wait for the setup frame (give the client up to 10 s to send it)
    try:
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=10)
    except asyncio.TimeoutError:
        print("[WebSocket] Timed out waiting for setup message", flush=True)
        await websocket.send_json({"type": "error", "message": "Setup message not received within 10 s"})
        await websocket.close()
        return
    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected before sending setup", flush=True)
        return

    if raw.get("action") != "setup":
        print(f"[WebSocket] Expected setup message, got: {raw.get('action')}", flush=True)
        await websocket.send_json({"type": "error", "message": "First message must be {action: 'setup', ...}"})
        await websocket.close()
        return

    persona_id = raw.get("personaId", "")
    user_id    = raw.get("userId", "")
    voice_id   = raw.get("voiceId", DEFAULT_VOICE_ID)
    session_id = raw.get("sessionId", "") or (context.session_id or "")

    print(f"[WebSocket] Setup from user={user_id} persona={persona_id} session={session_id}", flush=True)

    # Attach session ID as OTEL baggage so all downstream spans are correlated
    # in the CloudWatch GenAI Observability dashboard.
    _otel_ctx = baggage.set_baggage("session.id", session_id)
    _otel_token = otel_context.attach(_otel_ctx)

    if not persona_id or not user_id or not session_id:
        print(f"[WebSocket] Missing required params: persona={persona_id} user={user_id} session={session_id}", flush=True)
        await websocket.send_json({"type": "error", "message": "Setup missing personaId, userId, or sessionId"})
        await websocket.close()
        return
    
    agent = None
    ws_output = None
    ws_input = None
    persona_data = {}
    client_disconnected = False

    try:
        persona_data = await load_persona(persona_id)
        if not persona_data:
            await websocket.send_json({"type": "error", "message": f"Persona {persona_id} not found"})
            await websocket.close()
            return

        transcript_text = await load_transcript(user_id, session_id)
        if not transcript_text:
            print(f"[WebSocket] No transcript for session {session_id}, using placeholder", flush=True)
            transcript_text = "No presentation transcript available."

        session_duration = int(persona_data.get('timeLimitSec', 300))

        system_prompt = build_qa_system_prompt(
            persona_name=persona_data.get('name', 'Interviewer'),
            persona_prompt=persona_data.get('personaPrompt', ''),
            custom_instructions=persona_data.get('description', ''),
            transcript_text=transcript_text,
            session_duration=session_duration
        )
        await log_system_prompt_to_cloudwatch(session_id, system_prompt)

        model = create_nova_sonic_model(voice_id)
        time_guard = SessionTimeGuard(session_duration)
        agent = BidiAgent(
            model=model,
            tools=[stop_conversation],
            system_prompt=system_prompt,
            hooks=[time_guard],
        )

        await websocket.send_json({
            "type": "session_started",
            "persona_name": persona_data.get('name', 'Interviewer'),
            "session_id": session_id
        })

        ws_input = WebSocketBidiInput(websocket, time_guard=time_guard)
        ws_output = WebSocketBidiOutput(websocket)

        async def analytics_watcher():
            """Wait for client to request analytics, generate and send them
            while the agent (and WS) are still alive."""
            await ws_input._analytics_requested.wait()
            if not ws_output.transcript_entries:
                print("[WebSocket] Analytics requested but no transcript entries", flush=True)
                return
            try:
                print(f"[WebSocket] Generating QA analytics ({len(ws_output.transcript_entries)} entries)", flush=True)
                feedback = await generate_qa_analytics(ws_output.transcript_entries, persona_data)
                total_q = sum(1 for e in ws_output.transcript_entries if e['role'] == 'assistant')
                total_r = sum(1 for e in ws_output.transcript_entries if e['role'] == 'user')
                await websocket.send_json({
                    "type": "qa_analytics",
                    "qaFeedback": feedback,
                    "totalQuestions": total_q,
                    "totalResponses": total_r,
                })
                print("[WebSocket] QA analytics sent to client", flush=True)
                await save_qa_analytics(user_id, session_id, ws_output.transcript_entries, feedback)
            except Exception as e:
                print(f"[WebSocket] Analytics watcher error: {e}", flush=True)

        print(f"[WebSocket] Starting BidiAgent for session {session_id}", flush=True)

        try:
            analytics_task = asyncio.create_task(analytics_watcher())
            await agent.run(inputs=[ws_input], outputs=[ws_output])
        except WebSocketDisconnect:
            print("[WebSocket] Client disconnected", flush=True)
            client_disconnected = True
        except asyncio.CancelledError:
            print("[WebSocket] Session cancelled (client ended or disconnected)", flush=True)
        except Exception as e:
            print(f"[WebSocket] Agent run error: {e}", flush=True)
        finally:
            analytics_task.cancel()
            try:
                await analytics_task
            except (asyncio.CancelledError, Exception):
                pass

        # Fallback: if analytics were never requested but we have transcript data
        # (e.g. session timed out without the client requesting analytics)
        if not ws_input._analytics_requested.is_set() and ws_output and ws_output.transcript_entries and not client_disconnected:
            feedback = None
            try:
                print(f"[WebSocket] Generating fallback QA analytics ({len(ws_output.transcript_entries)} entries)", flush=True)
                feedback = await generate_qa_analytics(ws_output.transcript_entries, persona_data)
                total_q = sum(1 for e in ws_output.transcript_entries if e['role'] == 'assistant')
                total_r = sum(1 for e in ws_output.transcript_entries if e['role'] == 'user')
                await websocket.send_json({
                    "type": "qa_analytics",
                    "qaFeedback": feedback,
                    "totalQuestions": total_q,
                    "totalResponses": total_r,
                })
                print("[WebSocket] Fallback QA analytics sent to client", flush=True)
            except Exception as e:
                print(f"[WebSocket] Failed to send fallback analytics: {e}", flush=True)
            if feedback:
                try:
                    await save_qa_analytics(user_id, session_id, ws_output.transcript_entries, feedback)
                except Exception as e:
                    print(f"[WebSocket] Failed to save QA analytics to S3: {e}", flush=True)

    except Exception as e:
        print(f"[WebSocket] Handler error: {e}", flush=True)
        import traceback
        traceback.print_exc()
    finally:
        if _otel_token is not None:
            otel_context.detach(_otel_token)
        if agent:
            try:
                await agent.stop()
            except Exception:
                pass

        try:
            await websocket.send_json({"type": "session_ended", "reason": "server_complete"})
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass

if __name__ == "__main__":
    app.run()
