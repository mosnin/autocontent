"""Repositories for the media library: media_assets + compositions.

Every query is scoped by user_id — the library is strictly per-tenant.
"""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import Composition, MediaAsset


def _row_to_asset(row) -> MediaAsset:
    return MediaAsset(**dict(row))


def _row_to_composition(row) -> Composition:
    d = dict(row)
    d["clip_asset_ids"] = [UUID(x) for x in json.loads(d["clip_asset_ids"])]
    return Composition(**d)


# --------------------------------------------------------------------------- assets

async def record_asset(
    *,
    user_id: str,
    kind: str,
    storage: str,
    object_key: str,
    niche_id: UUID | None = None,
    job_id: UUID | None = None,
    scene_index: int | None = None,
    content_type: str = "video/mp4",
    size_bytes: int = 0,
    duration_sec: Decimal | float | None = None,
    title: str = "",
) -> MediaAsset:
    """Insert (or refresh) one asset row. Idempotent on
    (user_id, storage, object_key) so re-running a pipeline stage after a
    resume can't duplicate library entries."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into media_assets (
            user_id, niche_id, job_id, kind, scene_index, storage,
            object_key, content_type, size_bytes, duration_sec, title
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (user_id, storage, object_key) do update set
            size_bytes = excluded.size_bytes,
            duration_sec = excluded.duration_sec,
            title = excluded.title
        returning *
        """,
        user_id, niche_id, job_id, kind, scene_index, storage,
        object_key, content_type, size_bytes,
        Decimal(str(duration_sec)) if duration_sec is not None else None,
        title,
    )
    return _row_to_asset(row)


async def get_asset(asset_id: UUID, *, user_id: str) -> MediaAsset | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from media_assets where id = $1 and user_id = $2",
        asset_id, user_id,
    )
    return _row_to_asset(row) if row else None


async def list_assets(
    *,
    user_id: str,
    kind: str | None = None,
    niche_id: UUID | None = None,
    job_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[MediaAsset]:
    conds = ["user_id = $1"]
    values: list = [user_id]
    i = 2
    if kind is not None:
        conds.append(f"kind = ${i}")
        values.append(kind)
        i += 1
    if niche_id is not None:
        conds.append(f"niche_id = ${i}")
        values.append(niche_id)
        i += 1
    if job_id is not None:
        conds.append(f"job_id = ${i}")
        values.append(job_id)
        i += 1
    values += [limit, offset]
    sql = (
        "select * from media_assets where "
        + " and ".join(conds)
        + f" order by created_at desc limit ${i} offset ${i + 1}"
    )
    pool = await get_pool()
    rows = await pool.fetch(sql, *values)
    return [_row_to_asset(r) for r in rows]


async def get_assets_bulk(
    asset_ids: list[UUID], *, user_id: str
) -> list[MediaAsset]:
    """Fetch a set of assets (still user-scoped); order not guaranteed."""
    if not asset_ids:
        return []
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from media_assets where user_id = $1 and id = any($2::uuid[])",
        user_id, asset_ids,
    )
    return [_row_to_asset(r) for r in rows]


# --------------------------------------------------------------------------- compositions

async def create_composition(
    *,
    user_id: str,
    clip_asset_ids: list[UUID],
    title: str = "",
    audio_mode: str = "keep",
) -> Composition:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into compositions (user_id, title, clip_asset_ids, audio_mode)
        values ($1, $2, $3::jsonb, $4)
        returning *
        """,
        user_id, title, json.dumps([str(x) for x in clip_asset_ids]), audio_mode,
    )
    return _row_to_composition(row)


async def get_composition(
    composition_id: UUID, *, user_id: str
) -> Composition | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from compositions where id = $1 and user_id = $2",
        composition_id, user_id,
    )
    return _row_to_composition(row) if row else None


async def list_compositions(
    *, user_id: str, limit: int = 50, offset: int = 0
) -> list[Composition]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from compositions where user_id = $1
        order by created_at desc limit $2 offset $3
        """,
        user_id, limit, offset,
    )
    return [_row_to_composition(r) for r in rows]


async def set_composition_status(
    composition_id: UUID,
    *,
    user_id: str,
    status: str,
    output_asset_id: UUID | None = None,
    error: str | None = None,
) -> Composition | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update compositions
        set status = $3,
            output_asset_id = coalesce($4, output_asset_id),
            error = $5,
            updated_at = now()
        where id = $1 and user_id = $2
        returning *
        """,
        composition_id, user_id, status, output_asset_id, error,
    )
    return _row_to_composition(row) if row else None


async def claim_composition_for_render(
    composition_id: UUID, *, user_id: str
) -> bool:
    """Atomic queued->rendering claim so a double-spawned worker can't
    render the same composition twice.

    A 'rendering' row older than 20 minutes is reclaimable: the Modal
    render function times out at 15 minutes, so a claim that old belongs
    to a dead container and would otherwise be stuck forever."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update compositions set status = 'rendering', updated_at = now()
        where id = $1 and user_id = $2
          and (status = 'queued'
               or (status = 'rendering'
                   and updated_at < now() - interval '20 minutes'))
        returning id
        """,
        composition_id, user_id,
    )
    return row is not None
