#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AmplifyHostingStack } from '../lib/amplify-hosting-stack';
import { AIPresentationCoachStack } from '../lib/backend-stack';
import { AgentCoreStack } from '../lib/agentcore-stack';
import { FrontendConfigStack } from '../lib/frontend-config-stack';

const app = new cdk.App();

// ──────────────────────────────────────────────────────────
// All configuration lives here — one place to change.
//
// Deploy order (handled automatically by `cdk deploy --all`):
//   1. AmplifyHostingStack  → creates Amplify App, gets appId + domain
//   2. BackendStack         → uses Amplify URL for CORS
//   3. AgentCoreStack       → live Q&A agent (depends on backend Cognito, DynamoDB, S3)
//   4. FrontendConfigStack  → adds branch (+ env vars in GitHub mode)
//
// GitHub mode (Amplify builds from source on push):
//   cdk deploy --all -c branchName=master \
//     -c githubOwner=my-org -c githubRepo=my-repo -c githubToken=ghp_xxx
//
// Bare mode (deploy script pushes built artifacts to Amplify):
//   cdk deploy --all -c branchName=master
// ──────────────────────────────────────────────────────────

function requireContext(key: string): string {
  const value = app.node.tryGetContext(key);
  if (!value) {
    throw new Error(`Missing required context: -c ${key}=<value>`);
  }
  return value as string;
}

const config = {
  branchName:  requireContext('branchName'),

  // Optional — provide all three for GitHub CI/CD mode, omit for bare/script mode
  githubOwner: app.node.tryGetContext('githubOwner') as string | undefined,
  githubRepo:  app.node.tryGetContext('githubRepo')  as string | undefined,
  githubToken: app.node.tryGetContext('githubToken') as string | undefined,
};

const useGitHub = !!(config.githubOwner && config.githubRepo && config.githubToken);

// ──────────────────────────────────────────────
// 1. Amplify App shell (with or without GitHub source)
// ──────────────────────────────────────────────
const amplifyHosting = new AmplifyHostingStack(app, `AmplifyHostingStack-${config.branchName}`, {
  description: `Amplify App for ${config.branchName}`,
  branchName:  config.branchName,
  githubOwner: config.githubOwner,
  githubRepo:  config.githubRepo,
  githubToken: config.githubToken,
});

// ──────────────────────────────────────────────
// 2. Backend — CORS locked to localhost + Amplify URL
// ──────────────────────────────────────────────
const amplifyAppUrl = cdk.Fn.join('', [
  'https://',
  config.branchName,
  '.',
  amplifyHosting.defaultDomain,
]);

const backend = new AIPresentationCoachStack(app, `AIPresentationCoachStack-${config.branchName}`, {
  allowedOrigins: ['http://localhost:3000', amplifyAppUrl],
});

// ──────────────────────────────────────────────
// 3. AgentCore — live Q&A WebSocket agent
// ──────────────────────────────────────────────
const agentCore = new AgentCoreStack(app, `AgentCoreStack-${config.branchName}`, {
  description: `Live Q&A AgentCore runtime for ${config.branchName}`,
  userPool:          backend.userPool,
  userPoolClient:    backend.userPoolClient,
  authenticatedRole: backend.authenticatedRole,
  personasTable:     backend.personasTable,
  uploadsBucket:     backend.uploadsBucket,
});

// ──────────────────────────────────────────────
// 4. Frontend config — adds branch to the Amplify App
// ──────────────────────────────────────────────
new FrontendConfigStack(app, `FrontendConfigStack-${config.branchName}`, {
  description: `Frontend branch config for ${config.branchName}`,
  amplifyAppId:          amplifyHosting.appId,
  amplifyDefaultDomain:  amplifyHosting.defaultDomain,
  branchName:            config.branchName,
  useGitHub,
  apiUrl:                backend.apiUrl,
  userPoolId:            backend.userPoolId,
  userPoolClientId:      backend.userPoolClientId,
  identityPoolId:        backend.identityPoolId,
  agentCoreWebSocketUrl: agentCore.webSocketUrl,
});

// Security scanning
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
