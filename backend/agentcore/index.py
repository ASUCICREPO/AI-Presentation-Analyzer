from starlette.websockets import WebSocket, WebSocketDisconnect
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.types.events import (
    BidiAudioInputEvent,
    BidiAudioStreamEvent,
    BidiTranscriptStreamEvent,
    BidiInterruptionEvent,
    BidiResponseCompleteEvent,
)
from strands.experimental.bidi.types.io import BidiInput, BidiOutput, BidiOutputEvent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.tools import stop_conversation
from bedrock_agentcore import BedrockAgentCoreApp, RequestContext
from typing import Literal
import asyncio
import boto3
import aioboto3
import os
import json
import logging

logger = logging.getLogger("agentcore.qa")

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


def build_qa_system_prompt(persona_name: str, persona_prompt: str, custom_instructions: str, transcript_text: str) -> str:
    """Build a QA-focused system prompt from persona and presentation context."""
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
5. Maintain the conversation for approximately {SESSION_DURATION_SEC // 60} minutes

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
{transcript_text}
"""


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


class WebSocketBidiInput(BidiInput):
    """Bridge browser WebSocket audio into BidiAgent input events.

    The browser sends JSON frames: {"action": "audio", "data": "<base64 PCM>"}
    This converts them into BidiAudioInputEvent objects the agent understands.
    The frontend already base64-encodes 16-bit PCM at 16 kHz mono.
    """

    def __init__(self, websocket: WebSocket):
        self._ws = websocket
        self._stopped = False

    async def start(self, agent: BidiAgent) -> None:
        self._stopped = False

    async def __call__(self) -> BidiAudioInputEvent:
        while not self._stopped:
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
    """

    def __init__(self, websocket: WebSocket):
        self._ws = websocket

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

            elif isinstance(event, BidiInterruptionEvent):
                await self._ws.send_json({"type": "interruption"})

            elif isinstance(event, BidiResponseCompleteEvent):
                pass

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.warning("Failed to send output event: %s", e)

    async def stop(self) -> None:
        pass


async def load_persona(persona_id: str) -> dict:
    """Load persona configuration from DynamoDB."""
    table_name = os.getenv('PERSONA_TABLE_NAME')
    if not table_name:
        print("[Error] PERSONA_TABLE_NAME environment variable not set")
        return {}
    
    try:
        session = aioboto3.Session()
        async with session.resource('dynamodb', region_name=REGION) as dynamodb:
            table = await dynamodb.Table(table_name)
            response = await table.get_item(Key={'personaID': persona_id})
            
            if 'Item' not in response:
                print(f"[Error] Persona {persona_id} not found in DynamoDB")
                return {}
            
            return response['Item']
    except Exception as e:
        print(f"[Error] Failed to load persona {persona_id}: {e}")
        import traceback
        traceback.print_exc()
        return {}


async def load_transcript(user_id: str, date_str: str, session_id: str) -> str:
    """Load presentation transcript from S3."""
    bucket_name = os.getenv('UPLOADS_BUCKET')
    if not bucket_name:
        print("[Error] UPLOADS_BUCKET environment variable not set")
        return ""
    
    # S3 key format: {userId}/{dateStr}/{sessionId}/transcript.json
    s3_key = f"{user_id}/{date_str}/{session_id}/transcript.json"
    
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
            
            return transcript_text.strip()
            
    except Exception as e:
        print(f"[Warning] Failed to load transcript from s3://{bucket_name}/{s3_key}: {e}")
        return ""


app = BedrockAgentCoreApp()

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
        logger.warning("[WebSocket] Timed out waiting for setup message")
        await websocket.send_json({"type": "error", "message": "Setup message not received within 10 s"})
        await websocket.close()
        return
    except WebSocketDisconnect:
        logger.info("[WebSocket] Client disconnected before sending setup")
        return

    if raw.get("action") != "setup":
        logger.warning("[WebSocket] Expected setup message, got: %s", raw.get("action"))
        await websocket.send_json({"type": "error", "message": "First message must be {action: 'setup', ...}"})
        await websocket.close()
        return

    persona_id = raw.get("personaId", "")
    user_id    = raw.get("userId", "")
    date_str   = raw.get("dateStr", "")
    voice_id   = raw.get("voiceId", DEFAULT_VOICE_ID)
    session_id = raw.get("sessionId", "") or (context.session_id or "")

    logger.info("[WebSocket] Setup from user=%s persona=%s session=%s", user_id, persona_id, session_id)

    if not persona_id or not user_id or not session_id:
        logger.warning("[WebSocket] Missing required params: persona=%s user=%s session=%s", persona_id, user_id, session_id)
        await websocket.send_json({"type": "error", "message": "Setup missing personaId, userId, or sessionId"})
        await websocket.close()
        return
    
    agent = None

    try:
        persona_data = await load_persona(persona_id)
        if not persona_data:
            await websocket.send_json({"type": "error", "message": f"Persona {persona_id} not found"})
            await websocket.close()
            return

        transcript_text = await load_transcript(user_id, date_str, session_id)
        if not transcript_text:
            logger.info("[WebSocket] No transcript for session %s, using placeholder", session_id)
            transcript_text = "No presentation transcript available."

        system_prompt = build_qa_system_prompt(
            persona_name=persona_data.get('name', 'Interviewer'),
            persona_prompt=persona_data.get('personaPrompt', ''),
            custom_instructions=persona_data.get('description', ''),
            transcript_text=transcript_text
        )

        model = create_nova_sonic_model(voice_id)
        agent = BidiAgent(
            model=model,
            tools=[stop_conversation],
            system_prompt=system_prompt,
        )

        await websocket.send_json({
            "type": "session_started",
            "persona_name": persona_data.get('name', 'Interviewer'),
            "session_id": session_id
        })
        
        ws_input = WebSocketBidiInput(websocket)
        ws_output = WebSocketBidiOutput(websocket)
        
        logger.info("[WebSocket] Starting BidiAgent for session %s", session_id)
        await agent.run(inputs=[ws_input], outputs=[ws_output])
        
    except WebSocketDisconnect:
        logger.info("[WebSocket] Client disconnected")
    except asyncio.CancelledError:
        logger.info("[WebSocket] Session cancelled (client ended or disconnected)")
    except Exception as e:
        logger.exception("[WebSocket] Handler error: %s", e)
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except Exception:
            pass
    finally:
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
