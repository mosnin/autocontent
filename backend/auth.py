"""Bearer auth (docs/auth/README.md).

Three ways in, one context type (``AuthCtx``):

- **Session JWT** from the web app (Better Auth ``jwt`` plugin): RS256 only,
  verified against web's JWKS (``MARKETER_AUTH_JWKS_URL``), with ``iss``,
  ``aud`` and ``exp`` checked and ``sub`` (person), ``sid`` (session) and
  ``org`` (active workspace) required. Then ONE query against the ``auth``
  schema answers: is the session live and the person's, is the person banned,
  are they a member of ``org``, with which role, what is the workspace's
  tenant id and does it require two-factor. The answer is cached 15 seconds per
  ``(sid, org)``; a database error is a 503, never an allow.
- **Personal access token** (``mkt_...``): sha256 lookup. It acts with the
  role stored on it, capped by its creator's current role, and stops working
  when the creator is no longer a member of the workspace.
- **Agent delegation**: the service token (constant-time compare) plus
  ``x-tenant-id``. The agent role applies, intersected with the role of the
  person in ``x-actor-id`` when that person is a verified member of the
  tenant's workspace; otherwise the agent role minus anything that moves money.

``AuthCtx.user_id`` keeps meaning "the tenant" so no product query changes; the
person is ``actor_id``. Route permissions are enforced in ``backend/policy.py``.

Platform admin (``require_admin``): the session JWT, ``auth."user".role =
'admin'`` and two-factor enabled. Grants nothing inside a workspace.

Rate limiting on auth failures: every rejected bearer (bad PAT, bad JWT, bad
delegation) consumes one token from a per-IP bucket (20 a minute), keyed on
the trusted proxy hop, so rotating bearer strings cannot dodge it.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt.algorithms import RSAAlgorithm
from limits import parse as parse_limit

from marketer.config import settings
from marketer.repos import auth_identity
from marketer.repos import tokens as tokens_repo
from marketer.repos import users as users_repo

from . import permissions as perms

log = logging.getLogger(__name__)

# Per-IP bucket for authentication failures: 20 bad attempts per minute.
_AUTH_FAILURE_LIMIT = parse_limit("20/minute")
_AUTH_FAILURE_SCOPE = "auth_failure"

JWKS_TIMEOUT_SEC = 5
JWKS_TTL_SEC = 600  # refetch keys at most this stale
JWKS_MIN_REFRESH_SEC = 30  # an unknown kid refetches at most this often
JWT_LEEWAY_SEC = 10
JWT_ALGORITHM = "RS256"
REQUIRED_CLAIMS = ("exp", "iss", "aud", "sub", "sid", "org")

IDENTITY_TTL_SEC = 15.0
IDENTITY_TIMEOUT_SEC = 5.0
_IDENTITY_CACHE_MAX = 10_000

# The one thing a person whose workspace requires two-factor may do before
# enabling it: read their own profile.
MFA_EXEMPT: frozenset[tuple[str, str]] = frozenset({("GET", "/api/v1/users/me")})

_STATE_CTX = "auth_ctx"
_STATE_ADMIN = "admin_ctx"
_MAX_ID_LEN = 128


@dataclass
class AuthCtx:
    """Who is calling, for which workspace, with what permissions.

    ``user_id`` is the tenant id (the workspace's ``tenantId``), the key every
    product table is scoped by. ``email`` is kept for attribution (the
    person's address when known). ``role`` is the workspace role, or
    ``"agent"`` for delegated calls. ``permissions`` is the effective set of
    ``"resource:action"`` strings; it starts empty, so a context built without
    one can do nothing."""

    user_id: str
    email: str = ""
    role: str = ""
    # True when the agent harness is acting via the service token. Delegated
    # contexts never reach admin surfaces, tokens or account erasure.
    delegated: bool = False
    actor_id: str = ""
    actor_email: str = ""
    org_id: str = ""
    permissions: frozenset[str] = field(default_factory=frozenset)
    actor_type: str = "user"  # user | agent | token
    ip: str = ""
    user_agent: str = ""

    def can(self, permission: str) -> bool:
        return permission in self.permissions


@dataclass
class AdminCtx:
    """Platform-admin request context (Marketer staff). Carries request
    metadata so every admin action is attributed in the audit log."""

    user_id: str  # the person (auth."user".id)
    email: str
    ip: str
    user_agent: str


# --------------------------------------------------------------------------- helpers


def _state_get(request: Any, name: str) -> Any:
    state = getattr(request, "state", None)
    return getattr(state, name, None) if state is not None else None


def _state_set(request: Any, name: str, value: Any) -> None:
    state = getattr(request, "state", None)
    if state is not None:
        setattr(state, name, value)


def _request_meta(request: Any) -> tuple[str, str]:
    headers = getattr(request, "headers", {}) or {}
    ua = (headers.get("user-agent") or "")[:512]
    if not hasattr(request, "client"):
        return "", ua
    from .rate_limit import client_ip

    try:
        return client_ip(request), ua
    except Exception:  # noqa: BLE001 — metadata only
        return "", ua


def _consume_failure_token(request: Request) -> None:
    """Consume one token from the per-IP auth-failure bucket; 429 when empty.

    A request object without ``client`` (lightweight fakes in unit tests) is a
    no-op. Imported lazily: rate_limit → config; auth → rate_limit."""
    if not hasattr(request, "client"):
        return

    from .rate_limit import client_ip, limiter

    ip = client_ip(request)
    allowed = limiter.limiter.hit(_AUTH_FAILURE_LIMIT, ip, _AUTH_FAILURE_SCOPE)
    if not allowed:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too many failed auth attempts — try again later",
        )


def _unavailable(what: str, exc: BaseException | None = None) -> HTTPException:
    """Identity could not be established. Fail closed."""
    log.error("auth.unavailable: %s", what, exc_info=exc)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "auth_unavailable")


def _reject_if_suspended(user) -> None:
    """A suspended tenant is refused every request (defense in depth: the
    check lives in the auth path, not just the UI)."""
    if getattr(user, "suspended_at", None) is not None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "account suspended — contact support",
        )


def _clean_id(value: str | None) -> str:
    v = (value or "").strip()
    return v if 0 < len(v) <= _MAX_ID_LEN else ""


# --------------------------------------------------------------------------- JWKS


async def _fetch_jwks(url: str) -> dict:
    """GET the JWKS document. Explicit timeout: this runs on the request path
    on a cold start or key rotation."""
    async with httpx.AsyncClient(timeout=JWKS_TIMEOUT_SEC, follow_redirects=False) as client:
        resp = await client.get(url, headers={"accept": "application/json"})
        resp.raise_for_status()
        return resp.json()


def _parse_jwks(doc: dict) -> dict[str, Any]:
    """kid → RSA public key. Anything that is not an RS256 signing RSA public
    key is ignored, so a JWKS can never hand us an HMAC secret or a key for
    another algorithm (no key confusion)."""
    out: dict[str, Any] = {}
    for jwk in (doc or {}).get("keys", []) or []:
        if not isinstance(jwk, dict) or jwk.get("kty") != "RSA":
            continue
        if jwk.get("alg") not in (None, JWT_ALGORITHM):
            continue
        if jwk.get("use") not in (None, "sig"):
            continue
        if "d" in jwk:  # a private key has no business in a JWKS
            continue
        try:
            key = RSAAlgorithm.from_jwk(json.dumps(jwk))
        except Exception:  # noqa: BLE001 — malformed key: skip it
            continue
        out[str(jwk.get("kid") or "")] = key
    return out


class _JwksCache:
    def __init__(self) -> None:
        self.url = ""
        self.keys: dict[str, Any] = {}
        self.fetched_at = 0.0

    def reset(self) -> None:
        self.url, self.keys, self.fetched_at = "", {}, 0.0

    async def _refresh(self, url: str) -> None:
        doc = await _fetch_jwks(url)
        self.keys = _parse_jwks(doc)
        self.url = url
        self.fetched_at = time.monotonic()

    async def key_for(self, kid: str | None) -> Any | None:
        url = settings.auth_jwks_url_effective()
        if not url:
            raise _unavailable("MARKETER_AUTH_ISSUER / MARKETER_AUTH_JWKS_URL not set")
        now = time.monotonic()
        stale = url != self.url or not self.keys or now - self.fetched_at > JWKS_TTL_SEC
        if stale:
            try:
                await self._refresh(url)
            except Exception as e:  # noqa: BLE001
                raise _unavailable("JWKS fetch failed", e) from e
        key = self._pick(kid)
        if key is None and time.monotonic() - self.fetched_at > JWKS_MIN_REFRESH_SEC:
            # Possibly a key rotation: refetch once, rate limited.
            try:
                await self._refresh(url)
            except Exception as e:  # noqa: BLE001
                raise _unavailable("JWKS fetch failed", e) from e
            key = self._pick(kid)
        return key

    def _pick(self, kid: str | None) -> Any | None:
        if kid:
            return self.keys.get(kid)
        # No kid: acceptable only when there is exactly one key.
        if len(self.keys) == 1:
            return next(iter(self.keys.values()))
        return None


_jwks_cache = _JwksCache()


def _expected_issuer() -> str:
    return settings.auth_issuer.strip().rstrip("/")


async def _verify_jwt(token: str, request: Request) -> dict:
    """Signature, alg, iss, aud, exp and the required claims. Any failure is a
    401 and one hit on the auth-failure bucket."""
    issuer = _expected_issuer()
    if not issuer:
        raise _unavailable("MARKETER_AUTH_ISSUER not set")

    def _fail(reason: str, exc: BaseException | None = None) -> HTTPException:
        _consume_failure_token(request)
        # Library internals go to the log, never to the client.
        log.info("auth.jwt_rejected: %s", reason, exc_info=exc)
        return HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        raise _fail("malformed header", e) from e
    if header.get("alg") != JWT_ALGORITHM:
        raise _fail(f"alg {header.get('alg')!r} refused")
    kid = header.get("kid")
    if kid is not None and not isinstance(kid, str):
        raise _fail("kid is not a string")

    key = await _jwks_cache.key_for(kid)
    if key is None:
        raise _fail("no matching signing key")

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[JWT_ALGORITHM],
            issuer=issuer,
            audience=settings.auth_audience,
            leeway=JWT_LEEWAY_SEC,
            options={
                "require": list(REQUIRED_CLAIMS),
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                "verify_aud": True,
            },
        )
    except jwt.PyJWTError as e:
        raise _fail("decode failed", e) from e

    for name in ("sub", "sid", "org"):
        value = claims.get(name)
        if not isinstance(value, str) or not _clean_id(value):
            raise _fail(f"claim {name} missing or invalid")
    return claims


# --------------------------------------------------------------------------- identity


@dataclass
class _Cached:
    expires: float
    identity: auth_identity.SessionIdentity | None
    tenant: Any = None  # the public.users row, once ensured


_identity_cache: dict[tuple[str, str, str], _Cached] = {}


def reset_caches() -> None:
    """Forget cached JWKS and identities (tests; key rotation drills)."""
    _identity_cache.clear()
    _jwks_cache.reset()


def _prune(now: float) -> None:
    if len(_identity_cache) < _IDENTITY_CACHE_MAX:
        return
    for k in [k for k, v in _identity_cache.items() if v.expires <= now]:
        _identity_cache.pop(k, None)
    if len(_identity_cache) >= _IDENTITY_CACHE_MAX:
        _identity_cache.clear()


async def _session_identity(sid: str, sub: str, org: str) -> _Cached:
    """The identity query, cached 15 s per (sid, org) (and sub, so a cached
    answer can never be reused for a different person)."""
    key = (sid, org, sub)
    now = time.monotonic()
    hit = _identity_cache.get(key)
    if hit is not None and hit.expires > now:
        return hit
    try:
        identity = await asyncio.wait_for(
            auth_identity.session_identity(sid, sub, org), timeout=IDENTITY_TIMEOUT_SEC
        )
    except Exception as e:  # noqa: BLE001 — any failure: no answer, no access
        raise _unavailable("identity query failed", e) from e
    entry = _Cached(expires=now + IDENTITY_TTL_SEC, identity=identity)
    _prune(now)
    _identity_cache[key] = entry
    return entry


def _person_checks(identity: auth_identity.SessionIdentity | None) -> auth_identity.SessionIdentity:
    if identity is None:
        # Signed by us, but the session was revoked, expired or is not theirs.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session_expired")
    if identity.banned:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "banned")
    if not identity.email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "email_unverified")
    return identity


async def _resolve_session_jwt(token: str, request: Request) -> AuthCtx:
    claims = await _verify_jwt(token, request)
    sub, sid, org = claims["sub"], claims["sid"], claims["org"]
    entry = await _session_identity(sid, sub, org)
    identity = _person_checks(entry.identity)

    if identity.member_role is None or not identity.tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_a_member")

    if identity.require_two_factor and not identity.two_factor_enabled:
        method = getattr(request, "method", "GET")
        path = getattr(getattr(request, "url", None), "path", "")
        if (method, path.rstrip("/")) not in MFA_EXEMPT:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "mfa_required")

    if entry.tenant is None:
        # First sight of this workspace in this window: make sure the tenant
        # row (the FK target of every product table) exists.
        try:
            entry.tenant = await users_repo.ensure(identity.tenant_id, identity.email)
        except Exception as e:  # noqa: BLE001
            raise _unavailable("tenant upsert failed", e) from e
    _reject_if_suspended(entry.tenant)

    ip, ua = _request_meta(request)
    return AuthCtx(
        user_id=identity.tenant_id,
        email=identity.email,
        role=perms.primary_role(identity.member_role),
        actor_id=identity.person_id,
        actor_email=identity.email,
        org_id=identity.org_id,
        permissions=perms.permissions_for(identity.member_role),
        actor_type="user",
        ip=ip,
        user_agent=ua,
    )


# --------------------------------------------------------------------------- PATs


async def _resolve_pat(token: str, request: Request) -> AuthCtx:
    pat = await tokens_repo.get_by_token(token)
    if pat is None:
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    user = await users_repo.get(pat.user_id)
    if user is None:
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token owner no longer exists")
    _reject_if_suspended(user)

    creator = pat.created_by or pat.user_id
    token_perms = perms.permissions_for(pat.role)
    try:
        membership = await asyncio.wait_for(
            auth_identity.membership_for_tenant(pat.user_id, creator),
            timeout=IDENTITY_TIMEOUT_SEC,
        )
    except Exception as e:  # noqa: BLE001
        raise _unavailable("token creator lookup failed", e) from e

    org_id = ""
    email = user.email
    if membership is not None:
        if membership.banned:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "banned")
        # A token never does more than its creator may do today.
        token_perms = token_perms & perms.permissions_for(membership.role)
        org_id = membership.org_id
        email = membership.email or email
    elif creator != pat.user_id:
        # The person who made it left the workspace: the token goes with them.
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token creator is no longer a member")
    # else: a token from before workspaces (creator = the tenant itself) keeps
    # the role it migrated with.

    ip, ua = _request_meta(request)
    return AuthCtx(
        user_id=pat.user_id,
        email=email,
        role=perms.primary_role(pat.role),
        actor_id=creator,
        actor_email=email,
        org_id=org_id,
        permissions=token_perms,
        actor_type="token",
        ip=ip,
        user_agent=ua,
    )


# --------------------------------------------------------------------------- agent


def _is_agent_service_token(token: str) -> bool:
    """Constant-time match against the configured agent service token.
    Disabled (always False) when the setting is empty."""
    expected = settings.agent_service_token
    if not expected or not token:
        return False
    return hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8"))


async def _resolve_agent_delegation(request: Request) -> AuthCtx:
    """The agent harness acts for the workspace named by ``x-tenant-id``.

    The service token is already verified by the caller. The tenant must
    exist (delegation never mints accounts) and not be suspended. With
    ``x-actor-id`` naming a verified member of that workspace, the agent gets
    ``agent ∩ their role``; otherwise ``agent`` minus anything that moves
    money. A banned actor, or one whose workspace requires two-factor they
    have not enabled, is refused."""
    tenant_id = _clean_id(request.headers.get("x-tenant-id"))
    if not tenant_id:
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing x-tenant-id header")
    user = await users_repo.get(tenant_id)
    if user is None:
        _consume_failure_token(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown tenant")
    _reject_if_suspended(user)

    claimed_actor = _clean_id(request.headers.get("x-actor-id"))
    actor_role: str | None = None
    actor_id = ""
    actor_email = ""
    org_id = ""
    if claimed_actor:
        try:
            membership = await asyncio.wait_for(
                auth_identity.membership_for_tenant(tenant_id, claimed_actor),
                timeout=IDENTITY_TIMEOUT_SEC,
            )
        except Exception as e:  # noqa: BLE001
            raise _unavailable("actor lookup failed", e) from e
        if membership is not None:
            if membership.banned:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "banned")
            if membership.require_two_factor and not membership.two_factor_enabled:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "mfa_required")
            actor_role = membership.role
            actor_id = claimed_actor
            actor_email = membership.email
            org_id = membership.org_id

    ip, ua = _request_meta(request)
    return AuthCtx(
        user_id=user.id,
        email=actor_email or user.email,
        role="agent",
        delegated=True,
        actor_id=actor_id,
        actor_email=actor_email,
        org_id=org_id,
        permissions=perms.agent_permissions(actor_role),
        actor_type="agent",
        ip=ip,
        user_agent=ua,
    )


# --------------------------------------------------------------------------- deps


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    return auth.split(" ", 1)[1]


async def require_user(request: Request) -> AuthCtx:
    """Resolve the caller once per request; later calls reuse the context
    cached on ``request.state`` (the policy dependency and a route's own
    ``CurrentUser`` never authenticate twice)."""
    cached = _state_get(request, _STATE_CTX)
    if cached is not None:
        return cached
    token = _bearer(request)
    if _is_agent_service_token(token):
        ctx = await _resolve_agent_delegation(request)
    elif token.startswith(tokens_repo.TOKEN_PREFIX):
        ctx = await _resolve_pat(token, request)
    else:
        ctx = await _resolve_session_jwt(token, request)
    _state_set(request, _STATE_CTX, ctx)
    return ctx


async def require_admin(request: Request) -> AdminCtx:
    """Platform admin: a person's session JWT, ``auth."user".role = 'admin'``
    and two-factor enabled. Personal tokens and the agent never qualify.
    A non-admin gets 403. Read from the database (cached 15 s), never from a
    token claim."""
    cached = _state_get(request, _STATE_ADMIN)
    if cached is not None:
        return cached
    token = _bearer(request)
    if _is_agent_service_token(token) or token.startswith(tokens_repo.TOKEN_PREFIX):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    claims = await _verify_jwt(token, request)
    entry = await _session_identity(claims["sid"], claims["sub"], claims["org"])
    identity = _person_checks(entry.identity)
    if identity.platform_role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    if not identity.two_factor_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_requires_two_factor")
    ip, ua = _request_meta(request)
    ctx = AdminCtx(user_id=identity.person_id, email=identity.email, ip=ip, user_agent=ua)
    _state_set(request, _STATE_ADMIN, ctx)
    return ctx


CurrentUser = Depends(require_user)
CurrentAdmin = Depends(require_admin)
