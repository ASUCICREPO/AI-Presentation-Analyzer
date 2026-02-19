from starlette.websockets import WebSocket
from strands.experimental.bidi import BidiAgent, BidiAudioIO, BidiTextIO
from strands.experimental.bidi.types.events import BidiAudioInputEvent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.tools import stop_conversation
from strands.experimental.bidi.hooks.events import (
    BidiAgentInitializedEvent,
    BidiBeforeInvocationEvent,
    BidiAfterInvocationEvent,
    BidiMessageAddedEvent
)
from bedrock_agentcore import BedrockAgentCoreApp
from typing import Literal
import asyncio
import boto3
import os

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


audio_io = BidiAudioIO()
text_io = BidiTextIO()


async def main():
    # Persistent connection with continuous streaming
    import signal

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
            outputs=[audio_io.output(), text_io.output()]
        )
    except asyncio.CancelledError:
        print("Agent run cancelled, shutting down...")

app = BedrockAgentCoreApp()

@app.websocket
async def websocket_handler(websocket, context):

    model = create_nova_sonic_model()
    agent = BidiAgent(
        model=model,
        tools=[stop_conversation]
    )

    try:
        await websocket.accept()
        await agent.run(inputs=[websocket.receive_json], outputs=[websocket.send_json])
    except WebSocketDisconnect:
        print("Client WebSocket disconnected, stopping agent...")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await agent.stop()
        await websocket.close()



if __name__ == "__main__":
    asyncio.run(main())
