import * as path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const userPool = new cognito.UserPool(this, 'AI-Presentation-Coach-UserPool', {
      userPoolName: 'AI-Presentation-Coach-UserPool',
      // Configure sign-in options, e.g., using email as username
      signInAliases: {
        email: true,
        username: false,
      },
      // Configure password policy
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      // Configure account recovery options
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Make usernames/emails case insensitive (cannot be changed after creation)
      signInCaseSensitive: false,
    });

    const presentationAndSessionUploadsBucket = new cdk.aws_s3.Bucket(this, 'AIPresentationCoach-Presentations-Videos', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const s3UrlIssuerLambda = new lambda.Function(this, 'MyLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'get_presigned_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambdas', 'python')),
      timeout: cdk.Duration.seconds(20),
      environment: {
        'UPLOADS_BUCKET': presentationAndSessionUploadsBucket.bucketName,
        'PDF_UPLOAD_TIMEOUT': '120', //PDF upload timeout in 2 minutes
        'PRESENTATION_TIMEOUT': '1200' //Max Presentation video duration timeout 20 minutes
      },
    });

    // API Gateway definitions
    const apiGateway = new apigateway.LambdaRestApi(this, 'AIPresentationCoachApi', {
      handler: s3UrlIssuerLambda,
      proxy: false,
    });

    // S3 URLs resource
    let s3_urls_resource = apiGateway.root.addResource('s3_urls');
    s3_urls_resource.addMethod('GET', new apigateway.LambdaIntegration(s3UrlIssuerLambda));

    
    //Personas Dynamo DB Table Config
    const personasTable = new dynamodb.TableV2(this, 'AIPresentationAudiencePersonaTable', {
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
      handler: 'persona_crud.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambdas', 'dynamo_persona_lambdas')),
      timeout: cdk.Duration.seconds(20),
      environment: {
        'DYNAMODB_TABLE_NAME': personasTable.tableName,
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

  } 
}
