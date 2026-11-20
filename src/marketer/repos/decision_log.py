"""decision_log: append-only record of decision-model calls
(see db/migrations/0026_decision_log.sql).

Rows are written once by ``services.decisions`` (pipelines) or by
``POST /api/v1/decisions/log`` (the agent). Only ``outcome`` / ``correction``
are filled in later, via ``record_outcome``. Every read is user-scoped.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool


class DecisionLogEntry(BaseModel):
    id: UUID
    point: str
    mode: str
    model: str | None
    questions_version: str
    answers: dict[str, Any] | None
    fallback_used: bool
    reason: str | None
    latency_ms: int
    cost_usd: Decimal | None
    action_taken: str
    rule_action: str | None
    table_action: str | None
    subject_kind: str | None
    subject_id: str | None
    outcome: dict[str, Any] | None
    correction: dict[str, Any] | None
    outcome_at: datetime | None
    created_at: datetime


# state_hash is deliberately not returned to clients: it is a join key for
# tuning, not something the UI needs.
_COLS = (
    "id, point, mode, model, questions_version, answers, fallback_used, reason, "
    "latency_ms, cost_usd, action_taken, rule_action, table_action, subject_kind, "
    "subject_id, outcome, correction, outcome_at, created_at"
)


def _row(r) -> DecisionLogEntry:
    d = dict(r)
    for k in ("answers", "outcome", "correction"):
        if isinstance(d.get(k), str):
            d[k] = json.loads(d[k])
    return DecisionLogEntry(**d)


def _dumps(v: Any) -> str | None:
    return None if v is None else json.dumps(v, default=str)


async def insert(
    *,
    user_id: str,
    point: str,
    mode: str,
    model: str | None,
    questions_version: str,
    state_hash: str,
    answers: dict[str, Any] | None,
    fallback_used: bool,
    reason: str | None,
    latency_ms: int,
    cost_usd: Decimal | None,
    action_taken: str,
    rule_action: str | None = None,
    table_action: str | None = None,
    subject_kind: str | None = None,
    subject_id: str | None = None,
) -> UUID:
    pool = await get_pool()
    return await pool.fetchval(
        """
        insert into decision_log (
            user_id, point, mode, model, questions_version, state_hash, answers,
            fallback_used, reason, latency_ms, cost_usd, action_taken, rule_action,
            table_action, subject_kind, subject_id)
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        returning id
        """,
        user_id, point, mode, model, questions_version, state_hash, _dumps(answers),
        fallback_used, reason, latency_ms, cost_usd, action_taken, rule_action,
        table_action, subject_kind, subject_id,
    )


def encode_cursor(created_at: datetime, id: UUID) -> str:
    raw = f"{created_at.isoformat()}|{id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    """Raises ValueError on anything that isn't a cursor we issued."""
    pad = "=" * (-len(cursor) % 4)
    try:
        ts, id_ = base64.urlsafe_b64decode(cursor + pad).decode().split("|", 1)
        return datetime.fromisoformat(ts), UUID(id_)
    except Exception as e:  # noqa: BLE001
        raise ValueError("bad cursor") from e


async def list_for_user(
    user_id: str,
    *,
    limit: int = 50,
    before: tuple[datetime, UUID] | None = None,
    point: str | None = None,
) -> list[DecisionLogEntry]:
    """The user's decisions, newest first, keyset-paginated on (created_at, id)."""
    pool = await get_pool()
    args: list[Any] = [user_id]
    where = ["user_id = $1"]
    if point:
        args.append(point)
        where.append(f"point = ${len(args)}")
    if before is not None:
        args.extend(before)
        where.append(f"(created_at, id) < (${len(args) - 1}, ${len(args)})")
    args.append(limit)
    rows = await pool.fetch(
        f"select {_COLS} from decision_log where {' and '.join(where)} "
        f"order by created_at desc, id desc limit ${len(args)}",
        *args,
    )
    return [_row(r) for r in rows]


async def record_outcome(
    decision_id: UUID,
    *,
    user_id: str,
    outcome: dict[str, Any] | None = None,
    correction: dict[str, Any] | None = None,
) -> bool:
    """Fill the later-known outcome / correction. Returns False when the row
    isn't the user's. Leaves a column untouched when its argument is None."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update decision_log
           set outcome = coalesce($3::jsonb, outcome),
               correction = coalesce($4::jsonb, correction),
               outcome_at = now()
         where id = $1 and user_id = $2
        """,
        decision_id, user_id, _dumps(outcome), _dumps(correction),
    )
    return result.split()[-1] == "1"
