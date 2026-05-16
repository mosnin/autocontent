"""Clerk JWT verification.

The Next.js app sends Clerk's session JWT as a Bearer token. We verify
it against Clerk's JWKS (cached) and extract `sub` as the user id.
On first sight, we upsert the user row so FK references hold.
"""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWKClient

from autocontent.config import settings
from autocontent.repos import users as users_repo

_jwks_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not settings.clerk_jwks_url:
            raise RuntimeError("AUTOCONTENT_CLERK_JWKS_URL not set")
        _jwks_client = PyJWKClient(settings.clerk_jwks_url, cache_keys=True)
    return _jwks_client


@dataclass
class AuthCtx:
    user_id: str
    email: str


async def require_user(request: Request) -> AuthCtx:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = auth.split(" ", 1)[1]

    try:
        signing_key = _jwks().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer or None,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid token: {e}") from e

    user_id = claims.get("sub")
    email = claims.get("email") or claims.get("primary_email_address") or ""
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing sub claim")

    await users_repo.upsert(user_id, email)
    return AuthCtx(user_id=user_id, email=email)


CurrentUser = Depends(require_user)
