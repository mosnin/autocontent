"""Approvals for spend-affecting ad actions. When an action's dollar delta
exceeds the approval threshold, the safe-execute layer parks it here as
``pending`` and refuses to run it until a human approves. This is the human
circuit-breaker on agent-driven ad spend."""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from ..db import get_pool

APPROVAL_STATUSES = frozenset(
    {"pending", "approved", "rejected", "expired", "executed"}
)


class AdApproval(BaseModel):
    id: UUID
    user_id: str
    ad_account_id: UUID | None = None
    campaign_id: UUID | None = None
    action: str
    summary: str = ""
    dollar_delta_usd: Decimal = Decimal("0")
    payload: dict = Field(default_factory=dict)
    status: str = "pending"
    requested_by: str = "agent"
    decided_by: str = ""
    decided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


_COLS = (
    "id, user_id, ad_account_id, campaign_id, action, summary, dollar_delta_usd, "
    "payload_json as payload, status, requested_by, decided_by, decided_at, "
    "created_at, updated_at"
)


def _row(r) -> AdApproval:
    d = dict(r)
    v = d.get("payload")
    if isinstance(v, str):
        d["payload"] = json.loads(v)
    return AdApproval(**d)


async def create(
    *,
    user_id: str,
    action: str,
    summary: str = "",
    dollar_delta_usd: Decimal = Decimal("0"),
    ad_account_id: UUID | None = None,
    campaign_id: UUID | None = None,
    payload: dict | None = None,
    requested_by: str = "agent",
) -> AdApproval:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into ad_approvals
            (user_id, ad_account_id, campaign_id, action, summary,
             dollar_delta_usd, payload_json, requested_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8)
        returning {_COLS}
        """,
        user_id, ad_account_id, campaign_id, action, summary, dollar_delta_usd,
        json.dumps(payload or {}), requested_by,
    )
    return _row(row)


async def get(approval_id: UUID, *, user_id: str) -> AdApproval | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from ad_approvals where id = $1 and user_id = $2",
        approval_id, user_id,
    )
    return _row(row) if row else None


async def list_(
    *, user_id: str, status: str | None = None, limit: int = 100
) -> list[AdApproval]:
    pool = await get_pool()
    if status is not None:
        rows = await pool.fetch(
            f"select {_COLS} from ad_approvals where user_id = $1 and status = $2 "
            "order by created_at desc limit $3",
            user_id, status, limit,
        )
    else:
        rows = await pool.fetch(
            f"select {_COLS} from ad_approvals where user_id = $1 "
            "order by created_at desc limit $2",
            user_id, limit,
        )
    return [_row(r) for r in rows]


async def decide(
    approval_id: UUID,
    *,
    user_id: str,
    status: str,
    decided_by: str,
) -> AdApproval | None:
    """Approve or reject a pending approval. Only transitions from pending;
    returns None if not found or not pending (idempotent-safe)."""
    if status not in {"approved", "rejected"}:
        raise ValueError("decision must be 'approved' or 'rejected'")
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""update ad_approvals
              set status = $3, decided_by = $4, decided_at = now()
            where id = $1 and user_id = $2 and status = 'pending'
            returning {_COLS}""",
        approval_id, user_id, status, decided_by,
    )
    return _row(row) if row else None


async def mark_executed(approval_id: UUID, *, user_id: str) -> None:
    """Flip an approved row to executed after the safe-execute layer runs it,
    so a single approval can't be replayed."""
    pool = await get_pool()
    await pool.execute(
        "update ad_approvals set status = 'executed' "
        "where id = $1 and user_id = $2 and status = 'approved'",
        approval_id, user_id,
    )
