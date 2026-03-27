# Architecture Deep Dive

This document provides a detailed explanation of the AI Presentation Analyzer architecture, including the end-to-end data flow, technology stack, infrastructure design, and the key architectural decisions made during development.

---

## Architecture Diagram

![Architecture Diagram](./media/ArchitectureDiagram.jpg)

---

## Architecture Flow

The system is organized around three distinct user journeys that share a common auth and storage foundation: the **Practice Session**, the **Live Q&A Session**, and the **Post-Meeting Review**.

### 1. User Authentication

All interactions begin with the user signing in through the Next.js frontend. Authentication is handled by **Amazon Cognito User Pool**, which issues a JWT ID token on successful sign-in. This token is passed as the `Authorization` header on every REST API call. For the Live Q&A WebSocket and Amazon Transcribe streaming, the frontend exchanges the Cognito ID token for temporary AWS credentials via the **Cognito Identity Pool** — these credentials are scoped to the authenticated IAM role and used to SigV4-sign WebSocket connections.

### 2. Session Setup — Persona Selection, PDF Upload, and Custom Instructions

Before starting the practice session, the user completes three optional but impactful configuration steps:

1. **Persona Selection** — The frontend calls `GET /personas` to fetch the paginated list of available personas from DynamoDB. The user picks a persona (e.g. "Venture Capitalist", "Technical Interviewer") which determines the AI's communication style, areas of focus, Q&A time limit, and best-practice delivery thresholds used later in analytics. The selected persona's `personaID` is written into the session `manifest.json`.

2. **Custom Instructions Upload** — The user can type free-form instructions to further tailor the AI's behavior for their specific session (e.g. "Focus on my financial projections", "Ask harder follow-up questions"). This text is sent to the Pre-signed S3 URLs Lambda via `POST /s3_urls?action=upload_persona&session_id={id}`. Before saving, the Lambda runs the text through the **Bedrock Guardrail** to screen for harmful content and prompt injection attempts. If it passes, the text is stored as `{userId}/{sessionId}/CUSTOM_PERSONA_INSTRUCTION.txt`. A flag `hasPersonaCustomization: true` is set in `manifest.json` so both the AgentCore agent and the Post Meeting Analytics Lambda know to load and inject it into their system prompts. The frontend can also retrieve the saved text at any point via `GET /s3_urls?action=get_persona&session_id={id}`, which re-runs the guardrail scan on read as an extra safety layer.

3. **Presentation PDF Upload** — The user can optionally upload their slide deck as a PDF. The frontend requests a presigned POST URL from the Pre-signed S3 URLs Lambda (`GET /s3_urls?request_type=ppt&session_id={id}`), then POSTs the file directly to S3 where it is stored as `{userId}/{sessionId}/presentation.pdf`. This file is later passed as a document attachment to the Bedrock Converse API call in the Post Meeting Analytics Lambda, giving Claude visibility into the slide content when generating feedback.

Once setup is complete, the `manifest.json` capturing all session metadata (`persona`, `hasPresentationPdf`, `hasPersonaCustomization`) is uploaded to S3 via a presigned POST URL (`request_type=manifest`), finalising the session configuration before recording begins.

---

### 3. Practice Session — Recording and Transcription

With the session configured, the user records themselves presenting:

1. The frontend requests a presigned S3 upload URL from the **Pre-signed S3 URLs Lambda** via `GET /s3_urls?action=initiate_multipart` and streams video chunks directly to **Amazon S3** using the S3 multipart upload protocol. This keeps large video blobs out of the Lambda path entirely.
2. Simultaneously, the frontend streams microphone audio to **Amazon Transcribe** using the real-time streaming API over a WebSocket. Transcribe returns timestamped word-level transcripts which are displayed live and accumulated into a `transcript.json` file.
3. The browser also runs an on-device **Gaze Detection** pipeline via the device camera and a MediaPipe-based eye-tracking model. Eye contact scores, speaking pace, volume levels, filler word counts, and pause counts are computed locally and uploaded as `session_analytics.json` (30-second window aggregates) and `detailed_metrics.json`.
4. At session end the frontend uploads the final `transcript.json`, `session_analytics.json`, `detailed_metrics.json`, and `manifest.json` to S3 via additional presigned POST URLs.

### 4. Live Q&A Session — Bidirectional Voice Agent

After the practice session completes, the user initiates a live Q&A:

1. The frontend opens a SigV4-signed WebSocket to the **Bedrock AgentCore** runtime endpoint and immediately sends a `setup` frame containing the `personaId`, `userId`, `sessionId`, and optional `voiceId`.
2. AgentCore loads the selected persona from the **Persona DynamoDB Table** and fetches the session `transcript.json` from S3 to build a context-aware system prompt using a Jinja2 template.
3. A **Strands BidiAgent** backed by **Amazon Nova 2 Sonic** handles the bidirectional audio conversation. The frontend streams 16-bit PCM audio at 16 kHz and receives back synthesized speech audio and real-time transcripts over the same WebSocket.
4. A `SessionTimeGuard` hook monitors elapsed time and injects timer nudges into the agent so it naturally wraps up within the configured `qaTimeLimitSec` persona limit.
5. At session end, the agent generates structured Q&A analytics using **Amazon Nova 2 Lite** via the Bedrock Converse API and saves `qa_analytics.json` to S3 before closing the connection.

### 5. Post-Meeting Review — Analytics Generation

After both the practice session and Q&A are complete, the user navigates to the review page:

1. The frontend calls `GET /analytics?session_id={id}`, which invokes the **Post Meeting Analytics Lambda**.
2. The Lambda reads the `manifest.json` to determine the persona used, then fetches the transcript, optional PDF slide deck, optional persona customization text, and session analytics from S3.
3. It calls **Claude Haiku 4.5** via the Bedrock Converse API with a tool-use schema to generate structured feedback: five key recommendations, an overall performance summary, and per-metric delivery feedback (pace, volume, eye contact, filler words, pauses).
4. Timestamped feedback is also generated by comparing per-window metrics against the persona's configured `bestPractices` thresholds.
5. The result is cached to S3 as `ai_feedback.json`. Subsequent calls return the cache immediately. If the Lambda times out mid-generation (API Gateway 29 s limit), it keeps running and the client polls until a `200` is returned.

### 6. Persona Management

Administrators manage AI personas through the REST API:

1. `GET /personas` lists all personas from DynamoDB (paginated, open to all authenticated users).
2. `POST`, `PUT`, `DELETE` on `/personas` are restricted to the **Admin** Cognito group and perform CRUD operations on the DynamoDB Personas Table.
3. Users can also upload session-specific persona customization text via `POST /s3_urls?action=upload_persona`. This text is run through a **Bedrock Guardrail** before being saved to S3, blocking harmful content and prompt injection attempts.

---

## Cloud Services / Technology Stack

### Frontend

- **Next.js 14 (App Router)** — React framework for the web application. Server components used for static layout; client components handle all real-time interactions (recording, WebSocket, camera).
- **Tailwind CSS** — Utility-first CSS for styling.
- **Amazon Transcribe Streaming SDK** — Real-time speech-to-text via WebSocket, replacing the browser's Web Speech API.
- **MediaPipe / Gaze Detection** — On-device eye contact and gaze tracking running entirely within the browser without any server round-trips.
- **AWS Amplify Hosting** — Hosts and serves the Next.js frontend via CloudFront, deployed automatically from the CDK pipeline.

### Backend Infrastructure

- **AWS CDK (TypeScript)** — All infrastructure is defined as code across four stacks: `AIPresentationCoachStack` (auth, API, storage, core Lambdas), `AgentCoreStack` (Bedrock AgentCore runtime), `AmplifyHostingStack` (frontend hosting), and `FrontendConfigStack` (runtime config injection).

- **Amazon API Gateway (REST)** — Single REST API acting as the entry point for all Lambda-backed routes. Cognito authorizer enforces authentication on every route. CloudWatch access logging enabled.

- **AWS Lambda (Python 3.13)** — Three functions:
  - **Pre-signed S3 URLs Lambda** (`s3-presigned-url-gen/`) — Generates presigned POST/GET URLs for all session file types, manages the multipart upload lifecycle for recordings, and mediates persona customization uploads through the Bedrock Guardrail.
  - **Persona CRUD Lambda** (`persona-crud/`) — Full CRUD for the Personas DynamoDB table, with Admin-group gating on writes.
  - **Post Meeting Analytics Lambda** (`post-meeting-analytics/`) — Orchestrates AI feedback generation by reading session data from S3, calling Bedrock, and caching results back to S3.

### AI / ML Services

- **Amazon Bedrock AgentCore** — Managed container runtime for the bidirectional voice Q&A agent. Runs the Strands BidiAgent as a Docker container with native WebSocket support.
- **Amazon Nova 2 Sonic** (`amazon.nova-2-sonic-v1:0`) — Multimodal speech-to-speech model powering the real-time voice Q&A conversation.
- **Claude Haiku 4.5** (`global.anthropic.claude-haiku-4-5-20251001-v1:0`) — Used for post-meeting analytics generation via the Post Meeting Analytics Lambda. Accessed through the Bedrock Converse API with tool-use for structured JSON output.
- **Amazon Nova 2 Lite** (`global.amazon.nova-2-lite-v1:0`) — Used for Q&A session analytics generation within the AgentCore runtime.
- **Bedrock Guardrail** — Content safety layer applied to all persona customization uploads and reads. Filters hate speech, insults, sexual content, violence, misconduct, and prompt injection attacks at HIGH strength.
- **Amazon Transcribe** — Real-time streaming speech-to-text for live transcription during practice sessions.

### Data Storage

- **Amazon S3 (Session Data Bucket)** — Stores all session artifacts under the path `{userId}/{sessionId}/`:
  - `recording.webm` — Full session recording
  - `presentation.pdf` — Uploaded slide deck (optional)
  - `transcript.json` — Real-time transcription output
  - `session_analytics.json` — 30-second window delivery metrics
  - `detailed_metrics.json` — Raw per-frame metrics
  - `manifest.json` — Session metadata
  - `CUSTOM_PERSONA_INSTRUCTION.txt` — User's persona customization (optional)
  - `ai_feedback.json` — Cached post-meeting analytics
  - `qa_transcript.json` / `qa_analytics.json` — Live Q&A outputs
  - Objects expire automatically after 30 days via S3 lifecycle rules.

- **Amazon DynamoDB (Personas Table)** — On-demand billing, stores persona configurations with `personaID` as the partition key. Each persona record includes the system prompt, communication style, best-practice thresholds, voice preferences, and Q&A time limits.

### Authentication & Identity

- **Amazon Cognito User Pool** — Email/password sign-up and sign-in with email verification. Strong password policy enforced. Admin group for write-access control.
- **Amazon Cognito Identity Pool** — Exchanges Cognito ID tokens for temporary AWS credentials. Authenticated role grants Transcribe streaming permissions and AgentCore WebSocket invocation permission.

---

## Infrastructure as Code

All AWS resources are defined and deployed using **AWS CDK in TypeScript**, split across four stacks:

### CDK Stack Structure

```
backend/
├── bin/
│   └── backend.ts                  # CDK app entry point — instantiates all stacks
├── lib/
│   ├── backend-stack.ts            # Core stack: Cognito, API Gateway, Lambdas, S3, DynamoDB, Guardrail
│   ├── agentcore-stack.ts          # AgentCore runtime + IAM policy for authenticated users
│   ├── amplify-hosting-stack.ts    # Amplify hosting for Next.js frontend
│   └── frontend-config-stack.ts   # Injects Cognito/API config into the frontend at deploy time
└── lambda/
    ├── s3-presigned-url-gen/
    ├── persona-crud/
    ├── post-meeting-analytics/
    └── layers/
        └── boto3-latest/           # Lambda layer with the latest boto3 for Bedrock Converse API
```

### Key CDK Constructs

1. **`AIPresentationCoachStack`** — The primary stack. Provisions the S3 bucket (with CORS, lifecycle rules, and server access logging), the DynamoDB Personas Table, Cognito User Pool + Identity Pool + authenticated IAM role, API Gateway with Cognito authorizer, all three Lambda functions, and the Bedrock Guardrail with its first version.
2. **`AgentCoreStack`** — Builds the AgentCore Docker image from `backend/agentcore/`, registers it as a Bedrock AgentCore Runtime, and attaches an IAM managed policy to the Cognito authenticated role granting `bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream`. Kept as a separate stack to avoid circular CloudFormation dependencies between the runtime ARN and the authenticated role.
3. **`AmplifyHostingStack`** — Connects Amplify to the GitHub repository for automatic frontend deployments on push.
4. **`FrontendConfigStack`** — Writes the deployed Cognito pool IDs, API URL, and AgentCore WebSocket URL into the frontend's configuration so the app knows which AWS resources to connect to.

### Deployment Automation

The project includes a `buildspec-deploy.yml` for AWS CodeBuild and a `deploy.sh` shell script. Running `./deploy.sh` prompts for a GitHub repository and branch, then launches a CodeBuild job on ARM64 compute that installs dependencies, synthesizes the CDK app, and runs `cdk deploy --all`. Docker with ARM64 support is required for local deployments because the AgentCore container is built for `linux/arm64`.

---

## Security Considerations

- **Authentication** — All REST API endpoints are protected by a Cognito User Pools Authorizer on API Gateway. No unauthenticated access is permitted.
- **Authorization** — Persona write operations (POST, PUT, DELETE) are gated behind the Admin Cognito group, checked inside the Lambda handler. The Cognito authenticated IAM role is scoped to only the permissions needed: Transcribe streaming and AgentCore WebSocket invocation.
- **Content Safety** — All persona customization text (both uploads and reads) passes through a Bedrock Guardrail set to HIGH strength across hate, insults, sexual content, violence, misconduct, and prompt injection categories. Rejected content returns a `400` and is never persisted.
- **Data Encryption** — S3 bucket enforces SSL (`enforceSSL: true`) and blocks all public access. DynamoDB data is encrypted at rest by default.
- **Presigned URLs** — File uploads never flow through Lambda. The Lambda only issues short-lived presigned POST URLs; the client uploads directly to S3. PDF uploads expire in 2 minutes, recordings in 20 minutes, JSON data in 1 minute.
- **Least-Privilege IAM** — Each Lambda and the AgentCore runtime have dedicated IAM roles scoped to only the resources they need. CDK-nag is run at synth time to flag any overly permissive policies.
- **CORS** — API Gateway and S3 CORS are configured to the `allowedOrigins` list provided at deploy time, defaulting to `*` for local development.

---

## Scalability

- **Fully Serverless** — All compute is Lambda or AgentCore containers. There are no EC2 instances or fixed-capacity resources. Lambda scales concurrently per request up to account limits.
- **S3 Direct Upload** — Video recordings are streamed directly from the browser to S3 using multipart uploads, completely bypassing Lambda for the data path. This eliminates Lambda memory and payload size constraints regardless of recording length.
- **DynamoDB On-Demand** — The Personas Table uses on-demand billing and scales automatically with read/write traffic.
- **AgentCore Session Isolation** — Each Q&A session runs in its own isolated AgentCore container instance with a configurable idle timeout (10 minutes) and maximum lifetime (1 hour), preventing resource leakage between sessions.
- **Analytics Caching** — Post-meeting analytics are generated once and cached to S3. Repeat visits to the review page are served from cache with zero Bedrock invocations.

---

## Architectural Decisions

### Amazon Transcribe over the Web Speech API

During development the frontend initially used the browser's built-in Web Speech API for real-time transcription. This was replaced with **Amazon Transcribe Streaming** for two reasons. First, the Web Speech API includes a built-in post-processing layer that silently removes common filler words — "um", "uh", "eh", and similar disfluencies — before returning results to JavaScript. This made it impossible to accurately detect and count filler words, which is a core delivery metric in the analytics pipeline. Second, the Web Speech API's accuracy and word-timing precision are browser-dependent and inconsistent across platforms. Amazon Transcribe returns accurate word-level timestamps and preserves raw speech including disfluencies, giving the analytics pipeline reliable data to work with.

### Amazon Bedrock AgentCore with Strands for Live Q&A

The live Q&A agent was built using the **Strands SDK BidiAgent** running on **Amazon Bedrock AgentCore** rather than a traditional Lambda-based approach. Two factors drove this decision. First, AgentCore provides native bidirectional WebSocket connectivity — the client connects directly to a persistent AgentCore WebSocket endpoint and streams audio in real time without any polling or chunking overhead. A Lambda function cannot maintain a persistent WebSocket connection across multiple audio frames. Second, AgentCore's billing model does not charge for token I/O — only for compute time. Because Nova 2 Sonic processes continuous audio streams, the token volume per session is very high; a standard Bedrock inference billing model would make each Q&A session significantly more expensive. AgentCore's pricing structure keeps per-session costs predictable and low.

### Claude Haiku 4.5 for Post-Meeting Analytics

The Post Meeting Analytics Lambda uses **Claude Haiku 4.5** (`global.anthropic.claude-haiku-4-5-20251001-v1:0`) for generating structured post-session feedback. At the time of development this was the model that supported the Bedrock Converse API's tool-use (structured output) feature, which allows the response to be constrained to a strict JSON schema via a tool definition. This eliminates the need for fragile response parsing — the Lambda receives a typed JSON object directly from `toolUse.input` with guaranteed fields. Haiku 4.5 also provides strong reasoning quality at low latency and cost, which is well suited to the analytics use case where multiple fields (five recommendations, performance summary, per-metric delivery feedback) need to be populated reliably in a single inference call. The AgentCore Q&A feedback generation uses **Amazon Nova 2 Lite** (`global.amazon.nova-2-lite-v1:0`) for its structured Q&A analytics output.

### On-Device Gaze Detection

Eye contact scoring is performed entirely within the browser using a **MediaPipe-based gaze detection pipeline** running on the device's GPU via WebGL. This was chosen over a server-side vision model for two reasons. First, latency: sending video frames to a cloud endpoint introduces hundreds of milliseconds of round-trip delay, while on-device inference runs in under 30 ms per frame even on modest hardware. Second, cost: processing the camera feed server-side at 30 fps for a 10-minute session would require significant compute; running it in the browser makes this zero-cost regardless of session length. The scores are accumulated locally and uploaded as part of `session_analytics.json` at the end of the session, keeping the entire gaze pipeline off the critical network path.
