"""Trend report rows: one research run for one niche.

Rows are returned as plain dicts (same contract as ``repos.seo_audits``
and ``repos.design_projects``), with the `report` jsonb already decoded.
Every read is user-scoped — a report is a tenant artifact, and an
unscoped lookup would hand out another account's research.
"""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool

_COLS = (
    "id, user_id, niche_id, status, grounded, report, error, "
    "created_at, updated_at"
)

# Statuses a run can be stranded in when a container dies mid-flight.
_REAPABLE_STATUSES = ("queued", "researching")
_REAP_ERROR = "reaped: no progress (container died or timed out mid-run)"


def _row(row) -> dict:
    d = dict(row)
    if isinstance(d.get("report"), str):
        d["report"] = json.loads(d["report"])
    return d


async def create(*, user_id: str, niche_id: UUID) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into trend_reports (user_id, niche_id)
        values ($1, $2)
        returning {_COLS}
        """,
        user_id, niche_id,
    )
    return _row(row)


async def get(report_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from trend_reports where id = $1 and user_id = $2",
        report_id, user_id,
    )
    return _row(row) if row else None


async def list_for_user(
    user_id: str, *, niche_id: UUID | None = None, limit: int = 50
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS} from trend_reports
         where user_id = $1
           and ($2::uuid is null or niche_id = $2)
         order by created_at desc
         limit $3
        """,
        user_id, niche_id, limit,
    )
    return [_row(r) for r in rows]


async def set_status(report_id: UUID, *, user_id: str, status: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update trend_reports set status = $3, updated_at = now()
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        report_id, user_id, status,
    )
    return _row(row) if row else None


async def complete(
    report_id: UUID, *, user_id: str, report: dict, grounded: bool
) -> dict | None:
    """Store the finished report and clear any prior error.

    `grounded` is promoted out of the blob into its own column because
    the list view has to badge ungrounded reports, and reading a whole
    report blob per row to find one boolean is the kind of thing that
    turns a list endpoint into a slow one.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update trend_reports
           set status = 'done',
               report = $3::jsonb,
               grounded = $4,
               error = null,
               updated_at = now()
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        report_id, user_id, json.dumps(report), grounded,
    )
    return _row(row) if row else None


async def fail(report_id: UUID, *, user_id: str, error: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update trend_reports
           set status = 'failed', error = $3, updated_at = now()
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        report_id, user_id, error[:2000],
    )
    return _row(row) if row else None


async def claim_for_retry(report_id: UUID, *, user_id: str) -> bool:
    """Atomic failed -> queued claim.

    The `and status = 'failed'` predicate is re-evaluated under a row
    lock at UPDATE time, so of two concurrent retries exactly one wins.
    Without it both could pass a read-then-write check and both spawn a
    research run — two metered LLM calls for one report.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update trend_reports
           set status = 'queued', error = null, updated_at = now()
         where id = $1 and user_id = $2 and status = 'failed'
        returning id
        """,
        report_id, user_id,
    )
    return row is not None


async def reap_stale(*, older_than_minutes: int = 60) -> int:
    """Fail reports stranded in a non-terminal status — same contract as
    `repos.design_projects.reap_stale`. A crashed container otherwise
    leaves a report `researching` forever, where the user can neither see
    it fail nor retry it."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update trend_reports
           set status = 'failed', error = $2, updated_at = now()
         where status = any($1::text[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        list(_REAPABLE_STATUSES), _REAP_ERROR, older_than_minutes,
    )
    return int(result.split()[-1])
