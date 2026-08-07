"""Design projects: the brief, its plan, and the canvas it produced.

Rows are returned as plain dicts (same shape contract as
``repos.image_posts``). ``plan`` and ``canvas`` are jsonb snapshots —
the plan is rewritten after every executed layer so the plan view and
the resume path read the same source of truth.
"""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool


def _row(row) -> dict:
    d = dict(row)
    for key in ("plan", "canvas"):
        if isinstance(d.get(key), str):
            d[key] = json.loads(d[key])
    return d


async def create(
    *,
    user_id: str,
    niche_id: UUID,
    brief: str,
    fmt: str = "1:1",
    max_steps: int = 8,
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into design_projects (user_id, niche_id, brief, format, max_steps)
        values ($1, $2, $3, $4, $5)
        returning *
        """,
        user_id, niche_id, brief, fmt, max_steps,
    )
    return _row(row)


async def get(project_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from design_projects where id = $1 and user_id = $2",
        project_id, user_id,
    )
    return _row(row) if row else None


async def list_for_user(
    user_id: str, *, status: str | None = None, limit: int = 50
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from design_projects
        where user_id = $1 and ($2::text is null or status = $2)
        order by created_at desc limit $3
        """,
        user_id, status, limit,
    )
    return [_row(r) for r in rows]


async def set_status(project_id: UUID, *, user_id: str, status: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update design_projects set status = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, status,
    )
    return _row(row)


async def save_plan(project_id: UUID, *, user_id: str, plan: dict) -> dict:
    """Snapshot the plan (including each step's status/output).

    Called after every executed layer: partial progress must survive a
    container death, or a retry would re-buy images already paid for.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update design_projects set plan = $3::jsonb, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, json.dumps(plan),
    )
    return _row(row)


async def save_canvas(
    project_id: UUID, *, user_id: str, plan: dict, canvas: list[dict]
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update design_projects
        set plan = $3::jsonb, canvas = $4::jsonb, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, json.dumps(plan), json.dumps(canvas),
    )
    return _row(row)


async def complete(project_id: UUID, *, user_id: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update design_projects
        set status = 'done', error = null, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id,
    )
    return _row(row)


async def fail(project_id: UUID, *, user_id: str, error: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update design_projects set status = 'failed', error = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, error[:2000],
    )
    return _row(row)


async def claim_for_retry(project_id: UUID, *, user_id: str) -> bool:
    """Atomic failed -> queued claim (retry-button double-click safety).

    The plan is deliberately left untouched: completed steps keep their
    outputs so the retry resumes instead of restarting.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update design_projects set status = 'queued', error = null, updated_at = now()
        where id = $1 and user_id = $2 and status = 'failed'
        returning id
        """,
        project_id, user_id,
    )
    return row is not None


async def claim_step_retry(project_id: UUID, *, user_id: str, plan: dict) -> bool:
    """Atomic {done,failed} -> queued claim that also stores the reset plan.

    Re-running one step is legitimate on a *finished* project (the user
    dislikes one panel), so this accepts `done` as well — but only
    terminal states, so it can't race an in-flight run.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update design_projects
        set status = 'queued', error = null, plan = $3::jsonb, updated_at = now()
        where id = $1 and user_id = $2 and status in ('done', 'failed')
        returning id
        """,
        project_id, user_id, json.dumps(plan),
    )
    return row is not None


_REAPABLE_STATUSES = ("queued", "planning", "executing")
_REAP_ERROR = "reaped: no progress (container died or timed out mid-run)"


async def reap_stale(*, older_than_minutes: int = 120) -> int:
    """Fail projects stuck in a non-terminal status with no progress.

    A crashed container strands a project in `executing` forever, where
    it is invisible to the user and un-retryable (retry only claims
    `failed`). Reaping makes it retryable — and the retry resumes from
    the steps that did finish.
    """
    pool = await get_pool()
    result = await pool.execute(
        """
        update design_projects
           set status = 'failed', error = $2, updated_at = now()
         where status = any($1::text[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        list(_REAPABLE_STATUSES), _REAP_ERROR, older_than_minutes,
    )
    return int(result.split()[-1])
