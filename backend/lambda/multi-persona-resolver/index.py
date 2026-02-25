"""
Persona Resolver Lambda

Generates a unified custom persona from one or more selected personas using
Bedrock AI, and saves the confirmed persona to S3 for downstream consumption
by the post-meeting analytics Lambda.

Routes:
  POST /personas/resolve
    Body: { "personaIds": ["id1", ...], "customNotes": "optional" }
    Returns a single AI-generated persona matching DynamoDB persona structure.
    If only one persona is selected with no notes, returns it as-is.

  POST /personas/resolve/confirm
    Body: { "sessionId": "...", "customPersona": { ... } }
    Runs guardrail check, saves persona to S3 as CUSTOM_PERSONA.json.
"""

import json
import os
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
bedrock_runtime = boto3.client('bedrock-runtime')

PERSONA_TABLE_NAME = os.environ.get('PERSONA_TABLE_NAME')
if not PERSONA_TABLE_NAME:
    raise ValueError("PERSONA_TABLE_NAME environment variable is not set")

table = dynamodb.Table(PERSONA_TABLE_NAME)

UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET', '')
PERSONA_GUARDRAIL_ID = os.environ.get('PERSONA_GUARDRAIL_ID', '')
PERSONA_GUARDRAIL_VERSION = os.environ.get('PERSONA_GUARDRAIL_VERSION', '')
BEDROCK_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0'

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
}

PERSONA_FIELDS = [
    'name', 'description', 'expertise', 'keyPriorities',
    'presentationTime', 'communicationStyle', 'personaPrompt',
    'bestPractices', 'scoringWeights', 'timeLimitSec',
]


# ─── Helpers ──────────────────────────────────────────────────────────────────

class _DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o == int(o) else float(o)
        return super().default(o)


def api_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=_DecimalEncoder),
    }


def decimal_to_float(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    if isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    return obj


def _s3_key(user_id, session_id, filename):
    return f"{user_id}/{session_id}/{filename}"


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


# ─── Guardrail ────────────────────────────────────────────────────────────────

def scan_persona_text(text):
    """Run text through the Bedrock guardrail for safety screening."""
    if not PERSONA_GUARDRAIL_ID or not PERSONA_GUARDRAIL_VERSION:
        print("[WARN] Guardrail env vars not set — skipping scan.")
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
                "The persona was rejected by our safety filters."
            )
            print("[WARN] Guardrail INTERVENED for persona text.")
            return {"allowed": False, "action": action, "message": message}

        return {"allowed": True, "action": action, "message": ""}
    except ClientError as e:
        print(f"[ERROR] Guardrail scan failed: {e}")
        return {"allowed": True, "action": "ERROR", "message": ""}


# ─── Numeric metric computation (no AI needed) ───────────────────────────────

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


def _median(values):
    if not values:
        return 0
    s = sorted(values)
    n = len(s)
    if n % 2 == 1:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2


def _compute_best_practices(personas):
    """Median best practices across personas, falling back to defaults."""
    if len(personas) == 1:
        bp = personas[0].get('bestPractices', {})
        if bp:
            resolved = {}
            for key, default in _FALLBACK_BP.items():
                if key in bp and isinstance(bp[key], dict):
                    resolved[key] = {**default, **bp[key]}
                else:
                    resolved[key] = dict(default)
            return resolved
        return dict(_FALLBACK_BP)

    resolved = {}
    for key, default in _FALLBACK_BP.items():
        collected = {}
        for p in personas:
            bp = p.get('bestPractices', {}) or {}
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


def _compute_scoring_weights(personas):
    """Median scoring weights across personas, normalized to sum to 1.0."""
    if len(personas) == 1:
        w = personas[0].get('scoringWeights', {})
        if w:
            merged = {**_FALLBACK_WEIGHTS, **w}
            total = sum(merged.values())
            return {k: round(v / total, 2) for k, v in merged.items()} if total else dict(_FALLBACK_WEIGHTS)
        return dict(_FALLBACK_WEIGHTS)

    raw = {}
    for key, default_val in _FALLBACK_WEIGHTS.items():
        values = []
        for p in personas:
            sw = p.get('scoringWeights', {}) or {}
            if key in sw and isinstance(sw[key], (int, float)):
                values.append(sw[key])
        raw[key] = _median(values) if values else default_val

    total = sum(raw.values())
    if total == 0:
        return dict(_FALLBACK_WEIGHTS)
    return {k: round(v / total, 2) for k, v in raw.items()}


def _compute_time_limit(personas):
    """Use the minimum timeLimitSec across all personas."""
    limits = [p.get('timeLimitSec') for p in personas if p.get('timeLimitSec')]
    return min(limits) if limits else None


# ─── AI persona generation (text fields only, structured output) ──────────────

_TEXT_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Short creative name, 2-4 words"},
        "description": {"type": "string", "description": "1-2 sentence description of this audience"},
        "expertise": {"type": "string", "description": "Brief expertise phrase"},
        "keyPriorities": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-4 short priority phrases"
        },
        "presentationTime": {"type": "string", "description": "e.g. 10-15 minutes"},
        "communicationStyle": {"type": "string", "description": "1 sentence communication style"},
        "personaPrompt": {"type": "string", "description": "2-3 sentence persona behavior prompt for evaluating presentations"},
    },
    "required": ["name", "description", "expertise", "keyPriorities", "presentationTime", "communicationStyle", "personaPrompt"],
    "additionalProperties": False,
})

def _build_persona_section(persona, index):
    """Format a single persona's text fields for the AI prompt."""
    kp = persona.get('keyPriorities', [])
    if isinstance(kp, list):
        if kp and isinstance(kp[0], dict) and 'S' in kp[0]:
            kp = [item['S'] for item in kp]
        priorities = ', '.join(kp)
    else:
        priorities = str(kp)

    return (
        f"Persona {index}:\n"
        f"  Name: {persona.get('name', '')}\n"
        f"  Description: {persona.get('description', '')}\n"
        f"  Expertise: {persona.get('expertise', '')}\n"
        f"  Key Priorities: {priorities}\n"
        f"  Presentation Time: {persona.get('presentationTime', '')}\n"
        f"  Communication Style: {persona.get('communicationStyle', '')}\n"
        f"  Persona Prompt: {persona.get('personaPrompt', '')}\n"
    )


def generate_custom_persona(personas, custom_notes=''):
    """Generate a unified persona: Haiku structured output for text fields, median/min for numbers."""

    # ── Compute numeric fields locally ────────────────────────────────
    best_practices = _compute_best_practices(personas)
    scoring_weights = _compute_scoring_weights(personas)
    time_limit = _compute_time_limit(personas)

    # ── Call Haiku for text fields with structured output config ──────
    persona_sections = '\n'.join(
        _build_persona_section(p, i) for i, p in enumerate(personas, 1)
    )

    prompt_parts = [
        "You are an expert at creating audience personas for presentation coaching.",
        f"You have been given {len(personas)} audience persona(s) that a presenter has selected.",
        "",
        "Source Personas:",
        persona_sections,
    ]

    if custom_notes:
        prompt_parts.extend([
            "",
            "The presenter also provided these additional notes about their audience:",
            custom_notes,
        ])

    prompt_parts.extend([
        "",
        "Create ONE unified audience persona blending the above. BE CONCISE:",
        "- name: A short creative name (2-4 words max)",
        "- description: 1-2 sentences only",
        "- expertise: A brief phrase, not a paragraph",
        "- keyPriorities: 3-4 short phrases",
        "- presentationTime: e.g. '10-15 minutes'",
        "- communicationStyle: 1 sentence max",
        "- personaPrompt: 2-3 sentences describing how this persona evaluates presentations",
        "- If custom notes are provided, weave them in naturally",
        "",
        "Keep EVERY field short and punchy. No filler, no elaboration.",
    ])

    prompt = '\n'.join(prompt_parts)

    print(f"[INFO] Calling Bedrock ({BEDROCK_MODEL_ID}) with structured output config")
    response = bedrock_runtime.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[{'role': 'user', 'content': [{'text': prompt}]}],
        outputConfig={
            'textFormat': {
                'type': 'json_schema',
                'structure': {
                    'jsonSchema': {
                        'schema': _TEXT_SCHEMA,
                        'name': 'custom_persona',
                        'description': 'A unified audience persona blended from multiple source personas',
                    }
                }
            }
        },
    )

    raw = response['output']['message']['content'][0]['text']
    text_fields = json.loads(raw)

    # ── Merge AI text fields with computed numeric fields ─────────────
    text_fields['bestPractices'] = best_practices
    text_fields['scoringWeights'] = scoring_weights
    if time_limit is not None:
        text_fields['timeLimitSec'] = time_limit

    return text_fields


# ─── Lambda handler ──────────────────────────────────────────────────────────

def lambda_handler(event, context):
    """Routes API Gateway requests for persona resolution and confirmation.

    Routes:
      POST /personas/resolve          — generate unified persona via AI
      POST /personas/resolve/confirm   — save confirmed persona to S3
    """
    print(f"Event: {json.dumps(event)}")

    method = event.get('httpMethod', '')
    if method == 'OPTIONS':
        return api_response(200, {'message': 'OK'})

    claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
    user_id = claims.get('sub')
    if not user_id:
        return api_response(401, {'error': 'Unauthorized'})

    path = event.get('resource', '')

    # ─── POST /personas/resolve ───────────────────────────────────────
    if path.endswith('/resolve') and not path.endswith('/confirm'):
        if method != 'POST':
            return api_response(400, {'error': f'Unsupported method: {method}'})

        body = json.loads(event.get('body') or '{}')
        persona_ids = body.get('personaIds', [])
        custom_notes = body.get('customNotes', '').strip()

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

        # Single persona with no notes — return as-is, skip AI
        if len(personas) == 1 and not custom_notes:
            p = personas[0]
            persona_out = {field: p.get(field) for field in PERSONA_FIELDS}
            persona_out['personaID'] = p.get('personaID', '')
            return api_response(200, {
                'customPersona': persona_out,
                'generated': False,
                'notFound': not_found,
            })

        # Multiple personas or notes present — generate via AI
        try:
            custom_persona = generate_custom_persona(personas, custom_notes)
            return api_response(200, {
                'customPersona': custom_persona,
                'generated': True,
                'notFound': not_found,
            })
        except Exception as e:
            print(f"[ERROR] Failed to generate custom persona: {e}")
            import traceback
            traceback.print_exc()
            return api_response(500, {'error': f'Failed to generate custom persona: {str(e)}'})

    # ─── POST /personas/resolve/confirm ───────────────────────────────
    if path.endswith('/confirm'):
        if method != 'POST':
            return api_response(400, {'error': f'Unsupported method: {method}'})

        if not UPLOADS_BUCKET:
            return api_response(500, {'error': 'S3 bucket not configured'})

        body = json.loads(event.get('body') or '{}')
        session_id = body.get('sessionId')
        custom_persona = body.get('customPersona')

        if not session_id:
            return api_response(400, {'error': 'sessionId is required'})
        if not custom_persona or not isinstance(custom_persona, dict):
            return api_response(400, {'error': 'customPersona object is required'})

        # Save to S3
        key = _s3_key(user_id, session_id, 'CUSTOM_PERSONA.json')
        try:
            s3_client.put_object(
                Bucket=UPLOADS_BUCKET,
                Key=key,
                Body=json.dumps(custom_persona, indent=2),
                ContentType='application/json',
            )
            print(f"[INFO] Saved custom persona -> {key}")
            return api_response(200, {'message': 'Custom persona saved successfully.'})
        except ClientError as e:
            print(f"[ERROR] Failed to save custom persona: {e}")
            return api_response(500, {'error': 'Failed to save custom persona.'})

    return api_response(400, {'error': f'Unknown route: {method} {path}'})
