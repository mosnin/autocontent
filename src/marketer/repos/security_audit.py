"""``public.security_audit_log`` (migration 0031): append-only security events.

Web and backend both write it (docs/auth/README.md). This repo exposes exactly
two operations, insert and list-for-org; the table's trigger refuses UPDATE,
DELETE and TRUNCATE, so history cannot be rewritten from here or anywhere.

Never put secrets, tokens or passwords in ``metadata``.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from ..db import get_pool

ActorType = Literal["user", "agent", "token", "platform_admin", "system"]
Outcome = Literal["success", "denied", "failure"]

ACTOR_TYPES: frozenset[str] = frozenset({"user", "agent", "token", "platform_admin", "system"})
OUTCOMES: frozenset[str] = frozenset({"success", "denied", "failure"})
MAX_USER_AGENT = 512
MAX_LIST = 200

_COLS = (
    "id, at, org_id, tenant_id, actor_id, actor_email, actor_type, action, "
    "target_type, target_id, outcome, ip, user_agent, metadata"
)


class SecurityAuditEntry(BaseModel):
    id: int
    at: datetime
    org_id: str | None = None
    tenant_id: str | None = None
    actor_id: str | None = None
    actor_email: str = ""
    actor_type: str
    action: str
    target_type: str | None = None
    target_id: str | None = None
    outcome: str
    ip: str | None = None
    user_agent: str | None = None
    metadata: dict[str, Any] = {}


def _row(row) -> SecurityAuditEntry:
    d = dict(row)
    meta = d.get("metadata")
    if isinstance(meta, str):
        meta = json.loads(meta)
    d["metadata"] = meta or {}
    return SecurityAuditEntry(**d)


async def insert(
    *,
    action: str,
    actor_type: str,
    outcome: str,
    org_id: str | None = None,
    tenant_id: str | None = None,
    actor_id: str | None = None,
    actor_email: str = "",
    target_type: str | None = None,
    target_id: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    """Append one row. Returns its id."""
    if actor_type not in ACTOR_TYPES:
        raise ValueError(f"actor_type must be one of {sorted(ACTOR_TYPES)}")
    if outcome not in OUTCOMES:
        raise ValueError(f"outcome must be one of {sorted(OUTCOMES)}")
    pool = await get_pool()
    return await pool.fetchval(
        """
        insert into security_audit_log
            (org_id, tenant_id, actor_id, actor_email, actor_type, action,
             target_type, target_id, outcome, ip, user_agent, metadata)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        returning id
        """,
        org_id or None,
        tenant_id or None,
        actor_id or None,
        actor_email or "",
        actor_type,
        action,
        target_type,
        target_id,
        outcome,
        ip or None,
        (user_agent or "")[:MAX_USER_AGENT] or None,
        json.dumps(metadata or {}, default=str),
    )


async def list_for_org(
    org_id: str | None,
    tenant_id: str | None,
    *,
    limit: int = 50,
    before_id: int | None = None,
) -> list[SecurityAuditEntry]:
    """Newest first. A workspace's rows are those carrying its org id or its
    tenant id (backend rows written for an agent without a verified person
    know only the tenant). ``before_id`` pages backwards."""
    if not org_id and not tenant_id:
        return []
    limit = max(1, min(int(limit), MAX_LIST))
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS}
          from security_audit_log
         where (($1::text is not null and org_id = $1)
             or ($2::text is not null and tenant_id = $2))
           and ($3::bigint is null or id < $3)
         order by id desc
         limit $4
        """,
        org_id or None,
        tenant_id or None,
        before_id,
        limit,
    )
    return [_row(r) for r in rows]
