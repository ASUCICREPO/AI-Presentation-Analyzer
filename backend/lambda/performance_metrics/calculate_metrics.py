"""
Performance Metrics Lambda - State 1 of Analytics Pipeline

Aggregates raw session data chunks from S3 and calculates normalized scores (0-100)
for WPM, eye contact, filler words, and volume.
"""

import boto3
import json
import os
import statistics
from typing import Dict, List, Any
from decimal import Decimal
from botocore.exceptions import ClientError


def normalize_wpm(avg_wpm: float) -> float:
    """
    Calculate WPM score (0-100).
    Optimal: 130-160 WPM = 100
    Too slow: <110 WPM = penalty
    Too fast: >170 WPM = penalty
    """
    OPTIMAL_MIN = 130
    OPTIMAL_MAX = 160

    if OPTIMAL_MIN <= avg_wpm <= OPTIMAL_MAX:
        return 100.0
    elif avg_wpm < OPTIMAL_MIN:
        if avg_wpm < 110:
            return max(0, 50 * (avg_wpm / 110))
        else:
            return 50 + 50 * ((avg_wpm - 110) / (OPTIMAL_MIN - 110))
    else:  # avg_wpm > OPTIMAL_MAX
        if avg_wpm > 200:
            return 0.0
        else:
            return 100 - 100 * ((avg_wpm - OPTIMAL_MAX) / (200 - OPTIMAL_MAX))


def normalize_eye_contact(look_away_seconds: float, session_duration: int) -> float:
    """
    Calculate eye contact score (0-100).
    Only counts sustained look-aways >3 seconds.
    """
    if session_duration == 0:
        return 0.0

    eye_contact_percentage = ((session_duration - look_away_seconds) / session_duration) * 100

    if eye_contact_percentage >= 90:
        return 100.0
    elif eye_contact_percentage >= 70:
        return 70 + 30 * ((eye_contact_percentage - 70) / 20)
    else:
        return max(0, 70 * (eye_contact_percentage / 70) ** 1.5)


def normalize_filler_words(filler_count: int, duration_minutes: float) -> float:
    """
    Calculate filler words score (0-100).
    Normalized by presentation duration.
    """
    if duration_minutes == 0:
        return 100.0

    filler_rate = filler_count / duration_minutes

    if filler_rate <= 2:
        return 100.0
    elif filler_rate <= 4:
        return 100 - 40 * ((filler_rate - 2) / 2)
    elif filler_rate <= 8:
        return 60 - 40 * ((filler_rate - 4) / 4)
    else:
        return max(0, 20 - 20 * ((filler_rate - 8) / 8))


def normalize_volume(avg_volume: float, volume_variance: float) -> float:
    """
    Calculate volume score (0-100).
    70% weight on avg level (optimal 60-80%)
    30% weight on consistency (variance <15)
    """
    # Score for average level
    if 60 <= avg_volume <= 80:
        level_score = 100.0
    elif avg_volume < 60:
        level_score = max(0, 100 * (avg_volume / 60) ** 1.2)
    else:  # avg_volume > 80
        level_score = max(0, 100 - 100 * ((avg_volume - 80) / 20))

    # Penalty for variance (consistency)
    if volume_variance <= 10:
        consistency_score = 100.0
    elif volume_variance <= 20:
        consistency_score = 100 - 50 * ((volume_variance - 10) / 10)
    else:
        consistency_score = max(0, 50 - 50 * ((volume_variance - 20) / 20))

    return 0.7 * level_score + 0.3 * consistency_score


def list_and_read_chunks(s3_bucket: str, s3_key_prefix: str) -> List[Dict[str, Any]]:
    """
    List and read all chunk JSON files from S3.

    :param s3_bucket: S3 bucket name
    :param s3_key_prefix: S3 key prefix (date/userID/sessionID)
    :return: List of chunk data dictionaries
    """
    s3_client = boto3.client('s3')
    chunks = []

    # List all objects with prefix: {date}/{userID}/{sessionID}/data/
    data_prefix = f"{s3_key_prefix}/data/"
    print(f"[INFO] Listing chunks from s3://{s3_bucket}/{data_prefix}")

    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=s3_bucket, Prefix=data_prefix)

        for page in pages:
            if 'Contents' not in page:
                continue

            for obj in page['Contents']:
                s3_key = obj['Key']

                # Skip if not a JSON file
                if not s3_key.endswith('.json'):
                    continue

                print(f"[INFO] Reading chunk: {s3_key}")

                # Read the chunk content
                response = s3_client.get_object(Bucket=s3_bucket, Key=s3_key)
                chunk_data = json.loads(response['Body'].read().decode('utf-8'))
                chunks.append(chunk_data)

        print(f"[INFO] Successfully read {len(chunks)} chunks")
        return chunks

    except ClientError as e:
        print(f"[ERROR] Failed to read chunks from S3: {str(e)}")
        raise


def aggregate_metrics(chunks: List[Dict[str, Any]], total_duration: int) -> Dict[str, Any]:
    """
    Aggregate metrics from all chunks.

    Expected chunk structure:
    {
      chunkIndex: number,
      timestamp: number,
      wpmSamples: number[],
      volumeSamples: number[],
      fillerWords: [{word, timestamp}],
      gazeEvents: [{type: 'lookAway'|'lookBack', timestamp, duration}],
      transcriptSegments: [{text, timestamp, isFinal}]
    }

    :param chunks: List of chunk dictionaries
    :param total_duration: Total session duration in seconds
    :return: Aggregated metrics dictionary
    """
    print(f"[INFO] Aggregating metrics from {len(chunks)} chunks")

    # Sort chunks by chunkIndex to ensure correct order
    sorted_chunks = sorted(chunks, key=lambda c: c.get('chunkIndex', 0))

    # Initialize accumulators
    all_wpm_samples = []
    all_volume_samples = []
    all_filler_words = []
    all_gaze_events = []
    all_transcript_segments = []

    # Aggregate data from all chunks
    for chunk in sorted_chunks:
        all_wpm_samples.extend(chunk.get('wpmSamples', []))
        all_volume_samples.extend(chunk.get('volumeSamples', []))
        all_filler_words.extend(chunk.get('fillerWords', []))
        all_gaze_events.extend(chunk.get('gazeEvents', []))
        all_transcript_segments.extend(chunk.get('transcriptSegments', []))

    print(f"[INFO] Aggregated {len(all_wpm_samples)} WPM samples, {len(all_volume_samples)} volume samples")
    print(f"[INFO] Total filler words: {len(all_filler_words)}, gaze events: {len(all_gaze_events)}")

    # Calculate average WPM
    avg_wpm = statistics.mean(all_wpm_samples) if all_wpm_samples else 0.0

    # Calculate average volume and variance
    avg_volume = statistics.mean(all_volume_samples) if all_volume_samples else 0.0
    volume_variance = statistics.stdev(all_volume_samples) if len(all_volume_samples) > 1 else 0.0

    # Count filler words
    filler_words_count = len(all_filler_words)

    # Calculate pauses (count from volume samples - silence threshold)
    # A pause is defined as volume < 5% for sustained period
    pauses_count = 0
    silence_threshold = 5.0
    in_pause = False
    pause_start_idx = 0

    for i, volume in enumerate(all_volume_samples):
        if volume < silence_threshold:
            if not in_pause:
                in_pause = True
                pause_start_idx = i
        else:
            if in_pause:
                # Check if pause was >3 seconds (assuming ~100 samples per second)
                pause_duration_samples = i - pause_start_idx
                if pause_duration_samples > 300:  # >3 seconds
                    pauses_count += 1
                in_pause = False

    # Calculate eye contact look-away time
    # Only count sustained look-aways >3 seconds
    eye_contact_look_away_seconds = 0.0
    for gaze_event in all_gaze_events:
        if gaze_event.get('type') == 'lookAway':
            duration = gaze_event.get('duration', 0)
            if duration > 3:  # Only count sustained look-aways >3 seconds
                eye_contact_look_away_seconds += duration

    # Concatenate full transcript (only final segments)
    final_transcript_segments = [
        seg for seg in all_transcript_segments if seg.get('isFinal', False)
    ]
    full_transcript = ' '.join([seg.get('text', '') for seg in final_transcript_segments])

    print(f"[INFO] Calculated metrics:")
    print(f"  - Avg WPM: {avg_wpm:.2f}")
    print(f"  - Avg Volume: {avg_volume:.2f}%")
    print(f"  - Volume Variance: {volume_variance:.2f}")
    print(f"  - Filler Words: {filler_words_count}")
    print(f"  - Pauses: {pauses_count}")
    print(f"  - Eye Contact Look-Away: {eye_contact_look_away_seconds:.2f}s")
    print(f"  - Transcript length: {len(full_transcript)} characters")

    return {
        'avgWpm': round(avg_wpm, 2),
        'avgVolume': round(avg_volume, 2),
        'volumeVariance': round(volume_variance, 2),
        'fillerWordsCount': filler_words_count,
        'pausesCount': pauses_count,
        'eyeContactLookAwaySeconds': round(eye_contact_look_away_seconds, 2),
        'transcript': full_transcript,
        'duration': total_duration
    }


def fetch_persona(persona_id: str, persona_table_name: str) -> Dict[str, Any]:
    """
    Fetch persona from DynamoDB.

    :param persona_id: Persona ID
    :param persona_table_name: DynamoDB table name
    :return: Persona dictionary with metricWeights
    """
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(persona_table_name)

    print(f"[INFO] Fetching persona {persona_id} from DynamoDB")

    try:
        response = table.get_item(Key={'personaID': persona_id})

        if 'Item' not in response:
            print(f"[WARN] Persona {persona_id} not found, using default weights")
            return {
                'personaID': persona_id,
                'name': 'Unknown',
                'metricWeights': {
                    'wpm': 0.25,
                    'eyeContact': 0.25,
                    'fillerWords': 0.25,
                    'volume': 0.25
                }
            }

        persona = response['Item']

        # Convert Decimal to float for JSON serialization
        if 'metricWeights' in persona:
            weights = persona['metricWeights']
            persona['metricWeights'] = {
                'wpm': float(weights.get('wpm', 0.25)),
                'eyeContact': float(weights.get('eyeContact', 0.25)),
                'fillerWords': float(weights.get('fillerWords', 0.25)),
                'volume': float(weights.get('volume', 0.25))
            }
        else:
            # Use default weights if not set
            persona['metricWeights'] = {
                'wpm': 0.25,
                'eyeContact': 0.25,
                'fillerWords': 0.25,
                'volume': 0.25
            }

        print(f"[INFO] Fetched persona: {persona.get('name', 'Unknown')}")
        print(f"[INFO] Metric weights: {persona['metricWeights']}")

        return persona

    except ClientError as e:
        print(f"[ERROR] Failed to fetch persona from DynamoDB: {str(e)}")
        # Return default persona on error
        return {
            'personaID': persona_id,
            'name': 'Unknown',
            'metricWeights': {
                'wpm': 0.25,
                'eyeContact': 0.25,
                'fillerWords': 0.25,
                'volume': 0.25
            }
        }


def lambda_handler(event, context):
    """
    Step Functions State 1: Performance Metrics

    Input: {sessionID, userID, personaID, totalDuration, s3Bucket, s3KeyPrefix}
    Output: {sessionID, userID, personaID, date, s3KeyPrefix, normalizedScores, rawMetrics, transcript, metricWeights, duration}
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    # Extract input parameters
    session_id = event.get('sessionID')
    user_id = event.get('userID')
    persona_id = event.get('personaID')
    total_duration = event.get('totalDuration', 0)
    s3_bucket = event.get('s3Bucket', os.environ.get('UPLOADS_BUCKET'))
    s3_key_prefix = event.get('s3KeyPrefix')
    date = event.get('date')

    # Validate required parameters
    if not all([session_id, persona_id, s3_bucket, s3_key_prefix]):
        error_msg = 'Missing required parameters: sessionID, personaID, s3Bucket, s3KeyPrefix'
        print(f"[ERROR] {error_msg}")
        raise ValueError(error_msg)

    print(f"[INFO] Processing session {session_id} for user {user_id}")
    print(f"[INFO] S3 location: s3://{s3_bucket}/{s3_key_prefix}/data/")

    try:
        # Step 1: Read all chunks from S3
        chunks = list_and_read_chunks(s3_bucket, s3_key_prefix)

        if not chunks:
            print("[WARN] No chunks found, returning empty metrics")
            return {
                'statusCode': 200,
                'sessionID': session_id,
                'userID': user_id,
                'personaID': persona_id,
                'date': date,
                's3KeyPrefix': s3_key_prefix,
                'normalizedScores': {
                    'wpmScore': 0.0,
                    'eyeContactScore': 0.0,
                    'fillerWordsScore': 0.0,
                    'volumeScore': 0.0
                },
                'rawMetrics': {
                    'avgWpm': 0.0,
                    'avgVolume': 0.0,
                    'volumeVariance': 0.0,
                    'fillerWordsCount': 0,
                    'pausesCount': 0,
                    'eyeContactLookAwaySeconds': 0.0
                },
                'transcript': '',
                'metricWeights': {
                    'wpm': 0.25,
                    'eyeContact': 0.25,
                    'fillerWords': 0.25,
                    'volume': 0.25
                },
                'duration': total_duration
            }

        # Step 2: Aggregate metrics from all chunks
        raw_metrics = aggregate_metrics(chunks, total_duration)

        # Step 3: Fetch persona to get metric weights
        persona_table_name = os.environ.get('PERSONA_TABLE_NAME', 'UserPersonaTable')
        persona = fetch_persona(persona_id, persona_table_name)
        metric_weights = persona.get('metricWeights', {
            'wpm': 0.25,
            'eyeContact': 0.25,
            'fillerWords': 0.25,
            'volume': 0.25
        })

        # Step 4: Calculate normalized scores
        duration_minutes = total_duration / 60.0

        wpm_score = normalize_wpm(raw_metrics['avgWpm'])
        eye_contact_score = normalize_eye_contact(
            raw_metrics['eyeContactLookAwaySeconds'],
            total_duration
        )
        filler_words_score = normalize_filler_words(
            raw_metrics['fillerWordsCount'],
            duration_minutes
        )
        volume_score = normalize_volume(
            raw_metrics['avgVolume'],
            raw_metrics['volumeVariance']
        )

        normalized_scores = {
            'wpmScore': round(wpm_score, 2),
            'eyeContactScore': round(eye_contact_score, 2),
            'fillerWordsScore': round(filler_words_score, 2),
            'volumeScore': round(volume_score, 2)
        }

        print(f"[INFO] Normalized scores calculated:")
        print(f"  - WPM: {normalized_scores['wpmScore']}/100")
        print(f"  - Eye Contact: {normalized_scores['eyeContactScore']}/100")
        print(f"  - Filler Words: {normalized_scores['fillerWordsScore']}/100")
        print(f"  - Volume: {normalized_scores['volumeScore']}/100")

        # Step 5: Return results for next Step Functions state
        result = {
            'statusCode': 200,
            'sessionID': session_id,
            'userID': user_id,
            'personaID': persona_id,
            'date': date,
            's3KeyPrefix': s3_key_prefix,
            'normalizedScores': normalized_scores,
            'rawMetrics': raw_metrics,
            'transcript': raw_metrics['transcript'],
            'metricWeights': metric_weights,
            'duration': total_duration
        }

        print(f"[INFO] Successfully processed session {session_id}")
        return result

    except Exception as e:
        print(f"[ERROR] Failed to process session {session_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        raise
