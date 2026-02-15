import boto3
from botocore.exceptions import ClientError
from typing import Literal, Dict, List
import json
import uuid
import os

## Environment variables
PRESENTATION_TIMEOUT: int = int(os.environ.get("PRESENTATION_TIMEOUT", 1200)) # 20 minutes default
PDF_UPLOAD_TIMEOUT: int = int(os.environ.get("PDF_UPLOAD_TIMEOUT", 120)) # 120 seconds default
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET")

## Constants
AUTHORIZED_REQUEST_TYPES: List[str] = ['ppt', 'session', 'metric_chunk']


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

def get_upload_url(object_name: str, request_type: Literal['ppt', 'session', 'chunk_metrics'], user_id: str, session_id: str) -> Dict[str, Dict[str, str]] | None:
    """Generate a presigned URL to share an S3 object

    :param request_type: Type of upload request. Can be 'ppt' or 'session'.
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
                Key=f"{user_id}/{session_id}/data/presentation/{object_name}.pdf",
                Fields={"Content-Type": "application/pdf"},
                Conditions=[
                    {"Content-Type": "application/pdf"}
                ],
                ExpiresIn=PDF_UPLOAD_TIMEOUT
            )
        elif request_type == 'session':
            print("[INFO] Generating presigned URL for Session upload")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=f"{user_id}/{session_id}/data/recording/{object_name}.webm",
                ExpiresIn=PRESENTATION_TIMEOUT,
                Fields={"Content-Type": "video/webm"},
                Conditions=[
                    {"Content-Type": "video/webm"}
                ],
            )
        elif request_type == 'metric_chunk':
            print("[INFO] Generating presigned URL for Metric Chunk upload")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=f"{user_id}/{session_id}/data/raw/{object_name}.json",
                ExpiresIn=PRESENTATION_TIMEOUT,
                Fields={"Content-Type": "application/json"},
                Conditions=[
                    {"Content-Type": "application/json"}
                ],
            )
        else:
            return None
    except ClientError as e:
        print(f"[ERROR] {e}")
        return None
    # The response contains the presigned URL
    return response

def lambda_handler(event, context):
    """AWS Lambda handler to generate presigned S3 upload URLs.

    Called via API Gateway:  GET /s3_urls?request_type=ppt|session|metric_chunk&session_id={session_id}
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    if method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    if method != 'GET':
        return _response(400, {'message': f'Unsupported method: {method}'})

    try:
        authorizer = event.get('requestContext').get('authorizer')
        user_id = authorizer.get('claims').get('sub')  # 'sub' is the Cognito user ID
        session_id = event['queryStringParameters']['session_id']

        if not session_id:
            return _response(400, {'message': "Missing 'session_id' query parameter."})
        if not user_id:
            return _response(400, {'message': "User ID not found in request context."})
    except KeyError as e:
        print(f"[ERROR] Missing required information: {e}")
        return _response(400, {'message': f"Missing required one of: session_id query parameter or user authentication information."})


    qs = event.get('queryStringParameters') or {}
    request_type = qs.get('request_type')

    if not request_type or request_type not in AUTHORIZED_REQUEST_TYPES:
        return _response(400, {'message': f"Missing or invalid 'request_type'. Use one of {AUTHORIZED_REQUEST_TYPES}."})

    object_name = generate_object_name()
    presigned_url = get_upload_url(
        request_type=request_type, 
        object_name=object_name, 
        user_id=user_id, 
        session_id=session_id
    )

    if presigned_url is None:
        print("[ERROR] Failed to generate presigned URL")
        return _response(500, {'message': 'Failed to generate presigned URL'})

    return _response(200, {
        "presigned_url": presigned_url.get('url'),
        "object_name": object_name,
        "fields": presigned_url.get('fields', {}),
    })