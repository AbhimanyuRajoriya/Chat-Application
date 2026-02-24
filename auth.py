import httpx
import json
from jose import jwt, JWTError
from functools import lru_cache
import logging
from config import COGNITO_JWK_URL, COGNITO_REGION, COGNITO_USER_POOL_ID

logger = logging.getLogger(__name__)

class CognitoAuthenticator:
    """Handles JWT validation from AWS Cognito"""
    
    def __init__(self):
        self.jwk_client = None
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
        
        Args:
            token: JWT token string
            
        Returns:
            Dictionary with decoded token data
            
        Raises:
            JWTError: If token is invalid
        """
        try:
            # Get JWK set
            jwks = await self.get_jwks()
            
            # Get header to find key ID
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            
            if not kid:
                raise JWTError("Token header missing 'kid'")
            
            # Find matching key
            key = None
            for k in jwks.get("keys", []):
                if k.get("kid") == kid:
                    key = k
                    break
            
            if not key:
                raise JWTError(f"Unable to find a signing key that matches: {kid}")
            
            # Verify token
            payload = jwt.decode(
                token,
                json.dumps(key),
                algorithms=["RS256"],
                options={"verify_signature": True}
            )
            
            # Verify token is from correct user pool
            iss = payload.get("iss")
            expected_iss = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
            
            if iss != expected_iss:
                raise JWTError(f"Invalid issuer: {iss}")
            
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
    
    Args:
        token: JWT token from WebSocket query parameter
        
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
