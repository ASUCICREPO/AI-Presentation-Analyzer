"""
Session Complete Trigger Lambda

Receives POST /sessions/{sessionID}/complete from frontend and starts Step Functions workflow.
"""

import boto3
import json
import os
from datetime import datetime


STEP_FUNCTIONS_ARN = os.environ.get('STEP_FUNCTIONS_ARN')
UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET')


def _response(status_code: int, body: dict) -> dict:
    """Return properly formatted API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    """
    POST /sessions/{sessionID}/complete

    Triggers Step Functions analytics pipeline.

    Expected body:
    {
        "personaID": "uuid",
        "totalDuration": 180
    }
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    if method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    if method != 'POST':
        return _response(400, {'message': f'Unsupported method: {method}'})

    # Extract userID from Cognito JWT
    request_context = event.get('requestContext', {})
    authorizer = request_context.get('authorizer', {})
    claims = authorizer.get('claims', {})
    user_id = claims.get('sub')

    if not user_id:
        return _response(401, {'message': 'Unauthorized: Missing user authentication'})

    # Get sessionID from path
    path_params = event.get('pathParameters') or {}
    session_id = path_params.get('sessionID')

    if not session_id:
        return _response(400, {'message': 'Missing sessionID parameter'})

    # Parse request body
    try:
        body = json.loads(event.get('body', '{}'))
    except json.JSONDecodeError:
        return _response(400, {'message': 'Invalid JSON body'})

    persona_id = body.get('personaID')
    total_duration = body.get('totalDuration')

    if not persona_id:
        return _response(400, {'message': 'Missing personaID in request body'})

    # Construct S3 key prefix for chunks
    current_date = datetime.utcnow().strftime('%Y-%m-%d')
    s3_key_prefix = f"{current_date}/{user_id}/{session_id}"

    # Start Step Functions execution
    sfn_client = boto3.client('stepfunctions')

    try:
        execution_input = {
            'sessionID': session_id,
            'userID': user_id,
            'personaID': persona_id,
            'totalDuration': total_duration or 0,
            's3Bucket': UPLOADS_BUCKET,
            's3KeyPrefix': s3_key_prefix,
            'date': current_date
        }

        response = sfn_client.start_execution(
            stateMachineArn=STEP_FUNCTIONS_ARN,
            name=f"analytics-{session_id}-{int(datetime.utcnow().timestamp())}",
            input=json.dumps(execution_input)
        )

        execution_arn = response['executionArn']
        print(f"[INFO] Started Step Functions execution: {execution_arn}")

        return _response(200, {
            'message': 'Analytics pipeline started',
            'sessionID': session_id,
            'executionArn': execution_arn,
            'status': 'processing'
        })

    except Exception as e:
        print(f"[ERROR] Failed to start Step Functions: {str(e)}")
        return _response(500, {
            'message': 'Failed to start analytics pipeline',
            'error': str(e)
        })
