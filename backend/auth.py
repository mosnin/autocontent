"""Bearer auth.

Two acceptable bearer formats:
  - ``mkt_...`` — a personal access token (see ``marketer.repos.tokens``).
    Looked up by sha256(plaintext). Used by the CLI, MCP server, and any
    external agent driving the API without a browser session.
  - Anything else is treated as a Clerk session JWT, verified against
    Clerk's JWKS. On first sight we upsert the user row so FK references
    hold.

Rate limiting on auth failures
-------------------------------
When either the PAT or JWT branch rejects a bearer token we consume one token
from a per-IP bucket (20 failures / minute) via the shared slowapi limiter.
This ensures brute-force PAT enumeration is throttled even before any route
decorator fires.  The bucket key is the client IP (first X-Forwarded-For hop behind the
ingress, else the socket peer) so it cannot be
bypassed by rotating bearer strings.
"""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWKClient
from limits import parse as parse_limit

from marketer.config import settings
from marketer.repos import tokens as tokens_repo
from marketer.repos import users as users_repo

_jwks_client: PyJWKClient | None = None

# Per-IP bucket for authentication failures: 20 bad attempts per minute.
_AUTH_FAILURE_LIMIT = parse_limit("20/minute")
_AUTH_FAILURE_SCOPE = "auth_failure"


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not settings.clerk_jwks_url:
            raise RuntimeError("MARKETER_CLERK_JWKS_URL not set")
        _jwks_client = PyJWKClient(settings.clerk_jwks_url, cache_keys=True)
    return _jwks_client


@dataclass
class AuthCtx:
    user_id: str
    email: str


def _consume_failure_token(request: Request) -> None:
    """Consume one token from the per-IP auth-failure rate-limit bucket.

    Imported lazily to avoid a circular import at module load time
    (rate_limit → config; auth → rate_limit).

    Raises 429 immediately if the bucket is exhausted (hit() returns False).
    The hit is consumed even on success so each failure still counts.

    If the request object does not have a ``client`` attribute (e.g. in unit
    tests using a lightweight fake request) the call is a no-op so existing
    tests that bypass rate-limiting continue to work unchanged.
    """
    if not hasattr(request, "client"):
        return

    from .rate_limit import client_ip, limiter  # local import avoids circular dependency

    ip = client_ip(request)
    allowed = limiter.limiter.hit(_AUTH_FAILURE_LIMIT, ip, _AUTH_FAILURE_SCOPE)
    if not allowed:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too many failed auth attempts — try again later",
        )


async def _resolve_pat(token: str, request: Request) -> AuthCtx:
    pat = await tokens_repo.get_by_token(token)
    if pat is None:
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    # The PAT carries no email; trust the existing user row.
    user = await users_repo.get(pat.user_id)
    if user is None:
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token owner no longer exists")
    return AuthCtx(user_id=pat.user_id, email="")


async def _resolve_clerk_jwt(token: str, request: Request) -> AuthCtx:
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token).key
        # aud is verified when MARKETER_CLERK_AUDIENCE is configured;
        # issuer when MARKETER_CLERK_ISSUER is. Both should be set in
        # production — otherwise any RS256 token from the same JWKS
        # (e.g. minted for a different frontend on the same Clerk
        # instance) is accepted.
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer or None,
            audience=settings.clerk_audience or None,
            options={"verify_aud": bool(settings.clerk_audience)},
        )
    except jwt.PyJWTError as e:
        _consume_failure_token(request)
        # Don't echo library internals to the client; log them instead.
        import logging

        logging.getLogger(__name__).info("JWT rejected: %s", e)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from e

    user_id = claims.get("sub")
    email = claims.get("email") or claims.get("primary_email_address") or ""
    if not user_id:
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing sub claim")

    await users_repo.upsert(user_id, email)
    return AuthCtx(user_id=user_id, email=email)


async def require_user(request: Request) -> AuthCtx:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = auth.split(" ", 1)[1]

    if token.startswith(tokens_repo.TOKEN_PREFIX):
        return await _resolve_pat(token, request)
    return await _resolve_clerk_jwt(token, request)


CurrentUser = Depends(require_user)
