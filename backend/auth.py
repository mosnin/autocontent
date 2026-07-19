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

Scopes (least-privilege PATs)
------------------------------
Every PAT now carries a ``scopes`` grant (read / write / admin — see
``marketer.repos.tokens`` for the vocabulary and
``db/migrations/0026_pat_scopes.sql`` for the column). ``AuthCtx.scopes`` is
``None`` for a Clerk-JWT (web session) caller — those remain unscoped/full
access exactly as before scoping existed. It is always a ``list[str]`` for a
PAT caller, read fresh from the DB on every request (never trusted from
client input past token issuance).

``require_scope(scope)`` is a dependency factory routes can depend on
directly, e.g. ``ctx: AuthCtx = require_scope("write")``. For blanket
default enforcement (GET -> read, mutating method -> write) without
annotating every individual route, ``enforce_method_scope`` /
``RequireMethodScope`` implements the same check keyed off
``request.method`` — wire it as a router-level dependency (see the
docstring on ``enforce_method_scope`` for exactly how).

Per-token rate limiting
------------------------
``token_or_ip_key`` is a slowapi ``key_func`` that buckets a PAT caller by
token id (so one leaked/shared credential can't hammer the API regardless
of source IP) and falls back to the existing XFF-hardened client IP for
JWT/web callers. See its docstring for wiring instructions.
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


def _expected_issuer() -> str | None:
    """The issuer we require on Clerk JWTs.

    Prefers the explicit ``MARKETER_CLERK_ISSUER``. When that's unset we
    derive it from the JWKS URL: Clerk's ``iss`` claim is the Frontend API
    origin and the JWKS lives at ``{iss}/.well-known/jwks.json``, so
    stripping that suffix yields the issuer for free. This makes issuer
    verification the default even when only the JWKS URL is configured, so a
    token signed by a *different* Clerk instance's key can't be replayed
    here. Returns None only when we genuinely can't determine an issuer, in
    which case issuer verification is skipped (fail-open, as before).
    """
    if settings.clerk_issuer:
        return settings.clerk_issuer
    url = settings.clerk_jwks_url.strip()
    suffix = "/.well-known/jwks.json"
    if url.endswith(suffix):
        return url[: -len(suffix)]
    return None


@dataclass
class AuthCtx:
    user_id: str
    email: str
    role: str = "user"
    # ``None`` == unscoped/full access (Clerk-JWT / web session caller —
    # preserved exactly as before scopes existed). A PAT caller always gets
    # a concrete list (possibly empty), read fresh from the DB per request.
    scopes: list[str] | None = None


@dataclass
class AdminCtx:
    """Privileged request context. Carries request metadata so every admin
    action can be attributed in the audit log (actor, IP, user-agent)."""

    user_id: str
    email: str
    ip: str
    user_agent: str


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
    _reject_if_suspended(user)
    # Stash the token id so a per-request rate-limit key_func (see
    # token_or_ip_key) can bucket on the credential instead of the source IP,
    # without needing to re-run auth resolution itself. `pat.id` is absent on
    # some pre-scopes test doubles that only stub `user_id` — tolerate that
    # (falls back to IP-keyed limiting for those, same as before this change).
    pat_id = getattr(pat, "id", None)
    if pat_id is not None and hasattr(request, "state"):
        request.state.pat_id = str(pat_id)
    # `scopes` is likewise absent on those same minimal test doubles (e.g. a
    # bare SimpleNamespace(user_id=...)). A real PersonalAccessToken row
    # always carries a concrete list (Pydantic field default + the 0026
    # migration's column default), so this branch is only ever hit by a
    # pre-scopes test fake — treat it exactly like a pre-scoping PAT always
    # behaved: unscoped/full access, same as ctx.scopes=None for a JWT.
    scopes = getattr(pat, "scopes", None)
    scope_list = list(scopes) if scopes is not None else None
    return AuthCtx(user_id=pat.user_id, email=user.email, role=user.role, scopes=scope_list)


async def _resolve_clerk_jwt(token: str, request: Request) -> AuthCtx:
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token).key
        # Issuer is verified whenever we can determine it — explicitly via
        # MARKETER_CLERK_ISSUER, or derived from the JWKS URL (see
        # _expected_issuer) — so a token from a different Clerk instance's
        # key is rejected. Audience is verified only when
        # MARKETER_CLERK_AUDIENCE is set; set it in production to also reject
        # a token minted for a *different frontend on the same* instance.
        issuer = _expected_issuer()
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=issuer,
            audience=settings.clerk_audience or None,
            options={
                "verify_aud": bool(settings.clerk_audience),
                "verify_iss": issuer is not None,
            },
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

    user = await users_repo.upsert(user_id, email)
    _reject_if_suspended(user)
    return AuthCtx(user_id=user_id, email=email, role=user.role)


def _reject_if_suspended(user) -> None:
    """A suspended account is refused every request (defense in depth: the
    check lives in the auth path, not just the UI)."""
    if getattr(user, "suspended_at", None) is not None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "account suspended — contact support",
        )


async def require_user(request: Request) -> AuthCtx:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = auth.split(" ", 1)[1]

    if token.startswith(tokens_repo.TOKEN_PREFIX):
        return await _resolve_pat(token, request)
    return await _resolve_clerk_jwt(token, request)


CurrentUser = Depends(require_user)


async def require_admin(request: Request) -> AdminCtx:
    """Privileged dependency: valid auth AND role == 'admin'.

    Returns an AdminCtx enriched with request metadata for the audit log.
    A non-admin gets 403 (not 404) — admins are a known, small set and the
    obfuscation buys nothing while complicating support. The role is read
    from the DB on every call (no role claim is trusted from the token).

    A PAT caller additionally needs the 'admin' scope: role alone is
    necessary but not sufficient for a scoped credential (an admin's
    read/write-only token should not reach admin routes). A JWT/web session
    is unscoped (ctx.scopes is None) and is unaffected — same behaviour as
    before scoping existed."""
    ctx = await require_user(request)
    if ctx.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    _check_scope(ctx, "admin")

    from .rate_limit import client_ip

    return AdminCtx(
        user_id=ctx.user_id,
        email=ctx.email,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:512],
    )


def _check_scope(ctx: AuthCtx, scope: str) -> None:
    """Enforce that ``ctx`` carries ``scope``.

    ``ctx.scopes is None`` means an unscoped (Clerk-JWT / web session)
    caller — full access, unaffected by PAT scoping. Otherwise ``scope``
    must be present in the list read from the DB for this token; an
    unknown/empty scope set fails closed (denies both reads and writes,
    since 'read' itself would be absent)."""
    if ctx.scopes is None:
        return
    if scope not in ctx.scopes:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"token is missing required scope: {scope!r}",
        )


def require_scope(scope: str):
    """Dependency factory: ``ctx: AuthCtx = require_scope("write")``.

    Resolves auth exactly like ``CurrentUser`` (the underlying
    ``require_user`` call is cached per-request by FastAPI, so this does not
    re-run auth resolution) and additionally enforces the given scope. Use
    this on routes that need a scope other than the request's own HTTP
    method would imply, or to be explicit at the call site.
    """

    async def _dep(ctx: AuthCtx = CurrentUser) -> AuthCtx:
        _check_scope(ctx, scope)
        return ctx

    return Depends(_dep)


def _method_scope(method: str) -> str:
    return "read" if method.upper() in ("GET", "HEAD", "OPTIONS") else "write"


async def enforce_method_scope(request: Request, ctx: AuthCtx = CurrentUser) -> AuthCtx:
    """Default scope-by-HTTP-method enforcement: GET/HEAD/OPTIONS -> 'read',
    anything else (POST/PUT/PATCH/DELETE) -> 'write'.

    This lets the orchestrator apply blanket least-privilege enforcement to
    a whole router *without* editing every individual route function: add it
    as a router-level dependency, e.g.

        router = APIRouter(dependencies=[RequireMethodScope])

    or when including an existing router in main.py:

        app.include_router(some_router, dependencies=[RequireMethodScope])

    Routes that need a scope independent of their HTTP verb (e.g. a POST
    that's semantically a read, or anything needing 'admin') should instead
    depend on ``require_scope(...)`` explicitly and skip this one.
    Unscoped (JWT/web) callers are unaffected, matching ``_check_scope``.
    """
    _check_scope(ctx, _method_scope(request.method))
    return ctx


def token_or_ip_key(request: Request) -> str:
    """slowapi ``key_func``: bucket per-PAT rather than per-IP so a single
    credential can't hammer the API from many source IPs (or from behind a
    shared/rotating IP).

    Requires ``request.state.pat_id`` to already be populated, which happens
    inside ``_resolve_pat`` — i.e. some auth dependency (``CurrentUser``,
    ``require_scope(...)``, ``enforce_method_scope``, ...) must run before
    slowapi's own key_func does. In practice this is automatic: FastAPI
    resolves a route's ``Depends()`` parameters (including auth) before
    calling the route function, and slowapi's ``@limiter.limit(...)``
    decorator wraps that route function, so its key_func always runs after
    auth has had a chance to stash the token id.

    Falls back to the existing XFF-hardened client IP (see
    ``rate_limit.client_ip``) for JWT/web callers, and for any request where
    no PAT-auth dependency ran (nothing to fall back on otherwise).

    Wiring
    ------
    Per-route: ``@limiter.limit("60/minute", key_func=token_or_ip_key)``
    alongside an auth dependency on the same route (as in
    ``backend/routes/tokens.py``).

    Global default: replace ``rate_limit._limit_key`` with a call to this
    function so every limited route gets per-token buckets automatically —
    that edit lives in ``backend/rate_limit.py`` / ``backend/main.py``,
    outside this module's ownership this cycle; flagged for the
    orchestrator to wire centrally if broader coverage is wanted.
    """
    pat_id = getattr(request.state, "pat_id", None)
    if pat_id:
        return f"pat:{pat_id}"

    from .rate_limit import client_ip

    return client_ip(request)


CurrentAdmin = Depends(require_admin)
RequireMethodScope = Depends(enforce_method_scope)
