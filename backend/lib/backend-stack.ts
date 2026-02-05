import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

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
      bucketName: 'ai-presentation-coach-presentation-videos',
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
  }
}
