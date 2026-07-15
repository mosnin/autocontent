"""Ad workflow business logic — plain async functions with injectable external
calls, so they are unit-testable without Inngest or Composio. The Inngest
durable functions (services/inngest_app.py) wrap these in ``ctx.step`` for
retries/checkpointing; nothing here depends on the Inngest runtime.

Two workflows live here for now:
- metrics sync: pull daily performance per account into ad_metrics_daily.
- optimization: read recent metrics, and where a change is warranted, PROPOSE
  it through the safe-execute layer (which guards + parks for approval — an
  agent proposing an optimization can never move money on its own).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Awaitable, Callable
from uuid import UUID

from ..repos import ads as ads_repo
from ..repos.ads import AdAccount, AdCampaign
from . import composio_client
from .ad_actions_exec import AdSpendDenied, propose_budget_change

# A metrics fetcher returns a list of daily rows per campaign:
#   {campaign_id, date, impressions, clicks, spend_usd, conversions, revenue_usd}
MetricsFetcher = Callable[[AdAccount], Awaitable[list[dict]]]


async def _composio_metrics(account: AdAccount) -> list[dict]:
    """Default fetcher — pulls metrics via Composio. Returns [] when ads/
    Composio is disabled so the workflow degrades to a no-op rather than
    erroring."""
    if not composio_client.is_enabled():
        return []
    # Real slug wiring lands with the platform tool catalog; until then this
    # degrades cleanly to no rows (no fabricated metrics).
    return []


async def sync_account_metrics(
    *,
    user_id: str,
    account_id: UUID,
    fetch_fn: MetricsFetcher | None = None,
) -> int:
    """Pull and upsert daily metrics for one account. Returns rows written.
    Idempotent (upsert on campaign+date)."""
    account = await ads_repo.get_account(account_id, user_id=user_id)
    if account is None or account.status != "active":
        return 0
    fetch = fetch_fn or _composio_metrics
    rows = await fetch(account)
    written = 0
    for r in rows:
        await ads_repo.upsert_metrics(
            user_id=user_id,
            ad_account_id=account_id,
            campaign_id=UUID(str(r["campaign_id"])),
            day=r["date"] if isinstance(r["date"], date) else date.fromisoformat(str(r["date"])),
            impressions=int(r.get("impressions", 0)),
            clicks=int(r.get("clicks", 0)),
            spend_usd=Decimal(str(r.get("spend_usd", 0))),
            conversions=Decimal(str(r.get("conversions", 0))),
            revenue_usd=Decimal(str(r.get("revenue_usd", 0))),
        )
        written += 1
    return written


async def sync_all_accounts_metrics(
    *, user_ids: list[str], fetch_fn: MetricsFetcher | None = None
) -> int:
    total = 0
    for uid in user_ids:
        for account in await ads_repo.list_accounts(uid):
            if account.status == "active":
                total += await sync_account_metrics(
                    user_id=uid, account_id=account.id, fetch_fn=fetch_fn
                )
    return total


def _roas(campaign_metrics: list) -> Decimal | None:
    """Return-on-ad-spend over the provided window, or None if no spend."""
    spend = sum((m.spend_usd for m in campaign_metrics), Decimal("0"))
    revenue = sum((m.revenue_usd for m in campaign_metrics), Decimal("0"))
    if spend <= 0:
        return None
    return revenue / spend


def recommend_daily_budget(
    campaign: AdCampaign, campaign_metrics: list, *, target_roas: Decimal = Decimal("2")
) -> Decimal | None:
    """A simple, transparent policy: scale a strong performer up 20% and a weak
    one down 20%, bounded. Returns the recommended new daily budget, or None
    when there's not enough signal or no change is warranted. The recommendation
    is only ever a PROPOSAL — the guard + approval gate decide if it happens."""
    roas = _roas(campaign_metrics)
    current = campaign.daily_budget_usd
    if roas is None or current is None or current <= 0:
        return None
    if roas >= target_roas:
        proposed = (current * Decimal("1.2")).quantize(Decimal("0.01"))
    elif roas < target_roas / 2:
        proposed = (current * Decimal("0.8")).quantize(Decimal("0.01"))
    else:
        return None
    return proposed if proposed != current else None


async def optimize_campaign(
    *,
    user_id: str,
    campaign_id: UUID,
    lookback_days: int = 7,
    target_roas: Decimal = Decimal("2"),
    apply_fn=None,
) -> dict:
    """Evaluate a campaign and, if warranted, PROPOSE a budget change through
    the safe-execute layer. Returns a dict describing the outcome. Never moves
    money directly — a proposal is guarded and (if large) parked for approval."""
    campaign = await ads_repo.get_campaign(campaign_id, user_id=user_id)
    if campaign is None:
        return {"status": "skipped", "reason": "not found"}
    cutoff = date.today() - timedelta(days=lookback_days)
    metrics = [
        m
        for m in await ads_repo.campaign_metrics(campaign_id, user_id=user_id)
        if m.date >= cutoff
    ]
    recommended = recommend_daily_budget(
        campaign, metrics, target_roas=target_roas
    )
    if recommended is None:
        return {"status": "no_change"}
    try:
        return await propose_budget_change(
            user_id=user_id, campaign_id=campaign_id,
            new_daily_budget_usd=recommended, actor="agent",
            actor_email="optimizer@marketer.sh", apply_fn=apply_fn,
        )
    except AdSpendDenied as denied:
        return {"status": "denied", "reason": denied.reason}
