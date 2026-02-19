import boto3
from botocore.exceptions import ClientError
from decimal import Decimal
from typing import Dict, Optional
import os
import json
import uuid

'''
This Dynamo DB CRUD API is only meant to be used by Administrators of the system 
to create and manage personas that can be used to induce specific behaviors in the AI 
when analyzing presentation recordings.

All cutomizations made to the personas for specific user sessions are stores in that user's 
own session-specific data in S3, and not in this Dynamo DB table. 
Check out the s3-presigned-url-gen Lambda for more details on how session-specific data is stored in S3.
'''


class _DecimalEncoder(json.JSONEncoder):
    """Handle Decimal types returned by DynamoDB."""
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o == int(o) else float(o)
        return super().default(o)

PERSONA_TABLE_NAME: str = os.environ.get("PERSONA_TABLE_NAME")
MAX_ITEMS_PER_PAGE: int = int(os.environ.get("MAX_ITEMS_PER_PAGE", 20)) # Default to 20 items per page for pagination

if not PERSONA_TABLE_NAME:
    print("[!]Error: PERSONA_TABLE_NAME environment variable is not set.")
    raise ValueError("PERSONA_TABLE_NAME environment variable is not set")

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(PERSONA_TABLE_NAME)

def _response(status_code: int, body: dict) -> dict:
    """Return a properly formatted API Gateway proxy response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body, cls=_DecimalEncoder),
    }

def get_persona_from_id(id: str) -> Dict[str, str] | None:
    """Fetch a persona from DynamoDB using the provided ID

    :param id: The unique identifier for the persona
    :return: 
        If error or persona not found, returns None.
        Else, Dictionary containing the following keys:
            - personaID: Unique identifier for the persona
            - name: Name of the persona
            - description: Description of the persona
    """
    try:
        response = table.get_item(Key={'personaID': id})
        item = response.get('Item')
        if item:
            return item
        else:
            print(f"Persona with ID {id} not found.")
            return None
    except ClientError as e:
        print(f"Error fetching persona with ID {id}: {e.response['Error']['Message']}")
        return None

def _convert_floats(obj):
    """Recursively convert float values to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _convert_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_floats(i) for i in obj]
    return obj


def save_persona(persona: Dict[str, str]) -> dict[str, str]:
    """Save a persona to DynamoDB

    :param persona: Dictionary containing the following keys:
        - name: Name of the persona
        - description: Description of the persona
        - personaPrompt: The Markdown-formatted prompt to induce persona behavior
    :return: 
        dictionary containing the following keys:
            - message: Success or error message indicating the result of the save operation
    """
    try:
        if not all(key in persona for key in ['name', 'description', 'personaPrompt']):
            print("Persona dictionary is missing required keys: name, description, personaPrompt.")
            return _response(400, {
                'message': 'Error saving persona: Missing required field(s): name, description, and personaPrompt are required.'
            })
        table.put_item(Item=_convert_floats(persona))
        return _response(201, {'message': 'Persona saved successfully', 'persona': persona})
    except ClientError as e:
        print(f"Error saving persona: {e.response['Error']['Message']}")
        return _response(500, {'message': 'Error saving persona'})

def list_all_personas(last_evaled_key: Optional[str]) -> Dict[str, str]:
    """Fetch personas from DynamoDB with mandatory pagination
    :param last_evaled_key: The key to start pagination from
    :return: 
        If error or no personas found, returns None.
        Else, List of dictionaries, each containing the following keys:
            - personaID: Unique identifier for the persona
            - name: Name of the persona
            - description: Description of the persona
    """
    try:
        scan_kwargs = {
            'Limit': MAX_ITEMS_PER_PAGE,
        }
        if last_evaled_key:
            scan_kwargs['ExclusiveStartKey'] = {'personaID': last_evaled_key}
        response = table.scan(**scan_kwargs)
        items = response.get('Items', [])
        result = {'personas': items}
        lk = response.get('LastEvaluatedKey')
        if lk:
            result['lastEvaluatedKey'] = lk.get('personaID')
        return _response(200, result)
    except ClientError as e:
        print(f"Error fetching personas: {e.response['Error']['Message']}")
        return _response(500, {'message': 'Error fetching personas'})

def update_persona(persona_id: str, updated_fields: Dict[str, str]) -> dict[str, str]:
    """Update an existing persona in DynamoDB
    :param persona_id: The unique identifier for the persona to update
    :param updated_fields: Dictionary containing the fields to update. Supports all persona fields including nested objects like bestPractices and scoringWeights.
    :return: 
        dictionary containing the following keys:
            - message: Success or error message indicating the result of the update operation
    """
    try:
        update_expression = "SET " + ", ".join(f"#{key} = :{key}" for key in updated_fields.keys())
        expression_attribute_names = {f"#{key}": key for key in updated_fields.keys()}
        expression_attribute_values = {f":{key}": value for key, value in _convert_floats(updated_fields).items()}

        table.update_item(
            Key={'personaID': persona_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        return _response(200, {'message': 'Persona updated successfully'})
    except ClientError as e:
        print(f"Error updating persona with ID {persona_id}: {e.response['Error']['Message']}")
        return _response(500, {'message': 'Error updating persona'})

def delete_persona(persona_id: str) -> dict[str, str]:
    """Delete a persona from DynamoDB using the provided ID
    :param persona_id: The unique identifier for the persona to delete
    :return: 
        dictionary containing the following keys:
            - message: Success or error message indicating the result of the delete operation
    """
    try:
        table.delete_item(Key={'personaID': persona_id})
        return _response(200, {'message': 'Persona deleted successfully'})
    except ClientError as e:
        print(f"Error deleting persona with ID {persona_id}: {e.response['Error']['Message']}")
        return _response(500, {'message': 'Error deleting persona'})

def lambda_handler(event, context):
    """AWS Lambda handler — routes API Gateway requests to CRUD operations.

    Routes:
        GET    /personas              → list all personas
        GET    /personas/{personaID}  → get one persona
        POST   /personas              → create persona
        PUT    /personas/{personaID}  → update persona
        DELETE /personas/{personaID}  → delete persona
    """
    print(f"Event: {json.dumps(event)}")

    method = event.get('httpMethod', '')

    authorizer = event.get('requestContext', {}).get('authorizer', {})
    user_id = authorizer.get('claims', {}).get('sub')
    groups_raw = authorizer.get('claims', {}).get('cognito:groups', '')
    if isinstance(groups_raw, str):
        groups = [g.strip() for g in groups_raw.split(',') if g.strip()]
    elif isinstance(groups_raw, list):
        groups = groups_raw
    else:
        groups = []

    path_params = event.get('pathParameters') or {}
    qs = event.get('queryStringParameters') or {}
    persona_id = path_params.get('personaID')


    if method == 'OPTIONS':
        print(f"Health check heartbeat received from user {user_id}.")
        return _response(200, {'message': 'OK'})

    # GET endpoints are open — anyone can list/view personas
    if method == 'GET':
        if persona_id:
            item = get_persona_from_id(persona_id)
            if item:
                return _response(200, {'persona': item})
            return _response(404, {'message': f'Persona {persona_id} not found'})
        else:
            return list_all_personas(qs.get('lastEvaluatedKey'))

    # ─── Write operations below require Admin group ────────────────────
    if not groups or 'admin' not in list(map(str.lower, groups)):
        print(f"Unauthorized access attempt by user {user_id} who is not in Admin group.")
        return _response(403, {'message': 'Forbidden: Admin access required to modify personas.'})

    if method == 'POST':
        body = json.loads(event.get('body') or '{}')
        if 'personaID' not in body:
            body['personaID'] = str(uuid.uuid4())
        print(f"New persona create by user {user_id}: {body['personaID']}")
        return save_persona(body)

    if method == 'PUT':
        if not persona_id:
            return _response(400, {'message': 'Missing personaID in path'})
        body = json.loads(event.get('body') or '{}')
        print(f"Persona update attempted by user {user_id} on persona {persona_id} with fields: {list(body.keys())}")
        return update_persona(persona_id, body)

    if method == 'DELETE':
        if not persona_id:
            return _response(400, {'message': 'Missing personaID in path'})
        print(f"Persona delete attempted by user {user_id} on persona {persona_id}")
        return delete_persona(persona_id)

    return _response(400, {'message': f'Unsupported method: {method}'})

