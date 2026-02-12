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


def generate_mock_feedback(engagement_score: float) -> Dict:
    """
    Generate mock feedback for testing (without Bedrock).
    In production, this would be replaced with actual Bedrock API call.
    """
    # Generate feedback based on engagement score ranges
    if engagement_score >= 80:
        return {
            'strengths': [
                'Excellent speaking pace within optimal 130-160 WPM range',
                'Strong eye contact maintained throughout presentation',
                'Clear and confident volume with minimal variation'
            ],
            'improvements': [
                'Consider adding more strategic pauses for emphasis',
                'Could vary vocal tone to increase audience engagement'
            ],
            'personaRecommendations': [
                'Build on your strong foundation with advanced storytelling techniques',
                'Practice incorporating relevant examples and case studies'
            ],
            'keyTakeaway': 'You delivered a strong presentation with solid fundamentals. Focus on refining your delivery style with more dynamic pacing and vocal variety.',
            'overallAssessment': 'Excellent performance with room for polish.'
        }
    elif engagement_score >= 60:
        return {
            'strengths': [
                'Good attempt at maintaining consistent speaking pace',
                'Reasonable eye contact with the camera',
                'Adequate volume for most of the presentation'
            ],
            'improvements': [
                'Work on bringing speaking pace closer to optimal 130-160 WPM',
                'Reduce filler words and verbal pauses',
                'Maintain more consistent eye contact throughout'
            ],
            'personaRecommendations': [
                'Practice pacing drills to find your natural rhythm',
                'Record practice sessions to identify filler word patterns'
            ],
            'keyTakeaway': 'You\'re on the right track! Focus on reducing filler words and maintaining consistent eye contact to improve your overall delivery.',
            'overallAssessment': 'Good effort with clear areas for improvement.'
        }
    else:
        return {
            'strengths': [
                'Made a genuine effort to present',
                'Completed the full presentation',
                'Willingness to practice and improve'
            ],
            'improvements': [
                'Significantly reduce filler words (um, uh, like)',
                'Work on speaking pace - aim for 130-160 WPM',
                'Build confidence with more eye contact',
                'Improve volume consistency throughout'
            ],
            'personaRecommendations': [
                'Start with presentation fundamentals course',
                'Practice with smaller audience first',
                'Record and review your presentations'
            ],
            'keyTakeaway': 'Don\'t be discouraged! Public speaking is a skill that improves with practice. Focus on the fundamentals first.',
            'overallAssessment': 'Significant room for improvement in all areas.'
        }


def write_report_to_s3(s3_bucket: str, s3_key: str, report: Dict) -> bool:
    """
    Write report.json to S3.

    :param s3_bucket: S3 bucket name
    :param s3_key: S3 key for report.json
    :param report: Report dictionary
    :return: True if successful, False otherwise
    """
    s3_client = boto3.client('s3')

    try:
        s3_client.put_object(
            Bucket=s3_bucket,
            Key=s3_key,
            Body=json.dumps(report, indent=2),
            ContentType='application/json'
        )
        print(f"[INFO] Successfully wrote report to S3: {s3_key}")
        return True
    except Exception as e:
        print(f"[ERROR] Failed to write report to S3: {str(e)}")
        return False


def invoke_sse_notifier(session_id: str, status: str) -> bool:
    """
    Invoke SSE notifier Lambda to mark session completion.

    :param session_id: Session ID
    :param status: Status ('completed' or 'failed')
    :return: True if successful, False otherwise
    """
    lambda_client = boto3.client('lambda')

    try:
        lambda_client.invoke(
            FunctionName='SSENotifierLambda',
            InvocationType='Event',  # Async invocation
            Payload=json.dumps({
                'sessionID': session_id,
                'status': status
            })
        )
        print(f"[INFO] Invoked SSE notifier for session {session_id}: {status}")
        return True
    except Exception as e:
        print(f"[ERROR] Failed to invoke SSE notifier: {str(e)}")
        return False


def lambda_handler(event, context):
    """
    Step Functions State 2: Engagement Scores + AI Feedback

    Input: {sessionID, userID, personaID, date, s3KeyPrefix, normalizedScores, rawMetrics, transcript, metricWeights, duration}
    Output: {sessionID, userID, personaID, date, s3KeyPrefix, normalizedScores, rawMetrics, transcript, metricWeights, duration, engagementScore}
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    session_id = event.get('sessionID')
    s3_key_prefix = event.get('s3KeyPrefix')
    uploads_bucket = os.environ.get('UPLOADS_BUCKET')

    if not all([session_id, s3_key_prefix, uploads_bucket]):
        error_msg = 'Missing required parameters: sessionID, s3KeyPrefix, UPLOADS_BUCKET'
        print(f"[ERROR] {error_msg}")
        raise ValueError(error_msg)

    try:
        # Extract data from event
        normalized_scores = event.get('normalizedScores', {})
        raw_metrics = event.get('rawMetrics', {})
        transcript = event.get('transcript', '')
        metric_weights = event.get('metricWeights', {
            'wpm': 0.25,
            'eyeContact': 0.25,
            'fillerWords': 0.25,
            'volume': 0.25
        })

        # Calculate engagement score
        engagement_score = calculate_engagement_score(normalized_scores, metric_weights)
        print(f"[INFO] Calculated engagement score: {engagement_score}")

        # Generate mock feedback (for testing without Bedrock)
        feedback = generate_mock_feedback(engagement_score)

        # Construct report
        report = {
            'sessionID': session_id,
            'userID': event.get('userID'),
            'personaID': event.get('personaID'),
            'date': event.get('date'),
            's3KeyPrefix': s3_key_prefix,
            'normalizedScores': normalized_scores,
            'rawMetrics': raw_metrics,
            'transcript': transcript,
            'metricWeights': metric_weights,
            'engagementScore': engagement_score,
            'feedback': feedback
        }

        # Write report to S3
        report_s3_key = f"{s3_key_prefix}/reports/report.json"
        success = write_report_to_s3(uploads_bucket, report_s3_key, report)

        if not success:
            raise Exception("Failed to write report to S3")

        # Invoke SSE notifier to mark completion
        invoke_sse_notifier(session_id, 'completed')

        # Return for next Step Functions state
        result = event.copy()  # Pass through all original fields
        result['engagementScore'] = engagement_score

        print(f"[INFO] Successfully processed session {session_id}")
        return result

    except Exception as e:
        print(f"[ERROR] Failed to process session {session_id}: {str(e)}")
        import traceback
        traceback.print_exc()

        # Mark as failed in SSE notifier
        invoke_sse_notifier(session_id, 'failed')

        raise
