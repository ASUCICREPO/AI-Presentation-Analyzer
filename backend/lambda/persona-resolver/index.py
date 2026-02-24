"""
Persona Resolver Lambda

Handles ALL persona-related logic:
  - Resolving single/multiple persona configs into merged best practices & scoring weights
  - Generating a unified prompt for post-meeting analytics (calls Bedrock to merge multiple personas)
  - Persona customization text upload/read with S3 guardrail scanning

Routes (API Gateway):
  POST /personas/resolve       — resolve one or more personas by ID (frontend real-time thresholds)
  GET  /personas/resolve       — same via query string
  POST /personas/customization — upload persona customization text
  GET  /personas/customization — read persona customization text

Internal (Lambda invoke):
  action: "resolve-prompt"     — returns merged prompt + median best practices for post-meeting analytics
"""

import json
import os
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime')
s3_client = boto3.client('s3')

PERSONA_TABLE_NAME = os.environ.get('PERSONA_TABLE_NAME')
if not PERSONA_TABLE_NAME:
    raise ValueError("PERSONA_TABLE_NAME environment variable is not set")

table = dynamodb.Table(PERSONA_TABLE_NAME)

UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET', '')
PERSONA_GUARDRAIL_ID = os.environ.get('PERSONA_GUARDRAIL_ID', '')
PERSONA_GUARDRAIL_VERSION = os.environ.get('PERSONA_GUARDRAIL_VERSION', '')
MAX_PERSONA_TEXT_BYTES = 10 * 1024  # 10 KB

# Model used to merge multiple personas into a single prompt
MERGE_MODEL_ID = os.environ.get('MERGE_MODEL_ID', 'amazon.nova-lite-v1:0')

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
}

# ─── Fallback thresholds ─────────────────────────────────────────────────────

_FALLBACK_BP = {
    'wpm': {'min': 140, 'max': 160},
    'eyeContact': {'min': 60},
    'fillerWords': {'max': 3},
    'pauses': {'min': 4},
}

_FALLBACK_WEIGHTS = {
    'pace': 0.25,
    'eyeContact': 0.30,
    'fillerWords': 0.20,
    'pauses': 0.25,
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def api_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=_DecimalEncoder),
    }


class _DecimalEncoder(json.JSONEncoder):
    """Handle Decimal types returned by DynamoDB."""
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o == int(o) else float(o)
        return super().default(o)


def decimal_to_float(obj):
    """Recursively convert Decimal values to int/float."""
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    if isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    return obj


def _median(values):
    """Return the median of a list of numbers."""
    if not values:
        return 0
    s = sorted(values)
    n = len(s)
    if n % 2 == 1:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2


# ─── Persona fetching ────────────────────────────────────────────────────────

def get_persona(identifier):
    """Look up persona by ID, falling back to scan-by-name."""
    try:
        item = table.get_item(Key={'personaID': identifier}).get('Item')
        if item:
            return decimal_to_float(item)
    except ClientError as e:
        print(f"Error fetching persona by ID: {e}")

    try:
        items = table.scan(
            FilterExpression='#n = :name',
            ExpressionAttributeNames={'#n': 'name'},
            ExpressionAttributeValues={':name': identifier},
        ).get('Items', [])
        if items:
            return decimal_to_float(items[0])
    except ClientError as e:
        print(f"Error scanning persona by name: {e}")

    return None


# ─── Best practices resolution ────────────────────────────────────────────────

def _resolve_best_practices_single(persona):
    """Pull bestPractices from a single persona; fall back to defaults per field."""
    persona_bp = persona.get('bestPractices', {}) if persona else {}
    resolved = {}
    for key, default in _FALLBACK_BP.items():
        if key in persona_bp and isinstance(persona_bp[key], dict):
            resolved[key] = {**default, **persona_bp[key]}
        else:
            resolved[key] = dict(default)
    return resolved


def resolve_best_practices(personas):
    """Compute median best practices across multiple personas."""
    if not personas:
        return dict(_FALLBACK_BP)
    if len(personas) == 1:
        return _resolve_best_practices_single(personas[0])

    resolved = {}
    for key, default in _FALLBACK_BP.items():
        collected = {}
        for p in personas:
            bp = p.get('bestPractices', {}) if p else {}
            if key in bp and isinstance(bp[key], dict):
                for sub_key, val in bp[key].items():
                    if isinstance(val, (int, float)):
                        collected.setdefault(sub_key, []).append(val)

        entry = dict(default)
        for sub_key in default:
            if sub_key in collected and collected[sub_key]:
                entry[sub_key] = round(_median(collected[sub_key]))
        resolved[key] = entry
    return resolved


def resolve_scoring_weights(personas):
    """Compute median scoring weights across multiple personas, normalized to sum to 1.0."""
    if not personas:
        return dict(_FALLBACK_WEIGHTS)
    if len(personas) == 1:
        w = personas[0].get('scoringWeights', {})
        if w:
            merged = {**_FALLBACK_WEIGHTS, **w}
        else:
            return dict(_FALLBACK_WEIGHTS)
        total = sum(merged.values())
        if total == 0:
            return dict(_FALLBACK_WEIGHTS)
        return {k: v / total for k, v in merged.items()}

    raw = {}
    for key, default_val in _FALLBACK_WEIGHTS.items():
        values = []
        for p in personas:
            sw = p.get('scoringWeights', {})
            if sw and key in sw and isinstance(sw[key], (int, float)):
                values.append(sw[key])
        raw[key] = _median(values) if values else default_val

    total = sum(raw.values())
    if total == 0:
        return dict(_FALLBACK_WEIGHTS)
    return {k: v / total for k, v in raw.items()}


# ─── Prompt generation (single & multi-persona) ──────────────────────────────

def _build_single_persona_prompt(persona, persona_customization=None):
    """Build the feedback prompt section for a single persona."""
    name = persona.get('name', persona.get('title', 'a professional evaluator'))
    description = persona.get('description', '')
    communication_style = persona.get('communicationStyle', 'professional')
    attention_span = persona.get('attentionSpan', '')
    expertise = persona.get('expertise', '')

    key_priorities = persona.get('keyPriorities', [])
    if isinstance(key_priorities, list):
        if key_priorities and isinstance(key_priorities[0], dict) and 'S' in key_priorities[0]:
            key_priorities = [item['S'] for item in key_priorities]
        priorities_text = ', '.join(key_priorities)
    else:
        priorities_text = str(key_priorities)

    parts = [
        f"You are providing post-presentation feedback from the perspective of {name}.",
        "",
        "Audience Persona:",
        f"  Name: {name}",
        f"  Description: {description}",
        f"  Communication Style: {communication_style}",
        f"  Attention Span: {attention_span}",
        f"  Expertise: {expertise}",
        f"  Key Priorities: {priorities_text}",
    ]

    if persona_customization:
        parts.extend(["", "Additional Custom Instructions:", persona_customization])

    return '\n'.join(parts), communication_style


def _merge_personas_with_bedrock(personas, persona_customization=None):
    """Use a Bedrock model to merge multiple personas into a single unified prompt.
    Returns (merged_prompt_section, communication_style)."""
    persona_descriptions = []
    all_priorities = []
    communication_styles = []

    for i, persona in enumerate(personas, 1):
        name = persona.get('name', persona.get('title', 'Evaluator'))
        description = persona.get('description', '')
        communication_style = persona.get('communicationStyle', 'professional')
        attention_span = persona.get('attentionSpan', '')
        expertise = persona.get('expertise', '')
        communication_styles.append(communication_style)

        key_priorities = persona.get('keyPriorities', [])
        if isinstance(key_priorities, list):
            if key_priorities and isinstance(key_priorities[0], dict) and 'S' in key_priorities[0]:
                key_priorities = [item['S'] for item in key_priorities]
            all_priorities.extend(key_priorities)
            priorities_text = ', '.join(key_priorities)
        else:
            priorities_text = str(key_priorities)

        persona_descriptions.append(
            f"Persona {i}: {name}\n"
            f"  Description: {description}\n"
            f"  Communication Style: {communication_style}\n"
            f"  Attention Span: {attention_span}\n"
            f"  Expertise: {expertise}\n"
            f"  Key Priorities: {priorities_text}"
        )

    merge_prompt = (
        "You are given multiple audience personas for a presentation feedback system. "
        "Your job is to merge them into a SINGLE unified evaluator persona that captures "
        "the combined perspective, priorities, and expectations of all personas.\n\n"
        "Input Personas:\n" + "\n\n".join(persona_descriptions) + "\n\n"
    )

    if persona_customization:
        merge_prompt += f"Additional Custom Instructions:\n{persona_customization}\n\n"

    merge_prompt += (
        "Create a merged persona description that:\n"
        "1. Combines the key priorities from all personas\n"
        "2. Balances their communication style preferences\n"
        "3. Reflects the expertise areas of all personas\n"
        "4. Captures the attention span expectations (use the most demanding)\n\n"
        "Respond with ONLY the merged persona prompt in this exact format (no JSON, no markdown):\n"
        "---\n"
        "You are providing post-presentation feedback from the combined perspective of [names].\n\n"
        "Unified Audience Persona:\n"
        "  Name: [Combined name]\n"
        "  Description: [merged description]\n"
        "  Communication Style: [merged style]\n"
        "  Attention Span: [most demanding]\n"
        "  Expertise: [combined expertise]\n"
        "  Key Priorities: [all merged priorities]\n"
        "---"
    )

    print(f"Calling Bedrock ({MERGE_MODEL_ID}) to merge {len(personas)} personas")

    try:
        response = bedrock_runtime.converse(
            modelId=MERGE_MODEL_ID,
            messages=[{'role': 'user', 'content': [{'text': merge_prompt}]}],
        )
        merged_text = response['output']['message']['content'][0]['text'].strip()

        # Strip any markdown fences
        if merged_text.startswith('---'):
            merged_text = merged_text[3:].strip()
        if merged_text.endswith('---'):
            merged_text = merged_text[:-3].strip()
        if merged_text.startswith('```'):
            nl = merged_text.find('\n')
            merged_text = merged_text[nl + 1:] if nl != -1 else merged_text[3:]
        if merged_text.endswith('```'):
            merged_text = merged_text[:-3].strip()

        # Use the first persona's communication style as primary
        primary_style = communication_styles[0] if communication_styles else 'professional'
        return merged_text, primary_style

    except Exception as e:
        print(f"Bedrock merge failed, falling back to manual merge: {e}")
        return _manual_merge_personas(personas, persona_customization)


def _manual_merge_personas(personas, persona_customization=None):
    """Fallback: manually combine persona sections without Bedrock."""
    persona_names = []
    persona_sections = []

    for i, persona in enumerate(personas, 1):
        name = persona.get('name', persona.get('title', 'a professional evaluator'))
        persona_names.append(name)
        description = persona.get('description', '')
        communication_style = persona.get('communicationStyle', '')
        attention_span = persona.get('attentionSpan', '')
        expertise = persona.get('expertise', '')

        key_priorities = persona.get('keyPriorities', [])
        if isinstance(key_priorities, list):
            if key_priorities and isinstance(key_priorities[0], dict) and 'S' in key_priorities[0]:
                key_priorities = [item['S'] for item in key_priorities]
            priorities_text = ', '.join(key_priorities)
        else:
            priorities_text = str(key_priorities)

        persona_sections.extend([
            f"  Persona {i}: {name}",
            f"  - Description: {description}",
            f"  - Communication Style: {communication_style}",
            f"  - Attention Span: {attention_span}",
            f"  - Expertise: {expertise}",
            f"  - Key Priorities: {priorities_text}",
            "",
        ])

    combined_names = ' and '.join(persona_names) if len(persona_names) <= 2 else \
        ', '.join(persona_names[:-1]) + f', and {persona_names[-1]}'

    parts = [
        f"You are providing post-presentation feedback from the combined perspective of {combined_names}.",
        "Evaluate the presentation considering ALL of the following audience personas.",
        "Your feedback should reflect the priorities and expectations of each persona.",
        "",
        "Audience Personas:",
    ]
    parts.extend(persona_sections)

    if persona_customization:
        parts.extend(["", "Additional Custom Instructions:", persona_customization])

    primary_style = personas[0].get('communicationStyle', 'professional')
    return '\n'.join(parts), primary_style


def resolve_persona_prompt(persona_ids, persona_customization=None):
    """Main entry point: fetch personas, resolve prompt + median values.
    Returns dict with mergedPrompt, communicationStyle, bestPractices, scoringWeights, personas."""
    personas = []
    not_found = []
    for pid in persona_ids:
        p = get_persona(pid)
        if p:
            personas.append(p)
        else:
            not_found.append(pid)

    if not personas:
        raise ValueError(f"No personas found for IDs: {persona_ids}")

    if not_found:
        print(f"[WARN] Personas not found: {not_found}")

    # Generate the prompt
    if len(personas) == 1:
        merged_prompt, comm_style = _build_single_persona_prompt(personas[0], persona_customization)
    else:
        merged_prompt, comm_style = _merge_personas_with_bedrock(personas, persona_customization)

    # Compute median best practices and scoring weights
    best_practices = resolve_best_practices(personas)
    scoring_weights = resolve_scoring_weights(personas)

    return {
        'mergedPrompt': merged_prompt,
        'communicationStyle': comm_style,
        'bestPractices': best_practices,
        'scoringWeights': scoring_weights,
        'personas': [
            {
                'personaID': p.get('personaID', ''),
                'name': p.get('name', ''),
                'description': p.get('description', ''),
            }
            for p in personas
        ],
        'notFound': not_found,
    }


# ─── S3 persona customization ────────────────────────────────────────────────

def _s3_key(user_id, session_id, filename):
    return f"{user_id}/{session_id}/{filename}"


def scan_persona_text(text):
    """Run persona customization text through the Bedrock guardrail."""
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
            outputs = response.get("outputs", [])
            message = outputs[0]["text"] if outputs else (
                "The persona customization was rejected by our safety filters."
            )
            print(f"[WARN] Guardrail INTERVENED for persona text.")
            return {"allowed": False, "action": action, "message": message}

        return {"allowed": True, "action": action, "message": ""}
    except ClientError as e:
        print(f"[ERROR] Guardrail scan failed: {e}")
        return {"allowed": True, "action": "ERROR", "message": ""}


def upload_persona_customization(user_id, session_id, text):
    """Write validated persona customization text to S3."""
    key = _s3_key(user_id, session_id, 'CUSTOM_PERSONA_INSTRUCTION.txt')
    try:
        s3_client.put_object(
            Bucket=UPLOADS_BUCKET, Key=key,
            Body=text.encode('utf-8'), ContentType='text/plain',
        )
        print(f"[INFO] Uploaded persona customization -> {key}")
        return True
    except ClientError as e:
        print(f"[ERROR] Failed to upload persona customization: {e}")
        return False


def get_persona_customization(user_id, session_id):
    """Read persona customization text from S3."""
    key = _s3_key(user_id, session_id, 'CUSTOM_PERSONA_INSTRUCTION.txt')
    try:
        obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=key)
        return obj['Body'].read().decode('utf-8')
    except s3_client.exceptions.NoSuchKey:
        return None
    except ClientError as e:
        print(f"[ERROR] Failed to read persona customization: {e}")
        return None


# ─── Lambda handler ──────────────────────────────────────────────────────────

def lambda_handler(event, context):
    """Routes API Gateway requests and internal Lambda invocations.

    API Gateway routes:
      POST /personas/resolve
      GET  /personas/resolve
      POST /personas/customization
      GET  /personas/customization

    Internal Lambda invoke (from post-meeting analytics):
      { "action": "resolve-prompt", "personaIds": [...], "personaCustomization": "..." }
    """
    print(f"Event: {json.dumps(event)}")

    # ─── Internal Lambda invoke (no httpMethod) ───────────────────────
    action = event.get('action')
    if action == 'resolve-prompt':
        persona_ids = event.get('personaIds', [])
        persona_customization = event.get('personaCustomization')
        if not persona_ids:
            return {'error': 'personaIds is required'}
        try:
            result = resolve_persona_prompt(persona_ids, persona_customization)
            return result
        except Exception as e:
            print(f"resolve-prompt failed: {e}")
            return {'error': str(e)}

    # ─── API Gateway requests ─────────────────────────────────────────
    method = event.get('httpMethod', '')
    if method == 'OPTIONS':
        return api_response(200, {'message': 'OK'})

    claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
    user_id = claims.get('sub')
    if not user_id:
        return api_response(401, {'error': 'Unauthorized'})

    qs = event.get('queryStringParameters') or {}
    path = event.get('resource', '')

    # ─── /personas/resolve ────────────────────────────────────────────
    if path.endswith('/resolve'):
        if method == 'POST':
            body = json.loads(event.get('body') or '{}')
            persona_ids = body.get('personaIds', [])
        elif method == 'GET':
            raw = qs.get('personaIds', '')
            persona_ids = [p.strip() for p in raw.split(',') if p.strip()]
        else:
            return api_response(400, {'error': f'Unsupported method: {method}'})

        if not persona_ids:
            return api_response(400, {'error': 'personaIds is required'})

        personas = []
        not_found = []
        for pid in persona_ids:
            p = get_persona(pid)
            if p:
                personas.append(p)
            else:
                not_found.append(pid)

        if not personas:
            return api_response(404, {'error': f'No personas found for IDs: {persona_ids}'})

        if not_found:
            print(f"[WARN] Personas not found: {not_found}")

        best_practices = resolve_best_practices(personas)
        scoring_weights = resolve_scoring_weights(personas)

        return api_response(200, {
            'resolved': {
                'bestPractices': best_practices,
                'scoringWeights': scoring_weights,
            },
            'personas': [
                {
                    'personaID': p.get('personaID', ''),
                    'name': p.get('name', ''),
                    'description': p.get('description', ''),
                    'communicationStyle': p.get('communicationStyle', ''),
                    'attentionSpan': p.get('attentionSpan', ''),
                    'expertise': p.get('expertise', ''),
                    'keyPriorities': p.get('keyPriorities', []),
                    'bestPractices': p.get('bestPractices'),
                    'scoringWeights': p.get('scoringWeights'),
                    'timeLimitSec': p.get('timeLimitSec'),
                }
                for p in personas
            ],
            'notFound': not_found,
        })

    # ─── /personas/customization ──────────────────────────────────────
    if path.endswith('/customization'):
        session_id = qs.get('session_id')
        if not session_id:
            return api_response(400, {'error': "Missing 'session_id' query parameter"})

        if not UPLOADS_BUCKET:
            return api_response(500, {'error': 'S3 bucket not configured'})

        if method == 'POST':
            body = json.loads(event.get('body') or '{}')
            text = body.get('text', '')

            if not text or not text.strip():
                return api_response(400, {'error': 'Persona customization text cannot be empty.'})
            if len(text.encode('utf-8')) > MAX_PERSONA_TEXT_BYTES:
                return api_response(400, {
                    'error': f'Text exceeds the {MAX_PERSONA_TEXT_BYTES // 1024} KB limit.',
                })

            scan_result = scan_persona_text(text)
            if not scan_result['allowed']:
                return api_response(400, {
                    'message': scan_result['message'],
                    'rejected': True,
                })

            success = upload_persona_customization(user_id, session_id, text)
            if not success:
                return api_response(500, {'error': 'Failed to save persona customization.'})

            return api_response(200, {'message': 'Persona customization saved successfully.'})

        if method == 'GET':
            text = get_persona_customization(user_id, session_id)
            if text is None:
                return api_response(200, {'customization': None, 'exists': False})

            scan_result = scan_persona_text(text)
            if not scan_result['allowed']:
                return api_response(400, {
                    'message': scan_result['message'],
                    'exists': True,
                    'rejected': True,
                })

            return api_response(200, {'customization': text, 'exists': True})

    return api_response(400, {'error': f'Unknown route: {method} {path}'})
