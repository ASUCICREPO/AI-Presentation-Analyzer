import json
import os
import boto3
from decimal import Decimal
from datetime import datetime, timezone

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime')

BUCKET_NAME = os.environ.get('UPLOADS_BUCKET')
PERSONA_TABLE_NAME = os.environ.get('PERSONA_TABLE_NAME')
BEDROCK_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0'

FEEDBACK_FILE = 'ai_feedback.json'
STATUS_FILE = 'ai_feedback_status.json'
STALE_THRESHOLD_SEC = 120

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def api_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def decimal_to_float(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    return obj


def s3_key(user_sub, session_id, filename):
    return f"{user_sub}/{session_id}/{filename}"


def read_s3_text(key):
    try:
        return s3.get_object(Bucket=BUCKET_NAME, Key=key)['Body'].read().decode('utf-8')
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:
        print(f"Error reading {key}: {e}")
        return None


def read_s3_bytes(key):
    try:
        return s3.get_object(Bucket=BUCKET_NAME, Key=key)['Body'].read()
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:
        print(f"Error reading {key}: {e}")
        return None


def write_s3_json(key, data):
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=key,
        Body=json.dumps(data, indent=2),
        ContentType='application/json',
    )


def get_persona(identifier):
    """Look up persona by ID, falling back to scan-by-name."""
    table = dynamodb.Table(PERSONA_TABLE_NAME)
    try:
        item = table.get_item(Key={'personaID': identifier}).get('Item')
        if item:
            return decimal_to_float(item)
    except Exception as e:
        print(f"Error fetching persona by ID: {e}")

    try:
        items = table.scan(
            FilterExpression='#n = :name',
            ExpressionAttributeNames={'#n': 'name'},
            ExpressionAttributeValues={':name': identifier},
        ).get('Items', [])
        if items:
            return decimal_to_float(items[0])
    except Exception as e:
        print(f"Error scanning persona by name: {e}")

    return None

# ─── Timestamped feedback from session analytics windows ──────────────────────

# Fallback thresholds — only used when the persona has no bestPractices.
_FALLBACK_BP = {
    'wpm': {'min': 140, 'max': 160},
    'eyeContact': {'min': 60},
    'fillerWords': {'max': 3},
    'pauses': {'min': 4},
}

def _resolve_best_practices(persona):
    """Pull bestPractices from the persona; fall back to defaults per field."""
    persona_bp = persona.get('bestPractices', {}) if persona else {}
    resolved = {}
    for key, default in _FALLBACK_BP.items():
        if key in persona_bp and isinstance(persona_bp[key], dict):
            resolved[key] = {**default, **persona_bp[key]}
        else:
            resolved[key] = dict(default)
    return resolved

def _window_timestamp(window_number):
    """Convert a 1-based window number to MM:SS (each window = 30s)."""
    secs = (window_number - 1) * 30
    return f"{secs // 60:02d}:{secs % 60:02d}"

def generate_timestamped_feedback(session_analytics, persona=None):
    """Check each 30-second window against the persona's best-practice
    thresholds. Returns events only where a metric is below standard."""
    windows = session_analytics.get('windows', [])
    if not windows:
        return []

    bp = _resolve_best_practices(persona)
    events = []

    for w in windows:
        ts = _window_timestamp(w.get('windowNumber', 1))
        pace = w.get('speakingPace', {}).get('average', 0)
        eye = w.get('eyeContactScore', 100)
        fillers = w.get('fillerWords', 0)
        pauses = w.get('pauses', 0)

        if pace > 0 and pace < bp['wpm']['min']:
            events.append({'timestamp': ts, 'message': f'Speaking pace too slow ({pace} wpm)'})
        elif pace > bp['wpm']['max']:
            events.append({'timestamp': ts, 'message': f'Speaking pace too fast ({pace} wpm)'})

        if eye < bp['eyeContact']['min']:
            events.append({'timestamp': ts, 'message': f'Low eye contact ({eye}%)'})

        if fillers > bp['fillerWords']['max']:
            events.append({'timestamp': ts, 'message': f'High filler word usage ({fillers} detected)'})

        if pauses < bp['pauses']['min']:
            events.append({'timestamp': ts, 'message': f'Too few pauses ({pauses} used)'})

    return events



# ─── Bedrock feedback generation (prompt-based JSON, no outputConfig) ─────────

def generate_feedback(persona, transcript, persona_customization=None,
                      pdf_bytes=None, session_analytics=None):
    persona_name = persona.get('name', persona.get('title', 'a professional evaluator'))
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

    parts = [
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
        parts.extend(["", "Additional Custom Instructions:", persona_customization])

    parts.extend([
        "",
        "Presentation Transcript (with timestamps):",
        transcript if transcript else 'No transcript available',
    ])

    if session_analytics:
        final_avg = session_analytics.get('finalAverage', {})
        windows = session_analytics.get('windows', [])
        parts.extend([
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
            parts.append("")
            parts.append("Per-Window Breakdown:")
            for w in windows:
                pace = w.get('speakingPace', {})
                volume = w.get('volumeLevel', {})
                parts.append(
                    f"  Window {w.get('windowNumber', '?')} ({w.get('timestamp', '')}):"
                    f" Pace={pace.get('average', 'N/A')}wpm"
                    f" (SD:{pace.get('standardDeviation', 'N/A')}),"
                    f" Volume={volume.get('average', 'N/A')}%"
                    f" (SD:{volume.get('standardDeviation', 'N/A')}),"
                    f" Eye Contact={w.get('eyeContactScore', 'N/A')}%,"
                    f" Fillers={w.get('fillerWords', 0)},"
                    f" Pauses={w.get('pauses', 0)}"
                )

    parts.extend([
        "",
        f"Based on your role as {persona_name}, the transcript,"
        " and the presentation materials (if PDF is provided), provide structured feedback.",
        "",
        "IMPORTANT: Keep ALL feedback concise. Brevity is mandatory.",
        "",
        "CRITICAL CONSTRAINT FOR keyRecommendations: You MUST return EXACTLY 5"
        " recommendations — not 4, not 6, exactly 5. Each recommendation MUST"
        " have a short title (under 8 words) and a description of EXACTLY 3"
        " sentences. No more, no less than 3 sentences per description. Keep"
        " each description under 60 words total. Do NOT write paragraphs."
        " Recommendations MUST focus ONLY on the presentation CONTENT — what"
        " was said, the arguments made, the structure, clarity, depth, and"
        " completeness of the material. Do NOT mention delivery metrics like"
        " speaking pace, volume, eye contact, filler words, or pauses in"
        " keyRecommendations. Delivery feedback belongs in performanceSummary only.",
        "",
        "For performanceSummary: provide an overall assessment (2-3 sentences), list"
        " 2-3 content strengths (each no more than 1 sentence), and give delivery"
        " feedback on pace, volume, eye contact, filler words, and pauses.",
        "",
        "CRITICAL CONSTRAINT FOR deliveryFeedback: Each of the five delivery feedback"
        " fields (speakingPace, volume, eyeContact, fillerWords, pauses) MUST be"
        " EXACTLY 2 sentences. No more, no less. The first sentence should state"
        " what was observed. The second sentence should give one actionable tip."
        " Do NOT include statistics, standard deviations, window breakdowns, or"
        " lengthy analysis. Keep each field under 30 words total.",
        "",
        f"Use a {communication_style} tone throughout your feedback.",
        "Be constructive and encouraging while being honest about areas needing work.",
        "Prioritize brevity and clarity — avoid verbose explanations.",
        "",
        "You MUST respond with ONLY valid JSON matching this exact structure — no"
        " markdown fences, no commentary before or after the JSON:",
        json.dumps({
            "keyRecommendations": [
                {"title": "<short title>", "description": "<detailed recommendation>"}
            ],
            "performanceSummary": {
                "overallAssessment": "<2-3 sentence assessment>",
                "contentStrengths": ["<strength 1>", "<strength 2>"],
                "deliveryFeedback": {
                    "speakingPace": "<assessment>",
                    "volume": "<assessment>",
                    "eyeContact": "<assessment>",
                    "fillerWords": "<assessment>",
                    "pauses": "<assessment>",
                },
            },
        }, indent=2),
    ])

    prompt = "\n".join(parts)

    message_content = [{'text': prompt}]
    if pdf_bytes:
        try:
            message_content.append({
                'document': {
                    'format': 'pdf',
                    'name': 'presentation',
                    'source': {'bytes': pdf_bytes},
                }
            })
            print("PDF document added to Bedrock request")
        except Exception as e:
            print(f"Warning: Could not add PDF: {e}")

    print(f"Calling Bedrock ({BEDROCK_MODEL_ID}) with {len(message_content)} content items")

    response = bedrock_runtime.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[{'role': 'user', 'content': message_content}]
    )

    raw = response['output']['message']['content'][0]['text']

    text = raw.strip()
    # Strip markdown code fences if present (e.g. ```json ... ```)
    if text.startswith('```'):
        newline_idx = text.find('\n')
        if newline_idx != -1:
            text = text[newline_idx + 1:]
        else:
            text = text[3:]
    if text.endswith('```'):
        text = text[:-3]

    return json.loads(text.strip())


# ─── Main handler ────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    try:
        claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
        user_sub = claims.get('sub')
        if not user_sub:
            return api_response(401, {"error": "Unauthorized"})

        params = event.get('queryStringParameters') or {}
        session_id = params.get('session_id')

        if not session_id:
            return api_response(400, {"error": "session_id is required"})

        feedback_key = s3_key(user_sub, session_id, FEEDBACK_FILE)
        status_key = s3_key(user_sub, session_id, STATUS_FILE)

        # ── 1. Cache hit — return immediately ────────────────────────────
        cached = read_s3_text(feedback_key)
        if cached:
            print(f"Cache hit: {feedback_key}")
            return api_response(200, json.loads(cached))

        # ── 2. Check if another invocation is already generating ─────────
        status_str = read_s3_text(status_key)
        if status_str:
            status = json.loads(status_str)

            if status.get('status') == 'failed':
                # Clear the failed status so this invocation can retry generation
                print(f"Previous generation failed, retrying: {status.get('error')}")
                try:
                    s3.delete_object(Bucket=BUCKET_NAME, Key=status_key)
                except Exception:
                    pass

            if status.get('status') == 'processing':
                started = status.get('startedAt', '')
                if started:
                    elapsed = (datetime.now(timezone.utc)
                               - datetime.fromisoformat(started)).total_seconds()
                    if elapsed > STALE_THRESHOLD_SEC:
                        # Clear stale processing status so next poll retries
                        try:
                            s3.delete_object(Bucket=BUCKET_NAME, Key=status_key)
                        except Exception:
                            pass
                        return api_response(202, {"status": "processing"})
                return api_response(202, {"status": "processing"})

        # ── 3. Nothing cached, no active job → generate synchronously ────
        #    API Gateway may 504 after 29s, but Lambda keeps running up to
        #    its own 120s timeout and saves the result to S3 regardless.
        #    Next poll from the client picks up the cached result.
        now = datetime.now(timezone.utc).isoformat()
        write_s3_json(status_key, {'status': 'processing', 'startedAt': now})

        print(f"Generating AI feedback for session {session_id}")

        try:
            prefix = s3_key(user_sub, session_id, '')

            # Manifest
            manifest_str = read_s3_text(f"{prefix}manifest.json")
            if not manifest_str:
                raise ValueError("Session manifest not found")
            manifest = json.loads(manifest_str)
            print(f"Manifest loaded: {json.dumps(manifest)}")

            persona_id = manifest.get('persona')
            if not persona_id:
                raise ValueError("Persona not found in manifest")

            # Persona
            persona = get_persona(persona_id)
            if not persona:
                raise ValueError(f"Persona {persona_id} not found in DynamoDB")
            print(f"Persona loaded: {persona.get('name')}")

            # Transcript
            transcript_str = read_s3_text(f"{prefix}transcript.json")
            if not transcript_str:
                raise ValueError("Transcript not found")
            transcript_obj = json.loads(transcript_str)
            transcript = '\n'.join(
                f"[{item.get('timestamp', '')}] {item.get('text', '')}"
                for item in transcript_obj.get('transcripts', [])
                if item.get('text')
            )
            print(f"Transcript: {len(transcript)} chars")

            # Optional files
            persona_customization = None
            if manifest.get('hasPersonaCustomization'):
                persona_customization = read_s3_text(
                    f"{prefix}CUSTOM_PERSONA_INSTRUCTION.txt")

            pdf_bytes = None
            if manifest.get('hasPresentationPdf'):
                pdf_bytes = read_s3_bytes(f"{prefix}presentation.pdf")

            session_analytics = None
            sa_str = read_s3_text(f"{prefix}session_analytics.json")
            if sa_str:
                try:
                    session_analytics = json.loads(sa_str)
                    print(f"Session analytics: "
                          f"{len(session_analytics.get('windows', []))} windows")
                except json.JSONDecodeError:
                    print("Warning: could not parse session_analytics.json")

            # Generate AI feedback
            feedback = generate_feedback(
                persona, transcript, persona_customization,
                pdf_bytes, session_analytics,
            )

            # Generate timestamped feedback from window data + persona thresholds
            timestamped = []
            if session_analytics:
                timestamped = generate_timestamped_feedback(session_analytics, persona)

            result = {
                'status': 'completed',
                'sessionId': session_id,
                'persona': {
                    'id': persona_id,
                    'title': persona.get('name'),
                    'description': persona.get('description'),
                },
                'keyRecommendations': feedback.get('keyRecommendations', []),
                'performanceSummary': feedback.get('performanceSummary', {}),
                'timestampedFeedback': timestamped,
                'generatedAt': datetime.now(timezone.utc).isoformat(),
                'model': BEDROCK_MODEL_ID,
                'includedFiles': {
                    'transcript': True,
                    'presentationPdf': pdf_bytes is not None,
                    'personaCustomization': persona_customization is not None,
                    'sessionAnalytics': session_analytics is not None,
                },
            }

            write_s3_json(feedback_key, result)
            write_s3_json(status_key, {
                'status': 'completed',
                'completedAt': datetime.now(timezone.utc).isoformat(),
            })
            print(f"AI feedback saved: {feedback_key}")

            return api_response(200, result)

        except Exception as e:
            print(f"Generation failed: {e}")
            import traceback
            traceback.print_exc()
            write_s3_json(status_key, {
                'status': 'failed',
                'error': str(e),
                'failedAt': datetime.now(timezone.utc).isoformat(),
            })
            return api_response(500, {"status": "failed", "error": str(e)})

    except Exception as e:
        print(f"Error in lambda_handler: {e}")
        import traceback
        traceback.print_exc()
        return api_response(500, {"error": f"Internal server error: {str(e)}"})
