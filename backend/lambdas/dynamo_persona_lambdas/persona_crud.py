import logging
import boto3
from botocore.exceptions import ClientError
from typing import Dict, Optional
import os

PERSONA_TABLE_NAME: str = os.environ.get("PERSONA_TABLE_NAME")
MAX_ITEMS_PER_PAGE: int = int(os.environ.get("MAX_ITEMS_PER_PAGE", 20)) # Default to 20 items per page for pagination

if not PERSONA_TABLE_NAME:
    logging.error("[!]Error: PERSONA_TABLE_NAME environment variable is not set.")
    raise ValueError("PERSONA_TABLE_NAME environment variable is not set")

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
    # Create a DynamoDB client
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(PERSONA_TABLE_NAME)

    try:
        response = table.get_item(Key={'personaID': id})
        item = response.get('Item')
        if item:
            return {
                'personaID': item['personaID'],
                'name': item['name'],
                'description': item['description'],
                'personaPrompt': item['personaPrompt']
            }
        else:
            logging.warning(f"Persona with ID {id} not found.")
            return None
    except ClientError as e:
        logging.error(f"Error fetching persona with ID {id}: {e.response['Error']['Message']}")
        return None

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
    # Create a DynamoDB client
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(PERSONA_TABLE_NAME)

    try:
        if not all(key in persona for key in ['name', 'description', 'personaPrompt']):
            logging.error("Persona dictionary is missing required keys: name, description, personaPrompt.")
            return {
                'message': 'Error saving persona: Missing required field(s): name, description, and personaPrompt are required.'
            }
        table.put_item(Item=persona)
        return {
            'message': 'Persona saved successfully'
        }
    except ClientError as e:
        logging.error(f"Error saving persona with ID {persona['personaID']}: {e.response['Error']['Message']}")
        return {
            'message': 'Error saving persona'
        }

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
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(PERSONA_TABLE_NAME)
    try:
        scan_kwargs = {
            'Limit': MAX_ITEMS_PER_PAGE,
            'Select': 'name' | 'personaID' | 'description'
        }
        if last_evaled_key:
            scan_kwargs['ExclusiveStartKey'] = {'personaID': last_evaled_key}
        response = table.scan(**scan_kwargs)
        items = response.get('Items', [])
        if items:
            return {
                'personas': items,
                'lastEvaluatedKey': response.get('LastEvaluatedKey', {}).get('personaID')
            }
        else:
            logging.warning("No personas found.")
            return None
    except ClientError as e:
        logging.error(f"Error fetching personas: {e.response['Error']['Message']}")
        return {
            'message': 'Error fetching personas'
        }

def update_persona(persona_id: str, updated_fields: Dict[str, str]) -> dict[str, str]:
    """Update an existing persona in DynamoDB
    :param persona_id: The unique identifier for the persona to update
    :param updated_fields: Dictionary containing the fields to update with their new values. Allowed keys are 'name', 'description', and 'personaPrompt'.
    :return: 
        dictionary containing the following keys:
            - message: Success or error message indicating the result of the update operation
    """
    # Create a DynamoDB client
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(PERSONA_TABLE_NAME)

    try:
        update_expression = "SET " + ", ".join(f"{key} = :{key}" for key in updated_fields.keys())
        expression_attribute_values = {f":{key}": value for key, value in updated_fields.items()}

        table.update_item(
            Key={'personaID': persona_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_attribute_values
        )
        return {
            'message': 'Persona updated successfully'
        }
    except ClientError as e:
        logging.error(f"Error updating persona with ID {persona_id}: {e.response['Error']['Message']}")
        return {
            'message': 'Error updating persona'
        }

def delete_persona(persona_id: str) -> dict[str, str]:
    """Delete a persona from DynamoDB using the provided ID
    :param persona_id: The unique identifier for the persona to delete
    :return: 
        dictionary containing the following keys:
            - message: Success or error message indicating the result of the delete operation
    """
    # Create a DynamoDB client
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(PERSONA_TABLE_NAME)

    try:
        table.delete_item(Key={'personaID': persona_id})
        return {
            'message': 'Persona deleted successfully'
        }
    except ClientError as e:
        logging.error(f"Error deleting persona with ID {persona_id}: {e.response['Error']['Message']}")
        return {
            'message': 'Error deleting persona'
        }

def lambda_handler(event, context) -> Dict[str, str]:
    """AWS Lambda handler to manage CRUD operations for personas in DynamoDB
    :param event: Event data passed to the Lambda function. Expects a dictionary with keys 'operation' and 'data'
    :param context: Runtime information provided by AWS Lambda

    :return: 
        Dictionary containing the following keys:
            - message: Success or error message indicating the result of the operation
    """
    operation = event.get('operation')
    data = event.get('data', {})
    if not operation:
        return {'message': 'Missing operation in event'}

    if operation == 'get':
        persona_id = data.get('personaID')
        if not persona_id:
            return {'message': 'Missing personaID for get operation'}
        result = get_persona_from_id(persona_id)
        if result:
            return {'message': 'Success', 'persona': result}
        else:
            return {'message': f'Persona with ID {persona_id} not found'}

    elif operation == 'list':
        last_evaled_key = data.get('lastEvaluatedKey')
        result = list_all_personas(last_evaled_key)
        if result and 'personas' in result:
            return {'message': 'Success', **result}
        else:
            return result if result else {'message': 'No personas found'}

    elif operation == 'create':
        persona = data.get('persona')
        if not persona:
            return {'message': 'Missing persona data for create operation'}
        return save_persona(persona)

    elif operation == 'update':
        persona_id = data.get('personaID')
        updated_fields = data.get('updatedFields')
        if not persona_id or not updated_fields:
            return {'message': 'Missing personaID or updatedFields for update operation'}
        return update_persona(persona_id, updated_fields)

    elif operation == 'delete':
        persona_id = data.get('personaID')
        if not persona_id:
            return {'message': 'Missing personaID for delete operation'}
        return delete_persona(persona_id)

    else:
        return {'message': f'Unknown operation: {operation}'}

    
