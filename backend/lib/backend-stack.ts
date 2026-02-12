import { Construct } from 'constructs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

interface AIPresentationCoachStackProps extends cdk.StackProps {
  resourceSuffix: string;
}

export class AIPresentationCoachStack extends cdk.Stack {
  constructor(scope: Construct,
    id: string, props?: AIPresentationCoachStackProps
  ){
    const stackId = props?.resourceSuffix ? `${id}-${props.resourceSuffix}` : id;
    super(scope, stackId, props);

    const suffix = props?.resourceSuffix ? `-${props.resourceSuffix}` : '';

    // ──────────────────────────────────────────────
    // S3 bucket for uploads
    // ──────────────────────────────────────────────
    const presentationAndSessionUploadsBucket = new cdk.aws_s3.Bucket(this, `AIPresentationCoach-Presentations-Videos${suffix}`, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [cdk.aws_s3.HttpMethods.GET, cdk.aws_s3.HttpMethods.PUT, cdk.aws_s3.HttpMethods.POST],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
    });

    // ──────────────────────────────────────────────
    // SQS Queue for Post-Presentation Analytics Pipeline
    // ──────────────────────────────────────────────
    // Dead Letter Queue (DLQ) for failed processing attempts
    const postPresentationDLQ = new sqs.Queue(this, `PostPresentationDLQ${suffix}`, {
      queueName: `PostPresentationDLQ${suffix}`,
      retentionPeriod: cdk.Duration.days(14), // Keep failed messages for 14 days
    });

    // Main queue for analytics pipeline
    const postPresentationJobsQueue = new sqs.Queue(this, `PostPresentationJobsQueue${suffix}`, {
      queueName: `PostPresentationJobsQueue${suffix}`,
      visibilityTimeout: cdk.Duration.seconds(900), // 15 minutes (should be >= Step Functions max execution time)
      receiveMessageWaitTime: cdk.Duration.seconds(20), // Enable long polling
      deadLetterQueue: {
        queue: postPresentationDLQ,
        maxReceiveCount: 3, // Retry 3 times before moving to DLQ
      },
    });

    // ──────────────────────────────────────────────
    // Lambda for presigned URL generation
    // ──────────────────────────────────────────────
    const s3UrlIssuerLambda = new lambda.Function(this, `s3UrlIssuerLambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'get_presigned_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 's3_presigned_url_gen')),
      timeout: cdk.Duration.seconds(20),
      role: new iam.Role(this, `S3UrlIssuerLambdaRole${suffix}`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PDF_UPLOAD_TIMEOUT': '120', //PDF upload timeout in 2 minutes
        'PRESENTATION_TIMEOUT': '1200', //Max Presentation video duration timeout 20 minutes
        'CHUNK_UPLOAD_TIMEOUT': '300' //Chunk upload timeout 5 minutes
      },
    });

    // ──────────────────────────────────────────────
    // Cognito User Pool
    // ──────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, `UserPool${suffix}`, {
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
    const userPoolClient = new cognito.UserPoolClient(this, `UserPoolClient${suffix}`, {
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
    const identityPool = new cognito.CfnIdentityPool(this, `IdentityPool${suffix}`, {
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
    const authenticatedRole = new iam.Role(this, `CognitoAuthenticatedRole${suffix}`, {
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
    new cognito.CfnIdentityPoolRoleAttachment(this, `IdentityPoolRoleAttachment${suffix}`, {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // Grant Lambda permission to generate presigned URLs for the S3 bucket
    presentationAndSessionUploadsBucket.grantReadWrite(s3UrlIssuerLambda);

    // API Gateway definitions
    const apiGateway = new apigateway.RestApi(this, `AIPresentationCoachApi${suffix}`, {
      restApiName: `AIPresentationCoachApi${suffix}`,
      description: 'API for AI Presentation Coach',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // S3 URLs resource
    let s3_urls_resource = apiGateway.root.addResource('s3_urls');
    s3_urls_resource.addMethod('GET', new apigateway.LambdaIntegration(s3UrlIssuerLambda));

    
    //Personas Dynamo DB Table Config
    const personasTable = new dynamodb.TableV2(this, `UserPersonaTable${suffix}`, {
      // Required: Define the partition key
      partitionKey: {
        name: 'personaID', // The name of the partition key attribute
        type: dynamodb.AttributeType.STRING, // The data type (STRING, NUMBER, BINARY)
      },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY
      // pointInTimeRecovery: true, // Commenting for now to avoid additional costs, can be enabled in production for data protection.
    });

    // SSE Notifications DynamoDB Table
    const sseNotificationsTable = new dynamodb.TableV2(this, `SSENotificationsTable${suffix}`, {
      partitionKey: {
        name: 'sessionID',
        type: dynamodb.AttributeType.STRING,
      },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-delete entries after TTL expires
    });

    // Persona CRUD Lambda
    const personaCrudLambda = new lambda.Function(this, `PersonaCrudLambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'persona_crud.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'dynamo_persona_lambdas')),
      timeout: cdk.Duration.seconds(20),
      role: new iam.Role(this, `PersonaCrudLambdaRole${suffix}`, {
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
    // GET /personas - list all personas (with optional pagination)
    personas_resource.addMethod('GET', new apigateway.LambdaIntegration(personaCrudLambda));
    // POST /personas - create a new persona
    personas_resource.addMethod('POST', new apigateway.LambdaIntegration(personaCrudLambda));

    // /personas/{id} resource for GET, PUT, DELETE by ID
    let persona_id_resource = personas_resource.addResource('{personaID}');
    // GET /personas/{id} - get persona by ID
    persona_id_resource.addMethod('GET', new apigateway.LambdaIntegration(personaCrudLambda));
    // PUT /personas/{id} - update persona by ID
    persona_id_resource.addMethod('PUT', new apigateway.LambdaIntegration(personaCrudLambda));
    // DELETE /personas/{id} - delete persona by ID
    persona_id_resource.addMethod('DELETE', new apigateway.LambdaIntegration(personaCrudLambda));

    // ──────────────────────────────────────────────
    // Analytics Pipeline Lambda Functions
    // ──────────────────────────────────────────────

    // Performance Metrics Lambda (State 1)
    const performanceMetricsLambda = new lambda.Function(this, `PerformanceMetricsLambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'calculate_metrics.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'performance_metrics')),
      timeout: cdk.Duration.seconds(120), // 2 minutes for aggregating chunks
      memorySize: 512,
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PERSONA_TABLE_NAME': personasTable.tableName,
      },
    });

    // Engagement Scores + AI Lambda (State 2)
    const engagementScoresAILambda = new lambda.Function(this, `EngagementScoresAILambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'generate_feedback.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'engagement_scores')),
      timeout: cdk.Duration.seconds(300), // 5 minutes for Bedrock API call
      memorySize: 1024,
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PERSONA_TABLE_NAME': personasTable.tableName,
        'BEDROCK_MODEL_ID': 'anthropic.claude-sonnet-4-20250514-v1:0', // Default model, can be changed
      },
    });

    // PDF Generator Lambda (State 3)
    const pdfGeneratorLambda = new lambda.Function(this, `PDFGeneratorLambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'generate_pdf.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'pdf_generator')),
      timeout: cdk.Duration.seconds(120), // 2 minutes for PDF generation
      memorySize: 1024,
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
      },
    });

    // Report URL Issuer Lambda
    const reportUrlIssuerLambda = new lambda.Function(this, `ReportUrlIssuerLambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'get_report_urls.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'report_url_issuer')),
      timeout: cdk.Duration.seconds(20),
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PRESIGNED_URL_EXPIRATION': '3600', // 1 hour
      },
    });

    // Grant S3 permissions to Lambda functions
    presentationAndSessionUploadsBucket.grantReadWrite(performanceMetricsLambda);
    presentationAndSessionUploadsBucket.grantReadWrite(engagementScoresAILambda);
    presentationAndSessionUploadsBucket.grantReadWrite(pdfGeneratorLambda);
    presentationAndSessionUploadsBucket.grantRead(reportUrlIssuerLambda);

    // Grant DynamoDB read permissions to analytics Lambdas
    personasTable.grantReadData(performanceMetricsLambda);
    personasTable.grantReadData(engagementScoresAILambda);

    // SSE Notifier Lambda
    const sseNotifierLambda = new lambda.Function(this, `SSENotifierLambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'notifier.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'sse_notifier')),
      timeout: cdk.Duration.seconds(300), // 5 minutes for long-lived SSE connections
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'SSE_NOTIFICATIONS_TABLE': sseNotificationsTable.tableName,
      },
    });

    // Grant Bedrock permissions to engagement scores Lambda
    engagementScoresAILambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['*'], // Bedrock model ARNs
      })
    );

    // Grant engagement scores Lambda permission to invoke SSE notifier
    sseNotifierLambda.grantInvoke(engagementScoresAILambda);

    // Grant SSE Notifier Lambda access to SSE Notifications table
    sseNotificationsTable.grantReadWriteData(sseNotifierLambda);

    // Grant engagement scores Lambda permission to invoke SSE notifier
    sseNotifierLambda.grantInvoke(engagementScoresAILambda);

    // ──────────────────────────────────────────────
    // Step Functions State Machine
    // ──────────────────────────────────────────────

    // Define the state machine workflow
    const performanceMetricsTask = new tasks.LambdaInvoke(this, 'PerformanceMetricsTask', {
      lambdaFunction: performanceMetricsLambda,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const engagementScoresAITask = new tasks.LambdaInvoke(this, 'EngagementScoresAITask', {
      lambdaFunction: engagementScoresAILambda,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const pdfGeneratorTask = new tasks.LambdaInvoke(this, 'PDFGeneratorTask', {
      lambdaFunction: pdfGeneratorLambda,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Chain the tasks together
    const analyticsWorkflow = performanceMetricsTask
      .addRetry({
        errors: ['States.TaskFailed'],
        interval: cdk.Duration.seconds(2),
        maxAttempts: 3,
        backoffRate: 2.0,
      })
      .next(engagementScoresAITask.addRetry({
        errors: ['States.TaskFailed'],
        interval: cdk.Duration.seconds(3),
        maxAttempts: 3,
        backoffRate: 2.0,
      }))
      .next(pdfGeneratorTask.addRetry({
        errors: ['States.TaskFailed'],
        interval: cdk.Duration.seconds(2),
        maxAttempts: 2,
        backoffRate: 2.0,
      }));

    // Create the state machine
    const analyticsPipeline = new sfn.StateMachine(this, `AnalyticsPipeline${suffix}`, {
      stateMachineName: `AnalyticsPipeline${suffix}`,
      definitionBody: sfn.DefinitionBody.fromChainable(analyticsWorkflow),
      timeout: cdk.Duration.minutes(15),
    });

    // Grant Step Functions permission to invoke Lambdas
    performanceMetricsLambda.grantInvoke(analyticsPipeline);
    engagementScoresAILambda.grantInvoke(analyticsPipeline);
    pdfGeneratorLambda.grantInvoke(analyticsPipeline);

    // Session Complete Trigger Lambda (triggers Step Functions)
    const sessionCompleteTriggerLambda = new lambda.Function(this, `SessionCompleteTriggerLambda${suffix}`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'trigger_analytics.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'session_complete_trigger')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        'STEP_FUNCTIONS_ARN': analyticsPipeline.stateMachineArn,
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
      },
    });

    // Grant permission to start Step Functions execution
    analyticsPipeline.grantStartExecution(sessionCompleteTriggerLambda);

    // ──────────────────────────────────────────────
    // API Gateway Routes for Analytics
    // ──────────────────────────────────────────────

    // /sessions/{sessionID}/complete - Trigger analytics pipeline
    const sessionsResource = apiGateway.root.addResource('sessions');
    const sessionIdResource = sessionsResource.addResource('{sessionID}');
    const completeResource = sessionIdResource.addResource('complete');
    completeResource.addMethod('POST', new apigateway.LambdaIntegration(sessionCompleteTriggerLambda));

    // /sse/{sessionID} - Server-Sent Events for real-time notifications
    const sseResource = apiGateway.root.addResource('sse');
    const sseSessionResource = sseResource.addResource('{sessionID}');
    sseSessionResource.addMethod('GET', new apigateway.LambdaIntegration(sseNotifierLambda));

    // /report_urls/{sessionID} - Get presigned URLs for reports
    const reportUrlsResource = apiGateway.root.addResource('report_urls');
    const reportUrlsSessionResource = reportUrlsResource.addResource('{sessionID}');
    reportUrlsSessionResource.addMethod('GET', new apigateway.LambdaIntegration(reportUrlIssuerLambda));


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

    new cdk.CfnOutput(this, 'PostPresentationJobsQueueUrl', {
      value: postPresentationJobsQueue.queueUrl,
      description: 'SQS Queue URL for Analytics Pipeline',
    });

    new cdk.CfnOutput(this, 'AnalyticsPipelineArn', {
      value: analyticsPipeline.stateMachineArn,
      description: 'Step Functions State Machine ARN',
    });
  }
}
