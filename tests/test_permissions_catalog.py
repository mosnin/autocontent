"""backend/permissions.py is a typed copy of docs/auth/permissions.json."""
from __future__ import annotations

import json
from pathlib import Path

from backend import permissions as perms

CATALOG = Path(__file__).resolve().parents[1] / "docs" / "auth" / "permissions.json"


def _json() -> dict:
    data = json.loads(CATALOG.read_text())
    data.pop("$comment", None)
    return data


def test_typed_copy_equals_the_json_catalog():
    assert perms.as_catalog() == _json()


def test_every_grant_names_a_catalog_permission():
    for role, granted in perms.ROLE_PERMISSIONS.items():
        assert granted <= perms.ALL_PERMISSIONS, role


def test_owner_has_everything_and_ranks_are_strict():
    assert perms.permissions_for("owner") == perms.ALL_PERMISSIONS
    ranks = [perms.rank(r) for r in ("owner", "admin", "marketer", "analyst", "billing", "agent")]
    assert ranks == sorted(ranks, reverse=True)


def test_unknown_or_empty_role_has_nothing():
    assert perms.permissions_for("member") == frozenset()
    assert perms.permissions_for("") == frozenset()
    assert perms.permissions_for(None) == frozenset()


def test_comma_separated_roles_union_known_ones():
    assert perms.permissions_for("billing,analyst") == (
        perms.permissions_for("billing") | perms.permissions_for("analyst")
    )
    assert perms.primary_role("billing,analyst") == "analyst"
    assert perms.primary_role("member") == ""


def test_agent_intersection_rules():
    agent = perms.ROLE_PERMISSIONS["agent"]
    assert perms.agent_permissions(None) == agent - {"spend:approve", "campaign:launch"}
    assert perms.agent_permissions("owner") == agent
    assert perms.agent_permissions("analyst") == agent & perms.permissions_for("analyst")
    assert perms.agent_permissions("billing") == agent & perms.permissions_for("billing")
    # Asking the agent never exceeds what the person may do.
    for role in perms.ASSIGNABLE_ROLES:
        assert perms.agent_permissions(role) <= perms.permissions_for(role)
    # An unknown role is a verified member with nothing: the agent gets nothing.
    assert perms.agent_permissions("member") == frozenset()


def test_grant_ceiling():
    assert perms.can_grant("owner", "owner")
    assert not perms.can_grant("admin", "owner")
    assert perms.can_grant("admin", "admin")
    assert perms.can_grant("admin", "billing")
    assert not perms.can_grant("marketer", "admin")
    assert perms.can_grant("marketer", "analyst")
    assert not perms.can_grant("billing", "analyst")
    assert not perms.can_grant("owner", "agent")  # never assignable
    assert not perms.can_grant("agent", "billing")
    assert not perms.can_grant("", "billing")
    assert not perms.can_grant("owner", "superuser")
