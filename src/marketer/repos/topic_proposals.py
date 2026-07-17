"""Topic proposal repo — the human-in-the-loop approval queue the press
autopilot scheduler drains.

Lifecycle: pending -> approved | rejected (POST /topics/{id}/approve|reject,
each a one-way transition guarded by `status = 'pending'`). There is no
separate "consumed" status in the schema (`status` is checked to
pending/approved/rejected only) — when the autopilot scheduler consumes the
oldest approved proposal for a niche it moves it to 'rejected' so it can
never be picked again, and stamps `decided_at`. This keeps the schema small
at the cost of a consumed proposal looking identical to an explicitly
rejected one in the queue; if that distinction ever matters, add a real
`consumed` status/column instead of overloading `rejected`.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool


class TopicProposal(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID
    title: str
    focus_keyword: str
    rationale: str
    score: float
    status: str  # 'pending' | 'approved' | 'rejected'
    created_at: datetime
    decided_at: datetime | None = None


_COLS = (
    "id, user_id, niche_id, title, focus_keyword, rationale, score, "
    "status, created_at, decided_at"
)


async def create(
    *,
    user_id: str,
    niche_id: UUID,
    title: str,
    focus_keyword: str = "",
    rationale: str = "",
    score: float = 0.0,
) -> TopicProposal:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into topic_proposals
            (user_id, niche_id, title, focus_keyword, rationale, score)
        values ($1, $2, $3, $4, $5, $6)
        returning {_COLS}
        """,
        user_id, niche_id, title, focus_keyword, rationale, score,
    )
    return TopicProposal(**dict(row))


async def list_for_user(
    user_id: str,
    *,
    status: str | None = None,
    niche_id: UUID | None = None,
    limit: int = 100,
) -> list[TopicProposal]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS} from topic_proposals
         where user_id = $1
           and ($2::text is null or status = $2)
           and ($3::uuid is null or niche_id = $3)
         order by created_at desc
         limit $4
        """,
        user_id, status, niche_id, limit,
    )
    return [TopicProposal(**dict(r)) for r in rows]


async def get(proposal_id: UUID, *, user_id: str) -> TopicProposal | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from topic_proposals where id = $1 and user_id = $2",
        proposal_id, user_id,
    )
    return TopicProposal(**dict(row)) if row else None


async def decide(
    proposal_id: UUID, *, user_id: str, status: str
) -> TopicProposal | None:
    """Transition a pending proposal to 'approved' or 'rejected'. Returns
    None (and does nothing) if the proposal is missing, foreign, or already
    decided — approve/reject is a one-shot action, not idempotent-overwrite."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update topic_proposals
           set status = $3, decided_at = now()
         where id = $1 and user_id = $2 and status = 'pending'
        returning {_COLS}
        """,
        proposal_id, user_id, status,
    )
    return TopicProposal(**dict(row)) if row else None


async def consume_oldest_approved(niche_id: UUID) -> TopicProposal | None:
    """Atomically claim the oldest approved proposal for a niche (used by
    the autopilot scheduler to pick the next topic instead of a blind
    pick_topic call), marking it as no longer available. Uses
    `FOR UPDATE SKIP LOCKED` so two overlapping scheduler runs can't both
    claim the same proposal. Returns None if no approved proposal exists —
    callers should fall back to the pipeline's own pick_topic path."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update topic_proposals
           set status = 'rejected', decided_at = now()
         where id = (
             select id from topic_proposals
              where niche_id = $1 and status = 'approved'
              order by created_at asc
              limit 1
              for update skip locked
         )
        returning {_COLS}
        """,
        niche_id,
    )
    return TopicProposal(**dict(row)) if row else None
