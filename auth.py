import logging
import random

logger = logging.getLogger(__name__)

# DEV MODE: JWT and Cognito skipped
class DevAuthenticator:
    """Fake authenticator for demo purposes"""

    async def verify_token(self, token: str):
        logger.warning("⚠️ DEV MODE: Skipping token verification")
        # Return fake payload
        return {"sub": f"dev-{random.randint(1000,9999)}"}

    def get_chat_username(self, sub: str):
        # Generate a simple username from sub
        return f"User_{sub[-4:]}"


# Global authenticator instance
authenticator = DevAuthenticator()


async def get_current_user(token: str) -> dict:
    """
    Returns a fake user object for dev/demo purposes
    """
    payload = await authenticator.verify_token(token)
    sub = payload.get("sub") or f"dev-{random.randint(1000,9999)}"
    username = authenticator.get_chat_username(sub)

    return {
        "username": username,
        "user_id": sub,
        "token": token or f"dev-token-{sub}"
    }