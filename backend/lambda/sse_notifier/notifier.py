"""
SSE Notifier Lambda

Manages Server-Sent Events (SSE) connections and sends completion notifications.
Uses DynamoDB to store completion status with TTL.
"""

import boto3
import json
import os
import time
from typing import Dict
from botocore.exceptions import ClientError

UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET')
SSE_NOTIFICATIONS_TABLE = os.environ.get('SSE_NOTIFICATIONS_TABLE', 'SSENotifications')
NOTIFICATION_TTL_SECONDS = 3600  # 1 hour


def _response(status_code: int, headers: Dict = None, body: str = None) -> dict:
    """Return properly formatted API Gateway response."""
    default_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    }
    if headers:
        default_headers.update(headers)

    return {
        'statusCode': status_code,
        'headers': default_headers,
        'body': body or '',
    }


def store_completion_status(session_id: str, status: str) -> bool:
    """
    Store completion status in DynamoDB for client to retrieve.

    :param session_id: Session ID
    :param status: Status ('completed' or 'failed')
    :return: True if successful, False otherwise
    """
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(SSE_NOTIFICATIONS_TABLE)

    try:
        table.put_item(
            Item={
                'sessionID': session_id,
                'status': status,
                'timestamp': int(time.time()),
                'ttl': int(time.time()) + NOTIFICATION_TTL_SECONDS  # Auto-delete after 1 hour
            }
        )
        print(f"[INFO] Stored completion status for session {session_id}: {status}")
        return True
    except ClientError as e:
        print(f"[ERROR] Failed to store completion status: {str(e)}")
        return False


def get_completion_status(session_id: str) -> Dict:
    """
    Check DynamoDB for completion status.

    :param session_id: Session ID
    :return: Dict with status and timestamp, or None if not found
    """
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(SSE_NOTIFICATIONS_TABLE)

    try:
        response = table.get_item(Key={'sessionID': session_id})

        if 'Item' in response:
            print(f"[INFO] Found completion status for session {session_id}")
            return {
                'status': response['Item'].get('status', 'unknown'),
                'timestamp': response['Item'].get('timestamp', 0)
            }

        print(f"[INFO] No completion status found for session {session_id}")
        return None
    except ClientError as e:
        print(f"[ERROR] Failed to get completion status: {str(e)}")
        return None


def lambda_handler(event, context):
    """
    SSE Notifier Handler

    For GET /sse/{sessionID}: Client polls for completion status
    For other methods (invoked from engagement_scores_ai): Store completion event in DynamoDB
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    http_method = event.get('httpMethod', '')

    if http_method == 'GET':
        # Client polling for completion status
        session_id = event.get('pathParameters', {}).get('sessionID')

        if not session_id:
            return _response(400, body='Missing sessionID parameter')

        completion = get_completion_status(session_id)

        if completion:
            # Return SSE-formatted completion event
            sse_event = f'data: {json.dumps(completion)}\n\n'
            return _response(200, {'Content-Type': 'text/event-stream'}, sse_event)
        else:
            # Still processing - return keep-alive comment
            sse_keepalive = f': {{"status": "processing"}}\n\n'
            return _response(200, {'Content-Type': 'text/event-stream'}, sse_keepalive)

    else:
        # Called by engagement_scores_ai Lambda to store completion status
        session_id = event.get('sessionID')
        status = event.get('status', 'completed')

        if not session_id:
            return _response(400, body='Missing sessionID in event')

        success = store_completion_status(session_id, status)

        if success:
            return _response(200, body=json.dumps({
                'message': f'Completion status stored for session {session_id}',
                'status': status
            }))
        else:
            return _response(500, body='Failed to store completion status')
