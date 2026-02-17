import boto3
from botocore.exceptions import ClientError
import json
import os
import time
import base64
from datetime import datetime

# ─── Environment variables ────────────────────────────────────────────
CONNECTIONS_TABLE_NAME = os.environ.get('CONNECTIONS_TABLE_NAME')
UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET')
WEBSOCKET_API_ENDPOINT = os.environ.get('WEBSOCKET_API_ENDPOINT')
BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'amazon.nova-2-sonic-v1:0')
MAX_TOKENS = int(os.environ.get('MAX_TOKENS', '2048'))
DEFAULT_VOICE_ID = os.environ.get('DEFAULT_VOICE_ID', 'matthew')
MAX_QUESTIONS = int(os.environ.get('MAX_QUESTIONS', '10'))
MAX_DURATION_SECONDS = int(os.environ.get('MAX_DURATION_SECONDS', '600'))

if not all([CONNECTIONS_TABLE_NAME, UPLOADS_BUCKET, WEBSOCKET_API_ENDPOINT]):
    print("[ERROR] Required environment variables not set")
    raise ValueError("Missing required environment variables")

# ─── AWS Clients ──────────────────────────────────────────────────────
s3_client = boto3.client('s3')
bedrock_runtime = boto3.client('bedrock-runtime')
dynamodb = boto3.resource('dynamodb')
connections_table = dynamodb.Table(CONNECTIONS_TABLE_NAME)

# Extract WebSocket endpoint for API Gateway Management API
ws_endpoint = WEBSOCKET_API_ENDPOINT.replace('wss://', 'https://').replace('/prod', '')
apigw_client = boto3.client('apigatewaymanagementapi', endpoint_url=ws_endpoint + '/prod')

# ─── System Prompt Template ───────────────────────────────────────────
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


def _response(status_code: int, body: dict = None) -> dict:
    """Helper to format Lambda response."""
    return {
        'statusCode': status_code,
        'body': json.dumps(body) if body else ''
    }


def send_to_client(connection_id: str, message: dict):
    """Send message to WebSocket client."""
    try:
        apigw_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message).encode('utf-8')
        )
        print(f"[INFO] Sent message to {connection_id}: {message.get('type')}")
    except apigw_client.exceptions.GoneException:
        print(f"[WARN] Connection {connection_id} is gone")
        # Clean up stale connection
        try:
            connections_table.delete_item(Key={'connectionId': connection_id})
        except Exception as e:
            print(f"[ERROR] Failed to delete stale connection: {e}")
    except Exception as e:
        print(f"[ERROR] Failed to send message to {connection_id}: {e}")


def get_connection_record(connection_id: str) -> dict:
    """Fetch connection record from DynamoDB."""
    try:
        response = connections_table.get_item(Key={'connectionId': connection_id})
        return response.get('Item')
    except ClientError as e:
        print(f"[ERROR] Failed to get connection record: {e}")
        return None


def update_connection_record(connection_id: str, updates: dict):
    """Update connection record in DynamoDB."""
    try:
        update_expr = 'SET ' + ', '.join([f'#{k} = :{k}' for k in updates.keys()])
        update_expr += ', lastActivity = :lastActivity'

        expr_attr_names = {f'#{k}': k for k in updates.keys()}
        expr_attr_values = {f':{k}': v for k, v in updates.items()}
        expr_attr_values[':lastActivity'] = int(datetime.now().timestamp())

        connections_table.update_item(
            Key={'connectionId': connection_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values
        )
        print(f"[INFO] Updated connection record for {connection_id}")
    except ClientError as e:
        print(f"[ERROR] Failed to update connection record: {e}")


def fetch_session_data(user_id: str, session_date: str, session_id: str) -> dict:
    """Fetch transcript and custom persona from S3."""
    try:
        # Fetch transcript
        transcript_key = f"{user_id}/{session_date}/{session_id}/transcript.json"
        transcript_obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=transcript_key)
        transcript_data = json.loads(transcript_obj['Body'].read().decode('utf-8'))
        full_transcript = transcript_data.get('full_text', '')

        # Try to fetch custom persona (optional)
        custom_persona = ''
        try:
            persona_key = f"{user_id}/{session_date}/{session_id}/CUSTOM_PERSONA_INSTRUCTION.txt"
            persona_obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=persona_key)
            custom_persona = persona_obj['Body'].read().decode('utf-8')
            print(f"[INFO] Custom persona loaded for session {session_id}")
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                print(f"[INFO] No custom persona found for session {session_id}")
            else:
                print(f"[WARN] Error fetching custom persona: {e}")

        return {
            'transcript': full_transcript,
            'custom_persona': custom_persona
        }

    except ClientError as e:
        print(f"[ERROR] Failed to fetch session data from S3: {e}")
        return None


def build_system_prompt(transcript: str, custom_persona: str) -> str:
    """Build system prompt from template."""
    custom_persona_text = ''
    if custom_persona:
        custom_persona_text = f"\nCUSTOM AUDIENCE MEMBER BEHAVIOR:\n{custom_persona}"

    return SYSTEM_PROMPT_TEMPLATE.format(
        transcript=transcript,
        custom_persona=custom_persona_text,
        max_questions=MAX_QUESTIONS,
        max_minutes=MAX_DURATION_SECONDS // 60
    )


def check_session_limits(connection_record: dict) -> dict:
    """Check if session has reached limits."""
    question_count = connection_record.get('questionCount', 0)
    connected_at = connection_record.get('connectedAt', 0)
    elapsed_time = int(datetime.now().timestamp()) - connected_at

    if question_count >= MAX_QUESTIONS:
        return {
            'limit_reached': True,
            'reason': 'question_limit',
            'message': f'You have reached the {MAX_QUESTIONS} question limit.'
        }

    if elapsed_time >= MAX_DURATION_SECONDS:
        return {
            'limit_reached': True,
            'reason': 'time_limit',
            'message': f'You have reached the {MAX_DURATION_SECONDS // 60} minute session limit.'
        }

    # Warnings
    if question_count >= MAX_QUESTIONS - 2:
        return {
            'limit_reached': False,
            'warning': True,
            'message': f'{MAX_QUESTIONS - question_count} questions remaining'
        }

    if elapsed_time >= MAX_DURATION_SECONDS - 60:
        return {
            'limit_reached': False,
            'warning': True,
            'message': 'Less than 1 minute remaining'
        }

    return {'limit_reached': False, 'warning': False}


def invoke_bedrock_streaming(connection_id: str, events: list):
    """Invoke Bedrock with streaming and forward responses to client."""
    try:
        # Invoke Bedrock with streaming
        response = bedrock_runtime.invoke_model_with_response_stream(
            modelId=BEDROCK_MODEL_ID,
            body=json.dumps({'events': events})
        )

        # Process streaming response
        event_stream = response.get('body')
        if not event_stream:
            print("[ERROR] No event stream in Bedrock response")
            send_to_client(connection_id, {
                'type': 'error',
                'code': 'BEDROCK_ERROR',
                'message': 'No response stream from Bedrock'
            })
            return

        sequence = 0
        for event in event_stream:
            chunk = event.get('chunk')
            if chunk:
                chunk_data = json.loads(chunk.get('bytes').decode('utf-8'))

                # Forward different event types to client
                if 'audioOutput' in chunk_data:
                    audio_data = chunk_data['audioOutput'].get('data', '')
                    send_to_client(connection_id, {
                        'type': 'audio_output',
                        'audio': audio_data,
                        'sequence': sequence
                    })
                    sequence += 1

                elif 'textOutput' in chunk_data:
                    text = chunk_data['textOutput'].get('text', '')
                    is_final = chunk_data['textOutput'].get('isFinal', False)
                    send_to_client(connection_id, {
                        'type': 'text_output',
                        'text': text,
                        'isFinal': is_final
                    })

                elif 'turnEnd' in chunk_data:
                    # Get updated connection record to check question count
                    conn_record = get_connection_record(connection_id)
                    if conn_record:
                        questions_remaining = MAX_QUESTIONS - conn_record.get('questionCount', 0)
                        send_to_client(connection_id, {
                            'type': 'turn_end',
                            'questionsRemaining': questions_remaining,
                            'waitingForAnswer': True
                        })

        print(f"[INFO] Bedrock streaming completed for {connection_id}")

    except ClientError as e:
        print(f"[ERROR] Bedrock streaming failed: {e}")
        send_to_client(connection_id, {
            'type': 'error',
            'code': 'BEDROCK_ERROR',
            'message': 'Streaming interrupted. Please try again.'
        })


def handle_session_start(connection_id: str, config: dict):
    """Handle session start - fetch data, build prompt, initialize Bedrock, AI asks first question."""
    print(f"[INFO] Handling session_start for {connection_id}")

    # Get connection record
    conn_record = get_connection_record(connection_id)
    if not conn_record:
        send_to_client(connection_id, {
            'type': 'error',
            'code': 'CONNECTION_NOT_FOUND',
            'message': 'Connection record not found'
        })
        return _response(404)

    user_id = conn_record.get('userId')
    session_id = conn_record.get('sessionId')
    session_date = conn_record.get('sessionDate')

    # Fetch session data from S3
    session_data = fetch_session_data(user_id, session_date, session_id)
    if not session_data:
        send_to_client(connection_id, {
            'type': 'error',
            'code': 'SESSION_DATA_ERROR',
            'message': 'Failed to fetch session data'
        })
        return _response(500)

    # Build system prompt
    system_prompt = build_system_prompt(
        session_data['transcript'],
        session_data['custom_persona']
    )

    # Get voice configuration
    voice_id = config.get('voiceId', DEFAULT_VOICE_ID)
    endpointing_sensitivity = config.get('endpointingSensitivity', 'MEDIUM')

    # Build Bedrock events to initialize and trigger first question
    events = [
        {
            'sessionStart': {
                'inferenceConfiguration': {
                    'maxTokens': MAX_TOKENS,
                    'topP': 0.9,
                    'temperature': 0.7
                },
                'turnDetectionConfiguration': {
                    'endpointingSensitivity': endpointing_sensitivity
                }
            }
        },
        {
            'promptStart': {
                'systemPrompts': [{'text': {'text': system_prompt}}],
                'audioOutputConfiguration': {
                    'mediaType': 'audio/lpcm',
                    'sampleRateHertz': 16000,
                    'sampleSizeBits': 16,
                    'channelCount': 1,
                    'voiceId': voice_id,
                    'encoding': 'base64',
                    'audioType': 'SPEECH'
                },
                'textOutputConfiguration': {
                    'mediaType': 'text/plain'
                }
            }
        },
        {
            'contentStart': {
                'role': 'user'
            }
        },
        {
            'textInput': {
                'text': 'Please ask your first question to the presenter.'
            }
        },
        {
            'contentEnd': {}
        }
    ]

    # Update connection state
    update_connection_record(connection_id, {
        'conversationState': 'ai_asking',
        'questionCount': 1
    })

    # Send session_ready
    send_to_client(connection_id, {
        'type': 'session_ready',
        'sessionId': session_id,
        'questionsRemaining': MAX_QUESTIONS - 1,
        'message': 'AI is about to ask the first question'
    })

    # Invoke Bedrock to get first question
    invoke_bedrock_streaming(connection_id, events)

    return _response(200)


def handle_audio_chunk(connection_id: str, chunk_data: dict):
    """Handle audio chunk from user."""
    print(f"[INFO] Handling audio_chunk for {connection_id}")

    # Get connection record
    conn_record = get_connection_record(connection_id)
    if not conn_record:
        send_to_client(connection_id, {
            'type': 'error',
            'code': 'CONNECTION_NOT_FOUND',
            'message': 'Connection record not found'
        })
        return _response(404)

    # Update state to user_answering if needed
    if conn_record.get('conversationState') != 'user_answering':
        update_connection_record(connection_id, {
            'conversationState': 'user_answering'
        })

    # For now, we'll buffer the chunks and send them when audio_end is received
    # In a full implementation, you might stream chunks directly to Bedrock

    return _response(200)


def handle_audio_end(connection_id: str):
    """Handle end of user audio - send to Bedrock and get AI response."""
    print(f"[INFO] Handling audio_end for {connection_id}")

    # Get connection record
    conn_record = get_connection_record(connection_id)
    if not conn_record:
        send_to_client(connection_id, {
            'type': 'error',
            'code': 'CONNECTION_NOT_FOUND',
            'message': 'Connection record not found'
        })
        return _response(404)

    # Check session limits
    limits = check_session_limits(conn_record)
    if limits.get('limit_reached'):
        send_to_client(connection_id, {
            'type': 'session_limit_reached',
            'reason': limits['reason'],
            'message': limits['message']
        })
        return _response(200)

    if limits.get('warning'):
        send_to_client(connection_id, {
            'type': 'warning',
            'message': limits['message']
        })

    # Update state to ai_responding
    update_connection_record(connection_id, {
        'conversationState': 'ai_responding'
    })

    # In a full implementation, you would:
    # 1. Send contentEnd to Bedrock
    # 2. Process Bedrock response stream
    # 3. Increment question count if AI asked a new question
    # 4. Update conversation state

    # For now, send a placeholder response
    send_to_client(connection_id, {
        'type': 'text_output',
        'text': 'I understand. Let me ask you another question...',
        'isFinal': True
    })

    # Increment question count
    new_question_count = conn_record.get('questionCount', 0) + 1
    update_connection_record(connection_id, {
        'conversationState': 'ai_asking',
        'questionCount': new_question_count
    })

    send_to_client(connection_id, {
        'type': 'turn_end',
        'questionsRemaining': MAX_QUESTIONS - new_question_count,
        'waitingForAnswer': True
    })

    return _response(200)


def handle_control(connection_id: str, control_data: dict):
    """Handle control messages (interrupt, reset, end_session)."""
    action = control_data.get('action')
    print(f"[INFO] Handling control action '{action}' for {connection_id}")

    if action == 'end_session':
        send_to_client(connection_id, {
            'type': 'session_ended',
            'message': 'Session ended by user'
        })
        # Clean up connection
        try:
            connections_table.delete_item(Key={'connectionId': connection_id})
        except Exception as e:
            print(f"[ERROR] Failed to delete connection: {e}")

    return _response(200)


def lambda_handler(event, context):
    """Main Lambda handler."""
    try:
        connection_id = event.get('requestContext', {}).get('connectionId')
        body = json.loads(event.get('body', '{}'))
        message_type = body.get('type')

        print(f"[INFO] Processing message type: {message_type}, connection: {connection_id}")

        # Check remaining time and warn if running low
        remaining_time = context.get_remaining_time_in_millis()
        if remaining_time < 60000:  # 60 seconds
            print(f"[WARN] Lambda timeout approaching: {remaining_time}ms remaining")
            send_to_client(connection_id, {
                'type': 'warning',
                'message': 'Session may timeout soon, please wrap up'
            })

        # Route messages
        if message_type == 'session_start':
            config = body.get('config', {})
            return handle_session_start(connection_id, config)

        elif message_type == 'audio_chunk':
            return handle_audio_chunk(connection_id, body)

        elif message_type == 'audio_end':
            return handle_audio_end(connection_id)

        elif message_type == 'control':
            return handle_control(connection_id, body)

        else:
            print(f"[WARN] Unknown message type: {message_type}")
            return _response(400, {'message': 'Unknown message type'})

    except Exception as e:
        print(f"[ERROR] Unexpected error in lambda_handler: {e}")
        return _response(500, {'message': 'Internal server error'})
