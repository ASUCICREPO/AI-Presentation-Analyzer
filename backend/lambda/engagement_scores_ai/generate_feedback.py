"""
Engagement Scores + AI Feedback Lambda - State 2 of Analytics Pipeline

Calculates weighted engagement score and calls AWS Bedrock for AI-powered feedback.
"""

import boto3
import json
import os
from typing import Dict
from jinja2 import Environment, FileSystemLoader, select_autoescape


# Load Jinja2 template
template_dir = os.path.dirname(os.path.abspath(__file__))
jinja_env = Environment(
    loader=FileSystemLoader(template_dir),
    autoescape=select_autoescape()
)


def calculate_engagement_score(normalized_scores: Dict[str, float], metric_weights: Dict[str, float]) -> float:
    """
    Calculate weighted engagement score.

    engagement_score = Σ(normalizedScores[metric] * metricWeights[metric])
    """
    return round(
        normalized_scores['wpmScore'] * metric_weights.get('wpm', 0.25) +
        normalized_scores['eyeContactScore'] * metric_weights.get('eyeContact', 0.25) +
        normalized_scores['fillerWordsScore'] * metric_weights.get('fillerWords', 0.25) +
        normalized_scores['volumeScore'] * metric_weights.get('volume', 0.25),
        2
    )


def construct_bedrock_prompt(
    normalized_scores: Dict[str, float],
    raw_metrics: Dict,
    transcript: str,
    persona: Dict,
    engagement_score: float
) -> str:
    """
    Construct prompt for Bedrock using Jinja2 template.
    """
    duration_minutes = raw_metrics.get('duration', 0) / 60
    eye_contact_percentage = round((1 - raw_metrics.get('eyeContactLookAwaySeconds', 0) / max(raw_metrics.get('duration', 1), 1)) * 100, 1)
    filler_rate = round(raw_metrics.get('fillerWordsCount', 0) / max(duration_minutes, 1), 1)

    template = jinja_env.get_template('prompt_template.j2')

    return template.render(
        persona=persona,
        engagement_score=engagement_score,
        normalized_scores=normalized_scores,
        raw_metrics=raw_metrics,
        eye_contact_percentage=eye_contact_percentage,
        filler_rate=filler_rate,
        transcript=transcript  # Full transcript, not truncated
    )


def lambda_handler(event, context):
    """
    Step Functions State 2: Engagement Scores + AI Feedback

    Input: {normalizedScores, rawMetrics, transcript, personaID, duration}
    Output: {sessionID, reportS3Key}
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    # TODO: Fetch persona from DynamoDB
    # TODO: Calculate engagement score
    # TODO: Construct Bedrock prompt using template
    # TODO: Call Bedrock API
    # TODO: Parse JSON response
    # TODO: Write report.json to S3
    # TODO: Trigger SSE notification

    # Placeholder response
    return {
        'statusCode': 200,
        'sessionID': event.get('sessionID', 'test-session'),
        'reportS3Key': 'reports/test-session/report.json',
        'engagementScore': 82.5
    }
