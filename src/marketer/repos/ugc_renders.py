"""UGC studio renders (migration 0028). Rows are returned as plain dicts.

Two access patterns, deliberately separate:

  * user-scoped reads/writes (`get`, `list_for_user`, `claim_for_retry`,
    `delete`) always carry `user_id` in the WHERE clause — a caller
    holding someone else's render id gets a miss, not a row.
  * the webhook path (`complete`, `fail`, `mark_running`) keys on the
    provider's request id, which is not user-supplied and is unique. Those
    writes additionally require the row to still be in a non-terminal
    status, so a duplicate or late delivery cannot resurrect a render the
    user already deleted the result of, flip a failure back to done, or
    overwrite a completed video URL.
"""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from ..db import get_pool

# Statuses a provider callback is allowed to transition out of.
PENDING_STATUSES = ("queued", "running")


def _row(row) -> dict:
    d = dict(row)
    if isinstance(d.get("image_urls"), str):
        d["image_urls"] = json.loads(d["image_urls"])
    if isinstance(d.get("est_cost_usd"), Decimal):
        d["est_cost_usd"] = str(d["est_cost_usd"])
    return d


async def create(
    *,
    user_id: str,
    model_id: str,
    prompt: str,
    render_mode: str,
    aspect_ratio: str = "",
    resolution: str = "",
    mode: str = "",
    duration_sec: int = 0,
    image_urls: list[str] | None = None,
    niche_id: UUID | None = None,
    est_cost_usd: Decimal | str = "0",
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into ugc_renders (
            user_id, niche_id, model_id, prompt, render_mode,
            aspect_ratio, resolution, mode, duration_sec,
            image_urls, est_cost_usd
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
        returning *
        """,
        user_id, niche_id, model_id, prompt, render_mode,
        aspect_ratio, resolution, mode, duration_sec,
        json.dumps(list(image_urls or [])), Decimal(str(est_cost_usd)),
    )
    return _row(row)


async def get(render_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from ugc_renders where id = $1 and user_id = $2",
        render_id, user_id,
    )
    return _row(row) if row else None


async def get_by_request_id(provider_request_id: str) -> dict | None:
    """Webhook lookup. Not user-scoped: the caller is the provider, and the
    request id is ours-and-theirs, never client-supplied."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from ugc_renders where provider_request_id = $1",
        provider_request_id,
    )
    return _row(row) if row else None


async def list_for_user(
    user_id: str, *, status: str | None = None, limit: int = 50
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from ugc_renders
        where user_id = $1 and ($2::text is null or status = $2)
        order by created_at desc limit $3
        """,
        user_id, status, limit,
    )
    return [_row(r) for r in rows]


async def attach_request(
    render_id: UUID, *, user_id: str, provider_request_id: str
) -> dict | None:
    """Record the provider's request id and move queued -> running.

    Scoped to `queued` so a retry that raced with an in-flight submit can
    never rebind a running render to a second provider job.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ugc_renders
           set provider_request_id = $3, status = 'running',
               error = null, updated_at = now()
         where id = $1 and user_id = $2 and status = 'queued'
        returning *
        """,
        render_id, user_id, provider_request_id,
    )
    return _row(row) if row else None


async def fail_by_id(render_id: UUID, *, user_id: str, error: str) -> dict | None:
    """Mark a render failed from our side (submit rejected, validation blew
    up after the row was written)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ugc_renders
           set status = 'failed', error = $3, updated_at = now()
         where id = $1 and user_id = $2 and status = any($4::text[])
        returning *
        """,
        render_id, user_id, error, list(PENDING_STATUSES),
    )
    return _row(row) if row else None


async def complete(provider_request_id: str, *, video_url: str) -> dict | None:
    """Provider callback: pending -> done. None when the row is missing or
    already terminal (duplicate/late delivery)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ugc_renders
           set status = 'done', video_url = $2, error = null, updated_at = now()
         where provider_request_id = $1 and status = any($3::text[])
        returning *
        """,
        provider_request_id, video_url, list(PENDING_STATUSES),
    )
    return _row(row) if row else None


async def fail(provider_request_id: str, *, error: str) -> dict | None:
    """Provider callback: pending -> failed."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ugc_renders
           set status = 'failed', error = $2, updated_at = now()
         where provider_request_id = $1 and status = any($3::text[])
        returning *
        """,
        provider_request_id, error, list(PENDING_STATUSES),
    )
    return _row(row) if row else None


async def mark_running(provider_request_id: str) -> dict | None:
    """Provider progress ping: queued -> running, no other transition."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ugc_renders
           set status = 'running', updated_at = now()
         where provider_request_id = $1 and status = 'queued'
        returning *
        """,
        provider_request_id,
    )
    return _row(row) if row else None


async def claim_for_retry(render_id: UUID, *, user_id: str) -> dict | None:
    """Atomic failed -> queued claim (retry double-click safety).

    Clears the old provider_request_id: the retry gets a new job, and
    leaving the stale id attached would let the *old* render's late
    webhook complete the new attempt.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ugc_renders
           set status = 'queued', error = null, video_url = null,
               provider_request_id = null, updated_at = now()
         where id = $1 and user_id = $2 and status = 'failed'
        returning *
        """,
        render_id, user_id,
    )
    return _row(row) if row else None


async def delete(render_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from ugc_renders where id = $1 and user_id = $2",
        render_id, user_id,
    )
    return result.split()[-1] != "0"


_REAP_ERROR = "reaped: provider never reported completion"


async def reap_stale(*, older_than_minutes: int = 60) -> int:
    """Fail renders the provider never called back about.

    A missed webhook otherwise strands a row in `running` forever, showing
    the user a spinner for an ad that will never arrive.
    """
    pool = await get_pool()
    result = await pool.execute(
        """
        update ugc_renders
           set status = 'failed', error = $1, updated_at = now()
         where status = any($2::text[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        _REAP_ERROR, list(PENDING_STATUSES), older_than_minutes,
    )
    return int(result.split()[-1])
