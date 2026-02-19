import { Construct } from 'constructs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { NagSuppressions } from 'cdk-nag';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

export class AIPresentationCoachStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ──────────────────────────────────────────────
    // S3 bucket for uploads
    // ──────────────────────────────────────────────
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const presentationAndSessionUploadsBucket = new s3.Bucket(this, 'AIPresentationCoach-Presentations-Videos', {
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'uploads-access-logs/',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
      lifecycleRules: [
        {
          id: 'AbortIncompleteMultipartUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

    // ──────────────────────────────────────────────
    // Lambda for presigned URL generation
    // ──────────────────────────────────────────────
    const s3UrlIssuerLambda = new lambda.Function(this, 's3UrlIssuerLambda', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 's3-presigned-url-gen')),
      timeout: cdk.Duration.seconds(20),
      role: new iam.Role(this, 'S3UrlIssuerLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PDF_UPLOAD_TIMEOUT': '120', //PDF upload timeout in 2 minutes
        'PRESENTATION_TIMEOUT': '1200', //Max Presentation video duration timeout 20 minutes
        'JSON_UPLOAD_TIMEOUT': '60', //JSON data upload timeout 1 minute
        'MULTIPART_PART_URL_TIMEOUT': '300', //Multipart part URL timeout 5 minutes
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
    // Transcribe streaming APIs do not support resource-level ARNs — wildcard is required
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

    //Add users to groups for role-based access control (RBAC)
    const adminGroup = new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      groupName: 'Admin',
      userPoolId: userPool.userPoolId,
      description: 'Administrators with full access to the system configs. Can create new personas, manage existing personas, and alter system defaults.',
    });

    // Grant Lambda permission to generate presigned URLs for the S3 bucket
    presentationAndSessionUploadsBucket.grantReadWrite(s3UrlIssuerLambda);

    // ──────────────────────────────────────────────
    // API Gateway definitions
    // ──────────────────────────────────────────────
    // API Gateway CloudWatch logging role
    const apiGatewayLogRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
      ],
    });

    // Register the CloudWatch role at the API Gateway account level (required before any stage can log)
    const apiGatewayAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayLogRole.roleArn,
    });

    const apiLogGroup = new cdk.aws_logs.LogGroup(this, 'ApiGatewayAccessLogs', {
      retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiGateway = new apigateway.LambdaRestApi(this, 'AIPresentationCoachApi', {
      handler: s3UrlIssuerLambda,
      proxy: false,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Ensure the account-level CW role is set before the API stage deploys
    apiGateway.deploymentStage.node.addDependency(apiGatewayAccount);

    // Add CORS headers to Gateway error responses (auth failures, etc.)
    apiGateway.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });
    apiGateway.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    // Cognito Authorizer for API Gateway
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // S3 URLs resource
    let s3_urls_resource = apiGateway.root.addResource('s3_urls');
    s3_urls_resource.addMethod('GET', new apigateway.LambdaIntegration(s3UrlIssuerLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    s3_urls_resource.addMethod('POST', new apigateway.LambdaIntegration(s3UrlIssuerLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ──────────────────────────────────────────────
    // Personas Dynamo DB Table Config
    // ──────────────────────────────────────────────
    const personasTable = new dynamodb.TableV2(this, 'UserPersonaTable', {
      // Required: Define the partition key
      partitionKey: {
        name: 'personaID', // The name of the partition key attribute
        type: dynamodb.AttributeType.STRING, // The data type (STRING, NUMBER, BINARY)
      },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY
      // pointInTimeRecovery: true, // Commenting for now to avoid additional costs, can be enabled in production for data protection.
    });

    // Persona CRUD Lambda
    const personaCrudLambda = new lambda.Function(this, 'PersonaCrudLambda', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'persona-crud')),
      timeout: cdk.Duration.seconds(20),
      role: new iam.Role(this, 'PersonaCrudLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'PERSONA_TABLE_NAME': personasTable.tableName,
        'MAX_ITEMS_PER_PAGE': '20',
      },
    });

    // Grant Lambda access to the DynamoDB table
    personasTable.grantReadWriteData(personaCrudLambda);

    // Personas resource
    let personas_resource = apiGateway.root.addResource('personas');
    // GET /personas - list all personas (auth required)
    personas_resource.addMethod('GET', new apigateway.LambdaIntegration(personaCrudLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    // POST /personas - create a new persona (auth required)
    personas_resource.addMethod('POST', new apigateway.LambdaIntegration(personaCrudLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /personas/{id} resource for GET, PUT, DELETE by ID
    let persona_id_resource = personas_resource.addResource('{personaID}');
    // GET /personas/{id} - get persona by ID (auth required)
    persona_id_resource.addMethod('GET', new apigateway.LambdaIntegration(personaCrudLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    // PUT /personas/{id} - update persona by ID (auth required)
    persona_id_resource.addMethod('PUT', new apigateway.LambdaIntegration(personaCrudLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    // DELETE /personas/{id} - delete persona by ID (auth required)
    persona_id_resource.addMethod('DELETE', new apigateway.LambdaIntegration(personaCrudLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ──────────────────────────────────────────────
    // Post-Meeting Analytics Lambda
    // ──────────────────────────────────────────────

    // Lambda layer with latest boto3 (required for Bedrock structured outputs / Converse API)
    const boto3Layer = new lambda.LayerVersion(this, 'Boto3LatestLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'layers', 'boto3-latest'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_13.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output/python && cp -au . /asset-output/',
          ],
          local: {
            tryBundle(outputDir: string) {
              try {
                const { execSync } = require('child_process');
                execSync('pip3 --version');
                execSync(
                  `pip3 install -r ${path.join(__dirname, '..', 'lambda', 'layers', 'boto3-latest', 'requirements.txt')} -t ${path.join(outputDir, 'python')}`,
                  { stdio: 'inherit' },
                );
                return true;
              } catch {
                return false;
              }
            },
          },
        },
      }),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
      description: 'Latest boto3/botocore for Bedrock structured outputs support',
    });

    const postMeetingAnalyticsLambda = new lambda.Function(this, 'PostMeetingAnalyticsLambda', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'post-meeting-analytics')),
      timeout: cdk.Duration.seconds(120),
      layers: [boto3Layer],
      role: new iam.Role(this, 'PostMeetingAnalyticsLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PERSONA_TABLE_NAME': personasTable.tableName,
      },
    });

    // Grant Lambda access to S3 (read/write for fetching files and saving analytics)
    presentationAndSessionUploadsBucket.grantReadWrite(postMeetingAnalyticsLambda);

    // Grant Lambda read access to DynamoDB personas table
    personasTable.grantReadData(postMeetingAnalyticsLambda);

    // Grant Lambda permission to invoke any Bedrock model via Converse API
    postMeetingAnalyticsLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));

    // Analytics resource
    let analytics_resource = apiGateway.root.addResource('analytics');
    // GET /analytics - generate post-meeting analytics (auth required)
    analytics_resource.addMethod('GET', new apigateway.LambdaIntegration(postMeetingAnalyticsLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ──────────────────────────────────────────────
    // Bedrock Guardrail for Persona Customization
    // Prevents persona injection attacks and blocks
    // harmful content in custom persona uploads.
    // ──────────────────────────────────────────────
    const suffix = cdk.Names.uniqueId(this).slice(-8);

    const personaCustomizationGuardrail = new bedrock.CfnGuardrail(this, 'PersonaCustomizationGuardrail', {
      name: `PersonaCustomizationGuardrail-${suffix}`,
      description: 'Guardrail to check for harmful persona customizations and prevent persona injection attacks',
      blockedInputMessaging: 'The uploaded persona customization failed our security checks and has been rejected. Please review the content and try again.',
      blockedOutputsMessaging: 'The generated persona response has been blocked by our security filters due to harmful content. Please modify your persona customization and try again.',
      contentPolicyConfig: {
        // Content filters set to HIGH for maximum scrutiny on both inputs and outputs.
        // To allow more permissive configs, consider:
        // LOW: Most permissive — only blocks extremely harmful content (least recommended).
        // MEDIUM: Moderately permissive — blocks harmful content but allows edge cases
        //         (recommended if students may present on political, explicit, or sensitive topics).
        filtersConfig: [
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
        ],
      },
    });

    // Create initial guardrail version (required for the ApplyGuardrail API)
    const personaGuardrailVersion = new bedrock.CfnGuardrailVersion(this, 'PersonaGuardrailVersion', {
      guardrailIdentifier: personaCustomizationGuardrail.attrGuardrailId,
      description: 'Default Version',
    });

    // Pass guardrail identifiers to the presigned-URL Lambda so it can call ApplyGuardrail
    s3UrlIssuerLambda.addEnvironment('PERSONA_GUARDRAIL_ID', personaCustomizationGuardrail.attrGuardrailId);
    s3UrlIssuerLambda.addEnvironment('PERSONA_GUARDRAIL_VERSION', personaGuardrailVersion.attrVersion);

    // Grant the presigned-URL Lambda permission to invoke the guardrail
    s3UrlIssuerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:ApplyGuardrail'],
      resources: [personaCustomizationGuardrail.attrGuardrailArn],
    }));

    // ──────────────────────────────────────────────
    // AgentCore Runtime for Live Q&A WebSocket Agent
    // ──────────────────────────────────────────────
    const agentCoreRuntime = new agentcore.Runtime(this, 'LiveQAAgentRuntime', {
      runtimeName: 'liveQaAgent',
      description: 'Bidirectional voice agent for live Q&A sessions with WebSocket support',
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, '..', 'agentcore')
      ),
      authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        userPool,
        [userPoolClient],
        [], // audiences - empty for basic setup
        []  // scopes - empty for basic setup
      ),
      environmentVariables: {
        'VOICE_ID': 'matthew',
        'MODEL_ID': 'amazon.nova-2-sonic-v1:0',
        'SESSION_DURATION_SEC': '300',
        'PERSONA_TABLE_NAME': personasTable.tableName,
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
      },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(10),
        maxLifetime: cdk.Duration.hours(1),
      },
    });

    // Grant DynamoDB read permissions
    personasTable.grantReadData(agentCoreRuntime);

    // Grant S3 read permissions
    presentationAndSessionUploadsBucket.grantRead(agentCoreRuntime);

    // Grant Bedrock model invocation permissions
    agentCoreRuntime.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/amazon.nova-2-sonic-v1:0',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));

    // Grant Cognito Identity Pool users permission to connect to AgentCore WebSocket
    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream',
        ],
        resources: [agentCoreRuntime.agentRuntimeArn],
      }),
    );

    // ──────────────────────────────────────────────
    // Amplify Hosting for Frontend (Next.js)
    // ──────────────────────────────────────────────
    // COMMENTED OUT: Uncomment when ready to deploy frontend to Amplify
    /*
    const amplifyApp = new amplify.CfnApp(this, 'FrontendApp', {
      name: 'ai-presentation-coach-frontend',
      description: 'AI Presentation Coach - Next.js Frontend',
      platform: 'WEB_COMPUTE', // Amplify Gen 2 platform for SSR/SSG support
      environmentVariables: [
        { name: 'NEXT_PUBLIC_COGNITO_REGION', value: this.region },
        { name: 'NEXT_PUBLIC_COGNITO_USER_POOL_ID', value: userPool.userPoolId },
        { name: 'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID', value: userPoolClient.userPoolClientId },
        { name: 'NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID', value: identityPool.ref },
        { name: 'NEXT_PUBLIC_API_BASE_URL', value: apiGateway.url },
        { name: 'NEXT_PUBLIC_WEBSOCKET_API_URL', value: `wss://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${agentCoreRuntime.agentRuntimeArn}/ws` },
      ],
      // Build settings for Next.js
      buildSpec: `version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**\/*'
  cache:
    paths:
      - node_modules\/**\/*`,
    });

    // Create main branch for manual deployments
    const amplifyBranch = new amplify.CfnBranch(this, 'FrontendMainBranch', {
      appId: amplifyApp.attrAppId,
      branchName: 'main',
      enableAutoBuild: false, // Manual deployments only (no GitHub connection)
      framework: 'Next.js - SSR',
    });

    // Output Amplify app URL
    new cdk.CfnOutput(this, 'AmplifyAppUrl', {
      value: `https://main.${amplifyApp.attrDefaultDomain}`,
      description: 'Amplify Frontend URL',
    });

    new cdk.CfnOutput(this, 'AmplifyAppId', {
      value: amplifyApp.attrAppId,
      description: 'Amplify App ID (use with AWS CLI for manual deployments)',
    });
    */

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

    new cdk.CfnOutput(this, 'AgentCoreRuntimeArn', {
      value: agentCoreRuntime.agentRuntimeArn,
      description: 'AgentCore Runtime ARN for Live Q&A',
    });

    new cdk.CfnOutput(this, 'AgentCoreWebSocketUrl', {
      value: `wss://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${agentCoreRuntime.agentRuntimeArn}/ws`,
      description: 'WebSocket URL for Live Q&A (authenticate with Cognito ID token)',
    });

    // ──────────────────────────────────────────────
    // cdk-nag suppressions
    // ──────────────────────────────────────────────

    // AwsSolutions-IAM4: AWS managed policies required for Lambda CloudWatch Logs and API Gateway logging
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/S3UrlIssuerLambdaRole/Resource', [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/PersonaCrudLambdaRole/Resource', [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/PostMeetingAnalyticsLambdaRole/Resource', [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/ApiGatewayCloudWatchRole/Resource', [
      { id: 'AwsSolutions-IAM4', reason: 'AmazonAPIGatewayPushToCloudWatchLogs is the AWS-required managed policy for API Gateway to push logs to CloudWatch.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs'] },
    ]);

    // AwsSolutions-L1: Python 3.13 is the latest stable runtime; cdk-nag flags because 3.14 exists in CDK but is not GA
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/s3UrlIssuerLambda/Resource', [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/PersonaCrudLambda/Resource', [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/PostMeetingAnalyticsLambda/Resource', [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);

    // AwsSolutions-IAM5: Wildcard S3 actions generated by CDK grantReadWrite(), scoped to the single uploads bucket
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/S3UrlIssuerLambdaRole/DefaultPolicy/Resource', [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard actions (s3:Abort*, s3:DeleteObject*, s3:GetBucket*, s3:GetObject*, s3:List*) are generated by CDK grantReadWrite() and scoped to the uploads bucket only.', appliesTo: ['Action::s3:Abort*', 'Action::s3:DeleteObject*', 'Action::s3:GetBucket*', 'Action::s3:GetObject*', 'Action::s3:List*'] },
      { id: 'AwsSolutions-IAM5', reason: 'Resource wildcard is scoped to objects within the uploads bucket via CDK grantReadWrite().', appliesTo: ['Resource::<AIPresentationCoachPresentationsVideos1B0D776E.Arn>/*'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/PostMeetingAnalyticsLambdaRole/DefaultPolicy/Resource', [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard actions (s3:GetObject*, s3:List*) are generated by CDK grantRead() and scoped to the uploads bucket only.', appliesTo: ['Action::s3:GetObject*', 'Action::s3:GetBucket*', 'Action::s3:List*', 'Action::s3:Abort*', 'Action::s3:DeleteObject*'] },
      { id: 'AwsSolutions-IAM5', reason: 'Resource wildcard is scoped to objects within the uploads bucket via CDK grantReadWrite().', appliesTo: ['Resource::<AIPresentationCoachPresentationsVideos1B0D776E.Arn>/*'] },
      { id: 'AwsSolutions-IAM5', reason: 'DynamoDB read actions require wildcard for table indexes.', appliesTo: ['Action::dynamodb:BatchGet*', 'Action::dynamodb:DescribeStream', 'Action::dynamodb:DescribeTable', 'Action::dynamodb:Get*', 'Action::dynamodb:Query', 'Action::dynamodb:Scan'] },
      { id: 'AwsSolutions-IAM5', reason: 'Bedrock InvokeModel wildcard allows easy model switching for analytics feedback generation. Cross-region inference profiles route to multiple regions.', appliesTo: ['Resource::arn:aws:bedrock:*::foundation-model/*', `Resource::arn:aws:bedrock:*:<AWS::AccountId>:inference-profile/*`] },
    ]);

    // AwsSolutions-IAM5: Transcribe streaming APIs do not support resource-level permissions; wildcard is required
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/CognitoAuthenticatedRole/DefaultPolicy/Resource', [
      { id: 'AwsSolutions-IAM5', reason: 'Transcribe streaming APIs (StartStreamTranscription*) do not support resource-level ARNs. AWS requires Resource: * for these actions.', appliesTo: ['Resource::*'] },
    ]);

    // AwsSolutions-APIG2: Request validation handled in Lambda handlers with detailed input checks
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/AIPresentationCoachApi/Resource', [
      { id: 'AwsSolutions-APIG2', reason: 'Request validation is handled in Lambda handlers with detailed input validation and error responses.' },
    ]);

    // AwsSolutions-COG2/COG3: MFA and advanced security not enforced — Cognito is on ESSENTIALS tier (PLUS required for threat protection), and MFA adds friction for students
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/UserPool/Resource', [
      { id: 'AwsSolutions-COG2', reason: 'MFA not required for this student-facing presentation tool to reduce onboarding friction. Strong password policy is enforced instead.' },
      { id: 'AwsSolutions-COG3', reason: 'Cognito Threat Protection (AdvancedSecurityMode) requires the PLUS pricing tier. User Pool is on ESSENTIALS tier to minimize cost for this student-facing tool.' },
    ]);

    // AwsSolutions-APIG3: WAFv2 not attached — adds significant cost for a non-production student tool
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/AIPresentationCoachApi/DeploymentStage.prod/Resource', [
      { id: 'AwsSolutions-APIG3', reason: 'WAFv2 web ACL not attached to avoid additional cost for this non-production student-facing tool. Rate limiting handled at Cognito and API Gateway level.' },
    ]);

    // AwsSolutions-IAM5: AgentCore Runtime execution role requires wildcards for CloudWatch Logs, ECR, and service integration
    NagSuppressions.addResourceSuppressionsByPath(this, '/AIPresentationCoachStack/LiveQAAgentRuntime/ExecutionRole/DefaultPolicy/Resource', [
      // CloudWatch Logs wildcards - AgentCore creates log groups dynamically per runtime
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime creates CloudWatch log groups dynamically at /aws/bedrock-agentcore/runtimes/*. Wildcard required for runtime-managed logging.', appliesTo: ['Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/bedrock-agentcore/runtimes/*'] },
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime requires wildcard for log group discovery and creation. This is a service-managed pattern.', appliesTo: ['Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:*'] },
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime writes to log streams dynamically. Wildcard required for runtime-managed log streaming.', appliesTo: ['Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*'] },
      
      // ECR and service integration wildcards
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime requires wildcard ECR permissions to pull container images from service-managed repositories. This is required for container runtime execution.', appliesTo: ['Resource::*'] },
      
      // Workload identity wildcards - AgentCore service integration
      { id: 'AwsSolutions-IAM5', reason: 'AgentCore Runtime uses workload identity for secure service-to-service authentication. Wildcard required for dynamic identity management.', appliesTo: ['Resource::arn:<AWS::Partition>:bedrock-agentcore:<AWS::Region>:<AWS::AccountId>:workload-identity-directory/default/workload-identity/*'] },
      
      // S3 wildcards - generated by CDK grantRead()
      { id: 'AwsSolutions-IAM5', reason: 'S3 wildcard actions (GetBucket*, GetObject*, List*) are generated by CDK grantRead() and scoped to the uploads bucket only.', appliesTo: ['Action::s3:GetBucket*', 'Action::s3:GetObject*', 'Action::s3:List*'] },
      { id: 'AwsSolutions-IAM5', reason: 'S3 resource wildcard is scoped to objects within the uploads bucket via CDK grantRead().', appliesTo: ['Resource::<AIPresentationCoachPresentationsVideos1B0D776E.Arn>/*'] },
      
      // DynamoDB wildcards - generated by CDK grantReadData()
      { id: 'AwsSolutions-IAM5', reason: 'DynamoDB read actions (BatchGet*, Get*, Query, Scan) are generated by CDK grantReadData() and scoped to the personas table only.', appliesTo: ['Action::dynamodb:BatchGet*', 'Action::dynamodb:DescribeStream', 'Action::dynamodb:DescribeTable', 'Action::dynamodb:Get*', 'Action::dynamodb:Query', 'Action::dynamodb:Scan'] },
      
      // Bedrock model wildcards - cross-region inference
      { id: 'AwsSolutions-IAM5', reason: 'Bedrock foundation models are region-agnostic resources. Wildcard region required for Nova Sonic model access.', appliesTo: ['Resource::arn:aws:bedrock:*::foundation-model/amazon.nova-2-sonic-v1:0'] },
      { id: 'AwsSolutions-IAM5', reason: 'Bedrock inference profiles route to multiple regions for availability. Wildcard required for cross-region inference routing.', appliesTo: ['Resource::arn:aws:bedrock:*:<AWS::AccountId>:inference-profile/*'] },
    ]);
  }
}
