from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import SpendEntry, SpendHistoryRow


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


async def today_spend_total_usd(*, user_id: str) -> Decimal:
    """Sum today's USD spend for a user across ALL niches. Global-cap check reads this."""
    pool = await get_pool()
    val = await pool.fetchval(
        """
        select coalesce(sum(cost_usd), 0)::numeric
          from spend_ledger
         where user_id = $1
           and created_at::date = (now() at time zone 'utc')::date
        """,
        user_id,
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


async def history(
    *,
    user_id: str,
    days: int,
    niche_id: UUID | None = None,
) -> list[SpendHistoryRow]:
    """Return per-day per-niche spend aggregates for the last ``days`` days.

    The bucketing is UTC calendar day, matching the ``created_at`` timezone
    used throughout the rest of the spend queries. ``niche_id=None`` returns
    all niches for the user.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select date_trunc('day', created_at)::date as day,
               niche_id,
               sum(cost_usd) as cost_usd
          from spend_ledger
         where user_id = $1
           and created_at >= now() - ($2 || ' days')::interval
           and ($3::uuid is null or niche_id = $3)
         group by 1, 2
         order by 1 asc, 2 asc
        """,
        user_id,
        str(days),
        niche_id,
    )
    return [
        SpendHistoryRow(
            day=r["day"],
            niche_id=r["niche_id"],
            cost_usd=Decimal(r["cost_usd"]),
        )
        for r in rows
    ]


class SpendCapExceeded(Exception):
    """Raised when a spend cap is exceeded.

    ``scope`` distinguishes per-niche caps (``"niche"``) from the
    user-level global cap (``"global"``). Defaults to ``"niche"`` for
    backward compatibility with callers that don't pass the kwarg.
    """

    def __init__(self, message: str = "", *, scope: str = "niche") -> None:
        super().__init__(message)
        self.scope = scope


async def assert_within_cap(*, user_id: str, niche_id: UUID, cap_usd: Decimal) -> None:
    spent = await today_spend_usd(user_id=user_id, niche_id=niche_id)
    if spent >= cap_usd:
        raise SpendCapExceeded(
            f"niche {niche_id} hit daily cap: ${spent} >= ${cap_usd}",
            scope="niche",
        )
