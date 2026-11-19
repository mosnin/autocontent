"""One way to build an ``AuthCtx`` for a workspace role in tests.

    from tests.auth_helpers import as_role, ctx_for

    ctx = ctx_for("marketer")                 # a person who is a marketer
    ctx = ctx_for("agent", actor_role="analyst")  # the agent acting for an analyst
    as_role(app, "analyst")                   # every request on app is an analyst

The permissions come from ``backend.permissions`` (the catalog), so a test
says which role it means and gets exactly that role's permissions.
"""
from __future__ import annotations

from typing import Any

from backend import permissions as perms
from backend.auth import AuthCtx, require_user

DEFAULT_TENANT = "user_test"
DEFAULT_EMAIL = "t@t.com"
DEFAULT_ORG = "org_test"
DEFAULT_ACTOR = "person_test"


def ctx_for(
    role: str = "owner",
    *,
    user_id: str = DEFAULT_TENANT,
    email: str = DEFAULT_EMAIL,
    org_id: str = DEFAULT_ORG,
    actor_id: str | None = None,
    actor_role: str | None = None,
    actor_type: str | None = None,
    delegated: bool | None = None,
    permissions: frozenset[str] | None = None,
    **extra: Any,
) -> AuthCtx:
    """An ``AuthCtx`` for ``role``.

    ``role="agent"`` (or ``delegated=True``) builds the agent harness context:
    with ``actor_role`` its permissions are ``agent ∩ actor_role``, without it
    ``agent`` minus anything that moves money."""
    is_agent = role == "agent" or bool(delegated)
    if is_agent:
        effective = perms.agent_permissions(actor_role)
        return AuthCtx(
            user_id=user_id,
            email=email,
            role="agent",
            delegated=True,
            actor_id=actor_id if actor_id is not None else (DEFAULT_ACTOR if actor_role else ""),
            actor_email=email if actor_role else "",
            org_id=org_id if actor_role else "",
            permissions=permissions if permissions is not None else effective,
            actor_type="agent",
            **extra,
        )
    return AuthCtx(
        user_id=user_id,
        email=email,
        role=role,
        delegated=False,
        actor_id=actor_id if actor_id is not None else DEFAULT_ACTOR,
        actor_email=email,
        org_id=org_id,
        permissions=permissions if permissions is not None else perms.permissions_for(role),
        actor_type=actor_type or "user",
        **extra,
    )


def as_role(app, role: str = "owner", **kwargs: Any) -> AuthCtx:
    """Make every request on ``app`` authenticate as ``role``. Returns the ctx."""
    ctx = ctx_for(role, **kwargs)
    app.dependency_overrides[require_user] = lambda: ctx
    return ctx


# --------------------------------------------------------------------------- JWTs

ISSUER = "https://web.test"
AUDIENCE = "marketer-api"


class JwtKit:
    """An RSA key generated at test time, its JWKS served through a
    monkeypatched fetch, and a minter for Better-Auth-shaped JWTs.

        kit = JwtKit.install(monkeypatch)
        token = kit.mint(sub="p1", sid="s1", org="o1")
    """

    def __init__(self, kid: str = "test-key") -> None:
        from cryptography.hazmat.primitives.asymmetric import rsa

        self.kid = kid
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.fetches = 0

    def jwks(self) -> dict:
        import json

        from jwt.algorithms import RSAAlgorithm

        jwk = json.loads(RSAAlgorithm.to_jwk(self.private_key.public_key()))
        jwk.update({"kid": self.kid, "alg": "RS256", "use": "sig"})
        return {"keys": [jwk]}

    @classmethod
    def install(cls, monkeypatch, **kw: Any) -> JwtKit:
        from backend import auth
        from marketer.config import settings

        kit = cls(**kw)
        monkeypatch.setattr(settings, "auth_issuer", ISSUER)
        monkeypatch.setattr(settings, "auth_jwks_url", "")
        monkeypatch.setattr(settings, "auth_audience", AUDIENCE)

        async def _fetch(url: str) -> dict:
            assert url == f"{ISSUER}/api/auth/jwks"
            kit.fetches += 1
            return kit.jwks()

        monkeypatch.setattr(auth, "_fetch_jwks", _fetch)
        auth.reset_caches()
        return kit

    def mint(
        self,
        *,
        sub: str = DEFAULT_ACTOR,
        sid: str = "sess_test",
        org: str = DEFAULT_ORG,
        iss: str = ISSUER,
        aud: str = AUDIENCE,
        exp_in: int = 300,
        drop: tuple[str, ...] = (),
        key: Any = None,
        headers: dict | None = None,
        **claims: Any,
    ) -> str:
        import time

        import jwt as pyjwt

        now = int(time.time())
        payload: dict[str, Any] = {
            "sub": sub, "sid": sid, "org": org, "iss": iss, "aud": aud,
            "iat": now, "exp": now + exp_in, "email": "p@t.com", **claims,
        }
        for name in drop:
            payload.pop(name, None)
        return pyjwt.encode(
            payload, key or self.private_key, algorithm="RS256",
            headers={"kid": self.kid, **(headers or {})},
        )


def session_identity(
    *,
    person_id: str = DEFAULT_ACTOR,
    email: str = "p@t.com",
    email_verified: bool = True,
    platform_role: str = "user",
    banned: bool = False,
    two_factor_enabled: bool = False,
    org_id: str = DEFAULT_ORG,
    member_role: str | None = "owner",
    tenant_id: str | None = DEFAULT_TENANT,
    require_two_factor: bool = False,
):
    from marketer.repos.auth_identity import SessionIdentity

    return SessionIdentity(
        person_id=person_id, email=email, email_verified=email_verified,
        platform_role=platform_role, banned=banned, two_factor_enabled=two_factor_enabled,
        org_id=org_id, member_role=member_role, tenant_id=tenant_id,
        require_two_factor=require_two_factor,
    )
