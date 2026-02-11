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


def lambda_handler(event, context):
    """
    Step Functions State 1: Performance Metrics

    Input: {sessionID, s3Bucket, s3KeyPrefix (date/userID/sessionID)}
    Output: {normalizedScores, rawMetrics, transcript, personaID, duration}
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    # TODO: Implement chunk aggregation from S3
    # TODO: Fetch persona from DynamoDB for metricWeights
    # TODO: Calculate normalized scores
    # TODO: Return results to Step Functions

    # Placeholder response
    return {
        'statusCode': 200,
        'normalizedScores': {
            'wpmScore': 85.0,
            'eyeContactScore': 92.0,
            'fillerWordsScore': 68.0,
            'volumeScore': 83.0
        },
        'rawMetrics': {
            'avgWpm': 145,
            'eyeContactLookAwaySeconds': 12,
            'fillerWordsCount': 8,
            'avgVolume': 72,
            'volumeVariance': 8.5
        },
        'transcript': "Sample transcript...",
        'personaID': event.get('personaID', 'default'),
        'duration': 180
    }
