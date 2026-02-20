import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@aws-sdk/protocol-http';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

/**
 * Sign a WebSocket URL with AWS SigV4 authentication.
 * 
 * Creates a pre-signed WebSocket URL with SigV4 signature in query parameters.
 * AgentCore validates the signature and establishes the WebSocket connection.
 */
export async function signWebSocketUrl(
  url: string,
  credentials: AwsCredentialIdentity,
  region: string
): Promise<string> {
  const urlObj = new URL(url);

  const query: Record<string, string> = {};
  urlObj.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: urlObj.hostname,
    path: urlObj.pathname,
    query,
    headers: {
      host: urlObj.hostname,
    },
  });

  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region: region,
    credentials: credentials,
    sha256: Sha256,
  });

  const signedRequest = await signer.presign(request, {
    expiresIn: 300,
  });

  const queryParts: string[] = [];
  if (signedRequest.query) {
    for (const [key, value] of Object.entries(signedRequest.query)) {
      queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
    }
  }

  return `wss://${urlObj.hostname}${signedRequest.path}?${queryParts.join('&')}`;
}
