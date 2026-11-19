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
