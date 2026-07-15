"""Ads data layer: connected accounts, campaigns, ad sets, creatives, and
daily metrics. Every function is user_id-scoped — no cross-tenant reads.

Governance (caps, kill-switch, pacing) reads from here but lives in
``services/ad_spend_guard.py``; approvals + the append-only audit log live in
``repos/ad_approvals.py`` and ``repos/ad_actions.py``.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from ..db import get_pool

# Platforms we model. Composio exposes GOOGLEADS + METAADS as first-class ad
# toolkits; linkedin is ad-intelligence only for now.
PLATFORMS = frozenset({"google_ads", "meta_ads", "linkedin_ads"})
CAMPAIGN_STATUSES = frozenset(
    {"draft", "pending", "active", "paused", "ended", "failed"}
)


# --------------------------------------------------------------------------- models

class AdAccount(BaseModel):
    id: UUID
    user_id: str
    platform: str
    external_account_id: str = ""
    name: str = ""
    composio_connection_id: str = ""
    status: str = "pending"
    currency: str = "USD"
    daily_cap_usd: Decimal | None = None
    monthly_cap_usd: Decimal | None = None
    killswitch: bool = False
    last_error: str = ""
    created_at: datetime
    updated_at: datetime


class AdCampaign(BaseModel):
    id: UUID
    user_id: str
    ad_account_id: UUID
    external_campaign_id: str = ""
    name: str = ""
    objective: str = ""
    status: str = "draft"
    daily_budget_usd: Decimal | None = None
    lifetime_budget_usd: Decimal | None = None
    niche_id: UUID | None = None
    last_error: str = ""
    created_at: datetime
    updated_at: datetime


class AdCreative(BaseModel):
    id: UUID
    user_id: str
    campaign_id: UUID | None = None
    external_id: str = ""
    kind: str = "text"
    source_job_id: UUID | None = None
    source_article_id: UUID | None = None
    headline: str = ""
    body: str = ""
    media_path: str = ""
    cta: str = ""
    status: str = "draft"
    created_at: datetime
    updated_at: datetime


class AdMetricsDaily(BaseModel):
    date: date
    impressions: int = 0
    clicks: int = 0
    spend_usd: Decimal = Decimal("0")
    conversions: Decimal = Decimal("0")
    revenue_usd: Decimal = Decimal("0")


class AdSet(BaseModel):
    id: UUID
    user_id: str
    campaign_id: UUID
    external_id: str = ""
    name: str = ""
    status: str = "draft"
    targeting: dict = Field(default_factory=dict)
    bid_usd: Decimal | None = None
    created_at: datetime
    updated_at: datetime


_ACCOUNT_COLS = (
    "id, user_id, platform, external_account_id, name, composio_connection_id, "
    "status, currency, daily_cap_usd, monthly_cap_usd, killswitch, last_error, "
    "created_at, updated_at"
)
_CAMPAIGN_COLS = (
    "id, user_id, ad_account_id, external_campaign_id, name, objective, status, "
    "daily_budget_usd, lifetime_budget_usd, niche_id, last_error, created_at, "
    "updated_at"
)
_CREATIVE_COLS = (
    "id, user_id, campaign_id, external_id, kind, source_job_id, "
    "source_article_id, headline, body, media_path, cta, status, created_at, "
    "updated_at"
)


# --------------------------------------------------------------------------- accounts

async def create_account(
    *,
    user_id: str,
    platform: str,
    external_account_id: str = "",
    name: str = "",
    composio_connection_id: str = "",
    status: str = "pending",
    currency: str = "USD",
) -> AdAccount:
    if platform not in PLATFORMS:
        raise ValueError(f"unknown platform {platform!r}")
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into ad_accounts
            (user_id, platform, external_account_id, name, composio_connection_id,
             status, currency)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (user_id, platform, external_account_id) do update set
            name = excluded.name,
            composio_connection_id = excluded.composio_connection_id,
            status = excluded.status
        returning {_ACCOUNT_COLS}
        """,
        user_id, platform, external_account_id, name, composio_connection_id,
        status, currency,
    )
    return AdAccount(**dict(row))


async def list_accounts(user_id: str) -> list[AdAccount]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_ACCOUNT_COLS} from ad_accounts where user_id = $1 "
        "order by created_at desc",
        user_id,
    )
    return [AdAccount(**dict(r)) for r in rows]


async def get_account(account_id: UUID, *, user_id: str) -> AdAccount | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_ACCOUNT_COLS} from ad_accounts where id = $1 and user_id = $2",
        account_id, user_id,
    )
    return AdAccount(**dict(row)) if row else None


async def set_account_status(
    account_id: UUID, *, user_id: str, status: str, last_error: str = ""
) -> AdAccount | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""update ad_accounts set status = $3, last_error = $4
             where id = $1 and user_id = $2 returning {_ACCOUNT_COLS}""",
        account_id, user_id, status, last_error,
    )
    return AdAccount(**dict(row)) if row else None


async def set_account_governance(
    account_id: UUID,
    *,
    user_id: str,
    daily_cap_usd: Decimal | None = ...,  # type: ignore[assignment]
    monthly_cap_usd: Decimal | None = ...,  # type: ignore[assignment]
    killswitch: bool = ...,  # type: ignore[assignment]
) -> AdAccount | None:
    """Update governance fields; omitted kwargs are left unchanged (sentinel)."""
    updates: dict[str, object] = {}
    if daily_cap_usd is not ...:
        updates["daily_cap_usd"] = daily_cap_usd
    if monthly_cap_usd is not ...:
        updates["monthly_cap_usd"] = monthly_cap_usd
    if killswitch is not ...:
        updates["killswitch"] = killswitch
    if not updates:
        return await get_account(account_id, user_id=user_id)
    set_clause = ", ".join(f"{c} = ${i + 3}" for i, c in enumerate(updates))
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""update ad_accounts set {set_clause}
             where id = $1 and user_id = $2 returning {_ACCOUNT_COLS}""",
        account_id, user_id, *updates.values(),
    )
    return AdAccount(**dict(row)) if row else None


# --------------------------------------------------------------------------- campaigns

async def create_campaign(
    *,
    user_id: str,
    ad_account_id: UUID,
    name: str,
    objective: str = "",
    status: str = "draft",
    daily_budget_usd: Decimal | None = None,
    lifetime_budget_usd: Decimal | None = None,
    niche_id: UUID | None = None,
) -> AdCampaign:
    if status not in CAMPAIGN_STATUSES:
        raise ValueError(f"unknown status {status!r}")
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into ad_campaigns
            (user_id, ad_account_id, name, objective, status, daily_budget_usd,
             lifetime_budget_usd, niche_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning {_CAMPAIGN_COLS}
        """,
        user_id, ad_account_id, name, objective, status, daily_budget_usd,
        lifetime_budget_usd, niche_id,
    )
    return AdCampaign(**dict(row))


async def list_campaigns(
    user_id: str, *, ad_account_id: UUID | None = None, limit: int = 100
) -> list[AdCampaign]:
    pool = await get_pool()
    if ad_account_id is not None:
        rows = await pool.fetch(
            f"select {_CAMPAIGN_COLS} from ad_campaigns "
            "where user_id = $1 and ad_account_id = $2 "
            "order by created_at desc limit $3",
            user_id, ad_account_id, limit,
        )
    else:
        rows = await pool.fetch(
            f"select {_CAMPAIGN_COLS} from ad_campaigns where user_id = $1 "
            "order by created_at desc limit $2",
            user_id, limit,
        )
    return [AdCampaign(**dict(r)) for r in rows]


async def get_campaign(campaign_id: UUID, *, user_id: str) -> AdCampaign | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_CAMPAIGN_COLS} from ad_campaigns where id = $1 and user_id = $2",
        campaign_id, user_id,
    )
    return AdCampaign(**dict(row)) if row else None


async def update_campaign(
    campaign_id: UUID,
    *,
    user_id: str,
    status: str = ...,  # type: ignore[assignment]
    daily_budget_usd: Decimal | None = ...,  # type: ignore[assignment]
    lifetime_budget_usd: Decimal | None = ...,  # type: ignore[assignment]
    external_campaign_id: str = ...,  # type: ignore[assignment]
    last_error: str = ...,  # type: ignore[assignment]
) -> AdCampaign | None:
    updates: dict[str, object] = {}
    if status is not ...:
        if status not in CAMPAIGN_STATUSES:
            raise ValueError(f"unknown status {status!r}")
        updates["status"] = status
    if daily_budget_usd is not ...:
        updates["daily_budget_usd"] = daily_budget_usd
    if lifetime_budget_usd is not ...:
        updates["lifetime_budget_usd"] = lifetime_budget_usd
    if external_campaign_id is not ...:
        updates["external_campaign_id"] = external_campaign_id
    if last_error is not ...:
        updates["last_error"] = last_error
    if not updates:
        return await get_campaign(campaign_id, user_id=user_id)
    set_clause = ", ".join(f"{c} = ${i + 3}" for i, c in enumerate(updates))
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""update ad_campaigns set {set_clause}
             where id = $1 and user_id = $2 returning {_CAMPAIGN_COLS}""",
        campaign_id, user_id, *updates.values(),
    )
    return AdCampaign(**dict(row)) if row else None


# --------------------------------------------------------------------------- metrics

async def upsert_metrics(
    *,
    user_id: str,
    ad_account_id: UUID,
    campaign_id: UUID,
    day: date,
    impressions: int = 0,
    clicks: int = 0,
    spend_usd: Decimal = Decimal("0"),
    conversions: Decimal = Decimal("0"),
    revenue_usd: Decimal = Decimal("0"),
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into ad_metrics_daily
            (user_id, ad_account_id, campaign_id, date, impressions, clicks,
             spend_usd, conversions, revenue_usd)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (campaign_id, date) do update set
            impressions = excluded.impressions,
            clicks = excluded.clicks,
            spend_usd = excluded.spend_usd,
            conversions = excluded.conversions,
            revenue_usd = excluded.revenue_usd
        """,
        user_id, ad_account_id, campaign_id, day, impressions, clicks,
        spend_usd, conversions, revenue_usd,
    )


async def account_spend_on(
    ad_account_id: UUID, *, user_id: str, day: date
) -> Decimal:
    """Total spend for an account on a given day (pacing/cap input)."""
    pool = await get_pool()
    val = await pool.fetchval(
        """select coalesce(sum(spend_usd), 0) from ad_metrics_daily
             where ad_account_id = $1 and user_id = $2 and date = $3""",
        ad_account_id, user_id, day,
    )
    return Decimal(str(val))


async def account_spend_between(
    ad_account_id: UUID, *, user_id: str, start: date, end: date
) -> Decimal:
    pool = await get_pool()
    val = await pool.fetchval(
        """select coalesce(sum(spend_usd), 0) from ad_metrics_daily
             where ad_account_id = $1 and user_id = $2 and date >= $3 and date <= $4""",
        ad_account_id, user_id, start, end,
    )
    return Decimal(str(val))


async def campaign_metrics(
    campaign_id: UUID, *, user_id: str, limit: int = 90
) -> list[AdMetricsDaily]:
    pool = await get_pool()
    rows = await pool.fetch(
        """select date, impressions, clicks, spend_usd, conversions, revenue_usd
             from ad_metrics_daily where campaign_id = $1 and user_id = $2
             order by date desc limit $3""",
        campaign_id, user_id, limit,
    )
    return [AdMetricsDaily(**dict(r)) for r in rows]


# --------------------------------------------------------------------------- creatives

async def create_creative(
    *,
    user_id: str,
    campaign_id: UUID | None = None,
    kind: str = "text",
    source_job_id: UUID | None = None,
    source_article_id: UUID | None = None,
    headline: str = "",
    body: str = "",
    media_path: str = "",
    cta: str = "",
) -> AdCreative:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into ad_creatives
            (user_id, campaign_id, kind, source_job_id, source_article_id,
             headline, body, media_path, cta)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning {_CREATIVE_COLS}
        """,
        user_id, campaign_id, kind, source_job_id, source_article_id,
        headline, body, media_path, cta,
    )
    return AdCreative(**dict(row))


async def list_creatives(
    user_id: str, *, campaign_id: UUID | None = None
) -> list[AdCreative]:
    pool = await get_pool()
    if campaign_id is not None:
        rows = await pool.fetch(
            f"select {_CREATIVE_COLS} from ad_creatives "
            "where user_id = $1 and campaign_id = $2 order by created_at desc",
            user_id, campaign_id,
        )
    else:
        rows = await pool.fetch(
            f"select {_CREATIVE_COLS} from ad_creatives where user_id = $1 "
            "order by created_at desc",
            user_id,
        )
    return [AdCreative(**dict(r)) for r in rows]
