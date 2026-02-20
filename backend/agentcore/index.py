from starlette.websockets import WebSocket, WebSocketDisconnect
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.io.text import BidiTextIO
from strands.experimental.bidi.types.events import BidiAudioInputEvent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.tools import stop_conversation
from strands.experimental.hooks.events import (
    BidiAgentInitializedEvent,
    BidiBeforeInvocationEvent,
    BidiAfterInvocationEvent,
    BidiMessageAddedEvent
)
from bedrock_agentcore import BedrockAgentCoreApp
from typing import Literal
import asyncio
import boto3
import aioboto3
import os
import json

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
            "boto_session": boto3.Session(),
            "region": REGION
        }
    )


def create_qa_agent(system_prompt: str, voice_id: str = None) -> BidiAgent:
    """Create a BidiAgent configured for QA sessions."""
    model = create_nova_sonic_model(voice_id)
    return BidiAgent(
        model=model,
        tools=[stop_conversation],
        system_prompt=system_prompt,
    )


class ConversationLogger:
    """Log all major conversation events for debugging and analysis."""

    async def on_agent_initialized(self, event: BidiAgentInitializedEvent):
        print(f"Agent initialized with model: {event.agent.model.model_id}")

    async def on_before_invocation(self, event: BidiBeforeInvocationEvent):
        print(f"Before invocation: {event.agent.model.model_id}, input type: {type(event.input)}")

    async def on_after_invocation(self, event: BidiAfterInvocationEvent):
        print(f"QA session ended for conversation with ID: {event.conversation_id}")


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


async def main():
    # Persistent connection with continuous streaming
    # BidiAudioIO uses pyaudio (local mic) — only import when running locally
    from strands.experimental.bidi import BidiAudioIO
    import signal

    audio_io = BidiAudioIO()
    text_io = None  # BidiTextIO removed in newer strands SDK
    loop = asyncio.get_event_loop()

    def signal_handler():
        print("Received stop signal, stopping agent...")
        loop.create_task(agent.stop())

    loop.add_signal_handler(signal.SIGINT, signal_handler)
    loop.add_signal_handler(signal.SIGTERM, signal_handler)

    try:
        await agent.start()
        await agent.run(
            inputs=[audio_io.input()],
            outputs=[audio_io.output()]
        )
    except asyncio.CancelledError:
        print("Agent run cancelled, shutting down...")

app = BedrockAgentCoreApp()

@app.websocket
async def websocket_handler(websocket, context):
    """
    WebSocket handler for Q&A sessions.
    
    Custom headers are passed as query parameters with prefix:
    X-Amzn-Bedrock-AgentCore-Runtime-Custom-
    
    Expected headers:
    - PersonaId: DynamoDB persona ID
    - UserId: User identifier
    - DateStr: Session date string
    - VoiceId: Voice selection (optional)
    """
    
    # Extract custom headers from context
    # AgentCore passes custom headers in context['headers']
    headers = context.get('headers', {})
    
    persona_id = headers.get('x-amzn-bedrock-agentcore-runtime-custom-personaid', '')
    user_id = headers.get('x-amzn-bedrock-agentcore-runtime-custom-userid', '')
    date_str = headers.get('x-amzn-bedrock-agentcore-runtime-custom-datestr', '')
    voice_id = headers.get('x-amzn-bedrock-agentcore-runtime-custom-voiceid', DEFAULT_VOICE_ID)
    
    # Session ID is in standard header
    session_id = headers.get('x-amzn-bedrock-agentcore-runtime-session-id', '')
    
    print(f"[WebSocket] Connection from user={user_id}, persona={persona_id}, session={session_id}")
    
    agent = None
    
    try:
        # Load persona configuration from DynamoDB
        persona_data = await load_persona(persona_id)
        if not persona_data:
            await websocket.accept()
            await websocket.send_json({
                "type": "error",
                "message": f"Persona {persona_id} not found"
            })
            await websocket.close()
            return
        
        # Load presentation transcript from S3
        transcript_text = await load_transcript(user_id, date_str, session_id)
        if not transcript_text:
            print(f"[Warning] No transcript found for session {session_id}, using empty transcript")
            transcript_text = "No presentation transcript available."
        
        # Build QA system prompt
        system_prompt = build_qa_system_prompt(
            persona_name=persona_data.get('name', 'Interviewer'),
            persona_prompt=persona_data.get('personaPrompt', ''),
            custom_instructions=persona_data.get('description', ''),
            transcript_text=transcript_text
        )
        
        # Create agent with configuration
        model = create_nova_sonic_model(voice_id)
        agent = BidiAgent(
            model=model,
            tools=[stop_conversation],
            system_prompt=system_prompt,
        )
        
        # Accept connection and start agent
        await websocket.accept()
        
        # Send session started event
        await websocket.send_json({
            "type": "session_started",
            "persona_name": persona_data.get('name', 'Interviewer'),
            "session_id": session_id
        })
        
        # Run agent with bidirectional streaming
        await agent.start()
        await agent.run(
            inputs=[websocket.receive_json],
            outputs=[websocket.send_json]
        )
        
    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected")
    except Exception as e:
        print(f"[Error] WebSocket handler error: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        if agent:
            try:
                await agent.stop()
            except:
                pass
        try:
            await websocket.close()
        except:
            pass



if __name__ == "__main__":
    app.run()
