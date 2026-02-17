import boto3
import json
import os
import time
from jose import jwt, JWTError
import requests

# ─── Environment variables ────────────────────────────────────────────
USER_POOL_ID = os.environ.get('USER_POOL_ID')
USER_POOL_CLIENT_ID = os.environ.get('USER_POOL_CLIENT_ID')
REGION = os.environ.get('AWS_REGION', 'us-east-1')

if not USER_POOL_ID:
    print("[ERROR] USER_POOL_ID environment variable is not set")
    raise ValueError("USER_POOL_ID environment variable is not set")

# ─── Cognito JWKS Cache ───────────────────────────────────────────────
JWKS_URL = f'https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json'
jwks_cache = None
jwks_cache_time = 0
JWKS_CACHE_TTL = 3600  # 1 hour


def get_jwks():
    """Fetch JWKS from Cognito with caching."""
    global jwks_cache, jwks_cache_time
    current_time = time.time()

    if jwks_cache and (current_time - jwks_cache_time) < JWKS_CACHE_TTL:
        return jwks_cache

    try:
        response = requests.get(JWKS_URL, timeout=5)
        response.raise_for_status()
        jwks_cache = response.json()
        jwks_cache_time = current_time
        print(f"[INFO] JWKS fetched and cached")
        return jwks_cache
    except Exception as e:
        print(f"[ERROR] Failed to fetch JWKS: {e}")
        return None


def verify_jwt_token(token):
    """Verify and decode JWT token from Cognito."""
    try:
        # Get JWKS
        jwks = get_jwks()
        if not jwks:
            print("[ERROR] Could not fetch JWKS")
            return None

        # Decode token header to get the key ID
        unverified_header = jwt.get_unverified_header(token)
        rsa_key = None

        # Find the correct key from JWKS
        for key in jwks.get('keys', []):
            if key['kid'] == unverified_header['kid']:
                rsa_key = {
                    'kty': key['kty'],
                    'kid': key['kid'],
                    'use': key['use'],
                    'n': key['n'],
                    'e': key['e']
                }
                break

        if not rsa_key:
            print("[ERROR] No matching key found in JWKS")
            return None

        # Verify and decode the token
        issuer = f'https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}'
        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=['RS256'],
            audience=USER_POOL_CLIENT_ID,
            issuer=issuer
        )

        print(f"[INFO] JWT verified for user: {payload.get('sub')}")
        return payload

    except JWTError as e:
        print(f"[ERROR] JWT verification failed: {e}")
        return None
    except Exception as e:
        print(f"[ERROR] Unexpected error verifying JWT: {e}")
        return None


def generate_policy(principal_id, effect, method_arn, context=None):
    """Generate IAM policy for API Gateway."""
    auth_response = {
        'principalId': principal_id
    }

    if effect and method_arn:
        policy_document = {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Action': 'execute-api:Invoke',
                    'Effect': effect,
                    'Resource': method_arn
                }
            ]
        }
        auth_response['policyDocument'] = policy_document

    # Add context if provided (will be available in connection handler)
    if context:
        auth_response['context'] = context

    return auth_response


def lambda_handler(event, context):
    """Lambda authorizer handler for WebSocket connections."""
    try:
        print(f"[INFO] Authorizer event: {json.dumps(event)}")

        # Extract token from query string
        query_params = event.get('queryStringParameters') or {}
        token = query_params.get('token')

        if not token:
            print("[WARN] No token provided in query string")
            raise Exception('Unauthorized')

        # Verify JWT token
        payload = verify_jwt_token(token)
        if not payload:
            print("[WARN] Invalid or expired JWT token")
            raise Exception('Unauthorized')

        # Extract user information
        user_id = payload.get('sub')
        email = payload.get('email', '')
        username = payload.get('cognito:username', '')

        if not user_id:
            print("[ERROR] No user ID in JWT payload")
            raise Exception('Unauthorized')

        # Generate allow policy with user context
        method_arn = event.get('methodArn')

        # Make the policy permissive for all routes in this API
        # This allows the user to call $connect, $disconnect, and $default
        arn_parts = method_arn.split('/')
        base_arn = '/'.join(arn_parts[:-1])  # Remove the route part
        wildcard_arn = f"{base_arn}/*"  # Allow all routes

        print(f"[INFO] Authorizing user {user_id} for {wildcard_arn}")

        return generate_policy(
            principal_id=user_id,
            effect='Allow',
            method_arn=wildcard_arn,
            context={
                'userId': user_id,
                'email': email,
                'username': username
            }
        )

    except Exception as e:
        print(f"[ERROR] Authorization failed: {e}")
        # Return deny policy or raise exception (both result in 401 Unauthorized)
        raise Exception('Unauthorized')
