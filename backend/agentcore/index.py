from strands.experimental.bidi import BidiAgent, BidiAudioIO, BidiTextIO
from strands.experimental.bidi.types.events import BidiAudioInputEven
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.tools import stop_conversation
from strands.experimental.bidi.hooks.events import (
    BidiAgentInitializedEvent,
    BidiBeforeInvocationEvent,
    BidiAfterInvocationEvent,
    BidiMessageAddedEvent
)
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

DEFAULT_VOICE_ID: Literal["matthew", "tiffany", "amy", "ambre", "florian", "beatrice", "lorenzo", "greta", "lennart", "lupe", "carlos"] = os.getenv("VOICE_ID", "matthew")  # Default to "matthew" if not set
REGION = os.getenv("AWS_REGION", "us-east-1") #Always available in Lambda environment, but default to us-east-1 if not set for local development
if DEFAULT_VOICE_ID not in ["matthew", "tiffany", "amy", "ambre", "florian", "beatrice", "lorenzo", "greta", "lennart", "lupe", "carlos"]:
    raise ValueError(f"Invalid VOICE_ID '{DEFAULT_VOICE_ID}'. Must be one of: 'matthew', 'tiffany', 'amy', 'ambre', 'florian', 'beatrice', 'lorenzo', 'greta', 'lennart', 'lupe', 'carlos'.")
MODEL_ID=os.getenv("MODEL_ID", "amazon.nova-2-sonic-v1:0") #Nova 2 Sonic default for best performance. 

model = BidiNovaSonicModel(
    model_id=MODEL_ID,
    provider_config={
        "audio": {
            "input_rate": 16000,
            "output_rate": 16000,
            "voice": DEFAULT_VOICE_ID,
            "channels": 1,
            "format": "pcm"
        }
    },
    client_config={
        "boto_session": boto3.Session(),
        "region": REGION
    }
)
agent = BidiAgent(
    model=model, 
    tools=[stop_conversation]
)
audio_io = BidiAudioIO()
text_io = BidiTextIO()

class ConversationLogger:
    """
    Log all major conversation events for debugging and analysis.
    """

    async def on_agent_initialized(self, event: BidiAgentInitializedEvent):
        print(f"Agent initialized with model: {event.agent.model.model_id}")
    
    async def on_before_invocation(self, event: BidiBeforeInvocationEvent):
        print(f"Before invocation: {event.agent.model.model_id}, input type: {type(event.input)}")

    async def on_after_invocation(self, event: BidiAfterInvocationEvent):
        print(f"QA session ended for conversation with ID: {event.conversation_id}")

class InterruptionTracker:
    def __init__(self):
        self.interruption_count = 0
        self.interruptions = []

    async def on_interruption(self, event: BidiInterruptionEvent):
        self.interruption_count += 1
        self.interruptions.append({
            "reason": event.reason,
            "response_id": event.interrupted_response_id,
            "timestamp": time.time()
        })

        print(f"Interruption #{self.interruption_count}: {event.reason}")

async def main():
    # Persistent connection with continuous streaming

    loop = asyncio.get_event_loop()

    def signal_handler():
        print("Received stop signal, stopping agent...")
        loop.create_task(agent.stop())

    loop.add_signal_handler(signal.SIGINT, signal_handler)
    loop.add_signal_handler(signal.SIGTERM, signal_handler)

    try:
        await agent.run(
            inputs=[audio_io.input()],
            outputs=[audio_io.output(), text_io.output()]
        )
    except asyncio.CancelledError:
        print("Agent run cancelled, shutting down...")
        

if __name__ == "__main__":
    asyncio.run(main())



