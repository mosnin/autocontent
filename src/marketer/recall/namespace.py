"""Supermemory namespace derivation: the ONLY place a namespace is made.

    team:     "mkt-t-" + hex(HMAC-SHA256(secret, "v1|team|"   + tenant))[0:40]
    personal: "mkt-p-" + hex(HMAC-SHA256(secret, "v1|person|" + tenant + "|" + person))[0:40]

Inputs come from verified identity only (``AuthCtx.user_id`` = tenant,
``AuthCtx.actor_id`` = person; see ``service.scopes_for``). Ids containing
``|`` are refused, not derived. The agent derives the same values
(agent/src/marketer/recall/namespace.ts); both test against
docs/memory/supermemory-namespaces.json. ``tests/test_recall_guard.py`` fails
if any other module spells a namespace prefix or builds a namespace URL path.
"""
from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass, field
from typing import Literal

Kind = Literal["team", "personal"]

VERSION = "v1"
_PREFIX = {"team": "mkt-t-", "personal": "mkt-p-"}
_HEX_CHARS = 40
MAX_ID_LEN = 256


class NamespaceRefused(ValueError):
    """An id we will not derive a namespace from."""


def _check_id(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_ID_LEN:
        raise NamespaceRefused(f"{label} is missing or too long")
    if "|" in value or any(ord(ch) < 0x20 for ch in value):
        raise NamespaceRefused(f"{label} contains a reserved character")
    return value


def _message(kind: Kind, tenant_id: str, person_id: str | None) -> str:
    tenant = _check_id(tenant_id, "tenant id")
    if kind == "team":
        if person_id is not None:
            raise NamespaceRefused("a team namespace has no person")
        return f"{VERSION}|team|{tenant}"
    if kind == "personal":
        person = _check_id(person_id, "person id")
        return f"{VERSION}|person|{tenant}|{person}"
    raise NamespaceRefused(f"unknown namespace kind {kind!r}")


def derive(kind: Kind, tenant_id: str, person_id: str | None, secret: str) -> str:
    """The namespace string. Raises :class:`NamespaceRefused` on bad input."""
    if not isinstance(secret, str) or not secret:
        raise NamespaceRefused("MEMORY_NAMESPACE_SECRET is not set")
    digest = hmac.new(secret.encode(), _message(kind, tenant_id, person_id).encode(), hashlib.sha256).hexdigest()
    return _PREFIX[kind] + digest[:_HEX_CHARS]


@dataclass(frozen=True)
class Scope:
    """One namespace and what it is. The Supermemory client accepts only this
    type, so a namespace string from a request, a body or a model can never
    reach it. Build one with :func:`scope`."""

    kind: Kind
    namespace: str = field(repr=False)
    tenant_id: str = field(repr=False)
    person_id: str | None = field(default=None, repr=False)


def scope(kind: Kind, tenant_id: str, person_id: str | None, secret: str) -> Scope:
    return Scope(kind=kind, namespace=derive(kind, tenant_id, person_id, secret), tenant_id=tenant_id, person_id=person_id)
