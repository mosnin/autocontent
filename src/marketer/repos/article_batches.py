"""Bulk article batches and their items (0035)."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from ..db import get_pool

_BATCH = "id, user_id, niche_id, created_by, status, total, created_at, updated_at"
_ITEM = "id, batch_id, user_id, position, keyword, status, held_reason, article_id, error, created_at, updated_at"


class BatchItem(BaseModel):
    id: UUID
    batch_id: UUID
    user_id: str
    position: int
    keyword: str
    status: str
    held_reason: str | None = None
    article_id: UUID | None = None
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Batch(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID
    created_by: str = ""
    status: str
    total: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[BatchItem] = Field(default_factory=list)


async def create(*, user_id: str, niche_id: UUID, keywords: list[str], created_by: str) -> Batch:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            f"insert into article_batches (user_id, niche_id, created_by, total) values ($1, $2, $3, $4) returning {_BATCH}",
            user_id, niche_id, created_by, len(keywords),
        )
        rows = await conn.fetch(
            f"""
            insert into article_batch_items (batch_id, user_id, position, keyword)
            select $1, $2, p, k from unnest($3::text[]) with ordinality as t(k, p)
            returning {_ITEM}
            """,
            row["id"], user_id, keywords,
        )
    batch = Batch(**dict(row))
    batch.items = sorted((BatchItem(**dict(r)) for r in rows), key=lambda i: i.position)
    return batch


async def get(batch_id: UUID, *, user_id: str) -> Batch | None:
    pool = await get_pool()
    row = await pool.fetchrow(f"select {_BATCH} from article_batches where id = $1 and user_id = $2", batch_id, user_id)
    if not row:
        return None
    items = await pool.fetch(
        f"select {_ITEM} from article_batch_items where batch_id = $1 order by position", batch_id,
    )
    batch = Batch(**dict(row))
    batch.items = [BatchItem(**dict(r)) for r in items]
    return batch


async def list_for_user(user_id: str, *, limit: int = 20) -> list[Batch]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_BATCH} from article_batches where user_id = $1 order by created_at desc limit $2",
        user_id, limit,
    )
    batches = [Batch(**dict(r)) for r in rows]
    if not batches:
        return batches
    items = await pool.fetch(
        f"select {_ITEM} from article_batch_items where batch_id = any($1::uuid[]) order by position",
        [b.id for b in batches],
    )
    by: dict[UUID, list[BatchItem]] = {}
    for r in items:
        by.setdefault(r["batch_id"], []).append(BatchItem(**dict(r)))
    for b in batches:
        b.items = by.get(b.id, [])
    return batches


async def open_batch_ids(*, limit: int = 100) -> list[tuple[UUID, str]]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select id, user_id from article_batches where status in ('running', 'paused_cap') order by created_at limit $1",
        limit,
    )
    return [(r["id"], r["user_id"]) for r in rows]


async def reconcile_running(batch_id: UUID) -> None:
    """Mirror finished articles onto their running items, and fail items
    that were claimed but never got an article (a crash between the claim
    and the spawn)."""
    pool = await get_pool()
    await pool.execute(
        """
        update article_batch_items i
           set status = case when a.status = 'done' then 'done' else 'failed' end,
               error = case when a.status = 'failed' then left(coalesce(a.error, 'failed'), 500) else null end
          from articles a
         where i.batch_id = $1 and i.status = 'running' and a.id = i.article_id
           and a.status in ('done', 'failed')
        """,
        batch_id,
    )
    await pool.execute(
        """
        update article_batch_items
           set status = 'failed', error = 'did not start; retry from the article list'
         where batch_id = $1 and status = 'running' and article_id is null
           and updated_at < now() - interval '30 minutes'
        """,
        batch_id,
    )


async def counts(batch_id: UUID) -> dict[str, int]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select status, count(*) as n from article_batch_items where batch_id = $1 group by status", batch_id,
    )
    return {r["status"]: int(r["n"]) for r in rows}


async def next_queued(batch_id: UUID, *, limit: int) -> list[BatchItem]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_ITEM} from article_batch_items where batch_id = $1 and status = 'queued' order by position limit $2",
        batch_id, limit,
    )
    return [BatchItem(**dict(r)) for r in rows]


async def claim_item(item_id: UUID) -> bool:
    """queued -> running, exactly once."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "update article_batch_items set status = 'running', held_reason = null where id = $1 and status = 'queued' returning id",
        item_id,
    )
    return row is not None


async def attach_article(item_id: UUID, article_id: UUID) -> None:
    pool = await get_pool()
    await pool.execute("update article_batch_items set article_id = $2 where id = $1", item_id, article_id)


async def fail_item(item_id: UUID, error: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "update article_batch_items set status = 'failed', error = $2 where id = $1", item_id, error[:500],
    )


async def hold_queued(batch_id: UUID, reason: str | None) -> None:
    pool = await get_pool()
    await pool.execute(
        "update article_batch_items set held_reason = $2 where batch_id = $1 and status = 'queued'", batch_id, reason,
    )


async def set_status(batch_id: UUID, status: str) -> None:
    pool = await get_pool()
    await pool.execute("update article_batches set status = $2 where id = $1 and status <> $2", batch_id, status)


async def cancel(batch_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "update article_batches set status = 'cancelled' where id = $1 and user_id = $2 and status in ('running', 'paused_cap') returning id",
            batch_id, user_id,
        )
        if row is None:
            return False
        await conn.execute(
            "update article_batch_items set status = 'cancelled', held_reason = null where batch_id = $1 and status = 'queued'",
            batch_id,
        )
    return True
