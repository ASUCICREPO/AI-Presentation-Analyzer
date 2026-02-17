import asyncio
import base64
import boto3
from botocore.exceptions import ClientError
import json
import os
import uuid
from datetime import datetime

from aws_sdk_bedrock_runtime.client import (
    BedrockRuntimeClient,
    InvokeModelWithBidirectionalStreamOperationInput,
)
from aws_sdk_bedrock_runtime.models import (
    InvokeModelWithBidirectionalStreamInputChunk,
    BidirectionalInputPayloadPart,
)
from aws_sdk_bedrock_runtime.config import (
    Config,
    HTTPAuthSchemeResolver,
    SigV4AuthScheme,
)
from smithy_aws_core.identity import EnvironmentCredentialsResolver

# ─── Environment variables ────────────────────────────────────────────
CONNECTIONS_TABLE_NAME = os.environ.get("CONNECTIONS_TABLE_NAME")
UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET")
WEBSOCKET_API_ENDPOINT = os.environ.get("WEBSOCKET_API_ENDPOINT")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-2-sonic-v1:0")
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "1024"))
DEFAULT_VOICE_ID = os.environ.get("DEFAULT_VOICE_ID", "matthew")
MAX_QUESTIONS = int(os.environ.get("MAX_QUESTIONS", "10"))
MAX_DURATION_SECONDS = int(os.environ.get("MAX_DURATION_SECONDS", "600"))
REGION = os.environ.get("AWS_REGION", "us-east-1")
OUTPUT_SAMPLE_RATE = 24000

if not all([CONNECTIONS_TABLE_NAME, UPLOADS_BUCKET, WEBSOCKET_API_ENDPOINT]):
    raise ValueError("Missing required environment variables")

# ─── AWS Clients (boto3 for DynamoDB / S3 / API GW Management) ───────
s3_client = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
connections_table = dynamodb.Table(CONNECTIONS_TABLE_NAME)

ws_endpoint = (
    WEBSOCKET_API_ENDPOINT.replace("wss://", "https://").replace("/prod", "")
)
apigw_client = boto3.client(
    "apigatewaymanagementapi", endpoint_url=ws_endpoint + "/prod"
)

# ─── System Prompt Template ──────────────────────────────────────────
SYSTEM_PROMPT_TEMPLATE = """You are an engaged audience member attending a presentation. You have just watched the following presentation and now have the opportunity to ask the presenter clarifying questions.

PRESENTATION TRANSCRIPT:
{transcript}

{custom_persona}

YOUR ROLE:
- Ask thoughtful, clarifying questions about the presentation content
- Focus on content comprehension, not presentation style/delivery
- Simulate a realistic audience member's curiosity
- Ask one question at a time and listen to the presenter's answer
- Follow up naturally based on their responses
- Keep your questions conversational and clear
- Limit this session to {max_questions} questions or {max_minutes} minutes

INSTRUCTIONS:
- Start by asking your first question immediately when the session begins
- After the presenter answers, acknowledge their response briefly, then either ask a follow-up or move to a new topic
- Your questions should help the presenter practice explaining their content
- Be curious and engaged, like a real audience member"""


# ─── Helper functions ────────────────────────────────────────────────

def _response(status_code: int, body: dict = None) -> dict:
    return {"statusCode": status_code, "body": json.dumps(body) if body else ""}


def send_to_client(connection_id: str, message: dict):
    """Send message to WebSocket client via API Gateway Management API."""
    try:
        apigw_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message).encode("utf-8"),
        )
        print(f"[INFO] Sent {message.get('type')} to {connection_id}")
    except apigw_client.exceptions.GoneException:
        print(f"[WARN] Connection {connection_id} is gone")
        try:
            connections_table.delete_item(Key={"connectionId": connection_id})
        except Exception as e:
            print(f"[ERROR] Failed to delete stale connection: {e}")
    except Exception as e:
        print(f"[ERROR] Failed to send to {connection_id}: {e}")


def get_connection_record(connection_id: str) -> dict:
    try:
        resp = connections_table.get_item(Key={"connectionId": connection_id})
        return resp.get("Item")
    except ClientError as e:
        print(f"[ERROR] DynamoDB get failed: {e}")
        return None


def update_connection_record(connection_id: str, updates: dict):
    try:
        update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
        update_expr += ", lastActivity = :lastActivity"
        connections_table.update_item(
            Key={"connectionId": connection_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames={f"#{k}": k for k in updates},
            ExpressionAttributeValues={
                **{f":{k}": v for k, v in updates.items()},
                ":lastActivity": int(datetime.now().timestamp()),
            },
        )
    except ClientError as e:
        print(f"[ERROR] DynamoDB update failed: {e}")


def fetch_session_data(user_id: str, session_date: str, session_id: str) -> dict:
    """Fetch transcript and optional custom persona from S3."""
    try:
        transcript_key = f"{user_id}/{session_date}/{session_id}/transcript.json"
        obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=transcript_key)
        transcript_data = json.loads(obj["Body"].read().decode("utf-8"))
        full_transcript = transcript_data.get("full_text", "")

        custom_persona = ""
        try:
            persona_key = f"{user_id}/{session_date}/{session_id}/CUSTOM_PERSONA_INSTRUCTION.txt"
            pobj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=persona_key)
            custom_persona = pobj["Body"].read().decode("utf-8")
            print(f"[INFO] Custom persona loaded for session {session_id}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                print(f"[INFO] No custom persona for session {session_id}")

        return {"transcript": full_transcript, "custom_persona": custom_persona}
    except ClientError as e:
        print(f"[ERROR] Failed to fetch session data: {e}")
        return None


def build_system_prompt(transcript: str, custom_persona: str) -> str:
    custom_text = ""
    if custom_persona:
        custom_text = f"\nCUSTOM AUDIENCE MEMBER BEHAVIOR:\n{custom_persona}"
    return SYSTEM_PROMPT_TEMPLATE.format(
        transcript=transcript,
        custom_persona=custom_text,
        max_questions=MAX_QUESTIONS,
        max_minutes=MAX_DURATION_SECONDS // 60,
    )


def check_session_limits(conn_record: dict) -> dict:
    question_count = conn_record.get("questionCount", 0)
    connected_at = conn_record.get("connectedAt", 0)
    elapsed = int(datetime.now().timestamp()) - connected_at

    if question_count >= MAX_QUESTIONS:
        return {"limit_reached": True, "reason": "question_limit",
                "message": f"You have reached the {MAX_QUESTIONS} question limit."}
    if elapsed >= MAX_DURATION_SECONDS:
        return {"limit_reached": True, "reason": "time_limit",
                "message": f"You have reached the {MAX_DURATION_SECONDS // 60} minute limit."}
    if question_count >= MAX_QUESTIONS - 2:
        return {"limit_reached": False, "warning": True,
                "message": f"{MAX_QUESTIONS - question_count} questions remaining"}
    if elapsed >= MAX_DURATION_SECONDS - 60:
        return {"limit_reached": False, "warning": True,
                "message": "Less than 1 minute remaining"}
    return {"limit_reached": False, "warning": False}


# ═════════════════════════════════════════════════════════════════════
# Nova Sonic Bidirectional Streaming — runs inside a single Lambda
# invocation triggered by the `session_start` WebSocket message.
# The Lambda stays alive (up to 15 min) while the stream is open,
# receiving audio from the client via the `$default` route and
# forwarding it into the Bedrock stream. Bedrock output events are
# forwarded back to the client via API GW Management API.
# ═════════════════════════════════════════════════════════════════════

class NovaSonicSession:
    """Manages a single bidirectional Bedrock Nova Sonic session."""

    def __init__(self, connection_id: str, system_prompt: str,
                 voice_id: str = "matthew",
                 endpointing_sensitivity: str = "MEDIUM"):
        self.connection_id = connection_id
        self.system_prompt = system_prompt
        self.voice_id = voice_id
        self.endpointing_sensitivity = endpointing_sensitivity
        self.prompt_name = str(uuid.uuid4())
        self.system_content_name = str(uuid.uuid4())
        self.audio_content_name = str(uuid.uuid4())
        self.stream = None
        self.client = None
        self.is_active = False
        self.role = None
        self.display_assistant_text = False
        self.question_count = 0

    def _init_client(self):
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{REGION}.amazonaws.com",
            region=REGION,
            aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
            auth_scheme_resolver=HTTPAuthSchemeResolver(),
            auth_schemes={"aws.auth#sigv4": SigV4AuthScheme(service="bedrock")},
        )
        self.client = BedrockRuntimeClient(config=config)

    async def _send(self, event_dict: dict):
        """Send a JSON event to the Bedrock stream."""
        payload = json.dumps(event_dict)
        await self.stream.input_stream.send(
            InvokeModelWithBidirectionalStreamInputChunk(
                value=BidirectionalInputPayloadPart(bytes_=payload.encode("utf-8"))
            )
        )

    async def start(self):
        """Open the bidirectional stream and send initialisation events."""
        if not self.client:
            self._init_client()

        self.stream = await self.client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=BEDROCK_MODEL_ID)
        )
        self.is_active = True

        # 1. sessionStart
        await self._send({
            "event": {
                "sessionStart": {
                    "inferenceConfiguration": {
                        "maxTokens": MAX_TOKENS,
                        "topP": 0.9,
                        "temperature": 0.7,
                    },
                    "turnDetectionConfiguration": {
                        "endpointingSensitivity": self.endpointing_sensitivity,
                    },
                }
            }
        })

        # 2. promptStart
        await self._send({
            "event": {
                "promptStart": {
                    "promptName": self.prompt_name,
                    "textOutputConfiguration": {"mediaType": "text/plain"},
                    "audioOutputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": OUTPUT_SAMPLE_RATE,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "voiceId": self.voice_id,
                        "encoding": "base64",
                        "audioType": "SPEECH",
                    },
                }
            }
        })

        # 3. System prompt: contentStart → textInput → contentEnd
        await self._send({
            "event": {
                "contentStart": {
                    "promptName": self.prompt_name,
                    "contentName": self.system_content_name,
                    "type": "TEXT",
                    "interactive": False,
                    "role": "SYSTEM",
                    "textInputConfiguration": {"mediaType": "text/plain"},
                }
            }
        })
        await self._send({
            "event": {
                "textInput": {
                    "promptName": self.prompt_name,
                    "contentName": self.system_content_name,
                    "content": self.system_prompt,
                }
            }
        })
        await self._send({
            "event": {
                "contentEnd": {
                    "promptName": self.prompt_name,
                    "contentName": self.system_content_name,
                }
            }
        })

        # 4. Open the audio content stream (stays open for continuous audio)
        await self._send({
            "event": {
                "contentStart": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name,
                    "type": "AUDIO",
                    "interactive": True,
                    "role": "USER",
                    "audioInputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 16000,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "audioType": "SPEECH",
                        "encoding": "base64",
                    },
                }
            }
        })

        print("[INFO] Nova Sonic session started, audio stream open")

    async def send_audio(self, base64_audio: str):
        """Forward a base64-encoded audio chunk to Bedrock."""
        await self._send({
            "event": {
                "audioInput": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name,
                    "content": base64_audio,
                }
            }
        })

    async def send_text(self, text: str):
        """Send a cross-modal text message to Bedrock (e.g. initial prompt)."""
        content_name = str(uuid.uuid4())
        await self._send({
            "event": {
                "contentStart": {
                    "promptName": self.prompt_name,
                    "contentName": content_name,
                    "type": "TEXT",
                    "interactive": True,
                    "role": "USER",
                    "textInputConfiguration": {"mediaType": "text/plain"},
                }
            }
        })
        await self._send({
            "event": {
                "textInput": {
                    "promptName": self.prompt_name,
                    "contentName": content_name,
                    "content": text,
                }
            }
        })
        await self._send({
            "event": {
                "contentEnd": {
                    "promptName": self.prompt_name,
                    "contentName": content_name,
                }
            }
        })

    async def close(self):
        """Properly close the Bedrock session."""
        if not self.is_active:
            return
        self.is_active = False
        try:
            # Close audio stream
            await self._send({
                "event": {
                    "contentEnd": {
                        "promptName": self.prompt_name,
                        "contentName": self.audio_content_name,
                    }
                }
            })
            await self._send({
                "event": {"promptEnd": {"promptName": self.prompt_name}}
            })
            await self._send({"event": {"sessionEnd": {}}})
            await self.stream.input_stream.close()
        except Exception as e:
            print(f"[WARN] Error closing Bedrock stream: {e}")

    async def process_responses(self):
        """Read output events from Bedrock and forward to the WebSocket client."""
        try:
            while self.is_active:
                output = await self.stream.await_output()
                result = await output[1].receive()

                if not (result.value and result.value.bytes_):
                    continue

                data = json.loads(result.value.bytes_.decode("utf-8"))
                event = data.get("event", {})

                # ── contentStart (track role & speculative flag) ──
                if "contentStart" in event:
                    cs = event["contentStart"]
                    self.role = cs.get("role")
                    self.display_assistant_text = False
                    if "additionalModelFields" in cs:
                        extra = json.loads(cs["additionalModelFields"])
                        if extra.get("generationStage") == "SPECULATIVE":
                            self.display_assistant_text = True

                # ── textOutput ────────────────────────────────────
                elif "textOutput" in event:
                    text = event["textOutput"].get("content", "")
                    if self.role == "ASSISTANT" and self.display_assistant_text:
                        send_to_client(self.connection_id, {
                            "type": "text_output",
                            "text": text,
                            "role": "assistant",
                            "isFinal": True,
                        })
                    elif self.role == "USER":
                        send_to_client(self.connection_id, {
                            "type": "text_output",
                            "text": text,
                            "role": "user",
                            "isFinal": True,
                        })

                # ── audioOutput ───────────────────────────────────
                elif "audioOutput" in event:
                    audio_b64 = event["audioOutput"].get("content", "")
                    send_to_client(self.connection_id, {
                        "type": "audio_output",
                        "audio": audio_b64,
                    })

                # ── contentEnd ────────────────────────────────────
                elif "contentEnd" in event:
                    if self.role == "ASSISTANT":
                        self.question_count += 1
                        update_connection_record(self.connection_id, {
                            "questionCount": self.question_count,
                            "conversationState": "user_answering",
                        })
                        send_to_client(self.connection_id, {
                            "type": "turn_end",
                            "questionsRemaining": MAX_QUESTIONS - self.question_count,
                            "waitingForAnswer": True,
                        })

        except Exception as e:
            if self.is_active:
                print(f"[ERROR] Response processing failed: {e}")
                send_to_client(self.connection_id, {
                    "type": "error",
                    "code": "STREAM_ERROR",
                    "message": "Streaming interrupted. Please try again.",
                })


# ═════════════════════════════════════════════════════════════════════
# Lambda handler — routes WebSocket messages
# ═════════════════════════════════════════════════════════════════════

# Global session reference: only one session per Lambda container.
# When `session_start` arrives, we create the session and keep it
# alive, processing responses in the background. Subsequent
# `audio_chunk` messages feed audio into the existing stream.
_active_session: NovaSonicSession | None = None


async def _run_session(connection_id: str, config: dict):
    """Create a Nova Sonic session, stream the first question, and
    keep processing responses until the session ends."""
    global _active_session

    conn = get_connection_record(connection_id)
    if not conn:
        send_to_client(connection_id, {
            "type": "error", "code": "CONNECTION_NOT_FOUND",
            "message": "Connection record not found",
        })
        return

    session_data = fetch_session_data(
        conn["userId"], conn["sessionDate"], conn["sessionId"]
    )
    if not session_data:
        send_to_client(connection_id, {
            "type": "error", "code": "SESSION_DATA_ERROR",
            "message": "Failed to fetch session data",
        })
        return

    system_prompt = build_system_prompt(
        session_data["transcript"], session_data["custom_persona"]
    )
    voice_id = config.get("voiceId", DEFAULT_VOICE_ID)
    sensitivity = config.get("endpointingSensitivity", "MEDIUM")

    session = NovaSonicSession(
        connection_id=connection_id,
        system_prompt=system_prompt,
        voice_id=voice_id,
        endpointing_sensitivity=sensitivity,
    )
    _active_session = session

    try:
        await session.start()

        update_connection_record(connection_id, {
            "conversationState": "ai_asking",
            "questionCount": 0,
        })
        send_to_client(connection_id, {
            "type": "session_ready",
            "sessionId": conn["sessionId"],
            "questionsRemaining": MAX_QUESTIONS,
            "message": "AI is about to ask the first question",
        })

        # Ask the AI to start speaking first
        await session.send_text("Please ask your first question to the presenter.")

        # Block on response processing until session ends
        await session.process_responses()

    except Exception as e:
        print(f"[ERROR] Session error: {e}")
        send_to_client(connection_id, {
            "type": "error", "code": "SESSION_ERROR",
            "message": str(e),
        })
    finally:
        await session.close()
        _active_session = None


def handle_session_start(connection_id: str, config: dict):
    """Kick off the bidirectional streaming session (blocking)."""
    asyncio.run(_run_session(connection_id, config))
    return _response(200)


def handle_audio_chunk(connection_id: str, body: dict):
    """Forward an audio chunk into the running Bedrock stream."""
    global _active_session
    if _active_session and _active_session.is_active:
        audio_b64 = body.get("audio", "")
        if audio_b64:
            asyncio.run(_active_session.send_audio(audio_b64))
    return _response(200)


def handle_control(connection_id: str, body: dict):
    """Handle control messages (end_session, etc.)."""
    global _active_session
    action = body.get("action")
    print(f"[INFO] Control action '{action}' for {connection_id}")

    if action == "end_session":
        if _active_session and _active_session.is_active:
            asyncio.run(_active_session.close())
        send_to_client(connection_id, {
            "type": "session_ended",
            "message": "Session ended by user",
        })
        try:
            connections_table.delete_item(Key={"connectionId": connection_id})
        except Exception as e:
            print(f"[ERROR] Failed to delete connection: {e}")

    return _response(200)


def lambda_handler(event, context):
    """Main Lambda handler — routes WebSocket $default messages."""
    try:
        connection_id = event.get("requestContext", {}).get("connectionId")
        body = json.loads(event.get("body", "{}"))
        msg_type = body.get("type")

        print(f"[INFO] Message: {msg_type}, connection: {connection_id}")

        if msg_type == "session_start":
            return handle_session_start(connection_id, body.get("config", {}))

        elif msg_type == "audio_chunk":
            return handle_audio_chunk(connection_id, body)

        elif msg_type == "control":
            return handle_control(connection_id, body)

        else:
            print(f"[WARN] Unknown message type: {msg_type}")
            return _response(400, {"message": "Unknown message type"})

    except Exception as e:
        print(f"[ERROR] lambda_handler: {e}")
        return _response(500, {"message": "Internal server error"})
