import boto3
from botocore.exceptions import ClientError
from typing import Literal, Dict
import json
import uuid
import os
from datetime import datetime

PRESENTATION_TIMEOUT: int = int(os.environ.get("PRESENTATION_TIMEOUT", 1200)) # 20 minutes default
PDF_UPLOAD_TIMEOUT: int = int(os.environ.get("PDF_UPLOAD_TIMEOUT", 120)) # 120 seconds default
CHUNK_UPLOAD_TIMEOUT: int = int(os.environ.get("CHUNK_UPLOAD_TIMEOUT", 300)) # 5 minutes default for chunk uploads
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET")

if not UPLOADS_BUCKET:
    print("[ERROR] UPLOADS_BUCKET environment variable is not set.")
    raise ValueError("UPLOADS_BUCKET environment variable is not set")


# ─── CORS response helper ────────────────────────────────────────────
def _response(status_code: int, body: dict) -> dict:
    """Return a properly formatted API Gateway proxy response with CORS headers."""
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


def generate_object_name()-> str:
    """Generate a unique object name for the S3 upload

    :return: Unique object name as a string
    """
    return str(uuid.uuid4())

def get_upload_url(object_name: str, request_type: Literal['ppt', 'session', 'chunk']) -> Dict[str, Dict[str, str]] | None:
    """Generate a presigned URL to share an S3 object

    :param object_name: S3 key/path for the object
    :param request_type: Type of upload request. Can be 'ppt', 'session', or 'chunk'.
    :return:
        If error, returns None.
        Else, Dictionary containing the following keys:
            - url: Presigned URL to upload the object
            - fields: Dictionary of form fields and values to submit with the POST
    """
    # Create a S3 client
    s3_client = boto3.client('s3')
    try:
        if request_type == 'ppt':
            print("[INFO] Generating presigned URL for PPT upload")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=object_name,
                Fields={"Content-Type": "application/pdf"},
                Conditions=[
                    {"Content-Type": "application/pdf"}
                ],
                ExpiresIn=PDF_UPLOAD_TIMEOUT
            )
        elif request_type == 'session':
            print("[INFO] Generating presigned URL for Session video upload")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=object_name,
                ExpiresIn=PRESENTATION_TIMEOUT,
                Fields={"Content-Type": "video/webm"},
                Conditions=[
                    {"Content-Type": "video/webm"}
                ],
            )
        elif request_type == 'chunk':
            print(f"[INFO] Generating presigned URL for chunk upload: {object_name}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=object_name,
                Fields={"Content-Type": "application/json"},
                Conditions=[
                    {"Content-Type": "application/json"}
                ],
                ExpiresIn=CHUNK_UPLOAD_TIMEOUT
            )
        else:
            return None
    except ClientError as e:
        print(f"[ERROR] {e}")
        return None
    # The response contains the presigned URL
    return response

def get_metrics_url() -> Dict[str, str] | None:
    """
    Generate a S3 presigned URL to upload metrics data as JSON multipart form data.
    :return: 
        If error, returns None.
        Else, Dictionary containing the following keys:
            - url: Presigned URL to upload the object
            - fields: Dictionary of form fields and values to submit with the POST
    """
    s3_client = boto3.client('s3')
    object_name = f"metrics/{str(uuid.uuid4())}.json"
    try:
        response = s3_client.generate_presigned_post(
            Bucket=UPLOADS_BUCKET,
            Key=object_name,
            Fields={"Content-Type": "application/json"},
            Conditions=[
                {"Content-Type": "application/json"}
            ],
            ExpiresIn=300 # 5 minutes
        )
    except ClientError as e:
        print(f"[ERROR] {e}")
        return None
    return response

def lambda_handler(event, context):
    """AWS Lambda handler to generate presigned S3 upload URLs.

    Called via API Gateway:  GET /s3_urls?request_type=ppt|session|chunk
    For 'chunk' requests, also requires: sessionID and chunkIndex query parameters
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    if method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    if method != 'GET':
        return _response(400, {'message': f'Unsupported method: {method}'})

    qs = event.get('queryStringParameters') or {}
    request_type = qs.get('request_type')

    if not request_type or request_type not in ['ppt', 'session', 'chunk']:
        return _response(400, {'message': "Missing or invalid 'request_type'. Use 'ppt', 'session', or 'chunk'."})

    # Handle chunk uploads
    if request_type == 'chunk':
        # Extract userID from Cognito JWT claims (when authorizer is enabled)
        user_id = None
        request_context = event.get('requestContext', {})
        authorizer = request_context.get('authorizer', {})
        claims = authorizer.get('claims', {})
        user_id = claims.get('sub')  # Cognito user sub

        if not user_id:
            # Fallback: If no Cognito auth, require userID in query string (for testing)
            user_id = qs.get('userID')
            if not user_id:
                return _response(401, {'message': 'Unauthorized: Missing user authentication'})
            print(f"[WARN] Using userID from query string (testing mode): {user_id}")

        session_id = qs.get('sessionID')
        chunk_index = qs.get('chunkIndex')

        if not session_id:
            return _response(400, {'message': "Missing 'sessionID' query parameter for chunk upload"})
        if not chunk_index:
            return _response(400, {'message': "Missing 'chunkIndex' query parameter for chunk upload"})

        # Generate S3 key: {date}/{userID}/{sessionID}/data/chunk-{chunkIndex}.json
        current_date = datetime.utcnow().strftime('%Y-%m-%d')
        object_name = f"{current_date}/{user_id}/{session_id}/data/chunk-{chunk_index}.json"

        print(f"[INFO] Generated S3 key for chunk upload: {object_name}")

        presigned_url = get_upload_url(request_type=request_type, object_name=object_name)

        if presigned_url is None:
            print("[ERROR] Failed to generate presigned URL for chunk")
            return _response(500, {'message': 'Failed to generate presigned URL'})

        return _response(200, {
            "presigned_url": presigned_url.get('url'),
            "object_name": object_name,
            "fields": presigned_url.get('fields', {}),
            "sessionID": session_id,
        })

    # Handle existing ppt and session uploads
    object_name = generate_object_name()
    presigned_url = get_upload_url(request_type=request_type, object_name=object_name)

    if presigned_url is None:
        print("[ERROR] Failed to generate presigned URL")
        return _response(500, {'message': 'Failed to generate presigned URL'})

    return _response(200, {
        "presigned_url": presigned_url.get('url'),
        "object_name": object_name,
        "fields": presigned_url.get('fields', {}),
    })