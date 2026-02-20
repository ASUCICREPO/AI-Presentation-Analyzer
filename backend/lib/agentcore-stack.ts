import { Construct } from 'constructs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import { NagSuppressions } from 'cdk-nag';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

export interface AgentCoreStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  authenticatedRole: iam.Role;
  personasTable: dynamodb.TableV2;
  uploadsBucket: s3.Bucket;
}

export class AgentCoreStack extends cdk.Stack {
  public readonly webSocketUrl: string;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const agentCoreImage = new ecrAssets.DockerImageAsset(this, 'AgentCoreImage', {
      directory: path.join(__dirname, '..', 'agentcore'),
      platform: ecrAssets.Platform.LINUX_ARM64,
    });

    const agentCoreRuntime = new agentcore.Runtime(this, 'LiveQAAgentRuntime', {
      description: 'Bidirectional voice agent for live Q&A sessions with WebSocket support',
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromEcrRepository(
        agentCoreImage.repository,
        agentCoreImage.imageTag
      ),
      authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        props.userPool,
        [props.userPoolClient],
      ),
      environmentVariables: {
        'VOICE_ID': 'matthew',
        'MODEL_ID': 'amazon.nova-2-sonic-v1:0',
        'SESSION_DURATION_SEC': '300',
        'PERSONA_TABLE_NAME': props.personasTable.tableName,
        'UPLOADS_BUCKET': props.uploadsBucket.bucketName,
      },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(10),
        maxLifetime: cdk.Duration.hours(1),
      },
    });

    props.personasTable.grantReadData(agentCoreRuntime);
    props.uploadsBucket.grantRead(agentCoreRuntime);

    agentCoreRuntime.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/amazon.nova-2-sonic-v1:0',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));

    // Policy lives inside AgentCoreStack so the agentRuntimeArn token never
    // crosses into AIPresentationCoachStack — that would create a cycle.
    // attachToRole() creates AWS::IAM::Policy here, referencing the role by name
    // (a cross-stack import from AIPresentationCoachStack, same direction as all
    // other props). AIPresentationCoachStack has zero references to this stack.
    new iam.Policy(this, 'AuthRoleAgentCorePolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream'],
          resources: [agentCoreRuntime.agentRuntimeArn],
        }),
      ],
      roles: [props.authenticatedRole],
    });

    this.webSocketUrl = `wss://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${agentCoreRuntime.agentRuntimeArn}/ws`;

    // ──────────────────────────────────────────────
    // Stack Outputs
    // ──────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AgentCoreRuntimeArn', {
      value: agentCoreRuntime.agentRuntimeArn,
      description: 'AgentCore Runtime ARN for Live Q&A',
    });

    new cdk.CfnOutput(this, 'AgentCoreWebSocketUrl', {
      value: this.webSocketUrl,
      description: 'WebSocket URL for Live Q&A (authenticate with Cognito ID token)',
    });

    // ──────────────────────────────────────────────
    // cdk-nag suppressions
    // ──────────────────────────────────────────────
    NagSuppressions.addResourceSuppressions(agentCoreRuntime.role, [
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime creates CloudWatch log groups dynamically at /aws/bedrock-agentcore/runtimes/*. Wildcard required for runtime-managed logging.', appliesTo: ['Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/bedrock-agentcore/runtimes/*'] },
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime requires wildcard for log group discovery and creation. This is a service-managed pattern.', appliesTo: ['Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:*'] },
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime writes to log streams dynamically. Wildcard required for runtime-managed log streaming.', appliesTo: ['Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*'] },
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime requires wildcard ECR permissions to pull container images from service-managed repositories. This is required for container runtime execution.', appliesTo: ['Resource::*'] },
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime uses workload identity for secure service-to-service authentication. Wildcard required for dynamic identity management.', appliesTo: ['Resource::arn:<AWS::Partition>:bedrock-agentcore:<AWS::Region>:<AWS::AccountId>:workload-identity-directory/default/workload-identity/*'] },
      { id: 'AwsSolutions-IAM5', reason: 'S3 wildcard actions (GetBucket*, GetObject*, List*) are generated by CDK grantRead() and scoped to the uploads bucket only.', appliesTo: ['Action::s3:GetBucket*', 'Action::s3:GetObject*', 'Action::s3:List*'] },
      { id: 'AwsSolutions-IAM5', reason: 'S3 resource wildcard is scoped to objects within the uploads bucket via CDK grantRead().', appliesTo: ['Resource::<AIPresentationCoachPresentationsVideos1B0D776E.Arn>/*'] },
      { id: 'AwsSolutions-IAM5', reason: 'DynamoDB read actions (BatchGet*, Get*, Query, Scan) are generated by CDK grantReadData() and scoped to the personas table only.', appliesTo: ['Action::dynamodb:BatchGet*', 'Action::dynamodb:DescribeStream', 'Action::dynamodb:DescribeTable', 'Action::dynamodb:Get*', 'Action::dynamodb:Query', 'Action::dynamodb:Scan'] },
      { id: 'AwsSolutions-IAM5', reason: 'Bedrock foundation models are region-agnostic resources. Wildcard region required for Nova Sonic model access.', appliesTo: ['Resource::arn:aws:bedrock:*::foundation-model/amazon.nova-2-sonic-v1:0'] },
      { id: 'AwsSolutions-IAM5', reason: 'Bedrock inference profiles route to multiple regions for availability. Wildcard required for cross-region inference routing.', appliesTo: ['Resource::arn:aws:bedrock:*:<AWS::AccountId>:inference-profile/*'] },
    ], true);
  }
}
