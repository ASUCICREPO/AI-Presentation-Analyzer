import boto3
from botocore.exceptions import ClientError
from typing import Optional
import json
import os

# ─── Environment variables ────────────────────────────────────────────
PRESENTATION_TIMEOUT: int = int(os.environ.get("PRESENTATION_TIMEOUT", 1200))
PDF_UPLOAD_TIMEOUT: int = int(os.environ.get("PDF_UPLOAD_TIMEOUT", 120))
JSON_UPLOAD_TIMEOUT: int = int(os.environ.get("JSON_UPLOAD_TIMEOUT", 60))
MULTIPART_PART_URL_TIMEOUT: int = int(os.environ.get("MULTIPART_PART_URL_TIMEOUT", 300))
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET")
PERSONA_GUARDRAIL_ID: str = os.environ.get("PERSONA_GUARDRAIL_ID", "")
PERSONA_GUARDRAIL_VERSION: str = os.environ.get("PERSONA_GUARDRAIL_VERSION", "")

# ─── Constants — fixed S3 filenames (overwrite on re-upload) ──────────
AUTHORIZED_REQUEST_TYPES = [
    'ppt', 'session', 'metric_chunk',
    'transcript', 'session_analytics', 'detailed_metrics', 'manifest',
]

S3_FILENAMES = {
    'ppt': 'presentation.pdf',
    'session': 'recording.webm',
    'metric_chunk': 'analytics.json',
    'persona_customization': 'CUSTOM_PERSONA_INSTRUCTION.txt',
    'transcript': 'transcript.json',
    'session_analytics': 'session_analytics.json',
    'detailed_metrics': 'detailed_metrics.json',
    'manifest': 'manifest.json',
}

if not UPLOADS_BUCKET:
    print("[ERROR] UPLOADS_BUCKET environment variable is not set.")
    raise ValueError("UPLOADS_BUCKET environment variable is not set")

s3_client = boto3.client('s3')
bedrock_runtime = boto3.client('bedrock-runtime')


# ─── Guardrail scanning ─────────────────────────────────────────────
def scan_persona_text(text: str) -> dict:
    """Run persona customization text through the Bedrock guardrail.

    Returns a dict with:
        - allowed (bool): True if the content passed the guardrail.
        - action (str): The guardrail action — 'NONE' (safe) or 'GUARDRAIL_INTERVENED'.
        - message (str): Blocked messaging if the content was rejected.
    """
    if not PERSONA_GUARDRAIL_ID or not PERSONA_GUARDRAIL_VERSION:
        print("[WARN] Guardrail env vars not set — skipping persona scan.")
        return {"allowed": True, "action": "NONE", "message": ""}

    try:
        response = bedrock_runtime.apply_guardrail(
            guardrailIdentifier=PERSONA_GUARDRAIL_ID,
            guardrailVersion=PERSONA_GUARDRAIL_VERSION,
            source="INPUT",
            content=[{"text": {"text": text}}],
        )
        action = response.get("action", "NONE")
        if action == "GUARDRAIL_INTERVENED":
            # Pull the blocked message from the first output, or fall back to a default
            outputs = response.get("outputs", [])
            message = outputs[0]["text"] if outputs else (
                "The persona customization was rejected by our safety filters."
            )
            print(f"[WARN] Guardrail INTERVENED for persona text. Action: {action}")
            return {"allowed": False, "action": action, "message": message}

        print(f"[INFO] Guardrail passed for persona text. Action: {action}")
        return {"allowed": True, "action": action, "message": ""}

    except ClientError as e:
        print(f"[ERROR] Guardrail scan failed: {e}")
        # Fail-open is intentional here so the feature still works if Bedrock
        # has a transient error — but log loudly for monitoring.
        return {"allowed": True, "action": "ERROR", "message": ""}


# ─── CORS response helper ────────────────────────────────────────────
def _response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
        "body": json.dumps(body),
    }


def _build_s3_key(user_id: str, session_id: str, request_type: str) -> str:
    filename = S3_FILENAMES.get(request_type)
    if not filename:
        raise ValueError(f"Unknown request_type: {request_type}")
    return f"{user_id}/{session_id}/{filename}"


# ─── Presigned POST URL generation ───────────────────────────────────
def get_upload_url(request_type: str, user_id: str, session_id: str) -> Optional[dict]:
    """Generate a presigned POST URL for uploading to S3.

    S3 key structure (fixed filenames — re-uploads overwrite):
        {user_id}/{session_id}/{filename}
    """
    key = _build_s3_key(user_id, session_id, request_type)

    try:
        if request_type == 'ppt':
            print(f"[INFO] Presigned URL for PDF -> {key}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET, Key=key,
                Fields={"Content-Type": "application/pdf"},
                Conditions=[{"Content-Type": "application/pdf"}],
                ExpiresIn=PDF_UPLOAD_TIMEOUT,
            )
        elif request_type == 'session':
            print(f"[INFO] Presigned URL for recording -> {key}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET, Key=key,
                Fields={"Content-Type": "video/webm"},
                Conditions=[{"Content-Type": "video/webm"}],
                ExpiresIn=PRESENTATION_TIMEOUT,
            )
        elif request_type in ('metric_chunk', 'transcript', 'session_analytics', 'detailed_metrics', 'manifest'):
            print(f"[INFO] Presigned URL for JSON ({request_type}) -> {key}")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET, Key=key,
                Fields={"Content-Type": "application/json"},
                Conditions=[{"Content-Type": "application/json"}],
                ExpiresIn=JSON_UPLOAD_TIMEOUT,
            )
        else:
            return None
    except ClientError as e:
        print(f"[ERROR] {e}")
        return None

    return response


# ─── Read persona customization from S3 ──────────────────────────────
def get_persona_customization(user_id: str, session_id: str) -> Optional[str]:
    key = _build_s3_key(user_id, session_id, 'persona_customization')
    try:
        obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=key)
        return obj['Body'].read().decode('utf-8')
    except s3_client.exceptions.NoSuchKey:
        return None
    except ClientError as e:
        print(f"[ERROR] Failed to read persona customization: {e}")
        return None


# ─── Write persona customization to S3 (Lambda-mediated) ─────────────
MAX_PERSONA_TEXT_BYTES = 10 * 1024  # 10 KB — same limit as the old presigned URL


def upload_persona_customization(user_id: str, session_id: str, text: str) -> bool:
    """Write validated persona customization text directly to S3."""
    key = _build_s3_key(user_id, session_id, 'persona_customization')
    try:
        s3_client.put_object(
            Bucket=UPLOADS_BUCKET,
            Key=key,
            Body=text.encode('utf-8'),
            ContentType='text/plain',
        )
        print(f"[INFO] Uploaded persona customization -> {key}")
        return True
    except ClientError as e:
        print(f"[ERROR] Failed to upload persona customization: {e}")
        return False


# ─── Multipart upload helpers ─────────────────────────────────────────

def get_video_playback_url(user_id: str, session_id: str) -> Optional[str]:
    """Generate a presigned GET URL for playing back the recorded video."""
    key = _build_s3_key(user_id, session_id, 'session')
    try:
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': UPLOADS_BUCKET, 'Key': key},
            ExpiresIn=PRESENTATION_TIMEOUT,
        )
        return url
    except ClientError as e:
        print(f"[ERROR] Failed to generate video playback URL: {e}")
        return None


def get_manifest_data(user_id: str, session_id: str) -> Optional[dict]:
    """Fetch and parse the manifest.json file from S3."""
    key = _build_s3_key(user_id, session_id, 'manifest')
    try:
        response = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=key)
        content = response['Body'].read().decode('utf-8')
        return json.loads(content)
    except ClientError as e:
        print(f"[ERROR] Failed to fetch manifest: {e}")
        return None


def initiate_multipart(user_id: str, session_id: str) -> Optional[dict]:
    """Create a new multipart upload for recording.webm."""
    key = _build_s3_key(user_id, session_id, 'session')
    try:
        response = s3_client.create_multipart_upload(
            Bucket=UPLOADS_BUCKET,
            Key=key,
            ContentType='video/webm',
        )
        print(f"[INFO] Initiated multipart upload: key={key}, uploadId={response['UploadId']}")
        return {
            'uploadId': response['UploadId'],
            'key': key,
        }
    except ClientError as e:
        print(f"[ERROR] Failed to initiate multipart upload: {e}")
        return None


def get_part_presigned_url(user_id: str, session_id: str, upload_id: str, part_number: int) -> Optional[str]:
    """Generate a presigned PUT URL for a single multipart part."""
    key = _build_s3_key(user_id, session_id, 'session')
    try:
        url = s3_client.generate_presigned_url(
            'upload_part',
            Params={
                'Bucket': UPLOADS_BUCKET,
                'Key': key,
                'UploadId': upload_id,
                'PartNumber': part_number,
            },
            ExpiresIn=MULTIPART_PART_URL_TIMEOUT,
        )
        print(f"[INFO] Presigned URL for part {part_number} of upload {upload_id}")
        return url
    except ClientError as e:
        print(f"[ERROR] Failed to generate part URL: {e}")
        return None


def complete_multipart(user_id: str, session_id: str, upload_id: str, parts: list) -> bool:
    """Complete a multipart upload by assembling all parts."""
    key = _build_s3_key(user_id, session_id, 'session')
    try:
        s3_client.complete_multipart_upload(
            Bucket=UPLOADS_BUCKET,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={'Parts': parts},
        )
        print(f"[INFO] Completed multipart upload: key={key}")
        return True
    except ClientError as e:
        print(f"[ERROR] Failed to complete multipart upload: {e}")
        return False


def abort_multipart(user_id: str, session_id: str, upload_id: str) -> bool:
    """Abort a multipart upload and clean up parts."""
    key = _build_s3_key(user_id, session_id, 'session')
    try:
        s3_client.abort_multipart_upload(
            Bucket=UPLOADS_BUCKET, Key=key, UploadId=upload_id,
        )
        print(f"[INFO] Aborted multipart upload: key={key}")
        return True
    except ClientError as e:
        print(f"[ERROR] Failed to abort multipart upload: {e}")
        return False


# ─── Lambda handler ───────────────────────────────────────────────────
def lambda_handler(event, context):
    """AWS Lambda handler for S3 upload operations.

    GET  /s3_urls?request_type={type}&session_id={id}
        -> presigned POST URL for uploading files

    GET  /s3_urls?action=get_persona&session_id={id}
        -> read saved persona customization text (guardrail-checked)

    GET  /s3_urls?action=get_part_url&session_id={id}&upload_id={uid}&part_number={n}
        -> presigned PUT URL for a multipart upload part

    POST /s3_urls?action=upload_persona&session_id={id}
        body: { "text": "..." }
        -> scan text with Bedrock guardrail, then save to S3 if safe

    POST /s3_urls?action=initiate_multipart&session_id={id}
        -> initiate a new multipart upload for recording.webm

    POST /s3_urls?action=complete_multipart&session_id={id}
        body: { "upload_id": "...", "parts": [{"PartNumber": 1, "ETag": "..."}, ...] }

    POST /s3_urls?action=abort_multipart&session_id={id}
        body: { "upload_id": "..." }
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    if method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

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

    action = qs.get('action')

    # ═════════════════════════════════════════════════════════════════════
    # POST routes — multipart upload lifecycle
    # ═════════════════════════════════════════════════════════════════════
    if method == 'POST':
        body = json.loads(event.get('body') or '{}')

        if action == 'initiate_multipart':
            result = initiate_multipart(user_id, session_id)
            if not result:
                return _response(500, {'message': 'Failed to initiate multipart upload'})
            return _response(200, result)

        if action == 'complete_multipart':
            upload_id = body.get('upload_id')
            parts = body.get('parts')
            if not upload_id or not parts:
                return _response(400, {'message': "Missing 'upload_id' or 'parts' in request body."})
            success = complete_multipart(user_id, session_id, upload_id, parts)
            if not success:
                return _response(500, {'message': 'Failed to complete multipart upload'})
            return _response(200, {'message': 'Multipart upload completed'})

        if action == 'abort_multipart':
            upload_id = body.get('upload_id')
            if not upload_id:
                return _response(400, {'message': "Missing 'upload_id' in request body."})
            success = abort_multipart(user_id, session_id, upload_id)
            if not success:
                return _response(500, {'message': 'Failed to abort multipart upload'})
            return _response(200, {'message': 'Multipart upload aborted'})

        # Route: upload persona customization text (guardrail-gated)
        if action == 'upload_persona':
            text = body.get('text', '')

            # Validate payload size
            if not text or not text.strip():
                return _response(400, {'message': 'Persona customization text cannot be empty.'})
            if len(text.encode('utf-8')) > MAX_PERSONA_TEXT_BYTES:
                return _response(400, {
                    'message': f'Persona customization text exceeds the {MAX_PERSONA_TEXT_BYTES // 1024} KB limit.',
                })

            # Run through Bedrock guardrail before persisting
            scan_result = scan_persona_text(text)
            if not scan_result["allowed"]:
                print(f"[WARN] Persona upload rejected for user={user_id}, session={session_id}")
                return _response(400, {
                    'message': scan_result["message"],
                    'rejected': True,
                })

            # Guardrail passed — write to S3
            success = upload_persona_customization(user_id, session_id, text)
            if not success:
                return _response(500, {'message': 'Failed to save persona customization.'})

            return _response(200, {'message': 'Persona customization saved successfully.'})

        return _response(400, {'message': f"Unknown POST action: {action}"})

    # ═════════════════════════════════════════════════════════════════════
    # GET routes — presigned URLs and reads
    # ═════════════════════════════════════════════════════════════════════
    if method == 'GET':
        # Route: get saved persona customization text (with guardrail scan)
        if action == 'get_persona':
            text = get_persona_customization(user_id, session_id)
            if text is None:
                return _response(200, {'customization': None, 'exists': False})

            # Run the text through Bedrock guardrail before returning
            scan_result = scan_persona_text(text)
            if not scan_result["allowed"]:
                print(f"[WARN] Persona customization rejected for user={user_id}, session={session_id}")
                return _response(400, {
                    'message': scan_result["message"],
                    'exists': True,
                    'rejected': True,
                })

            return _response(200, {'customization': text, 'exists': True})

        # Route: presigned PUT URL for a multipart part
        if action == 'get_part_url':
            upload_id = qs.get('upload_id')
            part_number = qs.get('part_number')
            if not upload_id or not part_number:
                return _response(400, {'message': "Missing 'upload_id' or 'part_number'."})
            url = get_part_presigned_url(user_id, session_id, upload_id, int(part_number))
            if not url:
                return _response(500, {'message': 'Failed to generate part URL'})
            return _response(200, {'url': url, 'part_number': int(part_number)})

        # Route: presigned GET URL for video playback
        if action == 'get_video_url':
            url = get_video_playback_url(user_id, session_id)
            if not url:
                return _response(404, {'message': 'Video not found or URL generation failed'})
            return _response(200, {'url': url})

        # Route: fetch manifest.json data
        if action == 'get_manifest':
            manifest_data = get_manifest_data(user_id, session_id)
            if not manifest_data:
                return _response(404, {'message': 'Manifest not found'})
            return _response(200, manifest_data)

        # Route: presigned POST URL for file upload
        request_type = qs.get('request_type')
        if not request_type or request_type not in AUTHORIZED_REQUEST_TYPES:
            return _response(400, {
                'message': f"Missing or invalid 'request_type'. Use one of {AUTHORIZED_REQUEST_TYPES}."
            })

        presigned_url = get_upload_url(request_type, user_id, session_id)
        if presigned_url is None:
            return _response(500, {'message': 'Failed to generate presigned URL'})

        return _response(200, {
            "presigned_url": presigned_url.get('url'),
            "fields": presigned_url.get('fields', {}),
        })

    return _response(400, {'message': f'Unsupported method: {method}'})
