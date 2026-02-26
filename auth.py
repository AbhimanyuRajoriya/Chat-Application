import httpx
import json
import logging
import os
import base64
from jose import jwt, JWTError

from config import COGNITO_JWK_URL, COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID

logger = logging.getLogger(__name__)

class CognitoAuthenticator:
    """Handles JWT validation from AWS Cognito"""
    
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
        """
        Verify JWT token from Cognito
        
        Returns:
            Decoded token payload
        """
        # Validate token has 3 parts
        parts = token.split('.')
        if len(parts) != 3:
            logger.error(f"Invalid token format: expected 3 parts, got {len(parts)}")
            raise JWTError(f"Invalid token format: {len(parts)} parts instead of 3")

        # ── DEV MODE BYPASS ──────────────────────────────────────────────
        if self.dev_mode:
            try:
                # Decode without verification
                payload = self._decode_token_payload(token)
                username = payload.get('username') or payload.get('cognito:username')
                logger.info(f"✅ DEV MODE: Token decoded successfully for user: {username}")
                return payload
            except Exception as e:
                logger.error(f"❌ DEV MODE: Failed to decode token: {e}")
                raise JWTError(f"Dev mode token decode failed: {e}")
        # ─────────────────────────────────────────────────────────────────

        # Production mode: Verify with Cognito JWKs
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

    def _decode_token_payload(self, token: str) -> dict:
        """
        Decode JWT payload without verification (dev mode only)
        """
        parts = token.split('.')
        if len(parts) < 2:
            raise JWTError("Invalid token format")
        
        try:
            # Get payload (second part)
            payload_b64 = parts[1]
            
            # Add padding if needed
            padding = 4 - len(payload_b64) % 4
            if padding != 4:
                payload_b64 += '=' * padding
            
            # Decode from base64url
            payload_json = base64.urlsafe_b64decode(payload_b64)
            payload = json.loads(payload_json)
            
            return payload
        except Exception as e:
            raise JWTError(f"Failed to decode payload: {e}")


# Global authenticator instance
authenticator = CognitoAuthenticator()


async def get_current_user(token: str) -> dict:
    """
    Dependency for validating JWT tokens
    
    Returns:
        Decoded token payload with user info
    """
    payload = await authenticator.verify_token(token)
    username = payload.get("cognito:username") or payload.get("username")
    
    if not username:
        raise JWTError("Token missing username")
    
    return {
        "username": username,
        "user_id": payload.get("sub"),
        "token": token
    }
