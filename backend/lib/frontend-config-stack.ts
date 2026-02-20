import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as amplify_cfn from 'aws-cdk-lib/aws-amplify';

export interface FrontendConfigStackProps extends cdk.StackProps {
  amplifyAppId: string;
  amplifyDefaultDomain: string;
  branchName: string;

  /**
   * When true (GitHub mode), sets NEXT_PUBLIC_* env vars on the branch and
   * enables autoBuild so Amplify builds from source on every push.
   * When false (bare mode), creates the branch with autoBuild off — a deploy
   * script handles building and pushing artifacts via create-deployment API.
   */
  useGitHub: boolean;

  /** Backend outputs — only wired to the branch in GitHub mode */
  apiUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  agentCoreWebSocketUrl: string;
}

export class FrontendConfigStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendConfigStackProps) {
    super(scope, id, props);

    const {
      amplifyAppId,
      amplifyDefaultDomain,
      branchName,
      useGitHub,
      apiUrl,
      userPoolId,
      userPoolClientId,
      identityPoolId,
      agentCoreWebSocketUrl,
    } = props;

    const envVars: amplify_cfn.CfnBranch.EnvironmentVariableProperty[] = useGitHub
      ? [
          { name: 'NEXT_PUBLIC_API_BASE_URL',              value: apiUrl },
          { name: 'NEXT_PUBLIC_COGNITO_USER_POOL_ID',      value: userPoolId },
          { name: 'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID', value: userPoolClientId },
          { name: 'NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID',  value: identityPoolId },
          { name: 'NEXT_PUBLIC_COGNITO_REGION',            value: cdk.Stack.of(this).region },
          { name: 'NEXT_PUBLIC_AGENTCORE_WEBSOCKET_URL',   value: agentCoreWebSocketUrl },
        ]
      : [];

    new amplify_cfn.CfnBranch(this, 'Branch', {
      appId: amplifyAppId,
      branchName,
      stage: 'PRODUCTION',
      enableAutoBuild: useGitHub,
      ...(envVars.length > 0 && { environmentVariables: envVars }),
    });

    new cdk.CfnOutput(this, 'AmplifyAppUrl', {
      value: `https://${branchName}.${amplifyDefaultDomain}`,
      description: `Amplify frontend URL (${branchName})`,
    });
  }
}
