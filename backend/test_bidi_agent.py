#!/usr/bin/env python3
"""Test script for bidirectional agent lifecycle."""

import asyncio
import json
import threading
import time
from typing import Optional


class MockBidiAgent:
    """Mock agent for testing the lifecycle without AWS dependencies."""

    def __init__(self, system_prompt: str):
        self.system_prompt = system_prompt
        self.is_started = False
        self.is_stopped = False
        self._receive_queue = asyncio.Queue()

    async def start(self):
        """Start the agent."""
        print("[Agent] Starting...")
        await asyncio.sleep(0.5)  # Simulate startup time
        self.is_started = True
        print("[Agent] Started successfully")

        # Queue an initial greeting
        await self._receive_queue.put({
            "type": "bidi_transcript_stream",
            "role": "assistant",
            "transcript": "Hello! I see you've given a presentation. Let me ask you about it.",
            "is_partial": False,
        })

    async def stop(self):
        """Stop the agent."""
        print("[Agent] Stopping...")
        self.is_stopped = True
        await self._receive_queue.put({
            "type": "bidi_connection_close",
        })
        print("[Agent] Stopped")

    async def send(self, data):
        """Send data to the agent."""
        if isinstance(data, str):
            print(f"[Agent] Received text: {data}")
        elif isinstance(data, dict):
            if data.get("type") == "bidi_audio_input":
                print(f"[Agent] Received audio chunk (format: {data.get('format')})")
                # Simulate processing and generate a response
                await asyncio.sleep(0.1)
                await self._receive_queue.put({
                    "type": "bidi_transcript_stream",
                    "role": "user",
                    "transcript": "This is simulated user speech",
                    "is_partial": False,
                })
                await asyncio.sleep(0.5)
                await self._receive_queue.put({
                    "type": "bidi_transcript_stream",
                    "role": "assistant",
                    "transcript": "That's interesting! Can you elaborate?",
                    "is_partial": False,
                })

    async def receive(self):
        """Receive events from the agent."""
        while not self.is_stopped:
            try:
                event = await asyncio.wait_for(self._receive_queue.get(), timeout=1.0)
                yield event
                if event.get("type") == "bidi_connection_close":
                    break
            except asyncio.TimeoutError:
                continue


class SessionManager:
    """Manages bidirectional agent sessions."""

    def __init__(self):
        self.sessions = {}

    def start_session(self, connection_id: str, system_prompt: str):
        """Start a new agent session."""
        print(f"\n[Manager] Starting session for connection: {connection_id}")

        agent = MockBidiAgent(system_prompt)
        loop = asyncio.new_event_loop()

        session = {
            "agent": agent,
            "agent_loop": loop,
            "agent_started": False,
            "connection_id": connection_id,
        }

        async def _start_agent():
            """Start the agent."""
            try:
                await agent.start()
                session["agent_started"] = True
                print(f"[Manager] Agent started for connection {connection_id}")
            except Exception as e:
                print(f"[Manager] Error starting agent: {e}")

        async def _process_outputs():
            """Process agent outputs."""
            try:
                async for event in agent.receive():
                    event_type = event.get("type", "")
                    print(f"[Manager] Output event: {event_type}")

                    if event_type == "bidi_transcript_stream":
                        role = event.get("role", "")
                        text = event.get("transcript", "")
                        print(f"[Manager] Transcript [{role}]: {text}")

                    elif event_type == "bidi_connection_close":
                        print(f"[Manager] Connection closed")
                        break

            except Exception as e:
                print(f"[Manager] Error processing outputs: {e}")
            finally:
                await agent.stop()

        async def _run_agent_tasks():
            """Run both start and output processing tasks."""
            await _start_agent()
            await _process_outputs()

        def _run_agent_thread():
            """Thread entry point."""
            asyncio.set_event_loop(loop)
            loop.run_until_complete(_run_agent_tasks())
            loop.close()

        agent_thread = threading.Thread(target=_run_agent_thread)
        agent_thread.daemon = True
        agent_thread.start()

        session["agent_thread"] = agent_thread
        self.sessions[connection_id] = session

        # Give the agent a moment to start
        time.sleep(0.5)
        return session

    def send_audio(self, connection_id: str, audio_data: str):
        """Send audio to an agent."""
        session = self.sessions.get(connection_id)
        if not session:
            print(f"[Manager] No session for connection: {connection_id}")
            return False

        agent = session["agent"]
        agent_loop = session["agent_loop"]

        if not session.get("agent_started"):
            print(f"[Manager] Agent not started for connection: {connection_id}")
            return False

        async def _send_audio():
            await agent.send({
                "type": "bidi_audio_input",
                "audio": audio_data,
                "format": "pcm",
                "sample_rate": 16000,
                "channels": 1,
            })

        if agent_loop and agent_loop.is_running():
            asyncio.run_coroutine_threadsafe(_send_audio(), agent_loop)
            print(f"[Manager] Sent audio to connection: {connection_id}")
            return True
        else:
            print(f"[Manager] Agent loop not running for connection: {connection_id}")
            return False

    def end_session(self, connection_id: str):
        """End an agent session."""
        session = self.sessions.get(connection_id)
        if not session:
            print(f"[Manager] No session to end for connection: {connection_id}")
            return

        agent = session["agent"]
        agent_loop = session["agent_loop"]
        agent_thread = session["agent_thread"]

        if agent and agent_loop and agent_loop.is_running():
            async def _stop_agent():
                await agent.stop()

            asyncio.run_coroutine_threadsafe(_stop_agent(), agent_loop)

            if agent_thread and agent_thread.is_alive():
                agent_thread.join(timeout=2.0)

        del self.sessions[connection_id]
        print(f"[Manager] Ended session for connection: {connection_id}")


def main():
    """Test the bidirectional agent lifecycle."""
    print("Testing Bidirectional Agent Lifecycle")
    print("=" * 50)

    manager = SessionManager()
    connection_id = "test-connection-123"

    # Test 1: Start session
    print("\n1. Starting session...")
    session = manager.start_session(
        connection_id,
        system_prompt="You are a helpful QA assistant asking about a presentation."
    )

    # Wait for agent to be ready
    time.sleep(1.0)

    # Test 2: Send audio (simulating user speaking)
    print("\n2. Sending audio data...")
    for i in range(3):
        audio_data = f"base64_audio_chunk_{i}"
        success = manager.send_audio(connection_id, audio_data)
        if not success:
            print("Failed to send audio!")
            break
        time.sleep(0.5)

    # Wait for responses
    time.sleep(2.0)

    # Test 3: End session
    print("\n3. Ending session...")
    manager.end_session(connection_id)

    # Wait for cleanup
    time.sleep(1.0)

    print("\n" + "=" * 50)
    print("Test completed successfully!")


if __name__ == "__main__":
    main()