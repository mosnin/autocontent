"""asyncpg repository for `micro_dramas`.

The whole resume story lives in one jsonb column: `plan` holds the
`DramaPlan` snapshot (screenplay, cast with locked portrait paths, shots with
keyframe/clip paths). `save_plan` is called after every stage, so a container
that dies mid-render leaves behind an accurate record of exactly what was
already paid for — mirroring `repos.jobs.save_snapshot` for video jobs.
"""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool
from ..drama.schemas import Drama, DramaPlan, DramaStatus

_COLS = (
    "id, user_id, niche_id, status, idea, script, shot_count, aspect, plan, "
    "video_path, duration_sec, error, created_at, updated_at"
)


def _row_to_model(row) -> Drama:
    d = dict(row)
    plan = d.get("plan")
    if isinstance(plan, str):
        plan = json.loads(plan)
    d["plan"] = DramaPlan.model_validate(plan or {})
    return Drama.model_validate(d)


async def create(
    *,
    user_id: str,
    niche_id: UUID,
    idea: str = "",
    script: str = "",
    shot_count: int = 6,
    aspect: str = "9:16",
) -> Drama:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into micro_dramas (user_id, niche_id, idea, script, shot_count, aspect)
        values ($1, $2, $3, $4, $5, $6)
        returning {_COLS}
        """,
        user_id, niche_id, idea, script, shot_count, aspect,
    )
    return _row_to_model(row)


async def get(drama_id: UUID, *, user_id: str) -> Drama | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from micro_dramas where id = $1 and user_id = $2",
        drama_id, user_id,
    )
    return _row_to_model(row) if row else None


async def list_for_user(
    user_id: str, *, status: DramaStatus | None = None, limit: int = 50
) -> list[Drama]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS} from micro_dramas
         where user_id = $1
           and ($2::text is null or status = $2)
         order by created_at desc
         limit $3
        """,
        user_id,
        status.value if status is not None else None,
        limit,
    )
    out: list[Drama] = []
    for r in rows:
        try:
            out.append(_row_to_model(r))
        except Exception:
            import logging

            logging.getLogger(__name__).exception("unparseable drama row; skipping")
    return out


async def set_status(
    drama_id: UUID, *, user_id: str, status: DramaStatus
) -> Drama | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update micro_dramas set status = $3, updated_at = now()
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        drama_id, user_id, status.value,
    )
    return _row_to_model(row) if row else None


async def save_plan(drama_id: UUID, *, user_id: str, plan: DramaPlan) -> Drama | None:
    """Checkpoint the plan. Called after EVERY stage — the cost of an extra
    UPDATE is nothing next to re-buying a screenplay, five portraits, and six
    clips because a later stage blew up."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update micro_dramas set plan = $3::jsonb, updated_at = now()
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        drama_id, user_id, plan.model_dump_json(),
    )
    return _row_to_model(row) if row else None


async def complete(
    drama_id: UUID,
    *,
    user_id: str,
    plan: DramaPlan,
    video_path: str,
    duration_sec: float | None,
) -> Drama | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update micro_dramas
           set status = 'done', plan = $3::jsonb, video_path = $4,
               duration_sec = $5, error = null, updated_at = now()
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        drama_id, user_id, plan.model_dump_json(), video_path, duration_sec,
    )
    return _row_to_model(row) if row else None


async def fail(
    drama_id: UUID, *, user_id: str, error: str, plan: DramaPlan | None = None
) -> Drama | None:
    """Terminal failure. The plan is written alongside the error so the
    already-paid screenplay/portraits/clips survive for the retry."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update micro_dramas
           set status = 'failed', error = $3,
               plan = coalesce($4::jsonb, plan), updated_at = now()
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        drama_id, user_id, error,
        plan.model_dump_json() if plan is not None else None,
    )
    return _row_to_model(row) if row else None


async def claim_for_retry(drama_id: UUID, *, user_id: str) -> Drama | None:
    """Atomic failed->queued claim (mirrors articles.claim_for_retry).

    The `and status = 'failed'` predicate is re-evaluated under a row lock at
    UPDATE time, so two concurrent retries of the same drama can't both spawn
    a pipeline run — which for a drama would mean double-paying for every
    remaining shot. `plan` is deliberately NOT cleared: the retry resumes.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update micro_dramas
           set status = 'queued', error = null, updated_at = now()
         where id = $1 and user_id = $2 and status = 'failed'
        returning {_COLS}
        """,
        drama_id, user_id,
    )
    return _row_to_model(row) if row else None


async def reap_stale(*, older_than_minutes: int = 120) -> int:
    """Fail dramas stuck in a non-terminal status — same contract as
    jobs.reap_stale / articles.reap_stale."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update micro_dramas
           set status = 'failed',
               error = 'reaped: no progress (container died or timed out mid-run)',
               updated_at = now()
         where status not in ('done', 'failed')
           and updated_at < now() - make_interval(mins => $1)
        """,
        older_than_minutes,
    )
    return int(result.split()[-1])
