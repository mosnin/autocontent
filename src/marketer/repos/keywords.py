"""Keyword candidates repo — the SEO backlog Team Keywords' harvester feeds
(POST /keywords/harvest) and an operator triages via track/dismiss/promote.

Promotion hands a candidate off to the press planner's approval queue
(topic_proposals, migration 0017) rather than duplicating that table's
lifecycle here — this repo only tracks the candidate side of that handoff.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool


class KeywordCandidate(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID
    keyword: str
    intent: str = ""
    difficulty: Decimal | None = None
    volume_hint: str = ""
    rationale: str = ""
    status: str  # 'candidate' | 'tracked' | 'dismissed' | 'promoted'
    created_at: datetime


_COLS = (
    "id, user_id, niche_id, keyword, intent, difficulty, volume_hint, "
    "rationale, status, created_at"
)


async def create(
    *,
    user_id: str,
    niche_id: UUID,
    keyword: str,
    intent: str = "",
    volume_hint: str = "",
    rationale: str = "",
) -> KeywordCandidate | None:
    """Insert one harvested candidate.

    Returns None (a skip, not an error) when (user_id, niche_id, keyword)
    already exists — services.keyword_research.harvest's caller loops over
    a batch and counts skips rather than treating a duplicate as a
    failure, since the harvester is only asked to avoid repeats on a
    best-effort basis (see the unique constraint in migration 0020).
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into keyword_candidates
            (user_id, niche_id, keyword, intent, volume_hint, rationale)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (user_id, niche_id, keyword) do nothing
        returning {_COLS}
        """,
        user_id, niche_id, keyword, intent, volume_hint, rationale,
    )
    return KeywordCandidate(**dict(row)) if row else None


async def list_for_user(
    user_id: str,
    *,
    niche_id: UUID | None = None,
    status: str | None = None,
    limit: int = 200,
) -> list[KeywordCandidate]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS} from keyword_candidates
         where user_id = $1
           and ($2::uuid is null or niche_id = $2)
           and ($3::text is null or status = $3)
         order by created_at desc
         limit $4
        """,
        user_id, niche_id, status, limit,
    )
    return [KeywordCandidate(**dict(r)) for r in rows]


async def get(candidate_id: UUID, *, user_id: str) -> KeywordCandidate | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from keyword_candidates where id = $1 and user_id = $2",
        candidate_id, user_id,
    )
    return KeywordCandidate(**dict(row)) if row else None


async def set_status(
    candidate_id: UUID,
    *,
    user_id: str,
    status: str,
    from_statuses: tuple[str, ...],
) -> KeywordCandidate | None:
    """Transition a candidate's status, guarded by its current status —
    same one-shot-per-transition pattern as topic_proposals.decide. A
    candidate already 'promoted' or 'dismissed' can't be silently pulled
    back into another state underneath whatever it already triggered
    (e.g. a topic proposal spawned by promote)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update keyword_candidates
           set status = $3
         where id = $1 and user_id = $2 and status = any($4::text[])
        returning {_COLS}
        """,
        candidate_id, user_id, status, list(from_statuses),
    )
    return KeywordCandidate(**dict(row)) if row else None


async def set_difficulty(
    candidate_id: UUID, *, user_id: str, difficulty: Decimal | None
) -> KeywordCandidate | None:
    """Persist a difficulty score (or None, if scoring degraded). Allowed
    regardless of status — re-scoring a tracked/promoted candidate is
    fine, the difficulty is just informational."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update keyword_candidates
           set difficulty = $3
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        candidate_id, user_id, difficulty,
    )
    return KeywordCandidate(**dict(row)) if row else None
