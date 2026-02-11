"""
SSE Notifier Lambda

Manages Server-Sent Events (SSE) connections and sends completion notifications.
"""

import boto3
import json
import os
from typing import Dict


def lambda_handler(event, context):
    """
    SSE Connection Handler

    For GET /sse/{sessionID}: Open SSE connection and send status updates
    Called by Step Functions on completion: Send completion event to connected clients
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    http_method = event.get('httpMethod', '')

    if http_method == 'GET':
        # Client opening SSE connection
        session_id = event.get('pathParameters', {}).get('sessionID')

        # TODO: Implement SSE connection management
        # TODO: Return appropriate SSE headers
        # TODO: Keep connection alive and send heartbeat

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            },
            'body': f'data: {{"status": "connected", "sessionID": "{session_id}"}}\n\n'
        }

    else:
        # Called by Step Functions to send completion event
        session_id = event.get('sessionID')
        status = event.get('status', 'completed')

        # TODO: Send SSE event to connected clients for this sessionID
        # TODO: Close connection after sending completion event

        return {
            'statusCode': 200,
            'message': f'SSE event sent for session {session_id}'
        }
