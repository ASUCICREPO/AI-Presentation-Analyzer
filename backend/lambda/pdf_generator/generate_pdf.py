"""
PDF Generator Lambda - State 3 of Analytics Pipeline

Generates downloadable PDF report using ReportLab.
"""

import boto3
import json
import os
from typing import Dict
from botocore.exceptions import ClientError
from io import BytesIO

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
    from reportlab.lib import colors
except ImportError:
    # ReportLab not available in Lambda - will be added via Lambda layer
    pass

UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET')


def read_report_from_s3(s3_bucket: str, s3_key: str) -> Dict:
    """
    Read report.json from S3.

    :param s3_bucket: S3 bucket name
    :param s3_key: S3 key to report.json
    :return: Report dictionary
    """
    s3_client = boto3.client('s3')

    try:
        response = s3_client.get_object(Bucket=s3_bucket, Key=s3_key)
        report_data = json.loads(response['Body'].read().decode('utf-8'))
        print(f"[INFO] Successfully read report from S3: {s3_key}")
        return report_data
    except ClientError as e:
        print(f"[ERROR] Failed to read report from S3: {str(e)}")
        raise


def generate_pdf_content(report: Dict, buffer: BytesIO) -> None:
    """
    Generate PDF content using ReportLab.

    :param report: Report dictionary with metrics and feedback
    :param buffer: BytesIO buffer to write PDF to
    """
    doc = SimpleDocTemplate(buffer, pagesize=letter,
                           rightMargin=0.75*inch, leftMargin=0.75*inch,
                           topMargin=0.75*inch, bottomMargin=0.75*inch)

    styles = getSampleStyleSheet()
    story = []

    # Title
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a1a1a'),
        spaceAfter=0.2*inch,
    )
    story.append(Paragraph('Presentation Practice Report', title_style))

    # Session info
    session_date = report.get('date', 'Unknown')
    info_text = f"<b>Session Date:</b> {session_date} | <b>Session ID:</b> {report.get('sessionID', 'N/A')[:8]}..."
    story.append(Paragraph(info_text, styles['Normal']))
    story.append(Spacer(1, 0.2*inch))

    # Engagement Score Section
    engagement_score = report.get('engagementScore', 0)
    score_color = '#4CAF50' if engagement_score >= 75 else '#FF9800' if engagement_score >= 50 else '#F44336'

    engagement_style = ParagraphStyle(
        'EngagementStyle',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor(score_color),
        spaceAfter=0.1*inch,
    )
    story.append(Paragraph(f'Overall Engagement Score: {engagement_score:.1f}/100', engagement_style))
    story.append(Spacer(1, 0.2*inch))

    # Metric Scores
    story.append(Paragraph('Performance Metrics', styles['Heading2']))

    normalized_scores = report.get('normalizedScores', {})
    raw_metrics = report.get('rawMetrics', {})

    metrics_data = [
        ['Metric', 'Score', 'Raw Value'],
        [
            'Speaking Pace',
            f"{normalized_scores.get('wpmScore', 0):.1f}/100",
            f"{raw_metrics.get('avgWpm', 0):.0f} WPM"
        ],
        [
            'Eye Contact',
            f"{normalized_scores.get('eyeContactScore', 0):.1f}/100",
            f"{raw_metrics.get('eyeContactLookAwaySeconds', 0):.1f}s away"
        ],
        [
            'Filler Words',
            f"{normalized_scores.get('fillerWordsScore', 0):.1f}/100",
            f"{raw_metrics.get('fillerWordsCount', 0)} total"
        ],
        [
            'Volume & Clarity',
            f"{normalized_scores.get('volumeScore', 0):.1f}/100",
            f"Avg {raw_metrics.get('avgVolume', 0):.0f}%"
        ],
    ]

    metrics_table = Table(metrics_data, colWidths=[2.0*inch, 1.5*inch, 2.0*inch])
    metrics_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E8F5E9')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 11),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))

    story.append(metrics_table)
    story.append(Spacer(1, 0.3*inch))

    # Feedback Section
    feedback = report.get('feedback', {})

    if feedback:
        story.append(Paragraph('AI-Powered Feedback', styles['Heading2']))

        # Strengths
        strengths = feedback.get('strengths', [])
        if strengths:
            story.append(Paragraph('<b>Strengths:</b>', styles['Normal']))
            for strength in strengths[:3]:  # Limit to 3
                story.append(Paragraph(f'• {strength}', styles['Normal']))
            story.append(Spacer(1, 0.1*inch))

        # Improvements
        improvements = feedback.get('improvements', [])
        if improvements:
            story.append(Paragraph('<b>Areas for Improvement:</b>', styles['Normal']))
            for improvement in improvements[:3]:  # Limit to 3
                story.append(Paragraph(f'• {improvement}', styles['Normal']))
            story.append(Spacer(1, 0.1*inch))

        # Key Takeaway
        key_takeaway = feedback.get('keyTakeaway', '')
        if key_takeaway:
            story.append(Paragraph('<b>Key Takeaway:</b>', styles['Normal']))
            story.append(Paragraph(key_takeaway, styles['Normal']))
            story.append(Spacer(1, 0.2*inch))

    # Transcript Preview
    transcript = report.get('transcript', '')
    if transcript:
        story.append(PageBreak())
        story.append(Paragraph('Transcript (Full)', styles['Heading2']))
        transcript_style = ParagraphStyle(
            'TranscriptStyle',
            parent=styles['Normal'],
            fontSize=9,
            textColor=colors.HexColor('#666666'),
        )
        story.append(Paragraph(transcript[:3000], transcript_style))  # First 3000 chars

    # Build PDF
    doc.build(story)


def write_pdf_to_s3(s3_bucket: str, s3_key: str, pdf_buffer: BytesIO) -> bool:
    """
    Write PDF to S3.

    :param s3_bucket: S3 bucket name
    :param s3_key: S3 key for PDF
    :param pdf_buffer: BytesIO buffer with PDF content
    :return: True if successful, False otherwise
    """
    s3_client = boto3.client('s3')

    try:
        pdf_buffer.seek(0)
        s3_client.put_object(
            Bucket=s3_bucket,
            Key=s3_key,
            Body=pdf_buffer.getvalue(),
            ContentType='application/pdf'
        )
        print(f"[INFO] Successfully wrote PDF to S3: {s3_key}")
        return True
    except ClientError as e:
        print(f"[ERROR] Failed to write PDF to S3: {str(e)}")
        return False


def lambda_handler(event, context):
    """
    Step Functions State 3: PDF Generation

    Input: {sessionID, userID, personaID, date, s3KeyPrefix, normalizedScores, rawMetrics, transcript, metricWeights, duration, engagementScore, feedback}
    Output: {statusCode, success, pdfS3Key}
    """
    print(f"[INFO] Received event: {json.dumps(event)}")

    session_id = event.get('sessionID')
    user_id = event.get('userID')
    s3_key_prefix = event.get('s3KeyPrefix')

    if not all([session_id, user_id, s3_key_prefix, UPLOADS_BUCKET]):
        error_msg = 'Missing required parameters: sessionID, userID, s3KeyPrefix, UPLOADS_BUCKET'
        print(f"[ERROR] {error_msg}")
        raise ValueError(error_msg)

    try:
        # S3 key for report.json
        report_s3_key = f"{s3_key_prefix}/reports/report.json"

        # Read report.json
        report = read_report_from_s3(UPLOADS_BUCKET, report_s3_key)

        # Generate PDF in memory
        pdf_buffer = BytesIO()
        generate_pdf_content(report, pdf_buffer)

        # Write PDF to S3
        pdf_s3_key = f"{s3_key_prefix}/reports/report.pdf"
        success = write_pdf_to_s3(UPLOADS_BUCKET, pdf_s3_key, pdf_buffer)

        if not success:
            raise Exception("Failed to write PDF to S3")

        print(f"[INFO] Successfully generated PDF for session {session_id}")

        return {
            'statusCode': 200,
            'success': True,
            'pdfS3Key': pdf_s3_key
        }

    except Exception as e:
        print(f"[ERROR] Failed to generate PDF for session {session_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        raise
