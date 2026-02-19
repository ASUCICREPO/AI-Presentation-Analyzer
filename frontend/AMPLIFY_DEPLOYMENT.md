# Amplify Deployment Guide

This document explains how to deploy the frontend to AWS Amplify using the CDK stack.

## Overview

The frontend is configured to deploy to AWS Amplify Hosting with automatic environment variable injection from the backend CDK stack. This means you don't need to manually configure environment variables - they're automatically passed from your backend infrastructure.

## Prerequisites

1. Backend CDK stack must be deployed first (to get Cognito, API Gateway, and AgentCore URLs)
2. AWS CLI configured with appropriate credentials
3. Node.js and npm installed

## Deployment Steps

### 1. Uncomment Amplify Construct in CDK Stack

In `backend/lib/backend-stack.ts`, find the commented Amplify section (around line 475) and uncomment it:

```typescript
// Remove the /* at the start and */ at the end of the Amplify section
const amplifyApp = new amplify.CfnApp(this, 'FrontendApp', {
  // ... rest of the configuration
});
```

### 2. Deploy the Updated Stack

```bash
cd backend
npm run build
cdk deploy
```

This will create:
- Amplify App
- Amplify Branch (main)
- Automatic environment variable injection

### 3. Get Amplify App ID from Outputs

After deployment, note the `AmplifyAppId` from the CloudFormation outputs:

```
Outputs:
AIPresentationCoachStack.AmplifyAppId = d123abc456def
AIPresentationCoachStack.AmplifyAppUrl = https://main.d123abc456def.amplifyapp.com
```

### 4. Deploy Frontend Code to Amplify

Use the AWS CLI to create a deployment:

```bash
cd frontend

# Create a zip of the frontend code
# On Windows PowerShell:
Compress-Archive -Path * -DestinationPath ../frontend-deploy.zip -Force

# On Linux/Mac:
# zip -r ../frontend-deploy.zip . -x "node_modules/*" ".next/*"

# Deploy to Amplify
aws amplify create-deployment \
  --app-id <YOUR_APP_ID> \
  --branch-name main \
  --region us-east-1
```

This will return a `jobId` and an S3 upload URL. Upload your zip file to that URL, then start the deployment:

```bash
aws amplify start-deployment \
  --app-id <YOUR_APP_ID> \
  --branch-name main \
  --job-id <JOB_ID> \
  --region us-east-1
```

### 5. Monitor Deployment

Check deployment status:

```bash
aws amplify get-job \
  --app-id <YOUR_APP_ID> \
  --branch-name main \
  --job-id <JOB_ID> \
  --region us-east-1
```

Or visit the Amplify Console in AWS:
https://console.aws.amazon.com/amplify/home?region=us-east-1

## Environment Variables

The following environment variables are automatically injected by the CDK stack:

| Variable                                  | Source                   | Description                |
| ----------------------------------------- | ------------------------ | -------------------------- |
| `NEXT_PUBLIC_COGNITO_REGION`              | CDK Stack                | AWS Region                 |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID`        | Cognito User Pool        | User Pool ID               |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito User Pool Client | Client ID                  |
| `NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID`    | Cognito Identity Pool    | Identity Pool ID           |
| `NEXT_PUBLIC_API_BASE_URL`                | API Gateway              | REST API URL               |
| `NEXT_PUBLIC_WEBSOCKET_API_URL`           | AgentCore Runtime        | WebSocket URL for Live Q&A |

These are automatically kept in sync with your backend infrastructure - no manual updates needed!

## Local Development

For local development, continue using `frontend/.env.local`:

```bash
cd frontend
npm run dev
```

The `.env.local` file is gitignored and used only for local development.

## Troubleshooting

### Build Fails on Amplify

Check the build logs in the Amplify Console. Common issues:
- Missing dependencies in `package.json`
- TypeScript errors
- Environment variables not being read correctly

### Environment Variables Not Working

Verify they're set in the Amplify Console:
1. Go to Amplify Console
2. Select your app
3. Go to "Environment variables" in the left sidebar
4. Verify all `NEXT_PUBLIC_*` variables are present

### WebSocket Connection Fails

1. Verify the `NEXT_PUBLIC_WEBSOCKET_API_URL` is correct
2. Check that AgentCore Runtime is deployed and healthy
3. Verify Cognito authentication is working (check browser console for auth errors)

## Manual Deployment Alternative

If you prefer to use the Amplify Console UI:

1. Go to AWS Amplify Console
2. Select your app
3. Click "Deploy" → "Deploy without Git provider"
4. Upload the frontend code as a zip file
5. Amplify will automatically build and deploy

## Updating Environment Variables

If backend URLs change (e.g., after redeploying the stack):

1. Redeploy the CDK stack: `cdk deploy`
2. The environment variables in Amplify are automatically updated
3. Trigger a new Amplify build to pick up the changes:
   ```bash
   aws amplify start-job \
     --app-id <YOUR_APP_ID> \
     --branch-name main \
     --job-type RELEASE \
     --region us-east-1
   ```

## Cost Considerations

- Amplify Hosting: ~$0.01 per build minute + $0.15/GB served
- Free tier: 1000 build minutes/month + 15 GB served/month
- Typical build time: 3-5 minutes
- For a student project with low traffic, costs should be minimal (<$5/month)
