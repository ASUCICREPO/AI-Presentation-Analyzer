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
BEDROCK_MODEL_ID = 'global.anthropic.claude-sonnet-4-6'


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



def generate_feedback_with_bedrock(persona, transcript, persona_customization=None, pdf_bytes=None, session_analytics=None):
    """Generate personalized feedback using Amazon Bedrock with structured outputs."""

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

    # Add session analytics metrics if available
    if session_analytics:
        final_avg = session_analytics.get('finalAverage', {})
        windows = session_analytics.get('windows', [])

        prompt_parts.extend([
            "",
            "Session Delivery Metrics (captured in 30-second windows):",
            f"- Overall Speaking Pace: {final_avg.get('speakingPace', 'N/A')} words per minute",
            f"- Overall Volume Level: {final_avg.get('volumeLevel', 'N/A')}%",
            f"- Overall Eye Contact Score: {final_avg.get('eyeContactScore', 'N/A')}%",
            f"- Total Filler Words: {final_avg.get('totalFillerWords', 'N/A')}",
            f"- Total Pauses: {final_avg.get('totalPauses', 'N/A')}",
            f"- Number of 30-second Windows: {final_avg.get('totalWindows', len(windows))}",
        ])

        if windows:
            prompt_parts.append("")
            prompt_parts.append("Per-Window Breakdown:")
            for w in windows:
                pace = w.get('speakingPace', {})
                volume = w.get('volumeLevel', {})
                prompt_parts.append(
                    f"  Window {w.get('windowNumber', '?')} ({w.get('timestamp', '')}):"
                    f" Pace={pace.get('average', 'N/A')}wpm (SD:{pace.get('standardDeviation', 'N/A')}),"
                    f" Volume={volume.get('average', 'N/A')}% (SD:{volume.get('standardDeviation', 'N/A')}),"
                    f" Eye Contact={w.get('eyeContactScore', 'N/A')}%,"
                    f" Fillers={w.get('fillerWords', 0)}, Pauses={w.get('pauses', 0)}"
                )

    prompt_parts.extend([
        "",
        f"Based on your role as {persona_name}, the transcript, the delivery metrics, and the presentation materials (if PDF is provided), provide structured feedback.",
        "",
        "For keyRecommendations: provide 4-6 specific, actionable recommendations covering content, delivery, and persona-specific improvements. Each recommendation should have a short title and a detailed description with concrete examples from the transcript.",
        "",
        "For performanceSummary: provide an overall assessment (2-3 sentences), list 2-3 content strengths with transcript references, and give delivery feedback on pace, volume, eye contact, filler words, and pauses based on the session metrics.",
        "",
        f"Use a {communication_style} tone throughout your feedback.",
        "Be constructive and encouraging while being honest about areas needing work."
    ])

    prompt = "\n".join(prompt_parts)

    # Define the structured output schema
    feedback_schema = {
        "type": "object",
        "properties": {
            "keyRecommendations": {
                "type": "array",
                "description": "Specific, actionable recommendations for improvement",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short title for the recommendation"
                        },
                        "description": {
                            "type": "string",
                            "description": "Detailed recommendation with concrete examples"
                        }
                    },
                    "required": ["title", "description"],
                    "additionalProperties": False
                }
            },
            "performanceSummary": {
                "type": "object",
                "description": "Overall performance assessment and delivery feedback",
                "properties": {
                    "overallAssessment": {
                        "type": "string",
                        "description": "2-3 sentence overall performance assessment"
                    },
                    "contentStrengths": {
                        "type": "array",
                        "description": "Key content strengths observed",
                        "items": {
                            "type": "string"
                        }
                    },
                    "deliveryFeedback": {
                        "type": "object",
                        "description": "Feedback on delivery metrics",
                        "properties": {
                            "speakingPace": {"type": "string", "description": "Assessment of speaking pace"},
                            "volume": {"type": "string", "description": "Assessment of volume consistency"},
                            "eyeContact": {"type": "string", "description": "Assessment of eye contact"},
                            "fillerWords": {"type": "string", "description": "Assessment of filler word usage"},
                            "pauses": {"type": "string", "description": "Assessment of pause usage"}
                        },
                        "required": ["speakingPace", "volume", "eyeContact", "fillerWords", "pauses"],
                        "additionalProperties": False
                    }
                },
                "required": ["overallAssessment", "contentStrengths", "deliveryFeedback"],
                "additionalProperties": False
            }
        },
        "required": ["keyRecommendations", "performanceSummary"],
        "additionalProperties": False
    }

    try:
        # Prepare the message content
        message_content = [{'text': prompt}]

        # Add PDF as document if available
        if pdf_bytes:
            try:
                import base64
                message_content.append({
                    'document': {
                        'format': 'pdf',
                        'name': 'presentation',
                        'source': {
                            'bytes': pdf_bytes
                        }
                    }
                })
                print("PDF document added to Bedrock request")
            except Exception as e:
                print(f"Warning: Could not add PDF to request: {str(e)}")

        print(f"Calling Bedrock with {len(message_content)} content items (structured output)")

        response = bedrock_runtime.converse(
            modelId=BEDROCK_MODEL_ID,
            messages=[
                {
                    'role': 'user',
                    'content': message_content
                }
            ],
            inferenceConfig={
                'maxTokens': 4096,
            },
            outputConfig={
                'textFormat': {
                    'type': 'json_schema',
                    'structure': {
                        'jsonSchema': {
                            'schema': json.dumps(feedback_schema),
                            'name': 'presentation_feedback',
                            'description': 'Structured presentation feedback with recommendations and performance summary'
                        }
                    }
                }
            }
        )

        # Check stop reason for potential issues
        stop_reason = response.get('stopReason', '')
        if stop_reason == 'max_tokens':
            print("Warning: Response was truncated due to max_tokens limit")

        response_text = response['output']['message']['content'][0]['text']
        feedback = json.loads(response_text)

        return feedback
    except Exception as e:
        print(f"Error generating feedback with Bedrock: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"keyRecommendations": [], "performanceSummary": {"overallAssessment": f"Error generating feedback: {str(e)}", "contentStrengths": [], "deliveryFeedback": {"speakingPace": "N/A", "volume": "N/A", "eyeContact": "N/A", "fillerWords": "N/A", "pauses": "N/A"}}}



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
        
        # 4b. Fetch session analytics (30-sec window metrics)
        session_analytics = None
        session_analytics_str = get_s3_object(user_sub, utc_timestamp, session_id, 'session_analytics.json')
        if session_analytics_str:
            try:
                session_analytics = json.loads(session_analytics_str)
                print(f"Session analytics loaded: {len(session_analytics.get('windows', []))} windows")
            except json.JSONDecodeError:
                print("Warning: Could not parse session_analytics.json")
        
        # 5. Generate feedback using Bedrock
        print("Generating feedback with Bedrock Nova 2 Lite...")
        feedback = generate_feedback_with_bedrock(persona, transcript, persona_customization, pdf_bytes, session_analytics)
        
        # 6. Build and save result
        analytics_result = {
            'sessionId': session_id,
            'persona': {
                'id': persona_id,
                'title': persona.get('name'),
                'description': persona.get('description')
            },
            'keyRecommendations': feedback.get('keyRecommendations', []),
            'performanceSummary': feedback.get('performanceSummary', {}),
            'generatedAt': manifest.get('endTime') or manifest.get('lastUpdated'),
            'includedFiles': {
                'transcript': True,
                'presentationPdf': pdf_bytes is not None,
                'personaCustomization': persona_customization is not None,
                'sessionAnalytics': session_analytics is not None
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
