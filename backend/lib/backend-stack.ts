import { Construct } from 'constructs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { NagSuppressions } from 'cdk-nag';


export interface AIPresentationCoachStackProps extends cdk.StackProps {
  resourceSuffix: string;
}

export class AIPresentationCoachStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AIPresentationCoachStackProps) {
    super(scope, id, props);

    const resourceSuffix = props?.resourceSuffix ? `-${props.resourceSuffix}` : '';

    // ──────────────────────────────────────────────
    // S3 bucket for uploads
    // ──────────────────────────────────────────────
    const accessLogsBucket = new s3.Bucket(this, `AccessLogsBucket${resourceSuffix}`, {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const presentationAndSessionUploadsBucket = new s3.Bucket(this, `AIPresentationCoach-Presentations-Videos${resourceSuffix}`, {
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
    const s3UrlIssuerLambda = new lambda.Function(this, `s3UrlIssuerLambda${resourceSuffix}`, {
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
    const userPool = new cognito.UserPool(this, `UserPool${resourceSuffix}`, {
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
    const userPoolClient = new cognito.UserPoolClient(this, `UserPoolClient${resourceSuffix}`, {
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
    const identityPool = new cognito.CfnIdentityPool(this, `IdentityPool${resourceSuffix}`, {
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
    const authenticatedRole = new iam.Role(this, `CognitoAuthenticatedRole${resourceSuffix}`, {
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
    new cognito.CfnIdentityPoolRoleAttachment(this, `IdentityPoolRoleAttachment${resourceSuffix}`, {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    //Add users to groups for role-based access control (RBAC)
    const adminGroup = new cognito.CfnUserPoolGroup(this, `AdminGroup${resourceSuffix}`, {
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
    const apiGatewayLogRole = new iam.Role(this, `ApiGatewayCloudWatchRole${resourceSuffix}`, {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
      ],
    });

    // Register the CloudWatch role at the API Gateway account level (required before any stage can log)
    const apiGatewayAccount = new apigateway.CfnAccount(this, `ApiGatewayAccount${resourceSuffix}`, {
      cloudWatchRoleArn: apiGatewayLogRole.roleArn,
    });

    const apiLogGroup = new cdk.aws_logs.LogGroup(this, `ApiGatewayAccessLogs${resourceSuffix}`, {
      retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiGateway = new apigateway.LambdaRestApi(this, `AIPresentationCoachApi${resourceSuffix}`, {
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
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, `CognitoAuthorizer${resourceSuffix}`, {
      cognitoUserPools: [userPool],
    });

    // S3 URLs resource
    let s3_urls_resource = apiGateway.root.addResource('s3_urls'); // Resource path does not need suffix
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
    const personasTable = new dynamodb.TableV2(this, `UserPersonaTable${resourceSuffix}`, {
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
    const personaCrudLambda = new lambda.Function(this, `PersonaCrudLambda${resourceSuffix}`, {
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
    let personas_resource = apiGateway.root.addResource('personas'); // Resource path does not need suffix
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
    let persona_id_resource = personas_resource.addResource('{personaID}'); // Resource path does not need suffix
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
    // Live QA WebSocket Infrastructure
    // ──────────────────────────────────────────────

    // DynamoDB table for WebSocket connections
    const liveQAConnectionsTable = new dynamodb.TableV2(this, `LiveQAConnectionsTable${resourceSuffix}`, {
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for userId-sessionId lookups
    liveQAConnectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-sessionId-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sessionId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // WebSocket API Gateway
    const webSocketApi = new apigatewayv2.CfnApi(this, `LiveQAWebSocketApi${resourceSuffix}`, {
      name: 'LiveQAWebSocketApi',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    // WebSocket Authorizer Lambda
    const wsAuthorizerLambda = new lambda.Function(this, `WsAuthorizerLambda${resourceSuffix}`, {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'ws-authorizer'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_13.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output',
          ],
        },
      }),
      timeout: cdk.Duration.seconds(10),
      role: new iam.Role(this, 'WsAuthorizerLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'USER_POOL_ID': userPool.userPoolId,
        'USER_POOL_CLIENT_ID': userPoolClient.userPoolClientId,
      },
    });

    // WebSocket Authorizer
    const wsAuthorizer = new apigatewayv2.CfnAuthorizer(this, `WsAuthorizer${resourceSuffix}`, {
      apiId: webSocketApi.ref,
      name: 'CognitoAuthorizer',
      authorizerType: 'REQUEST',
      authorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsAuthorizerLambda.functionArn}/invocations`,
      identitySource: ['route.request.querystring.token'],
    });

    // Grant API Gateway permission to invoke authorizer
    wsAuthorizerLambda.addPermission('WsAuthorizerApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/authorizers/${wsAuthorizer.ref}`,
    });

    // WebSocket Connection Manager Lambda
    const wsConnectionManagerLambda = new lambda.Function(this, `WsConnectionManagerLambda${resourceSuffix}`, {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'ws-connection-manager')),
      timeout: cdk.Duration.seconds(20),
      role: new iam.Role(this, 'WsConnectionManagerLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'CONNECTIONS_TABLE_NAME': liveQAConnectionsTable.tableName,
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
      },
    });

    // Grant permissions to connection manager
    liveQAConnectionsTable.grantReadWriteData(wsConnectionManagerLambda);
    presentationAndSessionUploadsBucket.grantRead(wsConnectionManagerLambda);

    // WebSocket Message Handler Lambda
    const wsMessageHandlerLambda = new lambda.Function(this, `WsMessageHandlerLambda${resourceSuffix}`, {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'ws-message-handler')),
      timeout: cdk.Duration.seconds(900), // 15 minutes
      role: new iam.Role(this, 'WsMessageHandlerLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'CONNECTIONS_TABLE_NAME': liveQAConnectionsTable.tableName,
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'WEBSOCKET_API_ENDPOINT': `https://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/prod`,
        'BEDROCK_MODEL_ID': 'amazon.nova-2-sonic-v1:0',
        'MAX_TOKENS': '2048',
        'DEFAULT_VOICE_ID': 'matthew',
        'MAX_QUESTIONS': '10',
        'MAX_DURATION_SECONDS': '600',
      },
    });

    // Grant permissions to message handler
    liveQAConnectionsTable.grantReadWriteData(wsMessageHandlerLambda);
    presentationAndSessionUploadsBucket.grantRead(wsMessageHandlerLambda);

    // Grant Bedrock streaming permissions
    wsMessageHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['arn:aws:bedrock:*::foundation-model/amazon.nova-2-sonic-v1:0'],
    }));

    // Grant WebSocket ManageConnections permissions
    wsMessageHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/prod/POST/@connections/*`],
    }));

    // Lambda integrations
    const wsConnectionManagerIntegration = new apigatewayv2.CfnIntegration(this, `WsConnectionManagerIntegration${resourceSuffix}`, {
      apiId: webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsConnectionManagerLambda.functionArn}/invocations`,
    });

    const wsMessageHandlerIntegration = new apigatewayv2.CfnIntegration(this, `WsMessageHandlerIntegration${resourceSuffix}`, {
      apiId: webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsMessageHandlerLambda.functionArn}/invocations`,
    });

    // Routes
    const connectRoute = new apigatewayv2.CfnRoute(this, `ConnectRoute${resourceSuffix}`, {
      apiId: webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'CUSTOM',
      authorizerId: wsAuthorizer.ref,
      target: `integrations/${wsConnectionManagerIntegration.ref}`,
    });

    const disconnectRoute = new apigatewayv2.CfnRoute(this, `DisconnectRoute${resourceSuffix}`, {
      apiId: webSocketApi.ref,
      routeKey: '$disconnect',
      target: `integrations/${wsConnectionManagerIntegration.ref}`,
    });

    const defaultRoute = new apigatewayv2.CfnRoute(this, `DefaultRoute${resourceSuffix}`, {
      apiId: webSocketApi.ref,
      routeKey: '$default',
      target: `integrations/${wsMessageHandlerIntegration.ref}`,
    });

    // Deployment
    const wsDeployment = new apigatewayv2.CfnDeployment(this, `WsDeployment${resourceSuffix}`, {
      apiId: webSocketApi.ref,
    });
    wsDeployment.node.addDependency(connectRoute);
    wsDeployment.node.addDependency(disconnectRoute);
    wsDeployment.node.addDependency(defaultRoute);

    // Stage
    const wsStage = new apigatewayv2.CfnStage(this, `WsStage${resourceSuffix}`, {
      apiId: webSocketApi.ref,
      stageName: 'prod',
      deploymentId: wsDeployment.ref,
      autoDeploy: true,
    });

    // Lambda permissions for API Gateway to invoke
    wsConnectionManagerLambda.addPermission(`WsConnectionManagerApiGatewayInvoke${resourceSuffix}`, {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*`,
    });

    wsMessageHandlerLambda.addPermission(`WsMessageHandlerApiGatewayInvoke${resourceSuffix}`, {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*`,
    });

    // ──────────────────────────────────────────────
    // Bedrock Guardrail for Persona Customization
    // Prevents persona injection attacks and blocks
    // harmful content in custom persona uploads.
    // ──────────────────────────────────────────────
    const suffix = cdk.Names.uniqueId(this).slice(-8);

    const personaCustomizationGuardrail = new bedrock.CfnGuardrail(this, `PersonaCustomizationGuardrail${resourceSuffix}`, {
      name: `PersonaCustomizationGuardrail-${suffix}${resourceSuffix}`,
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
          { type: 'HATE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'SEXUAL', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'VIOLENCE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'MISCONDUCT', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          // { type: 'PROMPT_ATTACK', inputStrength: 'MEDIUM', outputStrength: 'NONE' },
        ],
      },
    });

    // Create initial guardrail version (required for the ApplyGuardrail API)
    const personaGuardrailVersion = new bedrock.CfnGuardrailVersion(this, `PersonaGuardrailVersion${resourceSuffix}`, {
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
    // Stack Outputs (useful for frontend configuration)
    // ──────────────────────────────────────────────
    new cdk.CfnOutput(this, `UserPoolId${resourceSuffix}`, {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, `UserPoolClientId${resourceSuffix}`, {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, `IdentityPoolId${resourceSuffix}`, {
      value: identityPool.ref,
      description: 'Cognito Identity Pool ID',
    });

    new cdk.CfnOutput(this, `Region${resourceSuffix}`, {
      value: this.region,
      description: 'AWS Region',
    });

    new cdk.CfnOutput(this, `WebSocketApiEndpoint${resourceSuffix}`, {
      value: `wss://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/prod`,
      description: 'WebSocket API Endpoint for Live QA',
    });

    // ──────────────────────────────────────────────
    // cdk-nag suppressions
    // ──────────────────────────────────────────────

    // AwsSolutions-IAM4: AWS managed policies required for Lambda CloudWatch Logs and API Gateway logging
    const stackName = this.stackName;
    const suffixPath = props.resourceSuffix ? `-${props.resourceSuffix}` : '';
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/S3UrlIssuerLambdaRole/Resource`, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/PersonaCrudLambdaRole/Resource`, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/ApiGatewayCloudWatchRole${suffixPath}/Resource`, [
      { id: 'AwsSolutions-IAM4', reason: 'AmazonAPIGatewayPushToCloudWatchLogs is the AWS-required managed policy for API Gateway to push logs to CloudWatch.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs'] },
    ]);

    // AwsSolutions-L1: Python 3.13 is the latest stable runtime; cdk-nag flags because 3.14 exists in CDK but is not GA
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/s3UrlIssuerLambda${suffixPath}/Resource`, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/PersonaCrudLambda${suffixPath}/Resource`, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsConnectionManagerLambda${suffixPath}/Resource`, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsMessageHandlerLambda${suffixPath}/Resource`, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsAuthorizerLambda${suffixPath}/Resource`, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest stable Lambda runtime. Python 3.14 is not yet generally available.' },
    ]);

    // AwsSolutions-IAM4: AWS managed policies for WebSocket Lambdas
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsConnectionManagerLambdaRole/Resource`, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsMessageHandlerLambdaRole/Resource`, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsAuthorizerLambdaRole/Resource`, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is the standard AWS managed policy required for CloudWatch Logs integration.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
    ]);

    // AwsSolutions-IAM5: Wildcard S3 actions generated by CDK grantReadWrite(), scoped to the single uploads bucket
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/S3UrlIssuerLambdaRole/DefaultPolicy/Resource`, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard actions (s3:Abort*, s3:DeleteObject*, s3:GetBucket*, s3:GetObject*, s3:List*) are generated by CDK grantReadWrite() and scoped to the uploads bucket only. Resource ARN is dynamically generated with resource suffix.' },
    ]);

    // AwsSolutions-IAM5: WebSocket Lambda IAM wildcards for S3 read, DynamoDB, Bedrock, and API Gateway
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsConnectionManagerLambdaRole/DefaultPolicy/Resource`, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard S3 actions (GetBucket*, GetObject*, List*) and DynamoDB index wildcards generated by CDK grantRead() and table.grantReadWriteData(). All resources are dynamically scoped to specific bucket and table with resource suffix.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsMessageHandlerLambdaRole/DefaultPolicy/Resource`, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard S3 actions (GetBucket*, GetObject*, List*), DynamoDB index wildcards, Bedrock model wildcard region (multi-region support), and API Gateway ManageConnections wildcard (required to post to any connection ID) are generated by CDK grantRead() and manual policies. All resources are dynamically scoped with resource suffix.' },
    ]);

    // AwsSolutions-APIG4: WebSocket routes authentication
    // ConnectRoute now has Lambda authorizer validating Cognito JWT tokens at API Gateway level
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/DisconnectRoute${suffixPath}`, [
      { id: 'AwsSolutions-APIG4', reason: 'WebSocket $disconnect route performs cleanup only. No sensitive operations require additional authorization.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/DefaultRoute${suffixPath}`, [
      { id: 'AwsSolutions-APIG4', reason: 'WebSocket $default route validates connection exists in DynamoDB (created during authenticated $connect). Authorization enforced at connection time.' },
    ]);

    // AwsSolutions-APIG1: WebSocket API access logging
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/WsStage${suffixPath}`, [
      { id: 'AwsSolutions-APIG1', reason: 'WebSocket API access logging handled via Lambda CloudWatch logs. All message handling is logged in Lambda functions with detailed context.' },
    ]);

    // AwsSolutions-IAM5: Transcribe streaming APIs do not support resource-level permissions; wildcard is required
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/CognitoAuthenticatedRole${suffixPath}/DefaultPolicy/Resource`, [
      { id: 'AwsSolutions-IAM5', reason: 'Transcribe streaming APIs (StartStreamTranscription*) do not support resource-level ARNs. AWS requires Resource: * for these actions.', appliesTo: ['Resource::*'] },
    ]);

    // AwsSolutions-APIG2: Request validation handled in Lambda handlers with detailed input checks
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/AIPresentationCoachApi${suffixPath}/Resource`, [
      { id: 'AwsSolutions-APIG2', reason: 'Request validation is handled in Lambda handlers with detailed input validation and error responses.' },
    ]);

    // AwsSolutions-COG2/COG3: MFA and advanced security not enforced — Cognito is on ESSENTIALS tier (PLUS required for threat protection), and MFA adds friction for students
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/UserPool${suffixPath}/Resource`, [
      { id: 'AwsSolutions-COG2', reason: 'MFA not required for this student-facing presentation tool to reduce onboarding friction. Strong password policy is enforced instead.' },
      { id: 'AwsSolutions-COG3', reason: 'Cognito Threat Protection (AdvancedSecurityMode) requires the PLUS pricing tier. User Pool is on ESSENTIALS tier to minimize cost for this student-facing tool.' },
    ]);

    // AwsSolutions-APIG3: WAFv2 not attached — adds significant cost for a non-production student tool
    NagSuppressions.addResourceSuppressionsByPath(this, `/${stackName}/AIPresentationCoachApi${suffixPath}/DeploymentStage.prod/Resource`, [
      { id: 'AwsSolutions-APIG3', reason: 'WAFv2 web ACL not attached to avoid additional cost for this non-production student-facing tool. Rate limiting handled at Cognito and API Gateway level.' },
    ]);
  } 
}
