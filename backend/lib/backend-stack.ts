import { Construct } from 'constructs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as bedrockl1 from 'aws-cdk-lib/aws-bedrock';

interface AIPresentationCoachStackProps extends cdk.StackProps {
  resourceSuffix: string; // Suffix to ensure unique resource names across stacks/environments
}

export class AIPresentationCoachStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AIPresentationCoachStackProps) {
    super(scope, id, props);

    const suffix = props.resourceSuffix;

    // Helper to create Lambda integration with CORS support
    const createCorsLambdaIntegration = (lambdaFunction: lambda.Function) => {
      return new apigateway.LambdaIntegration(lambdaFunction, {
        proxy: true, // Enable proxy mode for automatic CORS header handling
      });
    };

    // ──────────────────────────────────────────────
    // S3 bucket for uploads
    // ──────────────────────────────────────────────
    const presentationAndSessionUploadsBucket = new cdk.aws_s3.Bucket(this, 'AIPresentationCoach-Presentations-Videos', {
      bucketName: `ai-presentation-coach-uploads-${suffix}`,
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
    // Lambda for presigned URL generation
    // ──────────────────────────────────────────────
    const s3UrlIssuerLambda = new lambda.Function(this, 's3UrlIssuerLambda', {
      functionName: `s3-url-issuer-${suffix}`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'get_presigned_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 's3_presigned_url_gen')),
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
        'PRESENTATION_TIMEOUT': '1200' //Max Presentation video duration timeout 20 minutes
      },
    });

    // ──────────────────────────────────────────────
    // Cognito User Pool
    // ──────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `ai-presentation-coach-users-${suffix}`,
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
      identityPoolName: `ai-presentation-coach-identity-${suffix}`,
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

    //Add users to gorups for role-based access control (RBAC)
    const adminGroup = new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      groupName: 'Admin',
      userPoolId: userPool.userPoolId,
      description: 'Administrators with full access to the system configs. Can create new personas, manage existing personas, and alter system defaults.',
    });

    const userGroup = new cognito.CfnUserPoolGroup(this, 'UserGroup', {
      groupName: 'User',
      userPoolId: userPool.userPoolId,
      description: 'Regular users. Can take sessions, upload presentations, and view their own data.',
    });

    // Grant Lambda permission to generate presigned URLs for the S3 bucket
    presentationAndSessionUploadsBucket.grantReadWrite(s3UrlIssuerLambda);

    // ──────────────────────────────────────────────
    // API Gateway definitions
    // ──────────────────────────────────────────────
    const apiGateway = new apigateway.LambdaRestApi(this, 'AIPresentationCoachApi', {
      restApiName: `ai-presentation-coach-api-${suffix}`,
      handler: s3UrlIssuerLambda,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      defaultMethodOptions: {
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Headers': true,
              'method.response.header.Access-Control-Allow-Methods': true,
            },
          },
        ],
      },
    });

    // Cognito Authorizer for API Gateway
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // S3 URLs resource
    let s3_urls_resource = apiGateway.root.addResource('s3_urls');
    s3_urls_resource.addMethod('GET', createCorsLambdaIntegration(s3UrlIssuerLambda), {
      authorizer: authorizer,
    });

    // ──────────────────────────────────────────────
    // Personas Dynamo DB Table Config
    // ──────────────────────────────────────────────
    const personasTable = new dynamodb.TableV2(this, 'UserPersonaTable', {
      tableName: `user-personas-${suffix}`,
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
      functionName: `persona-crud-${suffix}`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'persona_crud.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'dynamo_persona_lambdas')),
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
    // GET /personas - list all personas (with optional pagination)
    personas_resource.addMethod('GET', createCorsLambdaIntegration(personaCrudLambda));
    // POST /personas - create a new persona
    personas_resource.addMethod('POST', createCorsLambdaIntegration(personaCrudLambda));

    // /personas/{id} resource for GET, PUT, DELETE by ID
    let persona_id_resource = personas_resource.addResource('{personaID}');
    // GET /personas/{id} - get persona by ID
    persona_id_resource.addMethod('GET', createCorsLambdaIntegration(personaCrudLambda));
    // PUT /personas/{id} - update persona by ID
    persona_id_resource.addMethod('PUT', createCorsLambdaIntegration(personaCrudLambda));
    // DELETE /personas/{id} - delete persona by ID
    persona_id_resource.addMethod('DELETE', createCorsLambdaIntegration(personaCrudLambda));

    // ────────────────────────────────────────────
    // Persona Customization Lambda
    // ────────────────────────────────────────────
    
    // Setup guardrail to prevent persona injection
    const personaCustomizationGuardrail = new bedrockl1.CfnGuardrail(this, 'PersonaCustomizationGuardrail', {
      name: `PersonaCustomizationGuardrail-${suffix}`,
      description: 'Guardrail to check for harmful persona customizations and prevent persona injection attacks',
      blockedInputMessaging: 'The uploaded persona customization failed our security checks and has been rejected. Please review the content and try again.',
      blockedOutputsMessaging: 'The generated persona response has been blocked by our security filters due to harmful content. Please modify your persona customization and try again.',
      contentPolicyConfig: {
        // Setup content filters. Set defaults to block harmful content with highest scrutiny.
        // This setup is least permissive towards sensetive content in both inputs and outputs.
        // To allow for more permissive configurations, consider picking one of the following strategies:
        // LOW: Most permissive. Only blocks content that is extremely harmful (Least recommended).
        // MEDIUM: Moderately permissive. Blocks content that is harmful but allows for some edge cases (Recommended for allowing students to practice presenting for topics that may be political, explicit or otherwise sensetive).
        filtersConfig:[
          {type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH'},
          {type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH'},
          {type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH'},
          {type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH'},
          {type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH'},
          {type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE'},
        ]
      }
    });

    // Create initial guardrail version to use with ApplyGuardrail API (Required)
    const personaGuardrailVersion = new bedrockl1.CfnGuardrailVersion(this, 'GuardrailVersion', {
      guardrailIdentifier: personaCustomizationGuardrail.attrGuardrailId,
      description: 'Default Version'
    });

    const personaCustomizerLambda = new lambda.Function(this, 'PersonaCustomizerLambda', {
      functionName: `persona-customizer-${suffix}`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'persona_customizer.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'persona_customizer')),
      timeout: cdk.Duration.seconds(20),
      role: new iam.Role(this, 'PersonaCustomizerLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      }),
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'CUSTOMIZATION_UPLOAD_TIMEOUT': "5",
        'GUARDRAIL_ID': personaCustomizationGuardrail.attrGuardrailId,
        'GUARDRAIL_VERSION': personaGuardrailVersion.attrVersion
      },
    });

    // Grant Lambda permission to write to S3
    presentationAndSessionUploadsBucket.grantReadWrite(personaCustomizerLambda);

    // Add /customize_persona resource for persona customization uploads
    let customize_persona_resource = apiGateway.root.addResource('customize_persona');
    customize_persona_resource.addMethod('POST', createCorsLambdaIntegration(personaCustomizerLambda), {
      authorizer: authorizer,
    });

    // Grant Lambda permission to use Bedrock for guardrail checks
    personaCustomizerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:ApplyGuardrail"
        ],
        resources: [
          personaCustomizationGuardrail.attrGuardrailArn
        ]
      })
    );


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

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: apiGateway.url,
      description: 'API Gateway URL',
    });
  }
}
