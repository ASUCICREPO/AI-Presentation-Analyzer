import { Construct } from 'constructs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';

export class AIPresentationCoachStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ──────────────────────────────────────────────
    // S3 bucket for uploads
    // ──────────────────────────────────────────────
    const presentationAndSessionUploadsBucket = new cdk.aws_s3.Bucket(this, 'AIPresentationCoach-Presentations-Videos', {
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
      runtime: lambda.Runtime.PYTHON_3_11,
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
    const apiGateway = new apigateway.LambdaRestApi(this, 'AIPresentationCoachApi', {
      handler: s3UrlIssuerLambda,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
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
      runtime: lambda.Runtime.PYTHON_3_11,
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
    // GET /personas - list all personas (public — needed before login to show persona cards)
    personas_resource.addMethod('GET', new apigateway.LambdaIntegration(personaCrudLambda));
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
