"""Headshot studio: sources, batches, and per-variant rows (migration 0035).

Rows are returned as plain dicts, matching `repos.image_posts` /
`repos.ugc_renders` — the batch payload is small and fully described by
its columns, so a pydantic model here would buy nothing but drift.

Every read and write is user-scoped in the WHERE clause. That is stricter
than it looks for this table set: the rows point at photographs of a real,
identifiable person, so a caller holding someone else's batch or variant
id must get a miss, never a row and never a file path.
"""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool

# Batch statuses a worker may still be moving through.
PENDING_BATCH_STATUSES = ("queued", "running")
# Terminal batch statuses that hold at least one paid-for portrait.
DELIVERED_BATCH_STATUSES = ("done", "partial")


def _batch_row(row) -> dict:
    d = dict(row)
    if isinstance(d.get("source_image_ids"), str):
        d["source_image_ids"] = json.loads(d["source_image_ids"])
    return d


def _row(row) -> dict:
    return dict(row)


# --------------------------------------------------------------- sources

async def create_source(
    *,
    user_id: str,
    path: str,
    content_type: str,
    size_bytes: int,
    filename: str = "",
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into headshot_sources (user_id, path, content_type, size_bytes, filename)
        values ($1, $2, $3, $4, $5)
        returning *
        """,
        user_id, path, content_type, size_bytes, filename,
    )
    return _row(row)


async def get_source(source_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from headshot_sources where id = $1 and user_id = $2",
        source_id, user_id,
    )
    return _row(row) if row else None


async def get_sources(source_ids: list[UUID], *, user_id: str) -> list[dict]:
    """Fetch the caller's sources, returned in the order they were asked
    for — reference order is art direction (the first photo is the primary
    face reference), so restoring it here keeps the DB's arbitrary row
    order from silently reshuffling the prompt inputs."""
    if not source_ids:
        return []
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from headshot_sources where user_id = $1 and id = any($2::uuid[])",
        user_id, list(source_ids),
    )
    by_id = {r["id"]: _row(r) for r in rows}
    return [by_id[sid] for sid in source_ids if sid in by_id]


async def list_source_paths(user_id: str) -> list[str]:
    """Every stored source path for a user. Used by the erasure sweep."""
    pool = await get_pool()
    rows = await pool.fetch(
        "select path from headshot_sources where user_id = $1", user_id
    )
    return [r["path"] for r in rows]


async def delete_source(source_id: UUID, *, user_id: str) -> str | None:
    """Delete one source row, returning its path so the caller can unlink
    the file. None if it wasn't the caller's."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "delete from headshot_sources where id = $1 and user_id = $2 returning path",
        source_id, user_id,
    )
    return row["path"] if row else None


# --------------------------------------------------------------- batches

async def create_batch(
    *,
    user_id: str,
    style_key: str,
    source_image_ids: list[UUID],
    variant_count: int,
    subject_notes: str = "",
    niche_id: UUID | None = None,
) -> dict:
    """Insert the batch and its N queued variant rows in one transaction.

    Atomic on purpose: a batch whose variant rows are missing renders
    nothing and reports 'queued' forever, which is indistinguishable from
    a stuck worker.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            batch = await conn.fetchrow(
                """
                insert into headshot_batches (
                    user_id, niche_id, style_key, subject_notes,
                    variant_count, source_image_ids
                )
                values ($1, $2, $3, $4, $5, $6::jsonb)
                returning *
                """,
                user_id, niche_id, style_key, subject_notes, variant_count,
                json.dumps([str(s) for s in source_image_ids]),
            )
            await conn.executemany(
                """
                insert into headshot_variants (batch_id, user_id, variant_index)
                values ($1, $2, $3)
                """,
                [(batch["id"], user_id, i) for i in range(variant_count)],
            )
    return _batch_row(batch)


async def get_batch(batch_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from headshot_batches where id = $1 and user_id = $2",
        batch_id, user_id,
    )
    return _batch_row(row) if row else None


async def list_batches(
    user_id: str, *, status: str | None = None, limit: int = 50
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from headshot_batches
        where user_id = $1 and ($2::text is null or status = $2)
        order by created_at desc limit $3
        """,
        user_id, status, limit,
    )
    return [_batch_row(r) for r in rows]


async def set_batch_status(
    batch_id: UUID, *, user_id: str, status: str, error: str | None = None
) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update headshot_batches
           set status = $3, error = $4, updated_at = now()
         where id = $1 and user_id = $2
        returning *
        """,
        batch_id, user_id, status, error,
    )
    return _batch_row(row) if row else None


async def claim_for_run(batch_id: UUID, *, user_id: str) -> dict | None:
    """Atomic queued -> running claim.

    The worker calls this before spending anything, so two spawns racing
    on the same batch can never both fan out and double-charge.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update headshot_batches
           set status = 'running', error = null, updated_at = now()
         where id = $1 and user_id = $2 and status = 'queued'
        returning *
        """,
        batch_id, user_id,
    )
    return _batch_row(row) if row else None


async def claim_for_retry(batch_id: UUID, *, user_id: str) -> dict | None:
    """Atomic failed/partial -> queued claim, resetting only the variants
    that have nothing to show.

    Variants already in 'done' keep their image: they were charged for and
    delivered, and re-rendering them would bill the user twice for a
    picture they already have. 'failed' and 'cancelled' variants go back to
    'queued' — cancelled ones in particular are the tail of a batch a
    tripped spend cap stopped, and finishing them is the whole point of
    the retry button.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            batch = await conn.fetchrow(
                """
                update headshot_batches
                   set status = 'queued', error = null, updated_at = now()
                 where id = $1 and user_id = $2 and status in ('failed','partial')
                returning *
                """,
                batch_id, user_id,
            )
            if batch is None:
                return None
            await conn.execute(
                """
                update headshot_variants
                   set status = 'queued', error = null, updated_at = now()
                 where batch_id = $1 and status in ('failed','cancelled')
                """,
                batch_id,
            )
    return _batch_row(batch)


async def delete_batch(batch_id: UUID, *, user_id: str) -> list[str]:
    """Delete a batch (variants cascade) and return every rendered image
    path so the caller can unlink the files. Empty list when the batch
    wasn't the caller's — callers must treat that as a 404, not a
    successful no-op delete."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            owned = await conn.fetchval(
                "select 1 from headshot_batches where id = $1 and user_id = $2",
                batch_id, user_id,
            )
            if owned is None:
                return []
            rows = await conn.fetch(
                """
                select image_path from headshot_variants
                 where batch_id = $1 and image_path is not null
                """,
                batch_id,
            )
            await conn.execute(
                "delete from headshot_batches where id = $1 and user_id = $2",
                batch_id, user_id,
            )
    return [r["image_path"] for r in rows]


# -------------------------------------------------------------- variants

async def list_variants(batch_id: UUID, *, user_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from headshot_variants
         where batch_id = $1 and user_id = $2
         order by variant_index
        """,
        batch_id, user_id,
    )
    return [_row(r) for r in rows]


async def get_variant(
    variant_id: UUID, *, batch_id: UUID, user_id: str
) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select * from headshot_variants
         where id = $1 and batch_id = $2 and user_id = $3
        """,
        variant_id, batch_id, user_id,
    )
    return _row(row) if row else None


async def set_variant_status(
    variant_id: UUID,
    *,
    status: str,
    image_path: str | None = None,
    error: str | None = None,
) -> dict | None:
    """Update one variant. Not user-scoped: the id came from a row the
    worker already read under the batch's ownership check, and the worker
    has no request context to scope with."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update headshot_variants
           set status = $2, image_path = coalesce($3, image_path),
               error = $4, updated_at = now()
         where id = $1
        returning *
        """,
        variant_id, status, image_path, error,
    )
    return _row(row) if row else None


async def list_image_paths(user_id: str) -> list[str]:
    """Every rendered portrait path for a user. Used by the erasure sweep."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select image_path from headshot_variants
         where user_id = $1 and image_path is not null
        """,
        user_id,
    )
    return [r["image_path"] for r in rows]


_REAP_ERROR = "reaped: no progress (container died or timed out mid-batch)"


async def reap_stale(*, older_than_minutes: int = 60) -> int:
    """Fail batches stranded in a non-terminal status.

    Mirrors `image_posts.reap_stale`. Variants are left alone: a stranded
    batch's 'running' variant may still be an in-flight provider call, and
    marking it failed would invite a retry to pay for it twice.
    """
    pool = await get_pool()
    result = await pool.execute(
        """
        update headshot_batches
           set status = 'failed', error = $2, updated_at = now()
         where status = any($1::text[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        list(PENDING_BATCH_STATUSES), _REAP_ERROR, older_than_minutes,
    )
    return int(result.split()[-1])
