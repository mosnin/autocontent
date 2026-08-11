"""Append-only admin audit log (SOC2 CC7.2 system of record).

This module exposes exactly two operations: `record` (insert) and `list_`
(select). It deliberately offers no update or delete — the audit trail must
be immutable at the application layer.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from ..db import get_pool


class AuditEntry(BaseModel):
    id: int
    actor_id: str
    actor_email: str
    action: str
    target_type: str | None
    target_id: str | None
    ip: str | None
    user_agent: str | None
    metadata: dict
    created_at: datetime


async def record(
    *,
    actor_id: str,
    actor_email: str,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Append one audit row. Never raises into the caller's happy path for
    logging-only failures would be a mistake here: an unrecordable admin
    action must fail closed, so we let DB errors propagate."""
    import json

    pool = await get_pool()
    await pool.execute(
        """
        insert into admin_audit_log
            (actor_id, actor_email, action, target_type, target_id, ip, user_agent, metadata)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        """,
        actor_id, actor_email, action, target_type, target_id, ip,
        user_agent, json.dumps(metadata or {}),
    )


async def list_(
    *,
    actor_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    action: str | None = None,
    limit: int = 100,
    before_id: int | None = None,
) -> list[AuditEntry]:
    """Read the audit trail, newest first, with optional filters and a
    keyset cursor (`before_id`) for stable pagination."""
    import json

    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, actor_id, actor_email, action, target_type, target_id,
               ip, user_agent, metadata, created_at
          from admin_audit_log
         where ($1::text is null or actor_id = $1)
           and ($2::text is null or target_type = $2)
           and ($3::text is null or target_id = $3)
           and ($4::text is null or action = $4)
           and ($5::bigint is null or id < $5)
         order by id desc
         limit $6
        """,
        actor_id, target_type, target_id, action, before_id, limit,
    )
    out: list[AuditEntry] = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("metadata"), str):
            d["metadata"] = json.loads(d["metadata"])
        out.append(AuditEntry(**d))
    return out
