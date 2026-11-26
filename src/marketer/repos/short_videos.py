"""Persistence for short video (db/migrations/0038_short_video.sql).

Every query is scoped by ``user_id`` (the tenant). Status transitions that
start or stop work are guarded UPDATEs (``where status = ...``) so a double
click or a racing worker changes a row at most once.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from ..db import get_pool
from ..short_video.metering import ClaimResult
from ..short_video.models import ShortVideoBatch, ShortVideoItem, Upload

_ITEM_JSON = ("stages", "search_terms", "clips")


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _item(row: Any, spent: int = 0) -> ShortVideoItem:
    d = dict(row)
    for k in _ITEM_JSON:
        d[k] = _j(d.get(k))
    d["spent_micros"] = spent
    return ShortVideoItem.model_validate(d)


def _batch(row: Any, items: list[ShortVideoItem], spent: int) -> ShortVideoBatch:
    d = dict(row)
    d["settings"] = _j(d["settings"])
    d["items"] = items
    d["spent_micros"] = spent
    return ShortVideoBatch.model_validate(d)


async def create_batch(
    *, user_id: str, niche_id: UUID | None, created_by: str, principal: str, title: str,
    source: str, topic: str, script: str, settings: dict, variants: int, status: str,
    estimate_micros: int, cap_micros: int, args_hash: str,
) -> ShortVideoBatch:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                insert into short_video_batches
                    (user_id, niche_id, created_by, principal, title, source, topic, script, settings,
                     variants, status, estimate_micros, cap_micros, args_hash)
                values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)
                returning *
                """,
                user_id, niche_id, created_by, principal, title, source, topic, script, json.dumps(settings),
                variants, status, estimate_micros, cap_micros, args_hash,
            )
            items = []
            for v in range(1, variants + 1):
                irow = await conn.fetchrow(
                    "insert into short_video_items (batch_id, user_id, variant) values ($1,$2,$3) returning *",
                    row["id"], user_id, v,
                )
                items.append(_item(irow))
    return _batch(row, items, 0)


async def _spent_by_item(conn: Any, batch_ids: list[UUID]) -> dict[UUID, int]:
    if not batch_ids:
        return {}
    rows = await conn.fetch(
        "select item_id, coalesce(sum(cost_micros), 0)::bigint as s from short_video_charges "
        "where batch_id = any($1::uuid[]) group by item_id",
        batch_ids,
    )
    return {r["item_id"]: int(r["s"]) for r in rows}


async def _hydrate(conn: Any, rows: list[Any]) -> list[ShortVideoBatch]:
    ids = [r["id"] for r in rows]
    if not ids:
        return []
    item_rows = await conn.fetch(
        "select * from short_video_items where batch_id = any($1::uuid[]) order by variant", ids
    )
    spent = await _spent_by_item(conn, ids)
    by_batch: dict[UUID, list[ShortVideoItem]] = {i: [] for i in ids}
    for ir in item_rows:
        by_batch[ir["batch_id"]].append(_item(ir, spent.get(ir["id"], 0)))
    return [_batch(r, by_batch[r["id"]], sum(i.spent_micros for i in by_batch[r["id"]])) for r in rows]


async def get_batch(batch_id: UUID, *, user_id: str) -> ShortVideoBatch | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("select * from short_video_batches where id = $1 and user_id = $2", batch_id, user_id)
        if row is None:
            return None
        return (await _hydrate(conn, [row]))[0]


async def list_batches(*, user_id: str, limit: int = 30) -> list[ShortVideoBatch]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select * from short_video_batches where user_id = $1 order by created_at desc limit $2", user_id, limit
        )
        return await _hydrate(conn, list(rows))


async def transition_batch(
    batch_id: UUID, *, user_id: str, from_status: tuple[str, ...], to_status: str,
    error: str | None = None, approved_by: str | None = None,
) -> bool:
    pool = await get_pool()
    val = await pool.fetchval(
        """
        update short_video_batches
           set status = $4, error = coalesce($5, error), updated_at = now(),
               approved_by = coalesce($6, approved_by),
               approved_at = case when $6::text is not null then now() else approved_at end
         where id = $1 and user_id = $2 and status = any($3::text[])
        returning id
        """,
        batch_id, user_id, list(from_status), to_status, error, approved_by,
    )
    return val is not None


async def finish_batch(batch_id: UUID, *, user_id: str) -> str:
    """Set the batch's terminal status from its items: done, partial or failed
    (cancelled stays cancelled)."""
    pool = await get_pool()
    rows = await pool.fetch("select status from short_video_items where batch_id = $1 and user_id = $2", batch_id, user_id)
    statuses = [r["status"] for r in rows]
    if statuses and all(s == "done" for s in statuses):
        final = "done"
    elif any(s == "done" for s in statuses):
        final = "partial"
    else:
        final = "failed"
    await transition_batch(batch_id, user_id=user_id, from_status=("running", "queued"), to_status=final)
    return final


async def cancel_items(batch_id: UUID, *, user_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "update short_video_items set status = 'cancelled', updated_at = now() "
        "where batch_id = $1 and user_id = $2 and status in ('queued', 'running')",
        batch_id, user_id,
    )


_ITEM_FIELDS = {
    "status", "stage", "progress", "stages", "hook", "script", "search_terms", "clips", "output_asset_id",
    "video_path", "srt_path", "vtt_path", "duration_sec", "error",
}


async def update_item(item_id: UUID, *, user_id: str, **fields: Any) -> None:
    bad = set(fields) - _ITEM_FIELDS
    if bad:
        raise ValueError(f"unknown item fields: {sorted(bad)}")
    if not fields:
        return
    sets, args = [], [item_id, user_id]
    for k, v in fields.items():
        args.append(json.dumps(v, default=str) if k in _ITEM_JSON else v)
        cast = "::jsonb" if k in _ITEM_JSON else ""
        sets.append(f"{k} = ${len(args)}{cast}")
    pool = await get_pool()
    await pool.execute(
        f"update short_video_items set {', '.join(sets)}, updated_at = now() where id = $1 and user_id = $2",
        *args,
    )


async def get_item(item_id: UUID, *, user_id: str) -> ShortVideoItem | None:
    pool = await get_pool()
    row = await pool.fetchrow("select * from short_video_items where id = $1 and user_id = $2", item_id, user_id)
    if row is None:
        return None
    spent = await pool.fetchval(
        "select coalesce(sum(cost_micros), 0)::bigint from short_video_charges where item_id = $1", item_id
    )
    return _item(row, int(spent or 0))


async def item_is_cancelled(item_id: UUID) -> bool:
    pool = await get_pool()
    return (await pool.fetchval("select status from short_video_items where id = $1", item_id)) == "cancelled"


async def reset_item_for_retry(item_id: UUID, *, user_id: str) -> ShortVideoItem | None:
    """failed → queued with a new attempt (new idempotency keys); the batch
    goes back to queued so the worker picks it up."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                update short_video_items
                   set status = 'queued', attempt = attempt + 1, error = null, stage = 'queued',
                       progress = 0, stages = '{}'::jsonb, updated_at = now()
                 where id = $1 and user_id = $2 and status = 'failed'
                returning *
                """,
                item_id, user_id,
            )
            if row is None:
                return None
            await conn.execute(
                "update short_video_batches set status = 'queued', updated_at = now() "
                "where id = $1 and status in ('done', 'partial', 'failed')",
                row["batch_id"],
            )
    return _item(row)


# ------------------------------------------------------------------ charges

class PgChargeStore:
    async def claim(self, key, *, user_id, batch_id, item_id, stage, provider, sku) -> ClaimResult:
        pool = await get_pool()
        inserted = await pool.fetchval(
            """
            insert into short_video_charges (idempotency_key, user_id, batch_id, item_id, stage, provider, sku)
            values ($1,$2,$3,$4,$5,$6,$7) on conflict (idempotency_key) do nothing returning idempotency_key
            """,
            key, user_id, batch_id, item_id, stage, provider, sku,
        )
        if inserted is not None:
            return "new"
        # A failed key may run again (nothing was delivered); flip it back atomically.
        reopened = await pool.fetchval(
            "update short_video_charges set status = 'pending', updated_at = now() "
            "where idempotency_key = $1 and status = 'failed' returning idempotency_key",
            key,
        )
        if reopened is not None:
            return "new"
        status = await pool.fetchval("select status from short_video_charges where idempotency_key = $1", key)
        return "done" if status == "done" else "pending"

    async def finish(self, key, *, status, cost_micros) -> None:
        pool = await get_pool()
        await pool.execute(
            "update short_video_charges set status = $2, cost_micros = cost_micros + $3, updated_at = now() "
            "where idempotency_key = $1",
            key, status, int(cost_micros),
        )

    async def batch_spent_micros(self, batch_id) -> int:
        pool = await get_pool()
        v = await pool.fetchval(
            "select coalesce(sum(cost_micros), 0)::bigint from short_video_charges where batch_id = $1", batch_id
        )
        return int(v or 0)


# --------------------------------------------------------------- stock cache

class PgSearchCache:
    ttl = timedelta(hours=24)

    async def get(self, provider: str, query: str, orientation: str) -> list[dict] | None:
        pool = await get_pool()
        row = await pool.fetchrow(
            "select results, fetched_at from stock_footage_cache where provider = $1 and query = $2 and orientation = $3",
            provider, query, orientation,
        )
        if row is None or row["fetched_at"] < datetime.now(timezone.utc) - self.ttl:
            return None
        return _j(row["results"])

    async def put(self, provider: str, query: str, orientation: str, results: list[dict]) -> None:
        pool = await get_pool()
        await pool.execute(
            """
            insert into stock_footage_cache (provider, query, orientation, results, fetched_at)
            values ($1,$2,$3,$4::jsonb, now())
            on conflict (provider, query, orientation) do update set results = excluded.results, fetched_at = now()
            """,
            provider, query, orientation, json.dumps(results),
        )


# ------------------------------------------------------------------ uploads

async def create_upload(
    *, upload_id: UUID, user_id: str, kind: str, filename: str, content_type: str, size_bytes: int, object_key: str,
) -> Upload:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into short_video_uploads (id, user_id, kind, filename, content_type, size_bytes, object_key)
        values ($1,$2,$3,$4,$5,$6,$7) returning *
        """,
        upload_id, user_id, kind, filename, content_type, size_bytes, object_key,
    )
    return Upload.model_validate(dict(row))


async def get_upload(upload_id: UUID, *, user_id: str) -> Upload | None:
    pool = await get_pool()
    row = await pool.fetchrow("select * from short_video_uploads where id = $1 and user_id = $2", upload_id, user_id)
    return Upload.model_validate(dict(row)) if row else None


async def list_uploads(*, user_id: str, status: str | None = "ready", limit: int = 100) -> list[Upload]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from short_video_uploads where user_id = $1 and ($2::text is null or status = $2) "
        "order by created_at desc limit $3",
        user_id, status, limit,
    )
    return [Upload.model_validate(dict(r)) for r in rows]


async def get_uploads_bulk(ids: list[UUID], *, user_id: str) -> list[Upload]:
    if not ids:
        return []
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from short_video_uploads where user_id = $1 and id = any($2::uuid[])", user_id, ids
    )
    return [Upload.model_validate(dict(r)) for r in rows]


async def settle_upload(
    upload_id: UUID, *, user_id: str, status: str, width: int | None = None, height: int | None = None,
    duration_sec: float | None = None, error: str | None = None,
) -> Upload | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update short_video_uploads
           set status = $3, width = $4, height = $5, duration_sec = $6, error = $7, updated_at = now()
         where id = $1 and user_id = $2 and status = 'pending'
        returning *
        """,
        upload_id, user_id, status, width, height, duration_sec, error,
    )
    return Upload.model_validate(dict(row)) if row else None
