from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import SpendEntry


async def record(entry: SpendEntry) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into spend_ledger
            (user_id, niche_id, job_id, provider, sku, units, cost_usd)
        values ($1, $2, $3, $4, $5, $6, $7)
        """,
        entry.user_id, entry.niche_id, entry.job_id,
        entry.provider, entry.sku, entry.units, entry.cost_usd,
    )


async def today_spend_usd(*, user_id: str, niche_id: UUID) -> Decimal:
    """Sum today's USD spend for a (user, niche). Cap check reads this."""
    pool = await get_pool()
    val = await pool.fetchval(
        """
        select coalesce(sum(cost_usd), 0)::numeric
          from spend_ledger
         where user_id = $1
           and niche_id = $2
           and created_at::date = (now() at time zone 'utc')::date
        """,
        user_id, niche_id,
    )
    return Decimal(val)


async def today_spend_by_niche(*, user_id: str) -> dict[UUID, Decimal]:
    """One row per niche the user has spent on today. Powers the dashboard."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select niche_id, coalesce(sum(cost_usd), 0)::numeric as total
          from spend_ledger
         where user_id = $1
           and created_at::date = (now() at time zone 'utc')::date
         group by niche_id
        """,
        user_id,
    )
    return {r["niche_id"]: Decimal(r["total"]) for r in rows}


class SpendCapExceeded(Exception):
    pass


async def assert_within_cap(*, user_id: str, niche_id: UUID, cap_usd: Decimal) -> None:
    spent = await today_spend_usd(user_id=user_id, niche_id=niche_id)
    if spent >= cap_usd:
        raise SpendCapExceeded(
            f"niche {niche_id} hit daily cap: ${spent} >= ${cap_usd}"
        )
