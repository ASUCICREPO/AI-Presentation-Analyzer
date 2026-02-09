import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export class AIPresentationCoachStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ──────────────────────────────────────────────
    // S3 bucket for uploads
    // ──────────────────────────────────────────────
    const presentationAndSessionUploadsBucket = new cdk.aws_s3.Bucket(this, 'AIPresentationCoach-Presentations-Videos', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ──────────────────────────────────────────────
    // Lambda for presigned URL generation
    // ──────────────────────────────────────────────
    const s3UrlIssuerLambda = new lambda.Function(this, 'MyLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'get_presigned_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 's3_presigned_url_gen')),
      timeout: cdk.Duration.seconds(20),
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PDF_UPLOAD_TIMEOUT': '120', //PDF upload timeout in 2 minutes
        'PRESENTATION_TIMEOUT': '1200' //Max Presentation video duration timeout 20 minutes
      },
    });

    // ──────────────────────────────────────────────
    // Cognito User Pool
    // ──────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      signInCaseSensitive: false,
    });

    // User Pool Client (needed by the Identity Pool to authenticate users)
    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      generateSecret: false, // false for browser-based / public clients
    });

    // ──────────────────────────────────────────────
    // Cognito Identity Pool
    // ──────────────────────────────────────────────
    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    // ──────────────────────────────────────────────
    // IAM Role for authenticated users
    // ──────────────────────────────────────────────
    const authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'Role assumed by authenticated Cognito Identity Pool users',
    });

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

    // Attach role to the Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // ──────────────────────────────────────────────
    // Stack Outputs (useful for frontend configuration)
    // ──────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: identityPool.ref,
      description: 'Cognito Identity Pool ID',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region',
    });
  }
}
