"""The permission catalog, typed (a copy of ``docs/auth/permissions.json``).

``tests/test_permissions_catalog.py`` asserts this module equals the JSON file,
so the copy cannot drift. Change the JSON first, then this file, in the same
commit (docs/auth/README.md).

A permission is the string ``"resource:action"``. A role maps to a frozenset of
them. Unknown roles map to the empty set: an unrecognised role can do nothing.
"""
from __future__ import annotations

from typing import Final, Literal

CATALOG_VERSION: Final = 1

RESOURCES: Final[dict[str, tuple[str, ...]]] = {
    "workspace": ("read", "update", "delete"),
    "member": ("read", "invite", "update_role", "remove"),
    "billing": ("read", "manage"),
    "security": ("read", "manage"),
    "audit": ("read",),
    "api_token": ("read", "create", "revoke"),
    "integration": ("read", "connect", "disconnect"),
    "webhook": ("read", "manage"),
    "brand": ("read", "update"),
    "playbook": ("read", "create", "update", "delete"),
    "content": ("read", "create", "update", "delete", "approve", "publish"),
    "campaign": ("read", "create", "update", "launch", "pause", "delete"),
    "spend": ("read", "approve", "set_limits"),
    "analytics": ("read",),
    "agent": ("chat", "approve"),
    "memory": ("read", "confirm", "forget"),
}

Role = Literal["owner", "admin", "marketer", "analyst", "billing", "agent"]

# grants: "*" (everything) or {resource: (actions...)}
ROLES: Final[dict[str, dict]] = {
    "owner": {
        "label": "Owner",
        "description": "Everything, including deleting the workspace and transferring ownership.",
        "assignable": True,
        "rank": 100,
        "grants": "*",
    },
    "admin": {
        "label": "Admin",
        "description": (
            "Runs the workspace: people, security, billing, integrations and all marketing work. "
            "Cannot delete the workspace or make owners."
        ),
        "assignable": True,
        "rank": 80,
        "grants": {
            "workspace": ("read", "update"),
            "member": ("read", "invite", "update_role", "remove"),
            "billing": ("read", "manage"),
            "security": ("read", "manage"),
            "audit": ("read",),
            "api_token": ("read", "create", "revoke"),
            "integration": ("read", "connect", "disconnect"),
            "webhook": ("read", "manage"),
            "brand": ("read", "update"),
            "playbook": ("read", "create", "update", "delete"),
            "content": ("read", "create", "update", "delete", "approve", "publish"),
            "campaign": ("read", "create", "update", "launch", "pause", "delete"),
            "spend": ("read", "approve", "set_limits"),
            "analytics": ("read",),
            "agent": ("chat", "approve"),
            "memory": ("read", "confirm", "forget"),
        },
    },
    "marketer": {
        "label": "Marketer",
        "description": (
            "Does the marketing: makes and approves content, launches and pauses campaigns within "
            "the caps an admin set, works with the agents."
        ),
        "assignable": True,
        "rank": 60,
        "grants": {
            "workspace": ("read",),
            "member": ("read",),
            "integration": ("read", "connect"),
            "webhook": ("read",),
            "brand": ("read", "update"),
            "playbook": ("read", "create", "update", "delete"),
            "content": ("read", "create", "update", "delete", "approve", "publish"),
            "campaign": ("read", "create", "update", "launch", "pause"),
            "spend": ("read", "approve"),
            "analytics": ("read",),
            "agent": ("chat", "approve"),
            "memory": ("read", "confirm"),
        },
    },
    "analyst": {
        "label": "Analyst",
        "description": (
            "Reads everything marketing and asks the agents questions. Changes nothing and "
            "approves nothing."
        ),
        "assignable": True,
        "rank": 40,
        "grants": {
            "workspace": ("read",),
            "member": ("read",),
            "integration": ("read",),
            "brand": ("read",),
            "playbook": ("read",),
            "content": ("read",),
            "campaign": ("read",),
            "spend": ("read",),
            "analytics": ("read",),
            "agent": ("chat",),
            "memory": ("read",),
        },
    },
    "billing": {
        "label": "Billing",
        "description": "Manages credits, plans and invoices, and sees spend. No marketing work.",
        "assignable": True,
        "rank": 20,
        "grants": {
            "workspace": ("read",),
            "member": ("read",),
            "billing": ("read", "manage"),
            "spend": ("read",),
            "analytics": ("read",),
        },
    },
    "agent": {
        "label": "Marketer agent",
        "description": (
            "System role for the agent harness acting on a workspace. Never assignable to a "
            "person. Its effective permissions are this set intersected with the role of the "
            "person who started the session."
        ),
        "assignable": False,
        "rank": 0,
        "grants": {
            "workspace": ("read",),
            "integration": ("read",),
            "webhook": ("read",),
            "brand": ("read",),
            "playbook": ("read", "create", "update"),
            "content": ("read", "create", "update", "approve", "publish"),
            "campaign": ("read", "create", "update", "launch", "pause"),
            "spend": ("read", "approve"),
            "analytics": ("read",),
            "agent": ("chat",),
            "memory": ("read",),
        },
    },
}

RULES: Final[dict[str, str]] = {
    "grant_ceiling": (
        "A person can invite someone with, or change someone to, only a role whose rank is at "
        "most their own. Only an owner can make an owner."
    ),
    "last_owner": (
        "A workspace always has at least one owner: the last owner cannot leave, be removed or "
        "be demoted."
    ),
    "self_change": "Nobody can change their own role.",
    "agent_intersection": (
        "Delegated agent calls get agent ∩ the starting person's role. With no verified person, "
        "they get the agent role alone, minus anything that moves money (spend:approve, "
        "campaign:launch), which then needs a person through the rails."
    ),
    "platform_admin": (
        "Marketer staff (auth.user.role = 'admin') is separate from workspace roles, grants "
        "nothing inside a workspace, and requires two-factor to reach /admin."
    ),
    "approval_deciders": (
        "A person may decide an agent approval by id when their role grants agent:approve."
    ),
}

ALL_PERMISSIONS: Final[frozenset[str]] = frozenset(
    f"{resource}:{action}" for resource, actions in RESOURCES.items() for action in actions
)

# What an agent call without a verified person may never do (rules.agent_intersection).
MONEY_MOVING: Final[frozenset[str]] = frozenset({"spend:approve", "campaign:launch"})


def _expand(grants: str | dict) -> frozenset[str]:
    if grants == "*":
        return ALL_PERMISSIONS
    assert isinstance(grants, dict)
    return frozenset(f"{r}:{a}" for r, actions in grants.items() for a in actions)


ROLE_PERMISSIONS: Final[dict[str, frozenset[str]]] = {
    name: _expand(spec["grants"]) for name, spec in ROLES.items()
}

ASSIGNABLE_ROLES: Final[frozenset[str]] = frozenset(
    name for name, spec in ROLES.items() if spec["assignable"]
)


def is_permission(value: str) -> bool:
    return value in ALL_PERMISSIONS


def rank(role: str | None) -> int:
    """A role's rank; unknown roles rank below everything (-1)."""
    spec = ROLES.get(role or "")
    return int(spec["rank"]) if spec else -1


def permissions_for(role: str | None) -> frozenset[str]:
    """Permissions a role grants. Unknown or empty role: nothing.

    Better Auth can store several roles as ``"a,b"``; each known role
    contributes its grants, unknown ones contribute nothing."""
    if not role:
        return frozenset()
    names = [r.strip() for r in role.split(",") if r.strip()]
    out: frozenset[str] = frozenset()
    for name in names:
        out |= ROLE_PERMISSIONS.get(name, frozenset())
    return out


def primary_role(role: str | None) -> str:
    """The highest-ranked known role in a (possibly comma-separated) value,
    or '' when none is known."""
    names = [r.strip() for r in (role or "").split(",") if r.strip()]
    known = [n for n in names if n in ROLES and n != "agent"]
    if not known:
        return ""
    return max(known, key=rank)


def agent_permissions(actor_role: str | None) -> frozenset[str]:
    """Effective permissions of a delegated agent call (rules.agent_intersection).

    ``actor_role`` is the verified person's role in the tenant's workspace, or
    None when no person was named or the named person is not a verified
    member. Then the agent role alone applies, minus anything that moves money."""
    agent = ROLE_PERMISSIONS["agent"]
    if actor_role is None:
        return agent - MONEY_MOVING
    return agent & permissions_for(actor_role)


def can_grant(granter_role: str | None, target_role: str) -> bool:
    """Grant ceiling: the target role must be assignable, rank at most the
    granter's, and only an owner may grant owner."""
    if target_role not in ASSIGNABLE_ROLES:
        return False
    granter = primary_role(granter_role)
    if not granter:
        return False
    if target_role == "owner" and granter != "owner":
        return False
    return rank(target_role) <= rank(granter)


def as_catalog() -> dict:
    """This module rendered in the JSON file's shape (for the equality test)."""
    return {
        "version": CATALOG_VERSION,
        "resources": {r: list(a) for r, a in RESOURCES.items()},
        "roles": {
            name: {
                **{k: v for k, v in spec.items() if k != "grants"},
                "grants": spec["grants"] if spec["grants"] == "*"
                else {r: list(a) for r, a in spec["grants"].items()},
            }
            for name, spec in ROLES.items()
        },
        "rules": dict(RULES),
    }
