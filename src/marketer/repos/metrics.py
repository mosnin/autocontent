"""Operational-visibility read-only aggregations.

Everything here is a pure, side-effect-free query over tables that already
exist (``spend_ledger``, ``jobs``, ``image_posts``). No table is mutated and
no numbers are invented — every field returned is a direct aggregate over
real rows. Callers are expected to be admin-gated (see
``backend/routes/ops.py``); this module does no authorization itself.

Design notes
------------
* ``jobs`` and ``image_posts`` don't carry a ``provider`` column — provider
  attribution only exists on ``spend_ledger``. So "provider error rate" is
  computed by joining ``spend_ledger`` rows (which know the provider) back
  to the entity they paid for (a job or an image post) and checking whether
  that entity ended up ``failed``. A provider that appears on many failed
  jobs relative to its total touched jobs is the one to look at first.
* Terminal states mirror ``JobStatus`` (done/failed/skipped/
  awaiting_approval) and the ``image_posts.status`` check constraint
  (queued/planning/generating/awaiting_approval/scheduling/done/failed).
  "Stuck" means non-terminal and not updated in over N minutes — the same
  signal ``backend/routes/admin.py:system_health`` already uses, generalized
  with a parameter instead of a hardcoded 2h window.
* Each function issues exactly one query (or, where two tables must be
  unioned, one query with a UNION ALL) — no N+1 loops.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, computed_field

from ..db import get_pool

# Non-terminal (i.e. "still in flight") states per entity. Anything not in
# this set is a resting state and can never be "stuck".
_JOB_NONTERMINAL = (
    "queued", "ideating", "scripting", "generating_images", "animating",
    "voicing", "editing", "captioning", "qa", "scheduling",
)
_IMAGE_POST_NONTERMINAL = ("queued", "planning", "generating", "scheduling")
# awaiting_approval is intentionally excluded from both "nonterminal" sets
# above: a job/post sitting in awaiting_approval is waiting on a *human*,
# not wedged in the pipeline, so it shouldn't count as reaper-should-have-
# caught-this. It's still visible via jobs_awaiting_approval below.


class ProviderSpend(BaseModel):
    provider: str
    cost_usd: Decimal
    units: Decimal


class SpendVelocity(BaseModel):
    window_minutes: int
    total_usd: Decimal
    by_provider: list[ProviderSpend]


class ProviderErrorRate(BaseModel):
    provider: str
    total: int
    failed: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def error_rate(self) -> float:
        """Failed / total, in [0, 1]. 0 when the provider had no touched
        entities in the window (rather than a misleading NaN or None)."""
        return (self.failed / self.total) if self.total else 0.0


class StuckWork(BaseModel):
    stuck_after_minutes: int
    jobs_stuck: int
    jobs_oldest_stuck_seconds: int | None
    image_posts_stuck: int
    image_posts_oldest_stuck_seconds: int | None
    jobs_awaiting_approval: int
    image_posts_awaiting_approval: int


class TopSku(BaseModel):
    provider: str
    sku: str
    cost_usd: Decimal
    units: Decimal


async def spend_velocity(window_minutes: int) -> SpendVelocity:
    """Spend grouped by provider over the trailing ``window_minutes``.

    Single query over ``spend_ledger``; callers typically call this twice
    (e.g. 60 and 1440 minutes) to get 1h/24h velocity.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select provider,
               coalesce(sum(cost_usd), 0)::numeric as cost_usd,
               coalesce(sum(units), 0)::numeric as units
          from spend_ledger
         where created_at >= now() - make_interval(mins => $1)
         group by provider
         order by cost_usd desc
        """,
        window_minutes,
    )
    by_provider = [ProviderSpend(**dict(r)) for r in rows]
    total = sum((p.cost_usd for p in by_provider), Decimal(0))
    return SpendVelocity(window_minutes=window_minutes, total_usd=total, by_provider=by_provider)


async def provider_error_rates(window_minutes: int) -> list[ProviderErrorRate]:
    """Failed-vs-total entities touched per provider in the window.

    Joins ``spend_ledger`` (provider) to ``jobs``/``image_posts`` (outcome)
    via the ``job_id``/``image_post_id`` foreign keys already on the ledger,
    then counts *distinct entities* per provider so a job with several
    ledger rows (e.g. multiple image generations) isn't double-counted.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        with touched as (
            select s.provider, s.job_id as entity_id, (j.status = 'failed') as is_failed
              from spend_ledger s
              join jobs j on j.id = s.job_id
             where s.job_id is not null
               and s.created_at >= now() - make_interval(mins => $1)
            union all
            select s.provider, s.image_post_id as entity_id, (ip.status = 'failed') as is_failed
              from spend_ledger s
              join image_posts ip on ip.id = s.image_post_id
             where s.image_post_id is not null
               and s.created_at >= now() - make_interval(mins => $1)
        )
        select provider,
               count(distinct entity_id) as total,
               count(distinct entity_id) filter (where is_failed) as failed
          from touched
         group by provider
         order by total desc
        """,
        window_minutes,
    )
    return [ProviderErrorRate(**dict(r)) for r in rows]


async def stuck_work(stuck_after_minutes: int) -> StuckWork:
    """Counts of jobs/image_posts wedged in a non-terminal state past
    ``stuck_after_minutes`` since their last update — the "should have been
    reaped by now" signal. Also reports how many are legitimately waiting on
    human approval (not stuck, just parked) so the two aren't conflated."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select
          (select count(*) from jobs
             where status = any($2::job_status[])
               and updated_at < now() - make_interval(mins => $1)) as jobs_stuck,
          (select extract(epoch from (now() - min(updated_at)))::int from jobs
             where status = any($2::job_status[])
               and updated_at < now() - make_interval(mins => $1)) as jobs_oldest_stuck_seconds,
          (select count(*) from image_posts
             where status = any($3::text[])
               and updated_at < now() - make_interval(mins => $1)) as image_posts_stuck,
          (select extract(epoch from (now() - min(updated_at)))::int from image_posts
             where status = any($3::text[])
               and updated_at < now() - make_interval(mins => $1)) as image_posts_oldest_stuck_seconds,
          (select count(*) from jobs where status = 'awaiting_approval') as jobs_awaiting_approval,
          (select count(*) from image_posts where status = 'awaiting_approval') as image_posts_awaiting_approval
        """,
        stuck_after_minutes, list(_JOB_NONTERMINAL), list(_IMAGE_POST_NONTERMINAL),
    )
    return StuckWork(stuck_after_minutes=stuck_after_minutes, **dict(row))


async def top_skus(window_minutes: int, limit: int = 10) -> list[TopSku]:
    """Highest-cost (provider, sku) pairs in the window — where the money is
    actually going, not just which provider."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select provider, sku,
               coalesce(sum(cost_usd), 0)::numeric as cost_usd,
               coalesce(sum(units), 0)::numeric as units
          from spend_ledger
         where created_at >= now() - make_interval(mins => $1)
         group by provider, sku
         order by cost_usd desc
         limit $2
        """,
        window_minutes, limit,
    )
    return [TopSku(**dict(r)) for r in rows]


async def db_ok() -> bool:
    """Cheap reachability probe, mirrors admin.system_health's check."""
    pool = await get_pool()
    try:
        await pool.fetchval("select 1")
        return True
    except Exception:  # noqa: BLE001
        return False


async def snapshot_generated_at() -> datetime:
    """Server-side timestamp so the snapshot is self-describing about when
    the underlying queries ran (useful once it's cached/proxied)."""
    pool = await get_pool()
    return await pool.fetchval("select now()")
