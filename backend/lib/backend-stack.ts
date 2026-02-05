import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const userPool = new cognito.UserPool(this, 'MyUserPool', {
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
  }
}
