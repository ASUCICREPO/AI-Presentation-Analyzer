# AI Presentation Analyzer APIs

This document provides comprehensive API documentation for the AI Presentation Analyzer.

---

## Overview

The API is split across three Lambda-backed REST endpoints exposed through Amazon API Gateway, all protected by Amazon Cognito authentication. The endpoints cover: uploading session files to S3 via presigned URLs, managing AI personas, generating post-session analytics, and reading back saved session data. A separate real-time voice Q&A channel is provided over a WebSocket connection managed by Amazon Bedrock AgentCore.

---

## Base URL

```
https://[INSERT_API_ID].execute-api.[INSERT_REGION].amazonaws.com/prod/
```

> **[PLACEHOLDER]** Replace with your actual API Gateway endpoint after deployment. This value is emitted as `ApiUrl` in the CDK stack outputs.

**Example:**
```
https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/
```

---

## Authentication

All REST endpoints require a valid Amazon Cognito ID token obtained after signing in through the Cognito User Pool.

### Headers Required
| Header | Description | Required |
|--------|-------------|----------|
| `Authorization` | Cognito ID token (Bearer format) | Yes |
| `Content-Type` | `application/json` | Yes (POST/PUT) |

Write operations on `/personas` (POST, PUT, DELETE) additionally require the authenticated user to be a member of the **Admin** Cognito group.

---

## 1) S3 Upload & Session Data Endpoints

These endpoints generate presigned S3 URLs for uploading session files, handle multipart uploads for large recordings, and serve back saved session data (persona customizations, video playback URLs, manifests, and QA analytics).

---

#### GET /s3_urls?request_type={type}&session_id={id} — Get a presigned upload URL

- **Purpose**: Generate a presigned POST URL for uploading a session file to S3. Files are stored at `{userId}/{sessionId}/{filename}` and re-uploads overwrite the previous file.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `request_type` | string | Yes | Type of file to upload. One of: `ppt`, `session`, `metric_chunk`, `transcript`, `session_analytics`, `detailed_metrics`, `manifest` |
| `session_id` | string | Yes | Unique identifier for the current session |

- **Example request**:
```
GET /s3_urls?request_type=session&session_id=abc-123
```

- **Response**:
```json
{
  "presigned_url": "string - S3 presigned POST URL",
  "fields": "object - Form fields to include in the multipart POST request to S3"
}
```

- **Example response**:
```json
{
  "presigned_url": "https://my-bucket.s3.amazonaws.com/",
  "fields": {
    "Content-Type": "video/webm",
    "key": "user-sub/abc-123/recording.webm",
    "AWSAccessKeyId": "...",
    "policy": "...",
    "signature": "..."
  }
}
```

- **Status codes**:
  - `200 OK` - Presigned URL generated successfully
  - `400 Bad Request` - Missing or invalid `request_type` or `session_id`
  - `500 Internal Server Error` - Failed to generate presigned URL

---

#### GET /s3_urls?action=get_persona&session_id={id} — Read persona customization

- **Purpose**: Retrieve the session-specific persona customization text saved for a session. The text is passed through the Bedrock Guardrail before being returned.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Must be `get_persona` |
| `session_id` | string | Yes | Session ID the customization was saved under |

- **Response**:
```json
{
  "customization": "string - The persona customization text, or null if not set",
  "exists": "boolean - Whether a customization file was found"
}
```

- **Status codes**:
  - `200 OK` - Success (check `exists` field to determine if a customization was found)
  - `400 Bad Request` - Content was rejected by Bedrock Guardrail (`rejected: true` in response)
  - `500 Internal Server Error` - Failed to read from S3

---

#### GET /s3_urls?action=get_video_url&session_id={id} — Get video playback URL

- **Purpose**: Generate a presigned GET URL for playing back the recorded session video (`recording.webm`).

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Must be `get_video_url` |
| `session_id` | string | Yes | Session ID of the recording |

- **Response**:
```json
{
  "url": "string - Presigned GET URL for the session recording"
}
```

- **Status codes**:
  - `200 OK` - URL generated successfully
  - `404 Not Found` - Video not found or URL generation failed

---

#### GET /s3_urls?action=get_manifest&session_id={id} — Fetch session manifest

- **Purpose**: Retrieve the `manifest.json` for a session. The manifest records metadata such as the selected persona ID and which optional files (PDF, customization) are present.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Must be `get_manifest` |
| `session_id` | string | Yes | Session ID |

- **Response**:
```json
{
  "persona": "string - Persona ID used in this session",
  "hasPresentationPdf": "boolean",
  "hasPersonaCustomization": "boolean"
}
```

- **Status codes**:
  - `200 OK` - Manifest returned
  - `404 Not Found` - Manifest not found for this session

---

#### GET /s3_urls?action=get_qa_analytics&session_id={id} — Fetch Q&A analytics

- **Purpose**: Retrieve the QA analytics JSON generated by the AgentCore runtime after a live Q&A session completes.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Must be `get_qa_analytics` |
| `session_id` | string | Yes | Session ID |

- **Response**:
```json
{
  "status": "string - completed",
  "sessionId": "string",
  "qaFeedback": {
    "overallSummary": "string",
    "responseQuality": "string - Excellent | Good | Needs Improvement",
    "strengths": ["string"],
    "improvements": ["string"],
    "questionBreakdown": [
      {
        "question": "string",
        "rating": "string - Strong | Adequate | Weak",
        "note": "string"
      }
    ]
  },
  "totalQuestions": "number",
  "totalResponses": "number",
  "generatedAt": "string - ISO 8601 timestamp",
  "model": "string - Bedrock model ID used"
}
```

- **Status codes**:
  - `200 OK` - Analytics returned
  - `404 Not Found` - QA analytics not yet available
  - `500 Internal Server Error` - Failed to fetch from S3

---

#### GET /s3_urls?action=get_part_url&session_id={id}&upload_id={uid}&part_number={n} — Get multipart part URL

- **Purpose**: Generate a presigned PUT URL for uploading a single part in a multipart upload. Used for streaming large recording files chunk-by-chunk.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Must be `get_part_url` |
| `session_id` | string | Yes | Session ID |
| `upload_id` | string | Yes | The multipart upload ID returned by `initiate_multipart` |
| `part_number` | number | Yes | 1-based part number |

- **Response**:
```json
{
  "url": "string - Presigned PUT URL for this part",
  "part_number": "number"
}
```

- **Status codes**:
  - `200 OK` - URL generated
  - `400 Bad Request` - Missing `upload_id` or `part_number`
  - `500 Internal Server Error` - Failed to generate part URL

---

#### POST /s3_urls?action=upload_persona&session_id={id} — Upload persona customization

- **Purpose**: Save session-specific persona customization text to S3. The text is scanned by the Bedrock Guardrail before being persisted — rejected content returns a `400`.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Must be `upload_persona` |
| `session_id` | string | Yes | Session ID |

- **Request body**:
```json
{
  "text": "string - Persona customization instructions (max 10 KB)"
}
```

- **Response**:
```json
{
  "message": "string - Success or rejection message"
}
```

- **Status codes**:
  - `200 OK` - Customization saved successfully
  - `400 Bad Request` - Empty text, exceeds 10 KB limit, or rejected by Bedrock Guardrail (`rejected: true`)
  - `500 Internal Server Error` - Failed to write to S3

---

#### POST /s3_urls?action=initiate_multipart&session_id={id} — Initiate multipart upload

- **Purpose**: Create a new S3 multipart upload for `recording.webm`. Returns an `uploadId` to use in subsequent part URL and completion requests.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Must be `initiate_multipart` |
| `session_id` | string | Yes | Session ID |

- **Response**:
```json
{
  "uploadId": "string - Multipart upload ID",
  "key": "string - S3 object key for the recording"
}
```

- **Status codes**:
  - `200 OK` - Multipart upload initiated
  - `500 Internal Server Error` - Failed to initiate

---

#### POST /s3_urls?action=complete_multipart&session_id={id} — Complete multipart upload

- **Purpose**: Assemble all uploaded parts into the final `recording.webm` object in S3.

- **Request body**:
```json
{
  "upload_id": "string - Multipart upload ID",
  "parts": [
    { "PartNumber": "number", "ETag": "string - ETag returned by S3 for the part" }
  ]
}
```

- **Response**:
```json
{
  "message": "Multipart upload completed"
}
```

- **Status codes**:
  - `200 OK` - Assembly complete
  - `400 Bad Request` - Missing `upload_id` or `parts`
  - `500 Internal Server Error` - Assembly failed

---

#### POST /s3_urls?action=abort_multipart&session_id={id} — Abort multipart upload

- **Purpose**: Cancel an in-progress multipart upload and clean up all uploaded parts from S3.

- **Request body**:
```json
{
  "upload_id": "string - Multipart upload ID to abort"
}
```

- **Response**:
```json
{
  "message": "Multipart upload aborted"
}
```

- **Status codes**:
  - `200 OK` - Aborted successfully
  - `400 Bad Request` - Missing `upload_id`
  - `500 Internal Server Error` - Abort failed

---

## 2) Persona Endpoints

Persona CRUD operations. GET requests are available to all authenticated users. Write operations (POST, PUT, DELETE) require the caller to be in the **Admin** Cognito group.

---

#### GET /personas — List all personas

- **Purpose**: Return a paginated list of all personas stored in DynamoDB (20 per page).

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lastEvaluatedKey` | string | No | Pagination cursor returned by a previous response |

- **Response**:
```json
{
  "personas": [
    {
      "personaID": "string",
      "name": "string",
      "description": "string",
      "personaPrompt": "string",
      "communicationStyle": "string",
      "expertise": "string",
      "keyPriorities": ["string"],
      "qaTimeLimitSec": "number",
      "bestPractices": {
        "wpm": { "min": "number", "max": "number" },
        "eyeContact": { "min": "number" },
        "fillerWords": { "max": "number" },
        "pauses": { "min": "number" }
      }
    }
  ],
  "lastEvaluatedKey": "string - Omitted when there are no more pages"
}
```

- **Status codes**:
  - `200 OK` - List returned
  - `500 Internal Server Error` - DynamoDB scan failed

---

#### GET /personas/{personaID} — Get a persona by ID

- **Purpose**: Fetch a single persona by its unique ID.

- **Path parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `personaID` | string | The unique persona identifier |

- **Response**:
```json
{
  "persona": {
    "personaID": "string",
    "name": "string",
    "description": "string",
    "personaPrompt": "string",
    "communicationStyle": "string",
    "expertise": "string",
    "keyPriorities": ["string"],
    "qaTimeLimitSec": "number"
  }
}
```

- **Status codes**:
  - `200 OK` - Persona found
  - `404 Not Found` - No persona with the given ID

---

#### POST /personas — Create a persona

- **Purpose**: Create a new persona in DynamoDB. A `personaID` is auto-generated (UUID) if not provided in the request body. **Requires Admin group.**

- **Request body**:
```json
{
  "name": "string - Display name for the persona (required)",
  "description": "string - Short description of the persona's role (required)",
  "personaPrompt": "string - Full system prompt for the AI persona (required)",
  "communicationStyle": "string - e.g. direct, encouraging, formal",
  "expertise": "string - Domain expertise of the persona",
  "keyPriorities": ["string"],
  "qaTimeLimitSec": "number - Duration of the live Q&A session in seconds",
  "bestPractices": {
    "wpm": { "min": "number", "max": "number" },
    "eyeContact": { "min": "number" },
    "fillerWords": { "max": "number" },
    "pauses": { "min": "number" }
  }
}
```

- **Response**:
```json
{
  "message": "Persona saved successfully",
  "persona": { "personaID": "string", "...": "all fields echoed back" }
}
```

- **Status codes**:
  - `201 Created` - Persona saved
  - `400 Bad Request` - Missing required fields (`name`, `description`, or `personaPrompt`)
  - `403 Forbidden` - Caller is not in the Admin group
  - `500 Internal Server Error` - DynamoDB write failed

---

#### PUT /personas/{personaID} — Update a persona

- **Purpose**: Partially update an existing persona. Only the fields provided in the request body are updated. **Requires Admin group.**

- **Path parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `personaID` | string | ID of the persona to update |

- **Request body**:
```json
{
  "fieldToUpdate": "newValue - Any valid persona field(s)"
}
```

- **Response**:
```json
{
  "message": "Persona updated successfully"
}
```

- **Status codes**:
  - `200 OK` - Updated
  - `400 Bad Request` - Missing `personaID` in path
  - `403 Forbidden` - Caller is not in the Admin group
  - `500 Internal Server Error` - DynamoDB update failed

---

#### DELETE /personas/{personaID} — Delete a persona

- **Purpose**: Permanently delete a persona from DynamoDB. **Requires Admin group.**

- **Path parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `personaID` | string | ID of the persona to delete |

- **Response**:
```json
{
  "message": "Persona deleted successfully"
}
```

- **Status codes**:
  - `200 OK` - Deleted
  - `400 Bad Request` - Missing `personaID` in path
  - `403 Forbidden` - Caller is not in the Admin group
  - `500 Internal Server Error` - DynamoDB delete failed

---

## 3) Analytics Endpoints

---

#### GET /analytics?session_id={id} — Generate post-meeting analytics

- **Purpose**: Trigger AI-powered post-presentation feedback generation using Claude via Amazon Bedrock. On first call the Lambda generates and caches the result to S3 — subsequent calls return the cache immediately. If generation is still in progress a `202` is returned; the client should poll until a `200` is received.

- **Query parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Session ID to generate analytics for |

- **Response (200 — completed)**:
```json
{
  "status": "completed",
  "sessionId": "string",
  "persona": {
    "id": "string",
    "title": "string",
    "description": "string"
  },
  "keyRecommendations": [
    {
      "title": "string - Short recommendation title (under 8 words)",
      "description": "string - 3-sentence elaboration"
    }
  ],
  "performanceSummary": {
    "overallAssessment": "string - 2-3 sentence summary",
    "contentStrengths": ["string"],
    "deliveryFeedback": {
      "speakingPace": "string",
      "volume": "string",
      "eyeContact": "string",
      "fillerWords": "string",
      "pauses": "string"
    }
  },
  "timestampedFeedback": [
    {
      "timestamp": "string - e.g. 00:30 - 01:00",
      "message": "string - Delivery issue detected in this window"
    }
  ],
  "generatedAt": "string - ISO 8601 timestamp",
  "model": "string - Bedrock model ID used",
  "includedFiles": {
    "transcript": "boolean",
    "presentationPdf": "boolean",
    "personaCustomization": "boolean",
    "sessionAnalytics": "boolean"
  }
}
```

- **Response (202 — still processing)**:
```json
{
  "status": "processing"
}
```

- **Status codes**:
  - `200 OK` - Analytics completed and returned
  - `202 Accepted` - Generation in progress; poll again
  - `400 Bad Request` - Missing `session_id`
  - `401 Unauthorized` - No valid Cognito token
  - `500 Internal Server Error` - Generation failed (retry on next poll)

---

## 4) Live Q&A WebSocket

The live Q&A session uses a persistent WebSocket connection managed by Amazon Bedrock AgentCore. The connection is SigV4-signed using temporary AWS credentials from the Cognito Identity Pool.

### WebSocket URL

```
wss://bedrock-agentcore.[REGION].amazonaws.com/runtimes/[AGENT_RUNTIME_ARN]/ws
```

> **[PLACEHOLDER]** Replace with the value emitted as `AgentCoreWebSocketUrl` in the CDK stack outputs.

### Authentication

Connections must be signed with AWS SigV4 using credentials obtained from the Cognito Identity Pool for the authenticated user.

### Session Lifecycle

**1. Connect** — Open the WebSocket using a SigV4-signed URL.

**2. Send setup frame** — Immediately after connecting, send a setup message (within 10 seconds or the connection is closed):

```json
{
  "action": "setup",
  "personaId": "string - Persona ID to use for this session",
  "userId": "string - Cognito user sub",
  "sessionId": "string - Session ID",
  "voiceId": "string - Optional voice override (e.g. matthew, tiffany, amy)"
}
```

**3. Receive session_started** — The server confirms the session is ready:

```json
{
  "type": "session_started",
  "persona_name": "string",
  "session_id": "string"
}
```

**4. Stream audio** — Send raw 16-bit PCM audio at 16 kHz mono, base64-encoded:

```json
{
  "action": "audio",
  "data": "string - base64-encoded PCM audio chunk"
}
```

**5. Receive audio and transcript** — The server streams responses back:

```json
{ "type": "audio", "data": "string - base64-encoded PCM audio" }
{ "type": "transcript", "role": "assistant|user", "text": "string", "is_partial": "boolean" }
{ "type": "interruption" }
```

**6. Request analytics** — After the Q&A concludes, request feedback before ending:

```json
{ "action": "get_analytics" }
```

The server generates and sends analytics, then saves them to S3:

```json
{
  "type": "qa_analytics",
  "qaFeedback": {
    "overallSummary": "string",
    "responseQuality": "string - Excellent | Good | Needs Improvement",
    "strengths": ["string"],
    "improvements": ["string"],
    "questionBreakdown": [
      { "question": "string", "rating": "string - Strong | Adequate | Weak", "note": "string" }
    ]
  },
  "totalQuestions": "number",
  "totalResponses": "number"
}
```

**7. End session**:

```json
{ "action": "end" }
```

The server responds with a final `session_ended` frame and closes the connection:

```json
{ "type": "session_ended", "reason": "server_complete" }
```

---

## Response Format

### Success Response
```json
{
  "statusCode": 200,
  "body": {
    "data": "..."
  }
}
```

### Error Response
```json
{
  "statusCode": 400,
  "body": {
    "message": "Human-readable error description"
  }
}
```

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| `400` | Bad Request | Missing or invalid query parameters or request body |
| `401` | Unauthorized | Missing or expired Cognito token |
| `403` | Forbidden | Valid token but insufficient permissions (Admin group required) |
| `404` | Not Found | Requested resource (persona, file, analytics) does not exist |
| `202` | Accepted | Analytics generation is in progress; poll again |
| `500` | Internal Server Error | Unexpected Lambda or AWS service error |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | Mar 2026 | Initial release — S3, Personas, Analytics, and AgentCore WebSocket APIs |
