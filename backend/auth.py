"""Bearer auth.

Two acceptable bearer formats:
  - ``act_...`` — a personal access token (see ``autocontent.repos.tokens``).
    Looked up by sha256(plaintext). Used by the CLI, MCP server, and any
    external agent driving the API without a browser session.
  - Anything else is treated as a Clerk session JWT, verified against
    Clerk's JWKS. On first sight we upsert the user row so FK references
    hold.
"""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWKClient

from autocontent.config import settings
from autocontent.repos import tokens as tokens_repo
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


async def _resolve_pat(token: str) -> AuthCtx:
    pat = await tokens_repo.get_by_token(token)
    if pat is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    # The PAT carries no email; trust the existing user row.
    user = await users_repo.get(pat.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token owner no longer exists")
    return AuthCtx(user_id=pat.user_id, email="")


async def _resolve_clerk_jwt(token: str) -> AuthCtx:
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


async def require_user(request: Request) -> AuthCtx:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = auth.split(" ", 1)[1]

    if token.startswith(tokens_repo.TOKEN_PREFIX):
        return await _resolve_pat(token)
    return await _resolve_clerk_jwt(token)


CurrentUser = Depends(require_user)
