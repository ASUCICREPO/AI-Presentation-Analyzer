# AI Presentation Coach — Deployment Guide

This guide covers three deployment methods. Pick the one that fits your situation:

| Method | Best For | GitHub Account Required? | Effort |
| --- | --- | --- | --- |
| [1. GitHub CI/CD Mode](#method-1-github-cicd-mode-recommended) | Most users — automated builds on every push | Yes (with PAT) | Low |
| [2. Bare Mode (CodeBuild)](#method-2-bare-mode-codebuild) | Users without GitHub access or for public repos | No | Low |
| [3. Manual CDK](#method-3-manual-cdk-deployment) | Full control, custom environments | No | High (expertise needed) |

All three methods deploy four CloudFormation stacks:

| Stack | Purpose |
| --- | --- |
| `AmplifyHostingStack-{branch}` | Creates the Amplify App (with optional GitHub source) |
| `AIPresentationCoachStack-{branch}` | Backend: Cognito, API Gateway, Lambda, DynamoDB, S3, Bedrock Guardrail |
| `AgentCoreStack-{branch}` | Live Q&A bidirectional voice agent (Bedrock AgentCore) |
| `FrontendConfigStack-{branch}` | Wires backend outputs to the Amplify branch and configures auto-build |

---

## Common Prerequisites

These apply to **all three** deployment methods.

### AWS Account

- An active [AWS account](https://aws.amazon.com/) with permissions for:
  CloudFormation, IAM, Cognito, Lambda, API Gateway, DynamoDB, S3, Amplify,
  Bedrock (+ AgentCore), ECR, Secrets Manager, CloudWatch Logs, SSM, STS, CodeBuild (Methods 1 & 2 only).

> **Note**: `AdministratorAccess` is **not** required. Methods 1 and 2 automatically create a scoped IAM role with only the permissions listed above. For Method 3, ensure your IAM user/role has access to these services.

---

## Method 1: GitHub CI/CD Mode (Recommended)

Amplify connects directly to your GitHub repository and **auto-builds the frontend on every push**. This is the best experience for ongoing development — push code, Amplify deploys automatically.

### Additional Prerequisites

| Requirement | Details |
| --- | --- |
| GitHub Personal Access Token | A classic PAT with `repo` and `admin:repo_hook` scopes — [create one here](https://github.com/settings/tokens) |
| Access to AWS CloudShell | Log in to the [AWS Console](https://console.aws.amazon.com/) and click the CloudShell icon (terminal icon) in the top nav bar |

#### Creating a GitHub Personal Access Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Name it (e.g., `AI-Presentation-Coach-Deploy`)
4. Set an expiration (e.g., 90 days)
5. Select scopes:
   - `repo` — required for private repos and source access
   - `admin:repo_hook` — required for Amplify auto-build webhooks
6. Click **"Generate token"** and **copy it immediately** — you won't see it again

<details>
<summary>Using a fine-grained token instead</summary>

1. Go to [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Set the resource owner and select your repository
4. Under **Repository permissions**, grant:
   - **Contents**: Read-only
   - **Webhooks**: Read and write
5. Click **"Generate token"** and copy it

</details>

### Deployment Steps

#### 1. Fork the Repository

1. Navigate to the repository on GitHub
2. Click **"Fork"** in the top-right corner
3. Select your GitHub account as the destination
4. Wait for the fork to complete — you now have `https://github.com/YOUR-USERNAME/AI-Presentation-Analyzer`

#### 2. Open AWS CloudShell

1. Log in to the [AWS Console](https://console.aws.amazon.com/)
2. Click the **CloudShell icon** in the top navigation bar
3. Wait for the environment to initialize

#### 3. Clone Your Fork

```bash
git clone https://github.com/YOUR-USERNAME/AI-Presentation-Analyzer
cd AI-Presentation-Analyzer/
```

#### 4. Run the Deployment Script

```bash
./deploy.sh
```

#### 5. Follow the Prompts

| Prompt | What to Enter | Example |
| --- | --- | --- |
| GitHub repository | Auto-detected, confirm or enter `owner/repo` | `your-username/AI-Presentation-Analyzer` |
| Branch name | Auto-detected, confirm or enter manually | `main` |
| GitHub token | **Paste your PAT** (this is what enables GitHub CI/CD mode) | `ghp_xxxxxxxxxxxx` |

When you provide a GitHub token, the deployment runs in **GitHub mode**: Amplify connects to your repo, sets `NEXT_PUBLIC_*` environment variables on the branch, enables auto-build, and triggers the first build automatically.

#### 6. Monitor the Build

The script outputs direct links to the CodeBuild console and CloudWatch Logs. You can also navigate manually:

1. Go to **AWS Console > CodeBuild > Build projects**
2. Click on your project (e.g., `ai-presentation-coach-20260313...`)
3. Click the running build to view live logs
4. Wait for completion (typically 15–25 minutes)

### What Happens

1. `deploy.sh` creates an IAM role and CodeBuild project, then starts a build
2. CodeBuild clones your repo and runs `cdk deploy --all` with GitHub context params
3. CDK deploys all four stacks — the `FrontendConfigStack` sets environment variables on the Amplify branch and triggers an initial build
4. Amplify clones your repo, runs `npm ci && npm run build`, and hosts the frontend
5. On every future `git push`, Amplify auto-builds and redeploys the frontend

### Post-Deployment

No manual steps needed. The frontend is live once the Amplify build completes.

Access the app at the URL from the stack outputs:

```
https://<branch>.<amplify-app-id>.amplifyapp.com
```

---

## Method 2: Bare Mode (CodeBuild)

Use this method if you **don't have a GitHub PAT** or don't want Amplify CI/CD. CodeBuild handles everything: it deploys the backend via CDK, builds the Next.js frontend, and pushes the static export to Amplify — fully automated.

The trade-off: Amplify won't auto-build on push. To redeploy after code changes, re-run `./deploy.sh`.

### Additional Prerequisites

| Requirement | Details |
| --- | --- |
| Access to AWS CloudShell | Log in to the [AWS Console](https://console.aws.amazon.com/) and click the CloudShell icon in the top nav bar |

No GitHub token is required for public repositories. For private repos, you still need a PAT — in that case, use [Method 1](#method-1-github-cicd-mode-recommended) instead.

### Deployment Steps

#### 1. Open AWS CloudShell

1. Log in to the [AWS Console](https://console.aws.amazon.com/)
2. Click the **CloudShell icon** in the top navigation bar
3. Wait for the environment to initialize

#### 2. Clone the Repository

No fork is needed for bare mode — clone the original repository directly:

```bash
git clone https://github.com/ORIGINAL-OWNER/AI-Presentation-Analyzer
cd AI-Presentation-Analyzer/
```

#### 3. Run the Deployment Script

```bash
./deploy.sh
```

#### 4. Follow the Prompts

| Prompt | What to Enter | Example |
| --- | --- | --- |
| GitHub repository | Auto-detected, confirm or enter `owner/repo` | `your-username/AI-Presentation-Analyzer` |
| Branch name | Auto-detected, confirm or enter manually | `main` |
| GitHub token | **Press Enter to skip** (this is what triggers bare mode) | *(empty)* |

When you skip the GitHub token, the deployment runs in **bare mode**: CodeBuild builds the frontend itself and deploys it to Amplify via the `create-deployment` API.

#### 5. Monitor the Build

Same as Method 1 — the script outputs direct links:

1. Go to **AWS Console > CodeBuild > Build projects**
2. Click on your project
3. Watch live logs
4. Wait for completion (typically 15–25 minutes)

### What Happens

1. `deploy.sh` creates an IAM role and CodeBuild project, then starts a build
2. CodeBuild clones your repo and runs `cdk deploy --all` in bare mode (no GitHub context params)
3. CDK deploys all four stacks — the `FrontendConfigStack` creates the Amplify branch with `autoBuild` disabled
4. The buildspec's post_build phase extracts backend stack outputs, writes `.env.local`, runs `npm ci && npm run build`, and deploys the static export to Amplify
5. Personas are seeded into DynamoDB automatically

### Post-Deployment

No manual steps needed. The frontend is live once the CodeBuild build completes.

To **redeploy after code changes**, re-run `./deploy.sh` from CloudShell. The script creates a fresh CodeBuild build each time.

---

## Method 3: Manual CDK Deployment

Use this method if you need **full control** over the deployment process — custom regions, staged rollouts, debugging CDK locally, etc. Requires local tooling and CDK/CloudFormation expertise.

### Additional Prerequisites

| Tool | Version | Install |
| --- | --- | --- |
| AWS CLI | v2.x | [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| Node.js | v18.x+ | [nodejs.org](https://nodejs.org/) |
| npm | v9.x+ | Included with Node.js |
| AWS CDK | v2.x | `npm install -g aws-cdk` |
| Git | Latest | [git-scm.com](https://git-scm.com/downloads) |
| Docker | Latest | [docker.com](https://www.docker.com/get-started/) — required for the AgentCore container image |
| Python 3.13 + pip | 3.13.x | [python.org](https://www.python.org/) — required for bundling the boto3 Lambda layer |

### Deployment Steps

#### 1. Fork the Repository

1. Navigate to the repository on GitHub
2. Click **"Fork"** in the top-right corner
3. Select your GitHub account as the destination
4. Wait for the fork to complete — you now have `https://github.com/YOUR-USERNAME/AI-Presentation-Analyzer`

#### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR-USERNAME/AI-Presentation-Analyzer
cd AI-Presentation-Analyzer/
```

#### 3. Configure AWS Credentials

```bash
aws configure
```

Enter your AWS Access Key ID, Secret Access Key, default region (e.g., `us-east-1`), and output format (`json`).

#### 4. Install Backend Dependencies

```bash
cd backend
npm install
```

#### 5. Bootstrap CDK (First Time Only)

```bash
npx cdk bootstrap -c branchName=main
```

This creates the `CDKToolkit` stack with an S3 bucket and ECR repository for asset staging.

#### 6. Deploy All Stacks

```bash
npx cdk deploy --all -c branchName=main
```

When prompted, review the IAM changes and type `y` to confirm.

> **Optional — GitHub mode**: If you have a PAT and want Amplify auto-builds, pass the GitHub context params:
>
> ```bash
> npx cdk deploy --all \
>   -c branchName=main \
>   -c githubOwner=your-org \
>   -c githubRepo=your-repo \
>   -c githubToken=ghp_xxxxxxxxxxxx
> ```

#### 7. Note the Stack Outputs

After deployment, CDK prints outputs:

```text
AIPresentationCoachStack-main.UserPoolId = us-east-1_xxxxxxxx
AIPresentationCoachStack-main.UserPoolClientId = xxxxxxxxxxxxxxxxxxxxxxxxxx
AIPresentationCoachStack-main.IdentityPoolId = us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AIPresentationCoachStack-main.ApiUrl = https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/
AgentCoreStack-main.AgentCoreWebSocketUrl = wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/...
AmplifyHostingStack-main.AmplifyAppId = xxxxxxxxxx
FrontendConfigStack-main.AmplifyAppUrl = https://main.xxxxxxxxxx.amplifyapp.com
```

#### 8. Build and Deploy the Frontend

If you deployed with GitHub context params, Amplify handles the frontend automatically — skip this step.

If you deployed in bare mode (no GitHub params), you need to build and deploy the frontend manually:

**a. Create `frontend/.env.local`** with the stack outputs:

```env
NEXT_PUBLIC_COGNITO_REGION=us-east-1
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxx
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NEXT_PUBLIC_API_BASE_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/
NEXT_PUBLIC_WEBSOCKET_API_URL=wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/...
```

**b. Build the frontend:**

```bash
cd frontend
npm install
npm run build
```

**c. Deploy to Amplify:**

```bash
cd out
zip -r ../build.zip .
cd ..

DEPLOY=$(aws amplify create-deployment --app-id <AmplifyAppId> --branch-name main --output json)
URL=$(echo $DEPLOY | python3 -c "import sys,json; print(json.load(sys.stdin)['zipUploadUrl'])")
JOB=$(echo $DEPLOY | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")

curl -X PUT -T build.zip "$URL"
aws amplify start-deployment --app-id <AmplifyAppId> --branch-name main --job-id $JOB
```

Alternatively, upload `build.zip` through the Amplify console under **"Deploy without Git provider"**.

#### 9. Seed Personas (Optional)

Methods 1 and 2 seed personas automatically. For manual deployment, seed them yourself:

```bash
PERSONA_TABLE=$(aws cloudformation list-stack-resources \
  --stack-name AIPresentationCoachStack-main \
  --query "StackResourceSummaries[?contains(LogicalResourceId, 'UserPersonaTable')].PhysicalResourceId" \
  --output text)

# Then use the AWS Console or a script to put-item each persona from backend/persona/personas.json
```

---

## Local Development

For local development against a deployed backend, create `frontend/.env.local` with the stack outputs, then:

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:3000`. CORS is pre-configured to allow this origin.

---

## Verifying the Deployment

### 1. Check Stack Status

```bash
aws cloudformation describe-stacks \
  --stack-name AIPresentationCoachStack-main \
  --query 'Stacks[0].StackStatus' \
  --output text
```

Expected: `CREATE_COMPLETE` or `UPDATE_COMPLETE`

### 2. Test the API

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/personas
```

Expected: `401` (Cognito auth required — confirms the API is live)

### 3. Access the Frontend

Navigate to the Amplify URL from the stack outputs:

```
https://main.xxxxxxxxxx.amplifyapp.com
```

---

## Environment Variables Reference

### Frontend (NEXT_PUBLIC_*)

| Variable | Description | Source |
| --- | --- | --- |
| `NEXT_PUBLIC_COGNITO_REGION` | AWS region | Stack output: `Region` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID | Stack output: `UserPoolId` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito App Client ID | Stack output: `UserPoolClientId` |
| `NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID` | Cognito Identity Pool ID | Stack output: `IdentityPoolId` |
| `NEXT_PUBLIC_API_BASE_URL` | API Gateway base URL | Stack output: `ApiUrl` |
| `NEXT_PUBLIC_WEBSOCKET_API_URL` | AgentCore WebSocket URL | Stack output: `AgentCoreWebSocketUrl` |

### CDK Context Parameters

| Parameter | Required | Description |
| --- | --- | --- |
| `branchName` | Yes | Git branch name (used in stack names and Amplify branch) |
| `githubOwner` | No | GitHub org/user (enables GitHub mode when all three are set) |
| `githubRepo` | No | GitHub repository name |
| `githubToken` | No | GitHub PAT with `repo` scope |

### AgentCore Runtime

| Variable | Value | Description |
| --- | --- | --- |
| `VOICE_ID` | `matthew` | Amazon Polly voice for Q&A responses |
| `MODEL_ID` | `amazon.nova-2-sonic-v1:0` | Bedrock model for voice agent |
| `QA_ANALYTICS_MODEL_ID` | `global.amazon.nova-2-lite-v1:0` | Bedrock model for Q&A analytics |
| `PERSONA_TABLE_NAME` | *(auto)* | DynamoDB personas table |
| `UPLOADS_BUCKET` | *(auto)* | S3 uploads bucket |

---

## Cleanup

### Destroy CDK Stacks

```bash
cd backend
npx cdk destroy --all -c branchName=main
```

Or destroy individually in reverse order:

```bash
npx cdk destroy FrontendConfigStack-main -c branchName=main
npx cdk destroy AgentCoreStack-main -c branchName=main
npx cdk destroy AIPresentationCoachStack-main -c branchName=main
npx cdk destroy AmplifyHostingStack-main -c branchName=main
```

### Clean Up CodeBuild Resources (Methods 1 & 2)

If you deployed via `deploy.sh`, also remove the CodeBuild project and IAM role:

```bash
# Delete the CodeBuild project (name from the deploy script output)
aws codebuild delete-project --name ai-presentation-coach-YYYYMMDDHHMMSS

# Detach and delete the IAM role
ROLE_NAME="ai-presentation-coach-YYYYMMDDHHMMSS-role"
POLICY_ARN=$(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --query 'AttachedPolicies[0].PolicyArn' --output text)
aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY_ARN"
aws iam delete-policy --policy-arn "$POLICY_ARN"
aws iam delete-role --role-name "$ROLE_NAME"
```

### Remove CDK Bootstrap Stack (Optional)

```bash
aws cloudformation delete-stack --stack-name CDKToolkit
```

> **Warning**: Only do this if no other CDK apps use this account/region.

---

## Troubleshooting

### CodeBuild: Build Fails Immediately

**Cause**: IAM role propagation delay — the role was just created.

**Fix**: Re-run `./deploy.sh`. The role already exists and will be reused.

### CodeBuild: Cannot Clone Repository

**Cause**: GitHub token is expired or missing required scopes.

**Fix**:
- Verify your token at [github.com/settings/tokens](https://github.com/settings/tokens)
- Ensure the token has `repo` scope
- Re-run `./deploy.sh` and provide the token again

### Amplify: "Last job was not finished"

**Cause**: A previous Amplify deployment is still running when bare mode tries to create a new one.

**Fix**: The buildspec automatically stops stuck jobs before creating a new deployment. If it persists, manually stop the job in the Amplify console, then re-run the build.

### CDK: "This stack uses assets, so the toolkit stack must be deployed"

**Fix**:

```bash
cd backend
npx cdk bootstrap -c branchName=main
```

### CDK: Docker Not Running

**Cause**: The AgentCore stack builds a container image that requires Docker.

**Fix**: Start Docker Desktop. This is not an issue when deploying via CodeBuild (Methods 1 & 2) since privileged mode is enabled.

### CDK: Python/pip Not Found

**Cause**: The boto3 Lambda layer bundles with pip locally.

**Fix**: Install Python 3.13 and pip. If local bundling fails, CDK falls back to Docker. Not an issue via CodeBuild.

### Stack Stuck in ROLLBACK_COMPLETE

**Fix**:

```bash
aws cloudformation delete-stack --stack-name AIPresentationCoachStack-main
# Wait for deletion, then redeploy
```

### CORS Errors in Browser

**Cause**: The backend allows `http://localhost:3000` and the Amplify URL by default.

**Fix**: If using a different origin, update `allowedOrigins` in `backend-stack.ts` or pass them via CDK context.

### Amplify Build Fails (GitHub Mode)

**Fix**:
- Ensure `frontend/package-lock.json` is committed
- Check that the GitHub PAT has `repo` scope
- Verify the branch name matches an actual branch in the repository

---

## Architecture Reference

For a deeper dive into the system:

- [Architecture Deep Dive](./architectureDeepDive.md)
- [API Documentation](./APIDoc.md)
- [User Guide](./userGuide.md)
- [Modification Guide](./modificationGuide.md)
