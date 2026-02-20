import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as amplify_cfn from 'aws-cdk-lib/aws-amplify';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { NagSuppressions } from 'cdk-nag';

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

    const branch = new amplify_cfn.CfnBranch(this, 'Branch', {
      appId: amplifyAppId,
      branchName,
      stage: 'PRODUCTION',
      enableAutoBuild: useGitHub,
      ...(envVars.length > 0 && { environmentVariables: envVars }),
    });

    // Trigger an initial Amplify build after the branch + env vars are set up.
    // Only in GitHub mode — bare mode uses the deploy script instead.
    if (useGitHub) {
      const jobParams = {
        appId: amplifyAppId,
        branchName,
        jobType: 'RELEASE',
      };

      const trigger = new AwsCustomResource(this, 'TriggerAmplifyBuild', {
        onCreate: {
          service: 'Amplify',
          action: 'startJob',
          parameters: jobParams,
          physicalResourceId: PhysicalResourceId.of(
            `${amplifyAppId}-${branchName}-${Date.now()}`
          ),
        },
        onUpdate: {
          service: 'Amplify',
          action: 'startJob',
          parameters: jobParams,
          physicalResourceId: PhysicalResourceId.of(
            `${amplifyAppId}-${branchName}-${Date.now()}`
          ),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [
            `arn:aws:amplify:${this.region}:${this.account}:apps/${amplifyAppId}`,
            `arn:aws:amplify:${this.region}:${this.account}:apps/${amplifyAppId}/branches/${branchName}/jobs/*`,
          ],
        }),
      });

      trigger.node.addDependency(branch);

      const stackName = this.stackName;

      // AwsSolutions-IAM5: Amplify job IDs are generated at runtime by startJob — wildcard is the minimum scope
      NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/TriggerAmplifyBuild/CustomResourcePolicy/Resource`, [
        { id: 'AwsSolutions-IAM5', reason: 'Amplify startJob creates dynamic job IDs at runtime. The wildcard on jobs/* is the narrowest possible scope — it is already scoped to a specific app and branch.', appliesTo: [`Resource::arn:aws:amplify:<AWS::Region>:<AWS::AccountId>:apps/${amplifyAppId}/branches/${branchName}/jobs/*`] },
      ]);

      // AwsSolutions-IAM4 + AwsSolutions-L1: CDK AwsCustomResource creates an internal singleton Lambda
      // whose role and runtime are not configurable via public API
      NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource`, [
        { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is attached by CDK AwsCustomResource internally. There is no public API to replace it with a customer-managed policy.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
      ]);
      NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/AWS679f53fac002430cb0da5b7982bd2287/Resource`, [
        { id: 'AwsSolutions-L1', reason: 'Lambda runtime is set internally by CDK AwsCustomResource singleton. There is no public API to override it.' },
      ]);
    }

    new cdk.CfnOutput(this, 'AmplifyAppUrl', {
      value: `https://${branchName}.${amplifyDefaultDomain}`,
      description: `Amplify frontend URL (${branchName})`,
    });
  }
}
