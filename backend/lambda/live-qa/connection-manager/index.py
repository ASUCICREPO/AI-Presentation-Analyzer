import boto3
from botocore.exceptions import ClientError
import json
import os
from datetime import datetime, timedelta

# ─── Environment variables ────────────────────────────────────────────
CONNECTIONS_TABLE_NAME = os.environ.get('CONNECTIONS_TABLE_NAME')
UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET')

if not CONNECTIONS_TABLE_NAME or not UPLOADS_BUCKET:
    print("[ERROR] Required environment variables not set")
    raise ValueError("Missing required environment variables")

# ─── AWS Clients ──────────────────────────────────────────────────────
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
connections_table = dynamodb.Table(CONNECTIONS_TABLE_NAME)


def _response(status_code: int, body: dict = None) -> dict:
    """Helper to format WebSocket connection response."""
    return {
        'statusCode': status_code,
        'body': json.dumps(body) if body else ''
    }


def verify_session_exists(user_id: str, session_id: str, session_date: str) -> bool:
    """Verify that session data exists in S3."""
    try:
        # Check if transcript.json exists
        transcript_key = f"{user_id}/{session_date}/{session_id}/transcript.json"
        s3_client.head_object(Bucket=UPLOADS_BUCKET, Key=transcript_key)
        print(f"[INFO] Session data verified for {user_id}/{session_date}/{session_id}")
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            print(f"[WARN] Session data not found for {user_id}/{session_date}/{session_id}")
            return False
        else:
            print(f"[ERROR] S3 error checking session: {e}")
            return False


def handle_connect(event, connection_id):
    """Handle WebSocket connection."""
    print(f"[INFO] Connection request from {connection_id}")

    # Extract user context from authorizer (JWT already validated at API Gateway level)
    authorizer_context = event.get('requestContext', {}).get('authorizer', {})
    user_id = authorizer_context.get('userId')

    if not user_id:
        print("[ERROR] No userId in authorizer context")
        return _response(403, {'message': 'Authorization context missing'})

    # Extract query parameters
    query_params = event.get('queryStringParameters') or {}
    session_id = query_params.get('sessionId')
    session_date = query_params.get('sessionDate')

    if not session_id:
        print("[WARN] Missing sessionId in query parameters")
        return _response(400, {'message': 'Missing required parameters'})

    # Use today's date if not provided
    if not session_date:
        session_date = datetime.now().strftime('%Y-%m-%d')

    # Verify session exists in S3
    if not verify_session_exists(user_id, session_id, session_date):
        print(f"[WARN] Session not found: {user_id}/{session_date}/{session_id}")
        return _response(404, {'message': 'Session not found'})

    # Create DynamoDB connection record
    try:
        ttl = int((datetime.now() + timedelta(hours=2)).timestamp())  # 2 hour TTL

        connections_table.put_item(
            Item={
                'connectionId': connection_id,
                'userId': user_id,
                'sessionId': session_id,
                'sessionDate': session_date,
                'conversationState': 'idle',
                'questionCount': 0,
                'connectedAt': int(datetime.now().timestamp()),
                'lastActivity': int(datetime.now().timestamp()),
                'ttl': ttl
            }
        )

        print(f"[INFO] Connection record created for {connection_id}")
        return _response(200)

    except ClientError as e:
        print(f"[ERROR] DynamoDB error creating connection: {e}")
        return _response(500, {'message': 'Internal server error'})


def handle_disconnect(event, connection_id):
    """Handle WebSocket disconnection."""
    print(f"[INFO] Disconnect request from {connection_id}")

    try:
        connections_table.delete_item(
            Key={'connectionId': connection_id}
        )
        print(f"[INFO] Connection record deleted for {connection_id}")
        return _response(200)

    except ClientError as e:
        print(f"[ERROR] DynamoDB error deleting connection: {e}")
        return _response(500, {'message': 'Internal server error'})


def lambda_handler(event, context):
    """Main Lambda handler."""
    try:
        route_key = event.get('requestContext', {}).get('routeKey')
        connection_id = event.get('requestContext', {}).get('connectionId')

        print(f"[INFO] Processing route: {route_key}, connection: {connection_id}")

        if route_key == '$connect':
            return handle_connect(event, connection_id)
        elif route_key == '$disconnect':
            return handle_disconnect(event, connection_id)
        else:
            print(f"[WARN] Unknown route: {route_key}")
            return _response(400, {'message': 'Unknown route'})

    except Exception as e:
        print(f"[ERROR] Unexpected error in lambda_handler: {e}")
        return _response(500, {'message': 'Internal server error'})
