import httpx
import json
import logging
import os
from jose import jwt, JWTError
import boto3

from config import COGNITO_JWK_URL, COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID

logger = logging.getLogger(__name__)

# Initialize Cognito client (for fetching custom attributes)
cognito_client = boto3.client('cognito-idp', region_name=COGNITO_REGION)


class CognitoAuthenticator:
    """Handles JWT validation and fetches chat_username from Cognito"""

    def __init__(self):
        self.jwks = None
        self.dev_mode = os.getenv("SKIP_JWT_VERIFY", "false").lower() == "true"
        if self.dev_mode:
            logger.warning("⚠️ DEV MODE ENABLED: JWT signature verification is SKIPPED")

    async def get_jwks(self):
        """Fetch JWK set from Cognito"""
        if self.jwks:
            return self.jwks
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(COGNITO_JWK_URL, timeout=5)
                response.raise_for_status()
                self.jwks = response.json()
                return self.jwks
        except Exception as e:
            logger.error(f"Error fetching JWKS: {e}")
            raise

    async def verify_token(self, token: str) -> dict:
        """Verify JWT token from Cognito and return payload"""
        if self.dev_mode:
            logger.warning("⚠️ DEV MODE: Skipping token verification")
            return {"sub": "dev-user"}  # fallback for dev

        try:
            jwks = await self.get_jwks()

            # Get unverified header
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            if not kid:
                raise JWTError("Token header missing 'kid'")

            # Find matching JWK
            key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
            if not key:
                raise JWTError(f"No matching JWK found for kid: {kid}")

            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))

            payload = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=COGNITO_CLIENT_ID,
                issuer=f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
            )

            return payload

        except JWTError as e:
            logger.error(f"JWT validation failed: {e}")
            raise
        except Exception as e:
            logger.error(f"Token verification error: {e}")
            raise JWTError(f"Token verification failed: {e}")

    def get_chat_username(self, sub: str) -> str:
        """
        Fetch the custom attribute 'chat_username' from Cognito using user sub
        """
        try:
            response = cognito_client.admin_get_user(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=sub
            )
            for attr in response.get("UserAttributes", []):
                if attr["Name"] == "custom:chat_username":
                    return attr["Value"]
            logger.warning(f"No custom:chat_username found for user {sub}")
            return None
        except Exception as e:
            logger.error(f"Error fetching chat_username from Cognito: {e}")
            return None


# Global authenticator instance
authenticator = CognitoAuthenticator()


async def get_current_user(token: str) -> dict:
    """
    Dependency for validating JWT tokens and fetching username from Cognito
    """
    payload = await authenticator.verify_token(token)
    sub = payload.get("sub")
    if not sub:
        raise JWTError("Token missing sub claim")

    # Fetch chat_username from Cognito
    username = authenticator.get_chat_username(sub)
    if not username:
        # fallback if custom attribute not set
        username = f"User_{sub[:6]}"

    return {
        "username": username,
        "user_id": sub,
        "token": token
    }