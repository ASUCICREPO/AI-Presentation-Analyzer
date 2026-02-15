from typing import Literal, Dict, List
from botocore.exceptions import ClientError
from enum import Enum
import traceback
import boto3
import json
import uuid
import os

## Environment variables
CUSTOMIZATION_UPLOAD_TIMEOUT: int = int(os.environ.get("CUSTOMIZATION_UPLOAD_TIMEOUT", 5)) # 5 second default for small JSON uploads of persona customizations
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET")
GUARDRAIL_ID: str = os.environ.get("GUARDRAIL_ID")
GUARDRAIL_VERSION: str = os.environ.get("GUARDRAIL_VERSION")

class ErrorType(str, Enum):
    GUARDRAIL_COMPLIANCE_FAILURE = "GUARDRAIL_COMPLIANCE_FAILURE"
    S3_UPLOAD_FAILURE = "S3_UPLOAD_FAILURE"

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
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(body),
    }

def generate_object_name()-> str:
    """Generate a unique object name for the S3 upload

    :return: Unique object name as a string
    """
    return str(uuid.uuid4())

def check_guardrail_compliance(content: str, guardrail_id: str, guardrail_version: str) -> bool:
    """Check if the provided content complies with the specified guardrail using Bedrock.

    :param content: The content to check for compliance
    :param guardrail_id: The ID of the guardrail to check against
    :param guardrail_version: The version of the guardrail to check against
    :return: True if compliant, False otherwise
    """
    bedrock_client = boto3.client('bedrock')
    try:
        response = bedrock_client.apply_guardrail(
            GuardrailIdentifier=guardrail_id,
            GuardrailVersion=guardrail_version,
            source='INPUT',
            Content=[
                {
                    'text': {
                        'text': content
                    }
                }
            ]
        )

        if response.get('action') == 'GUARDRAIL_INTERVENED':
            return False
        return True
    except ClientError as e:
        print(f"[ERROR] Bedrock ApplyGuardrail API failed for persona check: {content}")
        print(f"[ERROR] Bedrock apply_guardrail failed with error: {traceback.format_exc()}")
        return True # Fail open in case of Bedrock errors to avoid blocking user actions due to guardrail check failures
        # Not the best case for prod, but I am choosing to implement fail-open here to prioritize user experience.
        # As a safety mesure, I have logged the persona requested by the user and the error from Bedrock in case of failures, which should help with debugging and monitoring.


def upload_persona_customization(object_name: str, content, user_id: str, session_id: str) -> Dict[str, Dict[str, str]] | None:
    """
    Upload the submitted persona customization content to S3.
    :param object_name: The unique object name for the S3 upload
    :param content: The persona customization content to upload
    :param user_id: The ID of the user submitting the customization (used for S3 key namespacing)
    :param session_id: The ID of the session for which the customization is being submitted (used for S3 key namespacing)
    :return: 
        If successful, returns a dictionary containing the presigned URL and fields for the S3 upload.
        Else, returns None.
    """
    # Create a S3 client
    s3_client = boto3.client('s3')
    try:
        print("[INFO] Attempting save for persona customization to S3 with object name: {object_name} for user_id: {user_id} and session_id: {session_id}")

        # Run guardrail check
        if not check_guardrail_compliance(content, GUARDRAIL_ID, GUARDRAIL_VERSION):
            print(f"[WARN] Persona customization content failed guardrail compliance check. Content: {content}")
            return {
                "status": "error",
                "error_type": ErrorType.GUARDRAIL_COMPLIANCE_FAILURE,
                "message": "Persona customization content failed compliance check. Please modify your customization and try again."
            }
        
        # Upload to session S3
        s3_client.put_object(
            Bucket=UPLOADS_BUCKET,
            Key=f"persona_customizations/{session_id}/{user_id}/persona/{object_name}.json",
            Body=json.dumps(content),
            ContentType='application/json'
        )
        print(f"[INFO] Successfully uploaded persona customization to S3 with object name: {object_name} for user_id: {user_id} and session_id: {session_id}")
        return {
            "status": "success",
            "message": "Persona customization uploaded successfully.",
            "object_name": object_name
        }
    except ClientError as e:
        print(f"[ERROR] Failed to upload persona customization to S3 with object name: {object_name} for user_id: {user_id} and session_id: {session_id}")
        print(f"[ERROR] S3 upload failed with error: {traceback.format_exc()}")
        return {
            "status": "error",
            "error_type": ErrorType.S3_UPLOAD_FAILURE,
            "message": "Failed to upload persona customization. Please try again later."
        }

def lambda_handler(event, context):
    """AWS Lambda handler to generate presigned S3 upload URLs.

    Called via API Gateway:  GET /s3_urls?request_type=persona_customization&session_id={session_id}
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    if method == 'OPTIONS':
        return _response(200, {'message': 'OK'})

    if method != 'POST':
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


    body = json.loads(event.get('body') or '{}')
    content = body.get('content')
    if not content:
        return _response(400, {'message': "Missing 'content' in request body."})

    object_name = generate_object_name()
    
    save_result: dict[str, str] = upload_persona_customization(object_name, content, user_id, session_id)

    if save_result["status"] == "error":
        if save_result["error_type"] == ErrorType.GUARDRAIL_COMPLIANCE_FAILURE:
            return _response(403, {'message': save_result["message"]})
        elif save_result["error_type"] == ErrorType.S3_UPLOAD_FAILURE:
            return _response(500, {'message': save_result["message"]})
        else:
            return _response(500, {'message': save_result["message"]})

    return _response(200, {
        "message": save_result["message"],
        "object_name": save_result["object_name"]
    })