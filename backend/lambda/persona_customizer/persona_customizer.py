import boto3
from botocore.exceptions import ClientError
from typing import Literal, Dict, List
import json
import uuid
import os

## Environment variables
CUSTOMIZATION_UPLOAD_TIMEOUT: int = int(os.environ.get("CUSTOMIZATION_UPLOAD_TIMEOUT", 5)) # 5 second default for small JSON uploads of persona customizations
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET")

## Constants
AUTHORIZED_REQUEST_TYPES: List[str] = ['persona_customization']


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
            "Access-Control-Allow-Headers": "Content-Type",
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
        if request_type == 'persona_customization':
            print("[INFO] Generating presigned URL for persona customization upload")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=f"{user_id}/{session_id}/data/persona/{object_name}.json",
                ExpiresIn=CUSTOMIZATION_UPLOAD_TIMEOUT,
                Fields={
                    "Content-Type": "application/json"
                },
                Conditions=[
                    {"Content-Type": "application/json"},
                    ["content-length-range", 1, 10*1024]  # Limit to 10KB for small JSON uploads
                ]
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

    Called via API Gateway:  GET /s3_urls?request_type=persona_customization&session_id={session_id}
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
    persona_id = qs.get('persona_id')

    if not persona_id:
        return _response(400, {'message': f"Missing 'persona_id.'"})

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