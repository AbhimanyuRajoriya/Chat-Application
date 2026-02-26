import httpx
import json
import logging
from jose import jwt, JWTError

from config import COGNITO_JWK_URL, COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_APP_CLIENT_ID

logger = logging.getLogger(__name__)

class CognitoAuthenticator:
    """Handles JWT validation from AWS Cognito"""
    
    def __init__(self):
        self.jwks = None

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
        """
        Verify JWT token from Cognito
        
        Returns:
            Decoded token payload
        """
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

            # Convert JWK to public key
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))

            # Decode and verify token
            payload = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=COGNITO_APP_CLIENT_ID,
                issuer=f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
            )

            return payload

        except JWTError as e:
            logger.error(f"JWT validation failed: {e}")
            raise
        except Exception as e:
            logger.error(f"Token verification error: {e}")
            raise JWTError(f"Token verification failed: {e}")


# Global authenticator instance
authenticator = CognitoAuthenticator()


async def get_current_user(token: str) -> dict:
    """
    Dependency for validating JWT tokens
    
    Returns:
        Decoded token payload with user info
    """
    payload = await authenticator.verify_token(token)
    username = payload.get("cognito:username")
    
    if not username:
        raise JWTError("Token missing cognito:username")
    
    return {
        "username": username,
        "user_id": payload.get("sub"),
        "token": token
    }