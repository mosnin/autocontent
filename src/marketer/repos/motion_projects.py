"""Motion projects: the narration, its beat plan, and the composited video.

Rows come back as plain dicts (same shape contract as
``repos.image_posts`` / ``repos.design_projects``). ``beats`` and
``overlays`` are jsonb snapshots rewritten as the run progresses, so the
detail view and a resume read the same source of truth — including which
strategy supplied each beat and the keyword/prompt it used.
"""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool

# Statuses a run passes through before it settles. Kept here (not in the
# pipeline) because the reaper and the retry claim are the only things
# that need to know which ones are non-terminal.
PENDING_STATUSES = (
    "queued",
    "voicing",
    "transcribing",
    "planning",
    "rendering",
    "compositing",
)


def _row(row) -> dict:
    d = dict(row)
    for key in ("beats", "overlays"):
        if isinstance(d.get(key), str):
            d[key] = json.loads(d[key])
    return d


async def create(
    *,
    user_id: str,
    niche_id: UUID,
    narration: str = "",
    job_id: UUID | None = None,
    style_key: str,
    aspect: str = "9:16",
    source: str = "generated",
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into motion_projects
            (user_id, niche_id, narration, job_id, style_key, aspect, source)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
        """,
        user_id, niche_id, narration, job_id, style_key, aspect, source,
    )
    return _row(row)


async def get(project_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from motion_projects where id = $1 and user_id = $2",
        project_id, user_id,
    )
    return _row(row) if row else None


async def list_for_user(
    user_id: str, *, status: str | None = None, limit: int = 50
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from motion_projects
        where user_id = $1 and ($2::text is null or status = $2)
        order by created_at desc limit $3
        """,
        user_id, status, limit,
    )
    return [_row(r) for r in rows]


async def set_status(project_id: UUID, *, user_id: str, status: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update motion_projects set status = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, status,
    )
    return _row(row) if row else None


async def save_plan(
    project_id: UUID, *, user_id: str, beats: list[dict], overlays: list[dict]
) -> dict | None:
    """Snapshot the beat plan and the overlay specs.

    Written once before any pixels are bought and again after the render
    pass: partial progress must survive a container death, or a retry
    would re-buy keyframes that are already on the volume.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update motion_projects
        set beats = $3::jsonb, overlays = $4::jsonb, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, json.dumps(beats), json.dumps(overlays),
    )
    return _row(row) if row else None


async def complete(project_id: UUID, *, user_id: str, video_path: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update motion_projects
        set status = 'done', video_path = $3, error = null, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, video_path,
    )
    return _row(row) if row else None


async def fail(project_id: UUID, *, user_id: str, error: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update motion_projects set status = 'failed', error = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        project_id, user_id, error[:2000],
    )
    return _row(row) if row else None


async def claim_for_retry(project_id: UUID, *, user_id: str) -> bool:
    """Atomic failed -> queued claim (retry-button double-click safety).

    The beat plan is deliberately left untouched: keyframes already on
    the volume are reused by the render pass, so a retry resumes rather
    than re-buying every image.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update motion_projects set status = 'queued', error = null, updated_at = now()
        where id = $1 and user_id = $2 and status = 'failed'
        returning id
        """,
        project_id, user_id,
    )
    return row is not None


_REAP_ERROR = "reaped: no progress (container died or timed out mid-run)"


async def reap_stale(*, older_than_minutes: int = 120) -> int:
    """Fail projects stuck in a non-terminal status with no progress.

    A crashed container strands a project mid-render, where it is
    invisible to the user and un-retryable (retry only claims `failed`).
    Reaping makes it retryable — and the retry resumes.
    """
    pool = await get_pool()
    result = await pool.execute(
        """
        update motion_projects
           set status = 'failed', error = $2, updated_at = now()
         where status = any($1::text[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        list(PENDING_STATUSES), _REAP_ERROR, older_than_minutes,
    )
    return int(result.split()[-1])
