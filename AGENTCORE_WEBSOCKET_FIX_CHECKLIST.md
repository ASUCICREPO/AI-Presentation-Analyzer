# AgentCore WebSocket Implementation Fix Checklist

**Status:** Validated against AWS Official Documentation  
**Last Updated:** Based on AWS Bedrock AgentCore Developer Guide  
**Documentation Sources:**
- [WebSocket Getting Started Guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-websocket.html)
- [Cognito Identity Provider Setup](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-idp-cognito.html)

---

## 🎯 Overview

This checklist addresses three critical issues preventing local testing of the AgentCore WebSocket implementation:

1. **Authentication Mismatch** - Frontend and backend use incompatible auth methods
2. **WebSocket URL Format** - Frontend uses old API Gateway URL instead of AgentCore URL
3. **Incomplete Python Handler** - Backend doesn't load persona/transcript or build system prompt

---

## ✅ ISSUE #1: Fix WebSocket Authentication

### Problem Statement
**Current:** Frontend passes Cognito ID token as query parameter (`?token=xxx`)  
**Required:** AgentCore expects AWS SigV4 authentication or OAuth Bearer token in headers

### Solution: Use AWS SigV4 Pre-signed URL

According to AWS documentation, AgentCore supports three authentication methods:
1. AWS SigV4 headers
2. AWS SigV4 pre-signed URL (query parameters)
3. OAuth Bearer token

**We'll use Option #2 (SigV4 pre-signed URL)** because:
- Works with browser WebSocket API (no custom headers needed)
- Cognito Identity Pool provides temporary AWS credentials
- Frontend already has Cognito Identity Pool configured

---

### Task 1.1: Install AWS SDK for Credential Management

**File:** `frontend/package.json`

**Action:** Add AWS SDK dependencies

```bash
cd frontend
npm install @aws-sdk/client-sts @aws-sdk/signature-v4 @aws-sdk/protocol-http
```

**Validation:** Check that packages appear in `package.json` dependencies

---

### Task 1.2: Create AWS Credential Helper

**File:** `frontend/app/services/awsCredentials.ts` (NEW FILE)

**Action:** Create helper to get temporary AWS credentials from Cognito Identity Pool

```typescript
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { cognitoConfig } from '../config/config';

export async function getAwsCredentials() {
  const credentialProvider = fromCognitoIdentityPool({
    clientConfig: { region: cognitoConfig.region },
    identityPoolId: cognitoConfig.identityPoolId,
    logins: {
      [`cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`]: 
        await getIdToken(),
    },
  });

  return await credentialProvider();
}

async function getIdToken(): Promise<string> {
  // This will be passed from AuthContext
  // Implementation in next task
  throw new Error('Must be implemented with AuthContext integration');
}
```

**Validation:** File compiles without errors

---

### Task 1.3: Create WebSocket URL Signer

**File:** `frontend/app/services/websocketSigner.ts` (NEW FILE)

**Action:** Create SigV4 URL signer for WebSocket connections

```typescript
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@aws-sdk/protocol-http';

export async function signWebSocketUrl(
  url: string,
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  },
  region: string
): Promise<string> {
  const urlObj = new URL(url);
  
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'wss:',
    hostname: urlObj.hostname,
    path: urlObj.pathname,
    headers: {
      host: urlObj.hostname,
    },
  });

  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region: region,
    credentials: credentials,
    sha256: Sha256,
  });

  const signedRequest = await signer.presign(request, {
    expiresIn: 300, // 5 minutes
  });

  // Convert signed request to WebSocket URL with query parameters
  const signedUrl = new URL(url);
  Object.entries(signedRequest.query || {}).forEach(([key, value]) => {
    signedUrl.searchParams.set(key, value as string);
  });

  return signedUrl.toString();
}
```

**Validation:** File compiles without TypeScript errors

---

### Task 1.4: Update WebSocket Client to Use SigV4

**File:** `frontend/app/services/websocket.ts`

**Action:** Replace token query parameter with SigV4 signed URL

**Find:**
```typescript
const params = new URLSearchParams({
  personaId: this.config.personaId,
  sessionId: this.config.sessionId,
  userId: this.config.userId,
  dateStr: this.config.dateStr,
  ...(this.config.voiceId && { voiceId: this.config.voiceId }),
  ...(this.config.token && { token: this.config.token }),
});

const url = `${WEBSOCKET_URL}?${params.toString()}`;
this.ws = new WebSocket(url);
```

**Replace with:**
```typescript
import { signWebSocketUrl } from './websocketSigner';
import { getAwsCredentials } from './awsCredentials';

// Inside connect() method:
const credentials = await getAwsCredentials();

// Build base URL with custom headers as query params
const baseUrl = new URL(WEBSOCKET_URL);
baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id', this.config.sessionId);
baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-PersonaId', this.config.personaId);
baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-UserId', this.config.userId);
baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-DateStr', this.config.dateStr);
if (this.config.voiceId) {
  baseUrl.searchParams.set('X-Amzn-Bedrock-AgentCore-Runtime-Custom-VoiceId', this.config.voiceId);
}

// Sign the URL with SigV4
const signedUrl = await signWebSocketUrl(
  baseUrl.toString(),
  credentials,
  'us-east-1' // Use your region
);

this.ws = new WebSocket(signedUrl);
```

**Validation:** 
- TypeScript compiles without errors
- No runtime errors when creating WebSocket connection

---

### Task 1.5: Update useQASession Hook

**File:** `frontend/app/hooks/useQASession.ts`

**Action:** Remove token parameter (no longer needed)

**Find:**
```typescript
const token = getToken ? await getToken() : undefined;
const client = new QAWebSocketClient({ ...config, token }, handleEvent);
```

**Replace with:**
```typescript
const client = new QAWebSocketClient(config, handleEvent);
```

**Also update interface:**

**Find:**
```typescript
export interface QAWebSocketConfig {
  personaId: string;
  sessionId: string;
  userId: string;
  dateStr: string;
  voiceId?: string;
  token?: string;
}
```

**Replace with:**
```typescript
export interface QAWebSocketConfig {
  personaId: string;
  sessionId: string;
  userId: string;
  dateStr: string;
  voiceId?: string;
}
```

**Validation:** TypeScript compiles without errors

---

### Task 1.6: Update IAM Permissions for Identity Pool

**File:** `backend/lib/backend-stack.ts`

**Action:** Add AgentCore WebSocket permissions to authenticated role

**Find:**
```typescript
// Grant Amazon Transcribe real-time streaming permissions
authenticatedRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'transcribe:StartStreamTranscriptionWebSocket',
      'transcribe:StartStreamTranscription',
    ],
    resources: ['*'],
  }),
);
```

**Add after:**
```typescript
// Grant AgentCore WebSocket connection permissions
authenticatedRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream',
    ],
    resources: [agentCoreRuntime.agentRuntimeArn],
  }),
);
```

**Validation:** 
- CDK builds successfully: `npm run build`
- No TypeScript errors

---

## ✅ ISSUE #2: Fix WebSocket URL Format

### Problem Statement
**Current:** `wss://55iro76xs3.execute-api.us-east-1.amazonaws.com/prod` (old API Gateway v2)  
**Required:** `wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/<RUNTIME_ARN>/ws`

### Solution: Update Environment Variable After Deployment

---

### Task 2.1: Deploy Backend Stack

**Action:** Deploy CDK stack to get actual AgentCore Runtime ARN

```bash
cd backend
npm run build
cdk deploy
```

**Expected Output:**
```
Outputs:
AIPresentationCoachStack.AgentCoreRuntimeArn = arn:aws:bedrock:us-east-1:123456789012:agent-runtime/live-qa-agent-xyz
AIPresentationCoachStack.AgentCoreWebSocketUrl = wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn:aws:bedrock:us-east-1:123456789012:agent-runtime/live-qa-agent-xyz/ws
```

**Validation:** 
- Deployment succeeds
- CloudFormation outputs show `AgentCoreWebSocketUrl`

---

### Task 2.2: Update Frontend Environment Variables

**File:** `frontend/.env.local`

**Action:** Replace old WebSocket URL with AgentCore URL from deployment outputs

**Find:**
```
NEXT_PUBLIC_WEBSOCKET_API_URL=wss://55iro76xs3.execute-api.us-east-1.amazonaws.com/prod
```

**Replace with:** (use actual value from CloudFormation outputs)
```
NEXT_PUBLIC_WEBSOCKET_API_URL=wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn:aws:bedrock:us-east-1:123456789012:agent-runtime/live-qa-agent-xyz/ws
```

**Validation:** 
- URL starts with `wss://bedrock-agentcore`
- URL ends with `/ws`
- URL contains `/runtimes/arn:aws:bedrock:`

---

## ✅ ISSUE #3: Complete Python Handler Implementation

### Problem Statement
**Current:** Python handler doesn't load persona, transcript, or build system prompt  
**Required:** Handler must extract config, load data from DynamoDB/S3, and create agent with proper prompt

### Solution: Implement Full Handler with Data Loading

---

### Task 3.1: Update Python Handler to Extract Custom Headers

**File:** `backend/agentcore/index.py`

**Action:** Extract configuration from WebSocket connection context

**Find:**
```python
@app.websocket
async def websocket_handler(websocket, context):

    model = create_nova_sonic_model()
    agent = BidiAgent(
        model=model,
        tools=[stop_conversation]
    )

    try:
        await websocket.accept()
        await agent.run(inputs=[websocket.receive_json], outputs=[websocket.send_json])
    except WebSocketDisconnect:
        print("Client WebSocket disconnected, stopping agent...")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await agent.stop()
        await websocket.close()
```

**Replace with:**
```python
@app.websocket
async def websocket_handler(websocket, context):
    """
    WebSocket handler for Q&A sessions.
    
    Custom headers are passed as query parameters with prefix:
    X-Amzn-Bedrock-AgentCore-Runtime-Custom-
    
    Expected headers:
    - PersonaId: DynamoDB persona ID
    - UserId: User identifier
    - DateStr: Session date string
    - VoiceId: Voice selection (optional)
    """
    
    # Extract custom headers from context
    # AgentCore passes custom headers in context['headers']
    headers = context.get('headers', {})
    
    persona_id = headers.get('x-amzn-bedrock-agentcore-runtime-custom-personaid', '')
    user_id = headers.get('x-amzn-bedrock-agentcore-runtime-custom-userid', '')
    date_str = headers.get('x-amzn-bedrock-agentcore-runtime-custom-datestr', '')
    voice_id = headers.get('x-amzn-bedrock-agentcore-runtime-custom-voiceid', DEFAULT_VOICE_ID)
    
    # Session ID is in standard header
    session_id = headers.get('x-amzn-bedrock-agentcore-runtime-session-id', '')
    
    print(f"[WebSocket] Connection from user={user_id}, persona={persona_id}, session={session_id}")
    
    try:
        # Load persona configuration from DynamoDB
        persona_data = await load_persona(persona_id)
        if not persona_data:
            await websocket.accept()
            await websocket.send_json({
                "type": "error",
                "message": f"Persona {persona_id} not found"
            })
            await websocket.close()
            return
        
        # Load presentation transcript from S3
        transcript_text = await load_transcript(user_id, date_str, session_id)
        if not transcript_text:
            print(f"[Warning] No transcript found for session {session_id}, using empty transcript")
            transcript_text = "No presentation transcript available."
        
        # Build QA system prompt
        system_prompt = build_qa_system_prompt(
            persona_name=persona_data.get('name', 'Interviewer'),
            persona_prompt=persona_data.get('personaPrompt', ''),
            custom_instructions=persona_data.get('description', ''),
            transcript_text=transcript_text
        )
        
        # Create agent with configuration
        model = create_nova_sonic_model(voice_id)
        agent = BidiAgent(
            model=model,
            tools=[stop_conversation],
            system_prompt=system_prompt,
        )
        
        # Accept connection and start agent
        await websocket.accept()
        
        # Send session started event
        await websocket.send_json({
            "type": "session_started",
            "persona_name": persona_data.get('name', 'Interviewer'),
            "session_id": session_id
        })
        
        # Run agent with bidirectional streaming
        await agent.start()
        await agent.run(
            inputs=[websocket.receive_json],
            outputs=[websocket.send_json]
        )
        
    except Exception as e:
        print(f"[Error] WebSocket handler error: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        try:
            await agent.stop()
        except:
            pass
        try:
            await websocket.close()
        except:
            pass
```

**Validation:** Python syntax is correct (no indentation errors)

---

### Task 3.2: Add DynamoDB Persona Loader

**File:** `backend/agentcore/index.py`

**Action:** Add function to load persona from DynamoDB

**Add after imports:**
```python
import aioboto3

async def load_persona(persona_id: str) -> dict:
    """Load persona configuration from DynamoDB."""
    table_name = os.getenv('PERSONA_TABLE_NAME')
    if not table_name:
        print("[Error] PERSONA_TABLE_NAME environment variable not set")
        return {}
    
    try:
        session = aioboto3.Session()
        async with session.resource('dynamodb', region_name=REGION) as dynamodb:
            table = await dynamodb.Table(table_name)
            response = await table.get_item(Key={'personaID': persona_id})
            
            if 'Item' not in response:
                print(f"[Error] Persona {persona_id} not found in DynamoDB")
                return {}
            
            return response['Item']
    except Exception as e:
        print(f"[Error] Failed to load persona {persona_id}: {e}")
        return {}
```

**Validation:** Function compiles without errors

---

### Task 3.3: Add S3 Transcript Loader

**File:** `backend/agentcore/index.py`

**Action:** Add function to load transcript from S3

**Add after load_persona:**
```python
async def load_transcript(user_id: str, date_str: str, session_id: str) -> str:
    """Load presentation transcript from S3."""
    bucket_name = os.getenv('UPLOADS_BUCKET')
    if not bucket_name:
        print("[Error] UPLOADS_BUCKET environment variable not set")
        return ""
    
    # S3 key format: {userId}/{dateStr}/{sessionId}/transcript.json
    s3_key = f"{user_id}/{date_str}/{session_id}/transcript.json"
    
    try:
        session = aioboto3.Session()
        async with session.client('s3', region_name=REGION) as s3:
            response = await s3.get_object(Bucket=bucket_name, Key=s3_key)
            content = await response['Body'].read()
            
            # Parse transcript JSON
            import json
            transcript_data = json.loads(content)
            
            # Extract text from transcript entries
            if isinstance(transcript_data, list):
                # Format: [{"text": "...", "timestamp": ...}, ...]
                transcript_text = " ".join([entry.get('text', '') for entry in transcript_data])
            elif isinstance(transcript_data, dict) and 'entries' in transcript_data:
                # Format: {"entries": [...]}
                transcript_text = " ".join([entry.get('text', '') for entry in transcript_data['entries']])
            else:
                transcript_text = str(transcript_data)
            
            return transcript_text.strip()
            
    except Exception as e:
        print(f"[Warning] Failed to load transcript from s3://{bucket_name}/{s3_key}: {e}")
        return ""
```

**Validation:** Function compiles without errors

---

### Task 3.4: Update Requirements.txt

**File:** `backend/agentcore/requirements.txt`

**Action:** Add aioboto3 for async AWS SDK calls

**Find:**
```
aws-sdk-bedrock-runtime>=0.3.0,
prompt-toolkit>=3.0.52,
pyaudio>=0.2.14
strands-agents>=1.26.0
bedrock-agentcore>=1.0.3

boto3>=1.40.0
botocore>=1.40.0
```

**Replace with:**
```
aws-sdk-bedrock-runtime>=0.3.0,
prompt-toolkit>=3.0.52,
pyaudio>=0.2.14
strands-agents>=1.26.0
bedrock-agentcore>=1.0.3

boto3>=1.40.0
botocore>=1.40.0
aioboto3>=12.0.0
```

**Validation:** File saved successfully

---

### Task 3.5: Rebuild and Redeploy Backend

**Action:** Rebuild CDK stack with updated Python code

```bash
cd backend
npm run build
cdk deploy
```

**Validation:** 
- Deployment succeeds
- Docker image builds successfully
- No Python import errors in logs

---

## 🧪 Testing Checklist

### Local Frontend Testing

**Prerequisites:**
- Backend deployed to AWS
- Frontend `.env.local` updated with AgentCore WebSocket URL
- User registered in Cognito

**Steps:**

1. **Start Frontend Dev Server**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Login to Application**
   - Navigate to `http://localhost:3000`
   - Login with Cognito credentials
   - Verify authentication succeeds

3. **Upload Presentation**
   - Upload a PDF presentation
   - Verify upload succeeds

4. **Start Practice Session**
   - Select a persona
   - Start practice session
   - Record a short presentation (30 seconds)
   - Verify recording works

5. **Start Q&A Session**
   - Click "Start Q&A Session"
   - Check browser console for WebSocket connection
   - Expected: `[QA WebSocket] Connected`
   - Expected: Session started event received

6. **Test Voice Interaction**
   - Speak into microphone
   - Verify audio is captured
   - Verify agent responds with audio
   - Verify transcript appears in UI

7. **End Session**
   - Click "End Session"
   - Verify session ends gracefully
   - Verify transcript is saved

### Validation Criteria

✅ **Authentication Success:**
- No 401/403 errors in browser console
- WebSocket connection establishes
- Session started event received

✅ **Audio Streaming:**
- Microphone audio captured
- Audio sent to agent
- Agent audio received and played

✅ **Transcript Display:**
- User speech transcribed
- Agent responses transcribed
- Transcript updates in real-time

✅ **Error Handling:**
- Graceful error messages
- No unhandled exceptions
- Connection cleanup on errors

---

## 📚 Reference Documentation

### AWS Official Documentation
- [AgentCore WebSocket Getting Started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-websocket.html)
- [Cognito Identity Provider Setup](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-idp-cognito.html)
- [AgentCore HTTP Protocol Contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html)

### Key Concepts

**WebSocket URL Format:**
```
wss://bedrock-agentcore.<region>.amazonaws.com/runtimes/<agentRuntimeArn>/ws
```

**Authentication Methods:**
1. SigV4 Headers
2. SigV4 Pre-signed URL (query parameters) ← We use this
3. OAuth Bearer Token

**Custom Headers:**
- Prefix: `X-Amzn-Bedrock-AgentCore-Runtime-Custom-`
- Can be passed as query parameters in WebSocket URL
- Received as lowercase headers in Python handler

**Session Management:**
- Header: `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`
- Provides session isolation
- Maintains conversation context

---

## 🚨 Common Pitfalls

### ❌ Don't Do This:
1. **Don't pass Cognito ID token as query parameter** - AgentCore doesn't validate it
2. **Don't use old API Gateway v2 URL** - It doesn't exist anymore
3. **Don't forget to sign WebSocket URL** - Connection will fail with 403
4. **Don't use synchronous boto3** - Use aioboto3 for async operations
5. **Don't forget environment variables** - PERSONA_TABLE_NAME, UPLOADS_BUCKET required

### ✅ Do This Instead:
1. **Use SigV4 pre-signed URL** - Works with browser WebSocket API
2. **Use AgentCore WebSocket URL** - From CloudFormation outputs
3. **Sign URL with temporary credentials** - From Cognito Identity Pool
4. **Use aioboto3 for AWS calls** - Async/await compatible
5. **Set environment variables in CDK** - Already configured in stack

---

## 📝 Commit Strategy

Make commits after each major section:

1. **After Issue #1 (Auth):**
   ```
   git add frontend/app/services/awsCredentials.ts frontend/app/services/websocketSigner.ts frontend/app/services/websocket.ts frontend/app/hooks/useQASession.ts backend/lib/backend-stack.ts
   git commit -m "Implement SigV4 WebSocket authentication with Cognito Identity Pool"
   ```

2. **After Issue #2 (URL):**
   ```
   git add frontend/.env.local
   git commit -m "Update WebSocket URL to AgentCore endpoint"
   ```

3. **After Issue #3 (Python):**
   ```
   git add backend/agentcore/index.py backend/agentcore/requirements.txt
   git commit -m "Complete Python handler with persona and transcript loading"
   ```

---

## ✅ Final Validation

Before marking complete, verify:

- [ ] All TypeScript files compile without errors
- [ ] All Python files have correct syntax
- [ ] CDK stack deploys successfully
- [ ] Frontend connects to WebSocket
- [ ] No 401/403 authentication errors
- [ ] Audio streaming works bidirectionally
- [ ] Transcript displays in real-time
- [ ] Session ends gracefully
- [ ] All commits made with clear messages

---

**End of Checklist**
