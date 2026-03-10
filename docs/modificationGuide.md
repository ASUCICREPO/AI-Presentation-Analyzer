# Modification Guide

This guide is for developers who want to extend, customize, or modify the AI Presentation Analyzer.

---

## Table of Contents

- [Frontend Modifications](#frontend-modifications)
- [Backend Modifications](#backend-modifications)
- [Adding New Features](#adding-new-features)
- [Changing AI/ML Models](#changing-aiml-models)
- [Database Modifications](#database-modifications)
- [Best Practices](#best-practices)

---

## Frontend Modifications

### Changing the UI Theme

**Location**: `frontend/app/globals.css`

The project uses Tailwind CSS. Update the CSS variables and Tailwind configuration to change colours, fonts, or spacing globally. For component-level changes, edit the Tailwind classes directly in the relevant `.tsx` file.

```bash
# After any CSS changes, restart the dev server to see updates
cd frontend
npm run dev
```

### Adding New Pages

**Location**: `frontend/app/`

The project uses the Next.js App Router. To add a new page:

1. Create a new directory under `frontend/app/` (e.g. `frontend/app/settings/`)
2. Add a `page.tsx` file inside it — this becomes the route automatically
3. If the page needs auth, wrap it with the existing auth context from `frontend/app/context/`
4. Add a link to it from `frontend/app/components/Header.tsx`

### Modifying Existing Components

**Location**: `frontend/app/components/`

Key components and what they control:

| Component | Purpose |
|-----------|---------|
| `PersonaSelection.tsx` | Persona picker shown during session setup |
| `UploadContent.tsx` | PDF slide deck upload UI |
| `CustomizePersona.tsx` | Custom instructions text input |
| `PracticeSession.tsx` | Recording page with transcription and gaze detection |
| `QASession.tsx` | Live Q&A WebSocket audio session |
| `ReviewAnalytics.tsx` | Post-meeting analytics display |
| `ReportPDF.tsx` | PDF export of session analytics |
| `PersonaCard.tsx` | Individual persona card in the selection list |
| `Header.tsx` | Top navigation bar |

### Modifying the Transcription Provider

**Location**: `frontend/app/transcription/`

The project ships two transcription providers:
- `awsTranscribeProvider.ts` — Amazon Transcribe streaming (default, preserves filler words)
- `webSpeechProvider.ts` — Browser Web Speech API (fallback)

To swap providers, update the import in `frontend/app/transcription/index.ts`. To add a new provider, implement the interface defined in `frontend/app/transcription/types.ts`.

### Modifying the WebSocket Service

**Location**: `frontend/app/services/websocket.ts` and `websocketSigner.ts`

The AgentCore WebSocket connection logic lives here. `websocketSigner.ts` handles SigV4 request signing using temporary Cognito Identity Pool credentials. Update this file if the AgentCore endpoint structure or auth mechanism changes.

---

## Backend Modifications

### Adding a New Lambda Function

**Location**: `backend/lambda/` and `backend/lib/backend-stack.ts`

1. Create a new kebab-case directory under `backend/lambda/` (e.g. `backend/lambda/my-new-function/`)
2. Add an `index.py` with a `lambda_handler(event, context)` entry point
3. Register it in `backend/lib/backend-stack.ts`:

```typescript
const myNewLambda = new lambda.Function(this, 'MyNewLambda', {
  runtime: lambda.Runtime.PYTHON_3_13,
  handler: 'index.lambda_handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'my-new-function')),
  timeout: cdk.Duration.seconds(30),
  role: new iam.Role(this, 'MyNewLambdaRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    ],
  }),
  environment: {
    'MY_ENV_VAR': 'value',
  },
});
```

### Adding a New API Endpoint

After creating the Lambda (above), add an API Gateway route in `backend/lib/backend-stack.ts`:

```typescript
const myResource = apiGateway.root.addResource('my-resource');
myResource.addMethod('GET', new apigateway.LambdaIntegration(myNewLambda), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
```

Then update `docs/APIDoc.md` to document the new endpoint.

### Modifying the AgentCore Agent

**Location**: `backend/agentcore/index.py` and `backend/agentcore/qa_system_prompt.jinja2`

- **System prompt**: Edit `qa_system_prompt.jinja2` to change how the Q&A agent introduces itself, what topics it focuses on, or how it structures its questions. The template receives `persona_name`, `persona_prompt`, `custom_instructions`, `transcript_text`, and `qa_limit` variables.
- **Voice**: Change the default voice by updating the `VOICE_ID` environment variable in `backend/lib/agentcore-stack.ts`. Available voices: `matthew`, `tiffany`, `amy`, `ambre`, `florian`, `beatrice`, `lorenzo`, `greta`, `lennart`, `lupe`, `carlos`.
- **Session duration**: Update `SESSION_DURATION_SEC` in `backend/lib/agentcore-stack.ts` to change the default Q&A time limit (overridden per-persona by `qaTimeLimitSec`).
- **After any change** to `backend/agentcore/`, the Docker image must be rebuilt and redeployed: `cd backend && npx cdk deploy AgentCoreStack`.

### Modifying the CDK Stacks

The infrastructure is split across four stacks. Edit the appropriate file:

| Stack file | What to modify |
|-----------|----------------|
| `backend-stack.ts` | S3, DynamoDB, Cognito, API Gateway, Lambdas, Bedrock Guardrail |
| `agentcore-stack.ts` | AgentCore runtime config, env vars, IAM policies |
| `amplify-hosting-stack.ts` | GitHub branch, build settings for frontend hosting |
| `frontend-config-stack.ts` | Which stack outputs get injected into the frontend config |

---

## Adding New Features

### Adding a New Persona

Personas are stored as DynamoDB items and managed through the REST API. Only users in the **Admin** Cognito group can create or edit personas. There is no migration or schema change required — DynamoDB is schemaless and the frontend reads whatever fields are present.

#### Full Persona Schema

Below is a complete persona object with every supported field and an explanation of each:

```json
{
  "personaID": "vc-investor-001",
  "name": "Venture Capitalist",
  "description": "A sharp, commercially-driven investor who prioritises market size, business model clarity, and traction above all else.",
  "icon": "briefcase",
  "expertise": "expert",
  "communicationStyle": "direct and challenging",
  "presentationTime": "10 minutes",
  "keyPriorities": [
    "Market opportunity and competitive differentiation",
    "Revenue model and unit economics",
    "Team credibility and execution track record"
  ],
  "personaPrompt": "You are a seasoned venture capitalist evaluating an early-stage startup pitch. Ask probing questions about market size, defensibility, and financial projections. Push back on assumptions. Be direct but fair.",
  "qaTimeLimitSec": 300,
  "timeLimitSec": 600,
  "bestPractices": {
    "wpm": { "min": 130, "max": 170, "label": "Speaking pace" },
    "eyeContact": { "min": 65, "label": "Eye contact" },
    "fillerWords": { "max": 2, "label": "Filler words per 30s" },
    "pauses": { "min": 3, "label": "Pauses per 30s" }
  },
  "scoringWeights": {
    "pace": 0.20,
    "eyeContact": 0.30,
    "fillerWords": 0.25,
    "pauses": 0.25
  }
}
```

#### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `personaID` | string | Yes | Unique identifier. Auto-generated (UUID) if omitted on `POST`. Use a readable slug for manually created personas. |
| `name` | string | Yes | Display name shown on the persona card in the UI. |
| `description` | string | Yes | Short description of the persona's role and evaluation style. Shown on the persona card. |
| `icon` | string | No | Icon shown on the persona card. Must be one of: `briefcase`, `people`, `school`, `mic`, `lightbulb`. Defaults to `people` if omitted. |
| `expertise` | string | Yes | Difficulty level. One of: `beginner`, `intermediate`, `expert`. Controls sort order in the persona list. |
| `communicationStyle` | string | Yes | Describes the AI's tone. Used in both the Q&A system prompt and the post-meeting analytics feedback tone (e.g. `"direct and challenging"`, `"warm and encouraging"`). |
| `presentationTime` | string | Yes | Human-readable expected presentation duration (e.g. `"10 minutes"`). Injected into the analytics prompt for context. |
| `keyPriorities` | string[] | Yes | List of 2–4 focus areas the persona cares about most. Injected into both the Q&A system prompt and the analytics feedback prompt. |
| `personaPrompt` | string | Yes | Full system prompt that defines how the AI behaves during the live Q&A. This is the most important field — write it clearly and specifically. |
| `qaTimeLimitSec` | number | No | Duration of the live Q&A session in seconds. Defaults to `300` (5 minutes) if omitted. |
| `timeLimitSec` | number | No | Maximum practice session recording duration in seconds. Defaults to `900` (15 minutes) if omitted. |
| `bestPractices` | object | No | Per-metric thresholds used to flag delivery issues in the timestamped feedback log and to generate per-window analytics events. Falls back to system defaults if omitted (see below). |
| `bestPractices.wpm` | object | No | Speaking pace range. `min` and `max` in words-per-minute. Default: `{ min: 140, max: 160 }`. |
| `bestPractices.eyeContact` | object | No | Minimum eye contact percentage per 30-second window. Default: `{ min: 60 }`. |
| `bestPractices.fillerWords` | object | No | Maximum filler word count per 30-second window. Default: `{ max: 3 }`. |
| `bestPractices.pauses` | object | No | Minimum pause count per 30-second window. Default: `{ min: 4 }`. |
| `scoringWeights` | object | No | Weights used to calculate the overall delivery score. Must sum to `1.0`. Falls back to system defaults if omitted. |
| `scoringWeights.pace` | number | No | Weight for speaking pace. Default: `0.25`. |
| `scoringWeights.eyeContact` | number | No | Weight for eye contact. Default: `0.30`. |
| `scoringWeights.fillerWords` | number | No | Weight for filler words. Default: `0.20`. |
| `scoringWeights.pauses` | number | No | Weight for pauses. Default: `0.25`. |

#### Default Best Practices (when `bestPractices` is omitted)

| Metric | Default threshold | Source |
|--------|------------------|--------|
| Speaking pace | 140–160 wpm | Recommended range for professional presentations (Quantified Communications) |
| Eye contact | ≥ 60% per window | ~3.2s average preferred gaze duration (Vision Sciences Society, 2015) |
| Filler words | ≤ 3 per 30s window | Average speakers use ~5 fillers/min; optimal is ≤1/min |
| Pauses | ≥ 4 per 30s window | Deliberate pauses increase recall from 42% to 71% |

#### How to Create a Persona

**Option A — via the API (recommended for production):**

```bash
curl -X POST 'https://[API_URL]/personas' \
  -H 'Authorization: [COGNITO_ID_TOKEN]' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Venture Capitalist",
    "description": "...",
    "icon": "briefcase",
    "expertise": "expert",
    "communicationStyle": "direct and challenging",
    "presentationTime": "10 minutes",
    "keyPriorities": ["Market opportunity", "Revenue model"],
    "personaPrompt": "You are a seasoned VC...",
    "qaTimeLimitSec": 300,
    "bestPractices": {
      "wpm": { "min": 130, "max": 170 },
      "eyeContact": { "min": 65 },
      "fillerWords": { "max": 2 },
      "pauses": { "min": 3 }
    },
    "scoringWeights": {
      "pace": 0.20,
      "eyeContact": 0.30,
      "fillerWords": 0.25,
      "pauses": 0.25
    }
  }'
```

> The caller must be in the **Admin** Cognito group. A `personaID` is auto-generated if not provided.

**Option B — via the AWS Console:**

1. Open the **DynamoDB** console and navigate to the Personas Table
2. Click **Create item** and switch to JSON view
3. Paste the persona JSON from the schema above (with your own values)
4. Click **Create item**

#### Writing an Effective `personaPrompt`

The `personaPrompt` is injected directly into the Nova 2 Sonic system prompt alongside the presentation transcript and custom instructions. Keep it focused:

- **State the role clearly** — "You are a [role] evaluating a [type of presentation]."
- **Define what to probe** — List specific angles the persona should dig into.
- **Set the tone** — Describe how the persona should respond (challenge assumptions, be encouraging, stay formal, etc.).
- **Keep it under 300 words** — Longer prompts dilute the impact of the transcript context that follows.

### Adding a New Persona Field

Personas are stored as DynamoDB items with no fixed schema. To add a new field beyond the standard set above:

1. **Backend** — No DynamoDB schema change needed. Include the new field in the `POST /personas` or `PUT /personas/{personaID}` request body.
2. **AgentCore prompt** — Reference the new field in `backend/agentcore/qa_system_prompt.jinja2` and pass it through `build_qa_system_prompt()` in `backend/agentcore/index.py`.
3. **Analytics Lambda** — If the field affects feedback generation, read it in `backend/lambda/post-meeting-analytics/index.py` inside `generate_feedback()`.
4. **Frontend** — Update `frontend/app/components/PersonaCard.tsx` to display the field and `frontend/app/config/config.ts` (`Persona` interface) to type it.

### Adding a New Session File Type

Session files are stored in S3 under `{userId}/{sessionId}/`. To add a new file type:

1. Add the new `request_type` key and filename to the `AUTHORIZED_REQUEST_TYPES` list and `S3_FILENAMES` dict in `backend/lambda/s3-presigned-url-gen/index.py`.
2. The frontend can then request a presigned URL for it via `GET /s3_urls?request_type=my_new_type&session_id={id}`.
3. If the Post Meeting Analytics Lambda needs to read the file, add the S3 read logic in `backend/lambda/post-meeting-analytics/index.py` and pass it into `generate_feedback()`.

### Adding a New Analytics Metric

**Location**: `backend/lambda/post-meeting-analytics/index.py`

1. Add the new metric to the `session_analytics.json` window structure in the frontend recording pipeline.
2. Add a threshold entry for it in the `_FALLBACK_BP` dict in the analytics Lambda.
3. Update `generate_timestamped_feedback()` to check the new metric against the threshold per window.
4. Add the metric to the `bestPractices` object on relevant personas via `PUT /personas/{personaID}`.

---

## Changing AI/ML Models

### Switching the Post-Meeting Analytics Model

**Location**: `backend/lambda/post-meeting-analytics/index.py`

```python
BEDROCK_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0'
```

Replace with any model ID that supports the Bedrock Converse API **with tool-use (structured output)**. The Lambda relies on tool-use to receive a typed JSON response — models that do not support tool-use will break the analytics pipeline.

> **Note**: The Lambda IAM role is already granted `bedrock:InvokeModel` for `arn:aws:bedrock:*::foundation-model/*`, so no IAM changes are needed when switching models.

### Switching the Q&A Analytics Model

**Location**: `backend/agentcore/index.py`

```python
QA_ANALYTICS_MODEL_ID = os.getenv("QA_ANALYTICS_MODEL_ID", "global.anthropic.claude-haiku-4-5-20251001-v1:0")
```

Override via the `QA_ANALYTICS_MODEL_ID` environment variable in `backend/lib/agentcore-stack.ts`.

### Switching the Nova Sonic Voice Model

**Location**: `backend/agentcore/index.py`

```python
MODEL_ID = os.getenv("MODEL_ID", "amazon.nova-2-sonic-v1:0")
```

Override via the `MODEL_ID` environment variable in `backend/lib/agentcore-stack.ts`. Must be a model supported by the Strands `BidiNovaSonicModel`.

### Modifying the Q&A System Prompt

**Location**: `backend/agentcore/qa_system_prompt.jinja2`

Edit the Jinja2 template to change how the agent behaves during Q&A. The template has access to:

| Variable | Description |
|----------|-------------|
| `persona_name` | Display name of the selected persona |
| `persona_prompt` | Full persona system prompt from DynamoDB |
| `custom_instructions` | User's session-specific customization text (may be `None`) |
| `transcript_text` | Full transcript of the practice session |
| `qa_limit` | Q&A time limit in minutes |

---

## Database Modifications

### Adding New Persona Fields to DynamoDB

DynamoDB is schemaless — no migration is needed. Simply include the new fields when calling `POST /personas` or `PUT /personas/{personaID}`. Existing persona items are unaffected until explicitly updated.

If the new field has a default value that should apply to all existing personas, write a one-off script using the AWS CLI or boto3 to scan and update all items.

### Changing the DynamoDB Partition Key

The Personas Table uses `personaID` (String) as its partition key, defined in `backend/lib/backend-stack.ts`. **The partition key cannot be changed after table creation.** To use a different key, you must:

1. Create a new table with the desired key in `backend-stack.ts`
2. Migrate existing data
3. Update all Lambda environment variables and code references

### Enabling Point-in-Time Recovery

PITR is currently commented out in `backend/lib/backend-stack.ts` to reduce cost. To enable it for production:

```typescript
const personasTable = new dynamodb.TableV2(this, 'UserPersonaTable', {
  partitionKey: { name: 'personaID', type: dynamodb.AttributeType.STRING },
  billing: dynamodb.Billing.onDemand(),
  pointInTimeRecovery: true,   // Add this line
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Change for production
});
```

---

## Best Practices

1. **Run `cdk diff` before every deploy** — Review exactly what will change before applying it
2. **Deploy incrementally** — Deploy one stack at a time to isolate failures
3. **Never hardcode secrets** — Use Lambda environment variables or AWS Secrets Manager
4. **Test Lambda changes with `--hotswap`** — `npx cdk deploy --hotswap` updates Lambda code in seconds without a full CloudFormation update
5. **Keep Lambda handlers thin** — Business logic belongs in separate modules, not directly in `lambda_handler()`
6. **Update `docs/APIDoc.md`** whenever you add or change an endpoint
7. **Use `cdk synth` to catch errors early** — Synthesize before deploying to catch TypeScript and CDK validation errors locally

---

## Conclusion

The project is designed to be modular and extensible. The four CDK stacks are loosely coupled so changes to one area (e.g. the AgentCore runtime) do not require redeploying the others. Lambda functions are independently deployable, and the DynamoDB schema is flexible enough to accommodate new persona fields without migrations.

For questions or support, open an issue on the GitHub repository.
