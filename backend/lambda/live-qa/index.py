import json
import os
import boto3


def lambda_handler(event, context):
    """Live Q&A handler — speech-based Q&A with Nova 2 Sonic.

    TODO: Implement live Q&A logic.
    """
    return {
        "statusCode": 501,
        "body": json.dumps({"message": "Not implemented"}),
    }
