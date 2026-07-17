"""media_assets repo — the Content Studio media library.

One row per durable asset: pipeline output (`source='pipeline'`,
inserted by `pipeline.py` when a render finishes) and Content Studio
edits (`source='studio'`, inserted by the studio routes after a fal.ai
call downloads its result onto the volume).

Listing is keyset-paginated on `(created_at desc, id desc)` — `cursor` is
the id of the last row seen on the previous page, so pages stay stable
even as new rows are inserted between requests (unlike OFFSET paging).
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from ..db import get_pool
from ..models import MediaAsset


def _row_to_asset(row) -> MediaAsset:
    d = dict(row)
    meta = d.get("meta")
    d["meta"] = json.loads(meta) if isinstance(meta, str) else (meta or {})
    return MediaAsset(**d)


async def insert(
    *,
    user_id: str,
    kind: str,
    source: str,
    niche_id: UUID | None = None,
    job_id: UUID | None = None,
    article_id: UUID | None = None,
    path: str = "",
    url: str = "",
    mime: str = "",
    meta: dict[str, Any] | None = None,
) -> MediaAsset:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into media_assets
            (user_id, niche_id, job_id, article_id, kind, source, path, url, mime, meta)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        returning *
        """,
        user_id, niche_id, job_id, article_id, kind, source, path, url, mime,
        json.dumps(meta or {}),
    )
    return _row_to_asset(row)


async def get(media_id: UUID, *, user_id: str) -> MediaAsset | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select * from media_assets
         where id = $1 and user_id = $2 and deleted_at is null
        """,
        media_id, user_id,
    )
    return _row_to_asset(row) if row else None


async def list_for_user(
    user_id: str,
    *,
    kind: str | None = None,
    source: str | None = None,
    limit: int = 50,
    cursor: UUID | None = None,
) -> list[MediaAsset]:
    pool = await get_pool()
    cursor_created_at = None
    if cursor is not None:
        cursor_row = await pool.fetchrow(
            "select created_at from media_assets where id = $1 and user_id = $2",
            cursor, user_id,
        )
        # An unknown/foreign cursor degrades to "first page" rather than
        # erroring — a stale bookmark shouldn't break the whole listing.
        if cursor_row is not None:
            cursor_created_at = cursor_row["created_at"]

    rows = await pool.fetch(
        """
        select * from media_assets
         where user_id = $1
           and deleted_at is null
           and ($2::text is null or kind = $2)
           and ($3::text is null or source = $3)
           and (
                $4::timestamptz is null
                or (created_at, id) < ($4::timestamptz, $5::uuid)
           )
         order by created_at desc, id desc
         limit $6
        """,
        user_id, kind, source, cursor_created_at, cursor, limit,
    )
    return [_row_to_asset(r) for r in rows]


async def soft_delete(media_id: UUID, *, user_id: str) -> bool:
    """Mark a media asset deleted (the file on disk is left for retention
    GC — deletion here is a library/visibility action, not a volume wipe).
    Returns False if the row doesn't exist / isn't owned / is already
    deleted."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update media_assets
           set deleted_at = now()
         where id = $1 and user_id = $2 and deleted_at is null
        """,
        media_id, user_id,
    )
    return result.split()[-1] != "0"
