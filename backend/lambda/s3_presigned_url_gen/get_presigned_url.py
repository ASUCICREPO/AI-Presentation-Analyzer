import boto3
from botocore.exceptions import ClientError
from typing import Literal, Optional
import json
import os
from datetime import date

## Environment variables
PRESENTATION_TIMEOUT: int = int(os.environ.get("PRESENTATION_TIMEOUT", 1200))  # 20 minutes default
PDF_UPLOAD_TIMEOUT: int = int(os.environ.get("PDF_UPLOAD_TIMEOUT", 120))  # 120 seconds default
CUSTOMIZATION_UPLOAD_TIMEOUT: int = int(os.environ.get("CUSTOMIZATION_UPLOAD_TIMEOUT", 10))  # 10 seconds for small text
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET")

# ─── Constants — fixed S3 filenames (overwrite on re-upload) ──────────
AUTHORIZED_REQUEST_TYPES = ['ppt', 'session', 'metric_chunk', 'persona_customization']

S3_FILENAMES = {
    'ppt': 'presentation.pdf',
    'session': 'recording.webm',
    'metric_chunk': 'analytics.json',
    'persona_customization': 'CUSTOM_PERSONA_INSTRUCTION.txt',
}

if not UPLOADS_BUCKET:
    print("[ERROR] UPLOADS_BUCKET environment variable is not set.")
    raise ValueError("UPLOADS_BUCKET environment variable is not set")

s3_client = boto3.client('s3')


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


def _today() -> str:
    """Return today's date as YYYY-MM-DD for the S3 key prefix."""
    return date.today().isoformat()


def _build_s3_key(user_id: str, session_id: str, request_type: str) -> str:
    """Build the full S3 key: {user_id}/{date}/{session_id}/{filename}."""
    filename = S3_FILENAMES.get(request_type)
    if not filename:
        raise ValueError(f"Unknown request_type: {request_type}")
    return f"{user_id}/{_today()}/{session_id}/{filename}"


# ─── Presigned URL generation ─────────────────────────────────────────
def get_upload_url(
    request_type: Literal['ppt', 'session', 'metric_chunk', 'persona_customization'],
    user_id: str,
    session_id: str,
) -> Optional[dict]:
    """Generate a presigned POST URL for uploading to S3.

    S3 key structure (fixed filenames, no UUID — re-uploads overwrite):
        {user_id}/{date}/{session_id}/presentation.pdf
        {user_id}/{date}/{session_id}/recording.webm
        {user_id}/{date}/{session_id}/analytics.json
        {user_id}/{date}/{session_id}/CUSTOM_PERSONA_INSTRUCTION.txt
    """
    key = _build_s3_key(user_id, session_id, request_type)

    try:
        if request_type == 'ppt':
            print(f"[INFO] Presigned URL for PDF → {key}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=key,
                Fields={"Content-Type": "application/pdf"},
                Conditions=[{"Content-Type": "application/pdf"}],
                ExpiresIn=PDF_UPLOAD_TIMEOUT,
            )
        elif request_type == 'session':
            print(f"[INFO] Presigned URL for recording → {key}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=key,
                Fields={"Content-Type": "video/webm"},
                Conditions=[{"Content-Type": "video/webm"}],
                ExpiresIn=PRESENTATION_TIMEOUT,
            )
        elif request_type == 'metric_chunk':
            print(f"[INFO] Presigned URL for analytics → {key}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=key,
                Fields={"Content-Type": "application/json"},
                Conditions=[{"Content-Type": "application/json"}],
                ExpiresIn=PRESENTATION_TIMEOUT,
            )
        elif request_type == 'persona_customization':
            print(f"[INFO] Presigned URL for persona customization → {key}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=key,
                Fields={"Content-Type": "text/plain"},
                Conditions=[
                    {"Content-Type": "text/plain"},
                    ["content-length-range", 1, 10 * 1024],  # 10 KB max
                ],
                ExpiresIn=CUSTOMIZATION_UPLOAD_TIMEOUT,
            )
        else:
            return None
    except ClientError as e:
        print(f"[ERROR] {e}")
        return None

    return response


# ─── Read persona customization from S3 ──────────────────────────────
def get_persona_customization(user_id: str, session_id: str) -> Optional[str]:
    """Read the CUSTOM_PERSONA_INSTRUCTION.txt from S3 for a given session.

    Returns the text content, or None if the file doesn't exist.
    """
    key = _build_s3_key(user_id, session_id, 'persona_customization')
    try:
        obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=key)
        return obj['Body'].read().decode('utf-8')
    except s3_client.exceptions.NoSuchKey:
        return None
    except ClientError as e:
        print(f"[ERROR] Failed to read persona customization: {e}")
        return None


# ─── Lambda handler ───────────────────────────────────────────────────
def lambda_handler(event, context):
    """AWS Lambda handler for S3 presigned URL operations.

    Endpoints (via API Gateway):
        GET /s3_urls?request_type=ppt|session|metric_chunk|persona_customization&session_id={id}
            → Returns a presigned POST URL for uploading.

        GET /s3_urls?action=get_persona&session_id={id}
            → Returns the saved persona customization text (if any).
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    if method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    if method != 'GET':
        return _response(400, {'message': f'Unsupported method: {method}'})

    # ─── Auth & required params ───────────────────────────────────────
    try:
        authorizer = event.get('requestContext', {}).get('authorizer', {})
        user_id = authorizer.get('claims', {}).get('sub')
        qs = event.get('queryStringParameters') or {}
        session_id = qs.get('session_id')

        if not session_id:
            return _response(400, {'message': "Missing 'session_id' query parameter."})
        if not user_id:
            return _response(400, {'message': "User ID not found in request context."})
    except (KeyError, AttributeError) as e:
        print(f"[ERROR] Missing required information: {e}")
        return _response(400, {'message': "Missing session_id or user authentication information."})

    # ─── Route: get saved persona customization text ──────────────────
    action = qs.get('action')
    if action == 'get_persona':
        text = get_persona_customization(user_id, session_id)
        return _response(200, {
            'customization': text,
            'exists': text is not None,
        })

    # ─── Route: generate presigned upload URL ─────────────────────────
    request_type = qs.get('request_type')

    if not request_type or request_type not in AUTHORIZED_REQUEST_TYPES:
        return _response(400, {
            'message': f"Missing or invalid 'request_type'. Use one of {AUTHORIZED_REQUEST_TYPES}."
        })

    presigned_url = get_upload_url(
        request_type=request_type,
        user_id=user_id,
        session_id=session_id,
    )

    if presigned_url is None:
        print("[ERROR] Failed to generate presigned URL")
        return _response(500, {'message': 'Failed to generate presigned URL'})

    return _response(200, {
        "presigned_url": presigned_url.get('url'),
        "fields": presigned_url.get('fields', {}),
    })
