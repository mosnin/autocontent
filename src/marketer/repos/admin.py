"""Admin cross-tenant read/ops repository.

Every function here is privileged: callers MUST be gated by
`require_admin` and record an audit entry. These queries intentionally
span all tenants, unlike the user-scoped repos.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from ..db import get_pool
from ..models import User

_USER_COLS = (
    "id, email, ayrshare_profile_key, global_daily_cap_usd, "
    "credit_balance_usd, role, suspended_at, suspended_reason, created_at"
)


class AdminUserRow(BaseModel):
    user: User
    niche_count: int
    job_count: int
    article_count: int
    spend_total_usd: Decimal


class PlatformOverview(BaseModel):
    total_users: int
    admin_users: int
    suspended_users: int
    new_users_7d: int
    total_niches: int
    total_jobs: int
    jobs_24h: int
    failed_jobs_24h: int
    total_articles: int
    articles_24h: int
    spend_today_usd: Decimal
    spend_30d_usd: Decimal
    credit_liability_usd: Decimal


async def overview() -> PlatformOverview:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select
          (select count(*) from users) as total_users,
          (select count(*) from users where role = 'admin') as admin_users,
          (select count(*) from users where suspended_at is not null) as suspended_users,
          (select count(*) from users where created_at >= now() - interval '7 days') as new_users_7d,
          (select count(*) from niches) as total_niches,
          (select count(*) from jobs) as total_jobs,
          (select count(*) from jobs where created_at >= now() - interval '24 hours') as jobs_24h,
          (select count(*) from jobs where status = 'failed'
                and created_at >= now() - interval '24 hours') as failed_jobs_24h,
          (select count(*) from articles) as total_articles,
          (select count(*) from articles where created_at >= now() - interval '24 hours') as articles_24h,
          (select coalesce(sum(cost_usd), 0) from spend_ledger
                where created_at >= (now() at time zone 'utc')::date) as spend_today_usd,
          (select coalesce(sum(cost_usd), 0) from spend_ledger
                where created_at >= now() - interval '30 days') as spend_30d_usd,
          (select coalesce(sum(credit_balance_usd), 0) from users) as credit_liability_usd
        """
    )
    return PlatformOverview(**dict(row))


async def list_users(
    *, query: str | None = None, limit: int = 50, offset: int = 0
) -> list[AdminUserRow]:
    """Paginated cross-tenant user list with per-user rollups.

    Uses correlated subqueries rather than joins so a user with no niches
    still appears (LEFT-JOIN-count semantics without the fan-out)."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_USER_COLS},
          (select count(*) from niches n where n.user_id = u.id) as niche_count,
          (select count(*) from jobs j where j.user_id = u.id) as job_count,
          (select count(*) from articles a where a.user_id = u.id) as article_count,
          (select coalesce(sum(cost_usd), 0) from spend_ledger s where s.user_id = u.id)
              as spend_total_usd
          from users u
         where ($1::text is null or u.email ilike '%' || $1 || '%' or u.id = $1)
         order by u.created_at desc
         limit $2 offset $3
        """,
        query, limit, offset,
    )
    out: list[AdminUserRow] = []
    for r in rows:
        d = dict(r)
        counts = {
            "niche_count": d.pop("niche_count"),
            "job_count": d.pop("job_count"),
            "article_count": d.pop("article_count"),
            "spend_total_usd": d.pop("spend_total_usd"),
        }
        out.append(AdminUserRow(user=User(**d), **counts))
    return out


async def get_user(user_id: str) -> AdminUserRow | None:
    rows = await list_users(query=user_id, limit=1)
    # list_users matches id exactly OR email substring; confirm exact id.
    for r in rows:
        if r.user.id == user_id:
            return r
    return None


async def set_role(user_id: str, role: str) -> bool:
    if role not in ("user", "admin"):
        raise ValueError(f"invalid role: {role!r}")
    pool = await get_pool()
    result = await pool.execute(
        "update users set role = $2 where id = $1", user_id, role
    )
    return result.split()[-1] == "1"


async def set_suspended(user_id: str, *, suspended: bool, reason: str | None = None) -> bool:
    pool = await get_pool()
    if suspended:
        result = await pool.execute(
            "update users set suspended_at = now(), suspended_reason = $2 where id = $1",
            user_id, reason or "",
        )
    else:
        result = await pool.execute(
            "update users set suspended_at = null, suspended_reason = null where id = $1",
            user_id,
        )
    return result.split()[-1] == "1"


async def grant_credit(user_id: str, amount_usd: Decimal) -> Decimal:
    """Admin credit grant. Returns the new balance. The audit row (recorded
    by the route) plus the ledger movement below are the paper trail."""
    from ..config import settings

    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        new_balance = await conn.fetchval(
            """
            update users set credit_balance_usd = credit_balance_usd + $2
             where id = $1
            returning credit_balance_usd
            """,
            user_id, amount_usd,
        )
        if new_balance is None:
            raise ValueError(f"user {user_id!r} not found")
        if settings.billing_enabled:
            await conn.execute(
                """
                insert into credit_transactions (user_id, kind, amount_usd, reference, description)
                values ($1, 'grant', $2, $3, 'admin grant')
                """,
                user_id, amount_usd, f"admin-grant-{datetime.utcnow().isoformat()}",
            )
    return Decimal(new_balance)
