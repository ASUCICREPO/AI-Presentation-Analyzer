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

    let s3_urls_resource = apiGateway.root.addResource('s3_urls'); //Add /s3_urls resource to the API Gateway
    s3_urls_resource.addMethod('GET', new   apigateway.LambdaIntegration(s3UrlIssuerLambda)); //Add GET method to the /s3_urls resource
    

    //Dynamo DB Table Config
    const myTable = new dynamodb.TableV2(this, 'AIPresentationAudiencePersonaTable', {
      // Required: Define the partition key
      partitionKey: {
        name: 'personaID', // The name of the partition key attribute
        type: dynamodb.AttributeType.STRING, // The data type (STRING, NUMBER, BINARY)
      },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // pointInTimeRecovery: true, // Commenting for now to avoid additional costs, can be enabled in production for data protection.
    });

  } 
}
