# Deployment Guide

This project uses a one-click deployment script that handles all steps required to deploy the AWS infrastructure, including building Lambda layer dependencies.

## Prerequisites

- **Docker**: Required for building Lambda dependencies for ARM64 architecture
- **AWS CLI**: Configured with appropriate credentials
- **Node.js/npm**: For CDK deployment
- **Git**: For version control

Ensure Docker is running before starting deployment.

## One-Click Deployment

### On macOS/Linux:

```bash
chmod +x deploy.sh
./deploy.sh
```

### On Windows (PowerShell):

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\deploy.ps1
```

## What the Deploy Script Does

1. **Builds Lambda Layer Dependencies**
   - Creates the proper directory structure: `backend/agentcore/python/lib/python3.12/site-packages/`
   - Uses AWS Lambda Python 3.12 Docker image to install dependencies from `requirements.txt`
   - Ensures dependencies are compiled for ARM64 architecture (matching CDK configuration)

2. **Builds TypeScript CDK Code**
   - Installs npm dependencies if needed
   - Compiles TypeScript to JavaScript

3. **Deploys AWS Stack**
   - Runs `cdk deploy` with default flags (`--require-approval never`)
   - Creates/updates all AWS resources (S3, Lambda, DynamoDB, Cognito, API Gateway, WebSocket, etc.)

## Deployment with Custom CDK Options

To customize CDK deployment options:

### On macOS/Linux:

```bash
./deploy.sh --require-approval broadening
./deploy.sh --profile my-aws-profile
```

### On Windows PowerShell:

```powershell
.\deploy.ps1 -CdkArgs @('--require-approval', 'broadening')
.\deploy.ps1 -CdkArgs @('--profile', 'my-aws-profile')
```

## Layer Structure

The Lambda layer is built with the following structure:

```
backend/agentcore/python/
├── lib/
│   └── python3.12/
│       └── site-packages/
│           ├── strands_agents/
│           ├── pydantic/
│           ├── boto3/
│           └── ... (all dependencies)
```

This structure is automatically created by the deploy script and is compatible with AWS Lambda's layer expectations.

## Git and Layer Dependencies

The `python/` directory inside `backend/agentcore/` is excluded from git (see `.gitignore`).

**Why?** Layer dependencies are built on-demand during deployment for the correct architecture. This keeps the repository smaller and avoids architecture-specific binaries.

**Workflow:**
1. Modify `backend/agentcore/requirements.txt` as needed
2. Run `./deploy.sh` (or `.\deploy.ps1` on Windows)
3. The script rebuilds the layer automatically
4. Only commit `requirements.txt` changes to git (not the built `python/` directory)

## Troubleshooting

### Docker Connection Error
**Error:** `Cannot connect to the Docker daemon`

**Solution:** Ensure Docker Desktop (macOS/Windows) or Docker daemon (Linux) is running.

### Layer Build Failure
**Error:** `pip install` fails during layer build

**Solution:**
- Check `backend/agentcore/requirements.txt` for valid package names and versions
- Verify all packages support Python 3.12 and ARM64 architecture

### CDK Deploy Fails
**Error:** `cdk deploy` fails with permission errors

**Solution:**
- Verify AWS credentials: `aws sts get-caller-identity`
- Ensure IAM user has CloudFormation and service permissions
- Check AWS region: `aws configure get region`

### Permission Denied on deploy.sh (macOS/Linux)
**Error:** `./deploy.sh: Permission denied`

**Solution:** Make the script executable:
```bash
chmod +x deploy.sh
```

## Manual Steps (If Needed)

If you prefer to run steps manually:

```bash
# Step 1: Build layer
cd backend/agentcore
mkdir -p python/lib/python3.12/site-packages
docker run --rm \
  --platform linux/arm64 \
  --volume $(pwd)/requirements.txt:/tmp/requirements.txt:ro \
  --volume $(pwd)/python/lib/python3.12/site-packages:/tmp/site-packages \
  public.ecr.aws/lambda/python:3.12 \
  pip install -r /tmp/requirements.txt -t /tmp/site-packages

# Step 2: Build CDK
cd ../..
cd backend
npm install
npm run build

# Step 3: Deploy
npx cdk deploy --require-approval never
```

## Stack Outputs

After successful deployment, CDK outputs include:
- **UserPoolId**: Cognito User Pool ID
- **UserPoolClientId**: Cognito User Pool Client ID
- **IdentityPoolId**: Cognito Identity Pool ID
- **Region**: AWS Region deployed to
- **WebSocketApiUrl**: WebSocket API endpoint for Live Q&A sessions

These outputs are displayed in the console after deployment.

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/latest/guide/)
- [Lambda Layers](https://docs.aws.amazon.com/lambda/latest/dg/chapter-layers.html)
- [AWS Lambda Python Runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html)
