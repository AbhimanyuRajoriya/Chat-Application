import os
import json
import base64
import logging
from typing import Optional, Dict

import httpx
from jose import jwt

logger = logging.getLogger("auth")

COGNITO_REGION = os.getenv("COGNITO_REGION", "us-east-1").strip()
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "").strip()
COGNITO_CLIENT_ID = os.getenv("COGNITO_CLIENT_ID", "").strip()
COGNITO_DOMAIN = os.getenv("COGNITO_DOMAIN", "").strip()

SKIP_JWT_VERIFY = os.getenv("SKIP_JWT_VERIFY", "false").lower() == "true"

_JWKS_CACHE: Optional[Dict] = None


def _b64url_json_decode(part: str) -> dict:
    # base64url -> bytes -> json
    part = part.replace("-", "+").replace("_", "/")
    pad = "=" * ((4 - len(part) % 4) % 4)
    raw = base64.b64decode(part + pad)
    return json.loads(raw.decode("utf-8"))


def decode_unverified(token: str) -> dict:
    parts = (token or "").split(".")
    if len(parts) != 3:
        return {}
    try:
        return _b64url_json_decode(parts[1])
    except Exception:
        return {}


async def get_jwks() -> dict:
    global _JWKS_CACHE
    if _JWKS_CACHE:
        return _JWKS_CACHE

    if not (COGNITO_REGION and COGNITO_USER_POOL_ID):
        raise RuntimeError("Missing COGNITO_REGION / COGNITO_USER_POOL_ID")

    url = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/jwks.json"
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(url)
        r.raise_for_status()
        _JWKS_CACHE = r.json()
        return _JWKS_CACHE


def extract_email(payload: dict) -> str:
    email = (
        payload.get("email")
        or payload.get("cognito:username")
        or payload.get("username")
        or payload.get("preferred_username")
        or ""
    )
    email = str(email).strip().lower()
    return email if email else "guest@local"


async def verify_id_token(id_token: str) -> dict:
    """
    Returns token payload.
    - If SKIP_JWT_VERIFY=true, we only decode (no signature verification).
    - Else we verify using Cognito JWKS.
    """
    if not id_token or id_token == "dummy":
        return {}

    if SKIP_JWT_VERIFY:
        payload = decode_unverified(id_token)
        return payload

    jwks = await get_jwks()

    # jose.jwt will pick the correct key via kid internally if you pass jwks set
    # But python-jose doesn't accept jwks directly in jwt.decode.
    # So we manually select the key by kid.
    headers = jwt.get_unverified_header(id_token)
    kid = headers.get("kid")

    key = None
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            key = k
            break

    if not key:
        raise RuntimeError("JWKS key not found for token kid")

    issuer = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"

    payload = jwt.decode(
        id_token,
        key,
        algorithms=["RS256"],
        audience=COGNITO_CLIENT_ID,
        issuer=issuer,
        options={"verify_at_hash": False},
    )
    return payload


async def get_current_user(token: str) -> dict:
    payload = await verify_id_token(token)
    email = extract_email(payload)
    user_id = str(payload.get("sub") or email)
    return {"email": email, "user_id": user_id, "token": token}


async def exchange_code_for_tokens(code: str, redirect_uri: str) -> dict:
    """
    Exchange Hosted UI ?code=... to tokens using /oauth2/token
    """
    if not COGNITO_DOMAIN:
        raise RuntimeError("Missing COGNITO_DOMAIN")
    if not COGNITO_CLIENT_ID:
        raise RuntimeError("Missing COGNITO_CLIENT_ID")

    token_url = f"https://{COGNITO_DOMAIN}/oauth2/token"

    data = {
        "grant_type": "authorization_code",
        "client_id": COGNITO_CLIENT_ID,
        "code": code,
        "redirect_uri": redirect_uri,
    }

    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(token_url, data=data, headers=headers)
        r.raise_for_status()
        return r.json()