import json
import os
import boto3
from decimal import Decimal
from datetime import datetime

# AWS Clients
s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime')

# Configuration
BUCKET_NAME = os.environ.get('UPLOADS_BUCKET')
PERSONA_TABLE_NAME = os.environ.get('PERSONA_TABLE_NAME')
BEDROCK_MODEL_ID = 'us.amazon.nova-lite-v1:0'


def get_user_sub_from_token(event):
    """Extract user sub from Cognito authorizer claims."""
    try:
        # API Gateway puts Cognito claims in requestContext.authorizer.claims
        claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
        user_sub = claims.get('sub')
        if not user_sub:
            print("Warning: No 'sub' claim found in token")
        return user_sub
    except Exception as e:
        print(f"Error extracting user sub: {str(e)}")
        return None


def decimal_to_float(obj):
    """Convert DynamoDB Decimal types to float for JSON serialization."""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    return obj


def get_s3_object(user_sub, utc_date, session_id, filename):
    """Retrieve an object from S3 using the full path: user_sub/date/session_id/filename."""
    try:
        s3_key = f"{user_sub}/{utc_date}/{session_id}/{filename}"
        print(f"Fetching S3 object: {s3_key}")
        response = s3.get_object(Bucket=BUCKET_NAME, Key=s3_key)
        return response['Body'].read().decode('utf-8')
    except s3.exceptions.NoSuchKey:
        print(f"File not found: {s3_key}")
        return None
    except Exception as e:
        print(f"Error fetching {filename}: {str(e)}")
        return None


def get_s3_object_bytes(user_sub, utc_date, session_id, filename):
    """Retrieve binary object from S3 (for PDFs) using the full path."""
    try:
        s3_key = f"{user_sub}/{utc_date}/{session_id}/{filename}"
        print(f"Fetching S3 binary object: {s3_key}")
        response = s3.get_object(Bucket=BUCKET_NAME, Key=s3_key)
        return response['Body'].read()
    except s3.exceptions.NoSuchKey:
        print(f"File not found: {s3_key}")
        return None
    except Exception as e:
        print(f"Error fetching {filename}: {str(e)}")
        return None


def get_persona_from_dynamodb(persona_identifier):
    """Fetch persona details from DynamoDB.
    
    First tries to look up by personaID (UUID). If not found,
    falls back to scanning by name (for manifests that store the persona name).
    """
    table = dynamodb.Table(PERSONA_TABLE_NAME)
    
    # Try direct lookup by personaID first
    try:
        response = table.get_item(Key={'personaID': persona_identifier})
        item = response.get('Item')
        if item:
            return decimal_to_float(item)
    except Exception as e:
        print(f"Error fetching persona by ID: {str(e)}")
    
    # Fallback: scan by name
    try:
        response = table.scan(
            FilterExpression='#n = :name',
            ExpressionAttributeNames={'#n': 'name'},
            ExpressionAttributeValues={':name': persona_identifier}
        )
        items = response.get('Items', [])
        if items:
            return decimal_to_float(items[0])
    except Exception as e:
        print(f"Error scanning persona by name: {str(e)}")
    
    return None


def generate_feedback_with_bedrock(persona, transcript, persona_customization=None, pdf_bytes=None):
    """Generate personalized feedback using Amazon Bedrock Nova 2 Lite."""
    
    # Extract persona details from DynamoDB
    persona_name = persona.get('name', persona.get('title', 'a professional evaluator'))
    description = persona.get('description', '')
    communication_style = persona.get('communicationStyle', '')
    attention_span = persona.get('attentionSpan', '')
    expertise = persona.get('expertise', '')
    
    # Handle keyPriorities - could be a list or DynamoDB list format
    key_priorities = persona.get('keyPriorities', [])
    if isinstance(key_priorities, list):
        if key_priorities and isinstance(key_priorities[0], dict) and 'S' in key_priorities[0]:
            # DynamoDB format: [{"S": "value"}]
            key_priorities = [item['S'] for item in key_priorities]
        priorities_text = ', '.join(key_priorities)
    else:
        priorities_text = str(key_priorities)
    
    # Build the prompt with all available context
    prompt_parts = [
        f"You are providing post-presentation feedback as a {persona_name}.",
        "",
        "Persona Context:",
        f"- Role: {persona_name}",
        f"- Description: {description}",
        f"- Communication Style: {communication_style}",
        f"- Attention Span: {attention_span}",
        f"- Expertise: {expertise}",
        f"- Key Priorities: {priorities_text}",
    ]
    
    # Add custom persona instructions if available
    if persona_customization:
        prompt_parts.extend([
            "",
            "Additional Custom Instructions:",
            persona_customization,
        ])
    
    prompt_parts.extend([
        "",
        "Presentation Transcript (with timestamps):",
        transcript if transcript else 'No transcript available',
    ])
    
    prompt_parts.extend([
        "",
        f"Based on your role as {persona_name}, the transcript, and the presentation materials (if PDF is provided), provide detailed improvement feedback with:",
        "",
        "1. Overall Performance Assessment (2-3 sentences)",
        f"   - Evaluate based on your communication style: {communication_style}",
        "",
        "2. Content Strengths (2-3 specific points)",
        "   - Reference specific parts of the transcript",
        "   - Highlight what worked well for this audience",
        "",
        f"3. Areas for Improvement (3-4 specific actionable points focused on: {priorities_text})",
        "   - Provide concrete examples from the transcript",
        "   - Give specific recommendations",
        "",
        "4. Persona-Specific Feedback",
        f"   - How well did they address your expertise in {expertise}?",
        f"   - Did they match your attention span of {attention_span}?",
        f"   - Were your key priorities ({priorities_text}) addressed?",
        "",
        f"Use a {communication_style} tone throughout your feedback.",
        "Be constructive and encouraging while being honest about areas needing work."
    ])
    
    prompt = "\n".join(prompt_parts)
    
    try:
        # Prepare the message content
        message_content = [{'text': prompt}]
        
        # Add PDF as document if available
        if pdf_bytes:
            try:
                import base64
                pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
                message_content.append({
                    'document': {
                        'format': 'pdf',
                        'name': 'presentation.pdf',
                        'source': {
                            'bytes': pdf_base64
                        }
                    }
                })
                print("PDF document added to Bedrock request")
            except Exception as e:
                print(f"Warning: Could not add PDF to request: {str(e)}")
        
        # Call Bedrock Nova 2 Lite
        request_body = {
            'messages': [
                {
                    'role': 'user',
                    'content': message_content
                }
            ]
        }
        
        print(f"Calling Bedrock with {len(message_content)} content items")
        
        response = bedrock_runtime.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType='application/json',
            accept='application/json',
            body=json.dumps(request_body)
        )
        
        response_body = json.loads(response['body'].read())
        feedback_text = response_body['output']['message']['content'][0]['text']
        
        return feedback_text
    except Exception as e:
        print(f"Error generating feedback with Bedrock: {str(e)}")
        import traceback
        traceback.print_exc()
        return f"Error generating feedback: {str(e)}"


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}


def error_response(status_code, message):
    """Return a formatted API Gateway error response."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }


def success_response(body):
    """Return a formatted API Gateway success response."""
    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    """Post-meeting analytics handler — generates analytics via Nova 2 Lite."""
    
    try:
        user_sub = get_user_sub_from_token(event)
        if not user_sub:
            return error_response(401, "Unauthorized: Could not extract user identity")
        
        params = event.get('queryStringParameters', {})
        session_id = params.get('session_id')
        utc_timestamp = params.get('timestamp')  # Expected format: YYYY-MM-DD
        
        if not session_id:
            return error_response(400, "session_id is required")
        if not utc_timestamp:
            return error_response(400, "timestamp (YYYY-MM-DD) is required")
        
        print(f"Processing analytics for user: {user_sub}, date: {utc_timestamp}, session: {session_id}")
        
        # 1. Fetch manifest
        manifest_str = get_s3_object(user_sub, utc_timestamp, session_id, 'manifest.json')
        if not manifest_str:
            return error_response(404, "Session manifest not found")
        
        manifest = json.loads(manifest_str)
        print(f"Manifest loaded: {json.dumps(manifest)}")
        
        persona_id = manifest.get('persona')
        if not persona_id:
            return error_response(400, "Persona not found in manifest")
        
        # 2. Fetch persona from DynamoDB
        persona = get_persona_from_dynamodb(persona_id)
        if not persona:
            return error_response(404, f"Persona {persona_id} not found")
        print(f"Persona loaded: {persona.get('name')}")
        
        # 3. Fetch and parse transcript
        transcript_str = get_s3_object(user_sub, utc_timestamp, session_id, 'transcript.json')
        if not transcript_str:
            return error_response(404, "Transcript not found")
        
        transcript_obj = json.loads(transcript_str)
        transcript = '\n'.join(
            f"[{item.get('timestamp', '')}] {item.get('text', '')}"
            for item in transcript_obj.get('transcripts', [])
            if item.get('text')
        )
        print(f"Transcript loaded: {len(transcript)} characters")
        
        # 4. Fetch optional files based on manifest flags
        persona_customization = None
        if manifest.get('hasPersonaCustomization', False):
            persona_customization = get_s3_object(user_sub, utc_timestamp, session_id, 'CUSTOM_PERSONA_INSTRUCTION.txt')
        
        pdf_bytes = None
        if manifest.get('hasPresentationPdf', False):
            pdf_bytes = get_s3_object_bytes(user_sub, utc_timestamp, session_id, 'presentation.pdf')
        
        # 5. Generate feedback using Bedrock
        print("Generating feedback with Bedrock Nova 2 Lite...")
        feedback = generate_feedback_with_bedrock(persona, transcript, persona_customization, pdf_bytes)
        
        # 6. Build and save result
        analytics_result = {
            'sessionId': session_id,
            'persona': {
                'id': persona_id,
                'title': persona.get('name'),
                'description': persona.get('description')
            },
            'feedback': feedback,
            'generatedAt': manifest.get('endTime') or manifest.get('lastUpdated'),
            'includedFiles': {
                'transcript': True,
                'presentationPdf': pdf_bytes is not None,
                'personaCustomization': persona_customization is not None
            }
        }
        
        try:
            s3_key = f"{user_sub}/{utc_timestamp}/{session_id}/analytics_feedback.json"
            s3.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=json.dumps(analytics_result, indent=2), ContentType='application/json')
            print(f"Analytics feedback saved to S3: {s3_key}")
        except Exception as e:
            print(f"Warning: Failed to save analytics to S3: {str(e)}")
        
        return success_response(analytics_result)
        
    except Exception as e:
        print(f"Error in lambda_handler: {str(e)}")
        import traceback
        traceback.print_exc()
        return error_response(500, f"Internal server error: {str(e)}")
