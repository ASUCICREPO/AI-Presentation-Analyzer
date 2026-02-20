import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { cognitoConfig } from '../config/config';

/**
 * Get temporary AWS credentials from Cognito Identity Pool.
 * 
 * This uses the authenticated user's Cognito ID token to exchange for
 * temporary AWS credentials (access key, secret key, session token).
 * These credentials are then used to sign WebSocket URLs with SigV4.
 */
export async function getAwsCredentials(getIdToken: () => Promise<string>) {
  const idToken = await getIdToken();
  
  const credentialProvider = fromCognitoIdentityPool({
    clientConfig: { region: cognitoConfig.region },
    identityPoolId: cognitoConfig.identityPoolId,
    logins: {
      [`cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`]: idToken,
    },
  });

  return await credentialProvider();
}
