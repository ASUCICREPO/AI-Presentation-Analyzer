import logging
import boto3
from botocore.exceptions import ClientError
from typing import Literal
import dotenv
import json
import uuid

dotenv.load_dotenv()

PRESENTATION_TIMEOUT = os.getenv("PRESENTATION_TIMEOUT", 1200) # 20 minutes defualt
PDF_UPLOAD_TIMEOUT = os.getenv("PDF_UPLOAD_TIMEOUT", 120) # 120 seconds default
UPLOADS_BUCKET = os.getenv("UPLOADS_BUCKET")

if not UPLOADS_BUCKET:
    logging.error("[!]Error: UPLOADS_BUCKET environment variable is not set.")
    raise ValueError("UPLOADS_BUCKET environment variable is not set")


def generate_object_name()-> str:
    """Generate a unique object name for the S3 upload

    :return: Unique object name as a string
    """
    return str(uuid.uuid4())

def get_upload_url(object_name: str, request_type: Literal['ppt', 'session']) -> Dict[str, Dict[str, str]] | None:
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
            logging.info("Generating presigned URL for PPT upload")
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
            logging.info("Generating presigned URL for Session upload")
            response = s3_client.generate_presigned_post(
                Bucket=UPLOADS_BUCKET,
                Key=object_name,
                ExpiresIn=PRESENTATION_TIMEOUT,
                Fields={"Content-Type": "video/webm"},
                Conditions=[
                    {"Content-Type": "video/webm"}
                ],
            )
        else:
            return None
    except ClientError as e:
        logging.error(e)
        return None
    # The response contains the presigned URL
    return response

def lambda_handler(event, context) -> Dict[str, str, Dict[str, str]] | None:
    """AWS Lambda handler to generate presigned S3 upload URLs
    :param event: Event data passed to the Lambda function. Expects a dictionary with key 'request_type'
    :param context: Runtime information provided by AWS Lambda
    :return: 
        If error, returns None.
        Else, Dictionary containing the following keys:
            - presigned_url: Presigned URL to upload the object
            - object_name: The unique object name generated for the upload
            - fields: Dictionary of form fields and values to submit with the POST
    """
    logging.info(f"Received event: {json.dumps(event)}")
    
    request_type = event.get('request_type')
    if not request_type:
        logging.error("Missing 'request_type' in the event")
        return None
    elif not request_type in ['ppt', 'session']:
        logging.error("Invalid 'request_type' in the event")
        return None
    object_name = generate_object_name()

    if not request_type or not object_name:
        logging.error("Missing 'request_type' in the event")
        return None

    presigned_url = get_upload_url(request_type=request_type, object_name=object_name)
    
    if presigned_url is None:
        logging.error("Failed to generate presigned URL")
        return None

    return {
        "presigned_url": presigned_url.get('url'),
        "object_name": object_name,
        "fields": presigned_url.get('fields', {}),
    }