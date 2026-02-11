"""
Report URL Issuer Lambda

Generates presigned URLs for report.json and report.pdf access.
"""

import boto3
import json
import os
from botocore.exceptions import ClientError


UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET')
PRESIGNED_URL_EXPIRATION = int(os.environ.get('PRESIGNED_URL_EXPIRATION', 3600))  # 1 hour default


def _response(status_code: int, body: dict) -> dict:
    """Return properly formatted API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
        },
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    """
    GET /report_urls/{sessionID}

    Generates presigned URLs for report.json and report.pdf
    Validates userID from JWT matches session owner
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    if method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    if method != 'GET':
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

    # TODO: Verify session belongs to user (check S3 key structure: {date}/{userID}/{sessionID}/...)
    # TODO: Check if report.json and report.pdf exist
    # TODO: Generate presigned URLs for both files
    # TODO: Return URLs with expiration time

    # Placeholder response
    return _response(200, {
        'status': 'completed',
        'sessionID': session_id,
        'reportJsonUrl': f'https://example.com/reports/{session_id}/report.json',
        'reportPdfUrl': f'https://example.com/reports/{session_id}/report.pdf',
        'expiresIn': PRESIGNED_URL_EXPIRATION
    })
