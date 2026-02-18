# Bidirectional Agent Lifecycle Fix

## Problem
The Lambda function was blocking when starting the Strands BidiAgent, preventing it from processing incoming audio messages. The error "Agent not started. Send { action: 'start' } first" occurred even after sending the start action because the Lambda was stuck in a synchronous loop waiting for agent outputs.

## Root Cause
The original implementation used `loop.run_until_complete(_run_agent())` which blocked the Lambda execution. This prevented the Lambda from:
1. Processing incoming WebSocket messages after starting the agent
2. Forwarding audio data to the agent
3. Handling the bidirectional streaming correctly

## Solution
Restructured the agent lifecycle to run asynchronously in a background thread:

### Key Changes

1. **Non-blocking Agent Start**: The agent now runs in a separate thread, allowing the Lambda to continue processing WebSocket messages.

2. **Shared Event Loop**: Each session maintains its own event loop (`agent_loop`) that runs in a background thread for the duration of the session.

3. **Async Message Forwarding**: Audio and text inputs are forwarded to the agent using `asyncio.run_coroutine_threadsafe()` to safely schedule coroutines on the agent's event loop.

4. **Proper Cleanup**: Sessions are properly cleaned up, stopping the agent and joining threads on disconnect.

## Implementation Details

### Session Start Flow
1. Create BidiAgent with configuration
2. Create new event loop for the agent
3. Start background thread running the agent
4. Agent starts and begins processing outputs
5. Lambda returns immediately, ready for more messages

### Message Flow
1. Client sends audio/text via WebSocket
2. Lambda receives message
3. Lambda schedules send operation on agent's loop
4. Agent processes input and generates output
5. Output events are sent back via WebSocket

### Session End Flow
1. Client sends end action or disconnects
2. Lambda schedules agent.stop() on agent's loop
3. Thread is joined with timeout
4. Session data is saved to S3
5. Resources are cleaned up

## Testing
A test script (`test_bidi_agent.py`) verifies the lifecycle works correctly:
- Agent starts without blocking
- Audio can be sent while agent is running
- Outputs are processed concurrently
- Clean shutdown works properly

## Deployment Notes
- No changes needed to CDK stack or infrastructure
- Lambda function will handle concurrent sessions properly
- Each connection maintains its own agent instance and thread
- Thread safety is ensured via asyncio's thread-safe primitives