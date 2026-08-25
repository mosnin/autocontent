"""Ad Creative Studio data layer: Ad Runs and their Ad Slots.

Every function is user_id-scoped — a slot is always reached through its
owner, never through its run id alone, so the image endpoint cannot be
walked by guessing UUIDs. Rows come back as plain dicts (same contract as
`repos/image_posts.py`); the jsonb Brief is decoded on the way out.
"""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool

RUN_STATUSES = ("queued", "planning", "rendering", "done", "failed")
SLOT_STATUSES = ("queued", "rendering", "done", "failed")


def _run_row(row) -> dict:
    d = dict(row)
    if isinstance(d.get("brief"), str):
        d["brief"] = json.loads(d["brief"])
    return d


async def create_run(
    *, user_id: str, domain: str, niche_id: UUID | None = None
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into ad_creative_runs (user_id, niche_id, domain)
        values ($1, $2, $3)
        returning *
        """,
        user_id, niche_id, domain,
    )
    return _run_row(row)


async def get_run(run_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from ad_creative_runs where id = $1 and user_id = $2",
        run_id, user_id,
    )
    return _run_row(row) if row else None


async def list_runs(user_id: str, *, limit: int = 50) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from ad_creative_runs
        where user_id = $1
        order by created_at desc limit $2
        """,
        user_id, limit,
    )
    return [_run_row(r) for r in rows]


async def set_run_status(run_id: UUID, *, user_id: str, status: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ad_creative_runs set status = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        run_id, user_id, status,
    )
    return _run_row(row) if row else None


async def fail_run(run_id: UUID, *, user_id: str, error: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ad_creative_runs set status = 'failed', error = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        run_id, user_id, error,
    )
    return _run_row(row) if row else None


async def save_plan(
    run_id: UUID,
    *,
    user_id: str,
    brand_name: str,
    brief: dict,
    concepts: list[dict],
) -> list[dict]:
    """Persist the Brief and materialize one Ad Slot per Planned Concept.

    Done in one transaction so a Gallery never observes a run whose Brief
    landed but whose slots did not. Re-planning replaces the slots
    wholesale: positions are part of the run contract, so merging two
    generations of a plan would corrupt the company-then-product order.
    """
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        run = await conn.fetchrow(
            """
            update ad_creative_runs
            set brief = $3::jsonb, brand_name = $4, updated_at = now()
            where id = $1 and user_id = $2 returning id
            """,
            run_id, user_id, json.dumps(brief), brand_name,
        )
        if run is None:
            return []
        await conn.execute("delete from ad_creative_slots where run_id = $1", run_id)
        rows = []
        for concept in concepts:
            rows.append(
                await conn.fetchrow(
                    """
                    insert into ad_creative_slots (
                        run_id, user_id, position, direction_key, image_model_id,
                        subject_kind, product_name, product_description,
                        headline, subheadline
                    )
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    returning *
                    """,
                    run_id, user_id, concept["position"], concept["direction_key"],
                    concept["image_model_id"], concept["subject_kind"],
                    concept.get("product_name", ""),
                    concept.get("product_description", ""),
                    concept["headline"], concept.get("subheadline", ""),
                )
            )
    return [dict(r) for r in rows]


async def list_slots(run_id: UUID, *, user_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from ad_creative_slots
        where run_id = $1 and user_id = $2
        order by position
        """,
        run_id, user_id,
    )
    return [dict(r) for r in rows]


async def get_slot(slot_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from ad_creative_slots where id = $1 and user_id = $2",
        slot_id, user_id,
    )
    return dict(row) if row else None


async def set_slot_status(slot_id: UUID, *, user_id: str, status: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ad_creative_slots set status = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        slot_id, user_id, status,
    )
    return dict(row) if row else None


async def complete_slot(slot_id: UUID, *, user_id: str, image_path: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ad_creative_slots
        set status = 'done', image_path = $3, error = null, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        slot_id, user_id, image_path,
    )
    return dict(row) if row else None


async def fail_slot(slot_id: UUID, *, user_id: str, error: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ad_creative_slots set status = 'failed', error = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        slot_id, user_id, error,
    )
    return dict(row) if row else None


async def claim_slot_for_retry(slot_id: UUID, *, user_id: str) -> bool:
    """Atomic failed -> queued reset (retry button double-click safety)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ad_creative_slots
        set status = 'queued', error = null, updated_at = now()
        where id = $1 and user_id = $2 and status = 'failed'
        returning id
        """,
        slot_id, user_id,
    )
    return row is not None


async def settle_run(run_id: UUID, *, user_id: str) -> dict | None:
    """Move a rendering run to its terminal status from its slots.

    A run is `done` when at least one Ad Slot rendered — a partial
    Gallery is still a Gallery — and `failed` only when every slot
    failed, which is the case where the user has nothing to look at.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update ad_creative_runs r
        set status = case
                when exists (
                    select 1 from ad_creative_slots s
                    where s.run_id = r.id and s.status = 'done'
                ) then 'done'
                when exists (
                    select 1 from ad_creative_slots s
                    where s.run_id = r.id and s.status in ('queued', 'rendering')
                ) then r.status
                else 'failed'
            end,
            updated_at = now()
        where r.id = $1 and r.user_id = $2
        returning *
        """,
        run_id, user_id,
    )
    return _run_row(row) if row else None
