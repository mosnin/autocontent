"""Persistence for Gatekeeper intents and the audit trail.

Two shapes live here:

*   **Intents** — actions an agent performed speculatively, waiting for a
    human. Mutable through a narrow set of atomic status claims.
*   **Audit** — append-only. Insert and select; there is deliberately no
    update or delete path, matching `repos/admin_audit.py`.

Every state change on an intent is an atomic conditional UPDATE rather
than a read-then-write. Two approvers clicking the same row, or the apply
worker racing a rejection, must resolve to exactly one winner — the money
moves once or not at all.
"""
from __future__ import annotations

import json
from decimal import Decimal
from typing import Any
from uuid import UUID

from ..db import get_pool

# Statuses an intent can hold. Terminal ones never transition again.
PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"
APPLIED = "applied"
FAILED = "failed"
EXPIRED = "expired"

_TERMINAL = (REJECTED, APPLIED, FAILED, EXPIRED)


def _row(row) -> dict:
    d = dict(row)
    for key in ("params", "simulated", "observed", "evidence"):
        if isinstance(d.get(key), str):
            d[key] = json.loads(d[key])
    return d


def _dump(value: Any) -> str:
    """JSON for a jsonb column, tolerant of the Decimals and UUIDs that
    turn up in capability params."""
    return json.dumps(value, default=str)


# ------------------------------------------------------------------ intents


async def record_intent(
    *,
    user_id: str,
    capability: str,
    summary: str,
    params: Any,
    simulated: Any,
    reason: str = "",
    dollar_delta: Decimal | None = None,
    evidence: dict | None = None,
    actor: str = "agent",
    origin: str = "",
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into gatekeeper_intents (
            user_id, capability, summary, params, simulated,
            reason, dollar_delta, evidence, actor, origin
        )
        values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb,$9,$10)
        returning *
        """,
        user_id, capability, summary, _dump(params), _dump(simulated),
        reason, dollar_delta or Decimal("0"), _dump(evidence or {}), actor, origin,
    )
    return _row(row)


async def get_intent(intent_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from gatekeeper_intents where id = $1 and user_id = $2",
        intent_id, user_id,
    )
    return _row(row) if row else None


async def list_intents(
    user_id: str,
    *,
    status: str | None = None,
    capability: str | None = None,
    limit: int = 100,
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from gatekeeper_intents
         where user_id = $1
           and ($2::text is null or status = $2)
           and ($3::text is null or capability = $3)
         order by created_at desc
         limit $4
        """,
        user_id, status, capability, limit,
    )
    return [_row(r) for r in rows]


async def decide(
    intent_id: UUID,
    *,
    user_id: str,
    approved: bool,
    decided_by: str,
) -> dict | None:
    """pending -> approved|rejected, atomically.

    Returns None when the row was not pending — already decided, already
    applied, or not this user's. The caller must treat that as "someone
    else got there first", never as a reason to retry.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update gatekeeper_intents
           set status = $3, decided_by = $4, decided_at = now(), updated_at = now()
         where id = $1 and user_id = $2 and status = 'pending'
        returning *
        """,
        intent_id, user_id, APPROVED if approved else REJECTED, decided_by,
    )
    return _row(row) if row else None


async def decide_many(
    intent_ids: list[UUID],
    *,
    user_id: str,
    approved: bool,
    decided_by: str,
) -> list[dict]:
    """Bulk decide. One statement, so a partially-applied bulk approval
    cannot exist: every row that was pending flips, the rest are silently
    skipped and simply absent from the result.

    Bulk is the point of speculative execution — an operator reviews
    twenty queued actions at once — so it must not be a loop of
    round-trips that can die halfway.
    """
    if not intent_ids:
        return []
    pool = await get_pool()
    rows = await pool.fetch(
        """
        update gatekeeper_intents
           set status = $3, decided_by = $4, decided_at = now(), updated_at = now()
         where user_id = $2 and status = 'pending' and id = any($1::uuid[])
        returning *
        """,
        intent_ids, user_id, APPROVED if approved else REJECTED, decided_by,
    )
    return [_row(r) for r in rows]


async def claim_for_apply(intent_id: UUID) -> dict | None:
    """approved -> applied, atomically, BEFORE the external call.

    Claiming first means a crash mid-apply leaves the row in `applied`
    with no `applied_at`, which the reaper can see. The alternative —
    claim after — risks two workers both making the platform call, and
    double-spending real money is strictly worse than a stranded row that
    a human investigates.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update gatekeeper_intents
           set status = 'applied', updated_at = now()
         where id = $1 and status = 'approved'
        returning *
        """,
        intent_id,
    )
    return _row(row) if row else None


async def complete_apply(
    intent_id: UUID,
    *,
    observed: Any,
    diverged: str | None = None,
) -> dict:
    """Record what the platform actually returned, and whether it
    contradicted the simulation the agent was told."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update gatekeeper_intents
           set observed = $2::jsonb, diverged = $3,
               applied_at = now(), updated_at = now()
         where id = $1
        returning *
        """,
        intent_id, _dump(observed), diverged,
    )
    return _row(row)


async def fail_apply(intent_id: UUID, *, error: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update gatekeeper_intents
           set status = 'failed', error = $2, updated_at = now()
         where id = $1
        returning *
        """,
        intent_id, error,
    )
    return _row(row)


async def pending_apply_queue(*, limit: int = 50) -> list[dict]:
    """Approved intents waiting to be applied, oldest decision first.

    Ordered by decision time rather than creation time because an
    operator's approvals should take effect in the order they were made.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from gatekeeper_intents
         where status = 'approved'
         order by decided_at asc
         limit $1
        """,
        limit,
    )
    return [_row(r) for r in rows]


async def reap_stale(*, older_than_minutes: int = 60) -> int:
    """An intent claimed for apply whose container died never reaches
    `applied_at`. Left alone it looks successful forever, so it is failed
    loudly instead — a human must decide whether the platform call landed.
    """
    pool = await get_pool()
    result = await pool.execute(
        """
        update gatekeeper_intents
           set status = 'failed',
               error = 'reaped: apply claimed but never completed (container died)',
               updated_at = now()
         where status = 'applied'
           and applied_at is null
           and updated_at < now() - make_interval(mins => $1)
        """,
        older_than_minutes,
    )
    return int(result.split()[-1])


async def expire_stale_pending(*, older_than_hours: int = 168) -> int:
    """A speculated action nobody approved in a week is stale: the state
    it was simulated against has almost certainly moved, so applying it
    later would be acting on a stale premise. Expire rather than let it
    sit approvable forever."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update gatekeeper_intents
           set status = 'expired', updated_at = now()
         where status = 'pending'
           and created_at < now() - make_interval(hours => $1)
        """,
        older_than_hours,
    )
    return int(result.split()[-1])


# -------------------------------------------------------------------- audit


async def write_audit(
    *,
    user_id: str,
    capability: str,
    verdict: str,
    summary: str = "",
    reason: str = "",
    actor: str = "agent",
    origin: str = "",
    intent_id: UUID | None = None,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into gatekeeper_audit
            (user_id, capability, verdict, summary, reason, actor, origin, intent_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8)
        """,
        user_id, capability, verdict, summary, reason, actor, origin, intent_id,
    )


async def list_audit(
    user_id: str, *, capability: str | None = None, limit: int = 200
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from gatekeeper_audit
         where user_id = $1 and ($2::text is null or capability = $2)
         order by created_at desc
         limit $3
        """,
        user_id, capability, limit,
    )
    return [dict(r) for r in rows]


def is_terminal(status: str) -> bool:
    return status in _TERMINAL
