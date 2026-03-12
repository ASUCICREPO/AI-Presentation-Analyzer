# AI Presentation Coach — Deployment Guide

This guide covers two deployment methods:

1. **Automated deployment** using the `deploy.sh` script and AWS CodeBuild (recommended)
2. **Manual deployment** using AWS CDK directly from your local machine

Both methods deploy four CloudFormation stacks:

| Stack                               | Purpose                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `AmplifyHostingStack-{branch}`      | Creates the Amplify App (with optional GitHub CI/CD)                   |
| `AIPresentationCoachStack-{branch}` | Backend: Cognito, API Gateway, Lambda, DynamoDB, S3, Bedrock Guardrail |
| `AgentCoreStack-{branch}`           | Live Q&A bidirectional voice agent (Bedrock AgentCore)                 |
| `FrontendConfigStack-{branch}`      | Wires backend outputs to the Amplify branch as environment variables   |

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Creating a GitHub Personal Access Token](#creating-a-github-personal-access-token)
- [Deployment Modes](#deployment-modes)
- [Option A: Automated Deployment (deploy.sh + CodeBuild)](#option-a-automated-deployment-deploysh--codebuild)
- [Option B: Manual Deployment (CDK CLI)](#option-b-manual-deployment-cdk-cli)
- [Post-Deployment: Frontend Configuration](#post-deployment-frontend-configuration)
- [Verifying the Deployment](#verifying-the-deployment)
- [Environment Variables Reference](#environment-variables-reference)
- [Cleanup](#cleanup)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Accounts

- **AWS Account** — [Create one here](https://aws.amazon.com/)
- **GitHub Account** — optional; only needed if you want Amplify to auto-build on every push (GitHub mode). Not required for automated or bare-mode deployment with public repositories.

### For Automated Deployment (deploy.sh)

| Requirement                                | Details                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access to AWS CloudShell                   | Log in to the [AWS Console](https://console.aws.amazon.com/) and click the CloudShell icon in the top navigation bar.                                                         |
| AWS account with necessary IAM permissions | Needs permissions for IAM, CloudFormation, CodeBuild, STS, and all services listed under [AWS Permissions](#aws-permissions). `AdministratorAccess` simplifies initial setup. |

### For Manual Deployment (CDK CLI)

| Tool              | Version | Install                                                                                                 |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| AWS CLI           | v2.x    | [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)          |
| Node.js           | v18.x+  | [nodejs.org](https://nodejs.org/)                                                                       |
| npm               | v9.x+   | Included with Node.js                                                                                   |
| AWS CDK           | v2.x    | `npm install -g aws-cdk`                                                                                |
| Git               | Latest  | [git-scm.com](https://git-scm.com/downloads)                                                            |
| Docker            | Latest  | [docker.com](https://www.docker.com/get-started/) — required for building the AgentCore container image |
| Python 3.13 + pip | 3.13.x  | [python.org](https://www.python.org/) — required for bundling the boto3 Lambda layer                    |

### AWS Permissions

The deploying IAM user/role needs permissions for:

- CloudFormation (full stack management)
- IAM (roles, policies)
- Cognito (User Pool, Identity Pool)
- Lambda (functions, layers)
- API Gateway (REST API)
- DynamoDB (tables)
- S3 (buckets)
- Amplify (app hosting)
- Bedrock (guardrails, model access)
- Bedrock AgentCore (runtime)
- ECR (container image push)
- CloudWatch Logs
- Secrets Manager (GitHub token storage in GitHub mode)
- CodeBuild (automated deployment only)
- STS (caller identity — used by `deploy.sh`)

> **Tip**: For initial deployment, `AdministratorAccess` simplifies setup. Scope down permissions for production.

---

## Creating a GitHub Personal Access Token

A GitHub Personal Access Token (PAT) is only needed when:

- Your repository is **private** (required for both deployment methods)
- You want **GitHub mode** where Amplify auto-builds on every push

> **Note**: If your repository is public and you don't need Amplify CI/CD, you can skip this section entirely. The automated deployment works without a GitHub account for public repos.

### Steps to Create a Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a descriptive name (e.g., `AI-Presentation-Coach-Deploy`)
4. Set an expiration (e.g., 90 days)
5. Select the following scopes:
   - `repo` (Full control of private repositories) — required for private repos
   - `admin:repo_hook` (Full control of repository hooks) — required for Amplify auto-build webhooks in GitHub mode
6. Click **"Generate token"**
7. **Copy the token immediately** — you won't be able to see it again

> **Important**: Store your token securely. Do not commit it to your repository. The `deploy.sh` script uses `read -s` to accept the token without echoing it to the terminal.

### Using a Fine-Grained Token (Alternative)

If you prefer fine-grained tokens:

1. Go to [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Set the resource owner and select your repository
4. Under **Repository permissions**, grant:
   - **Contents**: Read-only
   - **Webhooks**: Read and write (for Amplify auto-build)
5. Click **"Generate token"** and copy it

---

## Deployment Modes

The CDK app supports two modes controlled by context parameters:

### GitHub Mode (CI/CD)

Amplify connects to your GitHub repository and auto-builds the frontend on every push. Requires a GitHub PAT.

```bash
cdk deploy --all \
  -c branchName=main \
  -c githubOwner=your-org \
  -c githubRepo=your-repo \
  -c githubToken=ghp_xxxxxxxxxxxx
```

### Bare Mode (Automated Deploy)

Amplify creates the app shell without a source provider. When using `deploy.sh`, CodeBuild automatically builds the frontend and deploys it to Amplify — no manual steps needed. No GitHub PAT required for public repos.

```bash
cdk deploy --all -c branchName=main
```

---

## Option A: Automated Deployment (deploy.sh + CodeBuild)

This is the **recommended deployment method**. The `deploy.sh` script automates the entire process by creating an AWS CodeBuild project that clones your repository and runs `cdk deploy --all`, then builds and deploys the frontend to Amplify automatically.

### What the Script Does

1. Detects your AWS region and account ID from CLI config (or EC2 metadata in CloudShell)
2. Prompts for GitHub repository (`owner/repo`), branch name, and optional GitHub PAT
3. Creates an IAM service role for CodeBuild with `AdministratorAccess` (if it doesn't exist)
4. Imports GitHub credentials into CodeBuild (for private repos only)
5. Creates a CodeBuild project named `ai-presentation-coach-deployer` (if it doesn't exist)
6. Starts a build that runs the `buildspec-deploy.yml` pipeline

### Step-by-Step

#### 1. Open AWS CloudShell (Recommended)

1. Log in to the [AWS Console](https://console.aws.amazon.com/)
2. Click the **CloudShell icon** (terminal icon) in the top navigation bar
3. Wait for the environment to initialize

> Alternatively, use any terminal with bash and the AWS CLI configured.

#### 2. Clone Your Repository

```bash
git clone https://github.com/YOUR-USERNAME/AI-Presentation-Coach
cd AI-Presentation-Coach/
```

> Replace `YOUR-USERNAME` with your actual GitHub username or organization.

#### 3. Run the Deployment Script

```bash
chmod +x deploy.sh
./deploy.sh
```

#### 4. Follow the Prompts

The script will ask for three inputs:

| Prompt            | Description                                            | Example                               |
| ----------------- | ------------------------------------------------------ | ------------------------------------- |
| GitHub repository | Your repo in `owner/repo` format                       | `your-username/AI-Presentation-Coach` |
| Branch name       | The branch to deploy                                   | `main`                                |
| GitHub token      | PAT for private repos (press Enter to skip for public) | `ghp_xxxxxxxxxxxx`                    |

```text
Enter GitHub repository (format: owner/repo):
> your-username/AI-Presentation-Coach

Enter branch name (e.g., main, develop, feature/new-ui):
> main

Enter GitHub Personal Access Token (optional, press Enter to skip):
>
```

- If you provide a GitHub token, the deployment runs in **GitHub mode** (Amplify auto-builds from source on every push)
- If you skip the token, the deployment runs in **bare mode** (CodeBuild builds the frontend and deploys it to Amplify automatically — fully automated, no manual steps needed)

#### 5. Monitor the Build

The script outputs direct links to the CodeBuild console and CloudWatch Logs. You can also monitor manually:

1. Go to **AWS Console > CodeBuild > Build projects**
2. Click on `ai-presentation-coach-deployer`
3. Click on the running build to view logs
4. Wait for the build to complete (typically 15–25 minutes)

### What the Build Does (buildspec-deploy.yml)

| Phase          | Actions                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **install**    | Installs Node.js 18 and zip utility                                                                                                              |
| **pre_build**  | Validates env vars, `cd backend && npm install`, runs `cdk bootstrap`                                                                            |
| **build**      | Runs `cdk deploy --all --require-approval never`                                                                                                 |
| **post_build** | Prints stack outputs. In bare mode: builds the frontend, creates an Amplify deployment, and deploys the static export directly — fully automated |

### CodeBuild Configuration

| Setting         | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Project name    | `ai-presentation-coach-deployer`                        |
| Compute type    | `BUILD_GENERAL1_SMALL`                                  |
| Image           | `aws/codebuild/amazonlinux2-aarch64-standard:3.0` (ARM) |
| Privileged mode | Enabled (required for Docker builds)                    |
| Timeout         | 60 minutes                                              |

### Stack Naming Convention

The branch name is sanitized and used in the stack name:

- Branch `main` → Stack `AIPresentationCoachStack-main`
- Branch `feature/new-ui` → Stack `AIPresentationCoachStack-feature-new-ui`

This allows multiple branches to be deployed side-by-side in the same account.

---

## Option B: Manual Deployment (CDK CLI)

Use this method if you prefer to deploy from your local machine.

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR-USERNAME/AI-Presentation-Coach
cd AI-Presentation-Coach/
```

### Step 2: Configure AWS Credentials

```bash
aws configure
```

Enter your AWS Access Key ID, Secret Access Key, default region (e.g., `us-east-1`), and output format (`json`).

### Step 3: Install Backend Dependencies

```bash
cd backend
npm install
```

### Step 4: Bootstrap CDK (First Time Only)

```bash
npx cdk bootstrap -c branchName=main
```

> **Note**: The `-c branchName` context parameter is required for bootstrap. If deploying in GitHub mode, include all context parameters:
> ```bash
> npx cdk bootstrap -c branchName=main -c githubOwner=your-org -c githubRepo=your-repo -c githubToken=ghp_xxxxxxxxxxxx
> ```

This creates the CDKToolkit stack with an S3 bucket and ECR repository that CDK uses for asset staging.

### Step 5: Synthesize (Optional — Review Before Deploy)

```bash
npx cdk synth -c branchName=main
```

This generates CloudFormation templates in `cdk.out/` without deploying. Review them to verify the resources.

### Step 6: Deploy All Stacks

**Bare mode** (no GitHub CI/CD — you'll deploy the frontend manually):

```bash
npx cdk deploy --all -c branchName=main
```

**GitHub mode** (Amplify auto-builds from your repo):

```bash
npx cdk deploy --all \
  -c branchName=main \
  -c githubOwner=your-org \
  -c githubRepo=your-repo \
  -c githubToken=ghp_xxxxxxxxxxxx
```

When prompted, review the IAM changes and type `y` to confirm.

### Step 7: Note the Stack Outputs

After deployment, CDK prints outputs like:

```text
AIPresentationCoachStack-main.UserPoolId = us-east-1_xxxxxxxx
AIPresentationCoachStack-main.UserPoolClientId = xxxxxxxxxxxxxxxxxxxxxxxxxx
AIPresentationCoachStack-main.IdentityPoolId = us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AIPresentationCoachStack-main.Region = us-east-1
AIPresentationCoachStack-main.ApiUrl = https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/
AgentCoreStack-main.AgentCoreWebSocketUrl = wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn:aws:bedrock-agentcore:...
AmplifyHostingStack-main.AmplifyAppId = xxxxxxxxxx
FrontendConfigStack-main.AmplifyAppUrl = https://main.xxxxxxxxxx.amplifyapp.com
```

Save these — you'll need them for frontend configuration (bare mode) or local development.

---

## Post-Deployment: Frontend Configuration

### GitHub Mode

No manual frontend configuration needed. The `FrontendConfigStack` automatically sets all `NEXT_PUBLIC_*` environment variables on the Amplify branch, and Amplify builds the frontend from source.

### Bare Mode (Automated via deploy.sh)

If you deployed using `deploy.sh` without a GitHub token, CodeBuild handles everything automatically:
1. Deploys all four backend stacks via CDK
2. Extracts backend stack outputs (Cognito, API Gateway, WebSocket URLs)
3. Builds the Next.js frontend with those values baked in
4. Deploys the frontend directly to Amplify via the create-deployment API

No manual steps are required — the frontend is live once the build completes.

### Bare Mode (Manual CDK Deployment — Option B)

If you deployed manually using `cdk deploy` (Option B), Amplify doesn't build from source. You need to:

1. **Create `frontend/.env.local`** with the stack outputs:

   ```env
   NEXT_PUBLIC_COGNITO_REGION=us-east-1
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxx
   NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
   NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   NEXT_PUBLIC_API_BASE_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod
   NEXT_PUBLIC_WEBSOCKET_API_URL=wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn:aws:bedrock-agentcore:...
   ```

2. **Build the frontend**:

   ```bash
   cd frontend
   npm install
   npm run build
   ```

   This produces a static export in `frontend/out/`.

3. **Deploy to Amplify** using the Amplify console or CLI:

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

   Alternatively, upload `build.zip` through the Amplify console under "Deploy without Git provider".

### Local Development

For local development, create `frontend/.env.local` with the same values as above, then:

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:3000`. CORS is pre-configured to allow `http://localhost:3000`.

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
# This should return a 401 (Cognito auth required) — confirms the API is live
curl -s -o /dev/null -w "%{http_code}" \
  https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/personas
```

Expected: `401`

### 3. Verify Cognito User Pool

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id us-east-1_xxxxxxxx \
  --query 'UserPool.Status' \
  --output text
```

### 4. Check AgentCore Runtime

```bash
aws cloudformation describe-stacks \
  --stack-name AgentCoreStack-main \
  --query 'Stacks[0].Outputs' \
  --output table
```

### 5. Access the Frontend

Navigate to the Amplify URL from the stack outputs:

```text
https://main.xxxxxxxxxx.amplifyapp.com
```

---

## Environment Variables Reference

### Frontend Environment Variables (NEXT_PUBLIC_*)

| Variable                                  | Description              | Source                                |
| ----------------------------------------- | ------------------------ | ------------------------------------- |
| `NEXT_PUBLIC_COGNITO_REGION`              | AWS region for Cognito   | Stack output: `Region`                |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID`        | Cognito User Pool ID     | Stack output: `UserPoolId`            |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito App Client ID    | Stack output: `UserPoolClientId`      |
| `NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID`    | Cognito Identity Pool ID | Stack output: `IdentityPoolId`        |
| `NEXT_PUBLIC_API_BASE_URL`                | API Gateway base URL     | Stack output: `ApiUrl`                |
| `NEXT_PUBLIC_WEBSOCKET_API_URL`           | AgentCore WebSocket URL  | Stack output: `AgentCoreWebSocketUrl` |

### CDK Context Parameters

| Parameter     | Required | Description                                              |
| ------------- | -------- | -------------------------------------------------------- |
| `branchName`  | Yes      | Git branch name (used in stack names and Amplify branch) |
| `githubOwner` | No       | GitHub org/user (enables GitHub mode)                    |
| `githubRepo`  | No       | GitHub repository name                                   |
| `githubToken` | No       | GitHub PAT with `repo` scope                             |

### AgentCore Runtime Environment Variables

| Variable                | Value                            | Description                          |
| ----------------------- | -------------------------------- | ------------------------------------ |
| `VOICE_ID`              | `matthew`                        | Amazon Polly voice for Q&A responses |
| `MODEL_ID`              | `amazon.nova-2-sonic-v1:0`       | Bedrock model for voice agent        |
| `QA_ANALYTICS_MODEL_ID` | `global.amazon.nova-2-lite-v1:0` | Bedrock model for Q&A analytics      |
| `PERSONA_TABLE_NAME`    | (auto)                           | DynamoDB personas table              |
| `UPLOADS_BUCKET`        | (auto)                           | S3 uploads bucket                    |

---

## Cleanup

### Using deploy.sh (Automated)

The `deploy.sh` script only deploys — to destroy, use CDK directly:

```bash
cd backend
npx cdk destroy --all -c branchName=main
```

Then clean up the CodeBuild resources:

```bash
# Delete the CodeBuild project
aws codebuild delete-project --name ai-presentation-coach-deployer

# Delete the IAM role
aws iam detach-role-policy \
  --role-name ai-presentation-coach-deployer-role \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
aws iam delete-role --role-name ai-presentation-coach-deployer-role

# Remove GitHub source credentials (optional)
CRED_ARN=$(aws codebuild list-source-credentials \
  --query 'sourceCredentialsInfos[?serverType==`GITHUB`].arn' \
  --output text)
aws codebuild delete-source-credentials --arn "$CRED_ARN"
```

### Using CDK Directly

```bash
cd backend

# Destroy in reverse dependency order
npx cdk destroy FrontendConfigStack-main -c branchName=main
npx cdk destroy AgentCoreStack-main -c branchName=main
npx cdk destroy AIPresentationCoachStack-main -c branchName=main
npx cdk destroy AmplifyHostingStack-main -c branchName=main

# Or destroy all at once
npx cdk destroy --all -c branchName=main
```

### Remove CDK Bootstrap Stack (optional)

```bash
aws cloudformation delete-stack --stack-name CDKToolkit
```

> **Warning**: Only do this if no other CDK apps use this account/region.

---

## Troubleshooting

### CDK Bootstrap Error

**Symptom**: `This stack uses assets, so the toolkit stack must be deployed`

**Fix**:

```bash
cd backend
npx cdk bootstrap -c branchName=main
```

### Docker Not Running

**Symptom**: `Cannot connect to the Docker daemon` during `cdk deploy`

**Fix**: Start Docker Desktop. The AgentCore stack builds a container image that requires Docker. This is handled automatically in CodeBuild (privileged mode is enabled).

### IAM Role Propagation Delay

**Symptom**: CodeBuild fails immediately after `deploy.sh` creates the IAM role

**Fix**: The script waits 10 seconds for propagation. If it still fails, re-run `./deploy.sh` — the role already exists and will be reused.

### GitHub Token Errors

**Symptom**: CodeBuild cannot clone the repository

**Fix**:

- Verify your token hasn't expired at [github.com/settings/tokens](https://github.com/settings/tokens)
- Ensure the token has `repo` scope
- For fine-grained tokens, ensure **Contents: Read-only** is granted for the correct repository
- Re-run `./deploy.sh` and provide the token again — it will re-import credentials

### Amplify Build Fails in GitHub Mode

**Symptom**: Amplify build fails with `npm ci` errors

**Fix**:

- Ensure `frontend/package-lock.json` is committed to the repo
- Check that the GitHub PAT has `repo` scope
- Verify the branch name matches an actual branch in the repository

### Stack Stuck in ROLLBACK_COMPLETE

**Symptom**: `cdk deploy` fails because a previous deployment left the stack in `ROLLBACK_COMPLETE`

**Fix**:

```bash
aws cloudformation delete-stack --stack-name AIPresentationCoachStack-main
# Wait for deletion, then redeploy
npx cdk deploy --all -c branchName=main
```

### CORS Errors in Browser

**Symptom**: `Access-Control-Allow-Origin` errors in the browser console

**Fix**: The backend allows `http://localhost:3000` and the Amplify URL. If using a different origin, update the `allowedOrigins` in `backend-stack.ts` or pass them via CDK context.

### Python/pip Not Found (Lambda Layer Build)

**Symptom**: `pip3: command not found` during CDK synth/deploy

**Fix**: Install Python 3.13 and pip. The boto3 Lambda layer uses local bundling with pip. If local bundling fails, CDK falls back to Docker bundling automatically. This is not an issue when deploying via CodeBuild.

---

## Architecture Reference

For a deeper dive into the system architecture, see:

- [Architecture Deep Dive](./architectureDeepDive.md)
- [API Documentation](./APIDoc.md)
- [User Guide](./userGuide.md)
- [Modification Guide](./modificationGuide.md)
