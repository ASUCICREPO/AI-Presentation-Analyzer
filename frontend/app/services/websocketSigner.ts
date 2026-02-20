import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@aws-sdk/protocol-http';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

/**
 * Sign a WebSocket URL with AWS SigV4 authentication.
 * 
 * This creates a pre-signed WebSocket URL with SigV4 signature in query parameters.
 * AgentCore validates the signature and establishes the WebSocket connection.
 * 
 * @param url - Base WebSocket URL (wss://bedrock-agentcore.region.amazonaws.com/runtimes/arn/ws)
 * @param credentials - Temporary AWS credentials from Cognito Identity Pool
 * @param region - AWS region (e.g., 'us-east-1')
 * @returns Signed WebSocket URL with SigV4 query parameters
 */
export async function signWebSocketUrl(
  url: string,
  credentials: AwsCredentialIdentity,
  region: string
): Promise<string> {
  const urlObj = new URL(url);
  
  // Create HTTP request for signing
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'wss:',
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search, // Include existing query params
    headers: {
      host: urlObj.hostname,
    },
  });

  // Create SigV4 signer
  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region: region,
    credentials: credentials,
    sha256: Sha256,
  });

  // Sign the request (creates pre-signed URL with 5 minute expiration)
  const signedRequest = await signer.presign(request, {
    expiresIn: 300, // 5 minutes
  });

  // Build final WebSocket URL with SigV4 query parameters
  const signedUrl = new URL(url);
  
  // Add SigV4 signature parameters
  if (signedRequest.query) {
    Object.entries(signedRequest.query).forEach(([key, value]) => {
      signedUrl.searchParams.set(key, value as string);
    });
  }

  return signedUrl.toString();
}
