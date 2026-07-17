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

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Awaitable, Callable
from uuid import UUID

from ..agents.ads_strategist import StrategistRecommendation, run_ads_strategist
from ..repos import ads as ads_repo
from ..repos.ads import AdAccount, AdCampaign
from . import composio_client
from .ad_actions_exec import AdSpendDenied, apply_status_change, propose_budget_change

log = logging.getLogger(__name__)

# A metrics fetcher returns a list of daily rows per campaign:
#   {campaign_id, date, impressions, clicks, spend_usd, conversions, revenue_usd}
MetricsFetcher = Callable[[AdAccount], Awaitable[list[dict]]]

# Hard clamp on any LLM-proposed budget delta, applied in code regardless of
# what the strategist asked for — its output is advisory, never authoritative
# on magnitude. See _clamp_delta.
_MAX_DELTA_FRACTION = Decimal("0.2")
_MIN_BUDGET_USD = Decimal("1")


async def _composio_metrics(account: AdAccount) -> list[dict]:
    """Default fetcher — pulls metrics via Composio and maps the platform's
    external campaign ids back to ours (upsert_metrics needs our internal
    UUID). Returns [] whenever there's nothing safe/known to report: ads
    disabled, no campaigns with an external id yet, or the platform call
    itself fails — clean degradation, never fabricated rows."""
    if not composio_client.is_enabled():
        return []
    campaigns = await ads_repo.list_campaigns(account.user_id, ad_account_id=account.id)
    by_external = {c.external_campaign_id: c.id for c in campaigns if c.external_campaign_id}
    if not by_external:
        return []
    date_to = date.today()
    date_from = date_to - timedelta(days=1)  # hourly cron; 2-day window catches late-arriving conversions
    try:
        raw_rows = composio_client.fetch_metrics(
            user_id=account.user_id,
            connected_account_id=account.composio_connection_id,
            platform=account.platform,
            date_from=date_from,
            date_to=date_to,
        )
    except (composio_client.AdsDisabled, composio_client.ComposioCallError) as e:
        log.warning("metrics fetch failed for account %s: %s", account.id, e)
        return []
    rows = []
    for r in raw_rows:
        internal_id = by_external.get(r["campaign_id"])
        if internal_id is None:
            continue  # a platform campaign we don't know about — never guess
        rows.append({**r, "campaign_id": str(internal_id)})
    return rows


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


async def active_user_ids() -> list[str]:
    """Users with at least one active ad account — the metrics-sync fan-out
    set. Replaces the old hardcoded ``event.data["user_ids"]`` payload."""
    return await ads_repo.list_user_ids_with_active_accounts()


async def sync_all_accounts_metrics(
    *, user_ids: list[str] | None = None, fetch_fn: MetricsFetcher | None = None
) -> int:
    """Sync metrics for every active account of every given user. When
    *user_ids* is omitted, looks them up via active_user_ids() itself."""
    if user_ids is None:
        user_ids = await active_user_ids()
    total = 0
    for uid in user_ids:
        for account in await ads_repo.list_accounts(uid):
            if account.status == "active":
                total += await sync_account_metrics(
                    user_id=uid, account_id=account.id, fetch_fn=fetch_fn
                )
    return total


async def active_optimize_targets(user_ids: list[str]) -> list[tuple[str, UUID]]:
    """(user_id, campaign_id) pairs for every ACTIVE campaign under an ACTIVE
    ad account of the given users — the fan-out set for the post-sync
    ``ads/campaign.optimize`` event, one per campaign."""
    targets: list[tuple[str, UUID]] = []
    for uid in user_ids:
        for account in await ads_repo.list_accounts(uid):
            if account.status != "active":
                continue
            for camp in await ads_repo.list_campaigns(uid, ad_account_id=account.id):
                if camp.status == "active":
                    targets.append((uid, camp.id))
    return targets


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


def _clamp_delta(current: Decimal, delta_usd: Decimal) -> Decimal:
    """Hard-clamp an LLM-proposed budget delta to +/-20% of the current daily
    budget. Applied in code, unconditionally — the strategist's number is
    advisory input, never authoritative on magnitude."""
    cap = (current * _MAX_DELTA_FRACTION).copy_abs()
    if delta_usd > cap:
        return cap
    if delta_usd < -cap:
        return -cap
    return delta_usd


async def _apply_strategist_recommendation(
    *, user_id: str, campaign: AdCampaign, rec: StrategistRecommendation, apply_fn
) -> dict:
    """Turn a StrategistRecommendation into an actual (governed) change. A
    budget_change is clamped then routed through propose_budget_change
    exactly like a human-initiated change — same guard, same approval
    threshold, same audit trail. A pause propagates to the platform via the
    same path a human pause would take. no_change does nothing."""
    if rec.action == "no_change":
        return {"status": "no_change", "rationale": rec.rationale}

    if rec.action == "pause":
        account = await ads_repo.get_account(campaign.ad_account_id, user_id=user_id)
        updated = await apply_status_change(
            campaign=campaign, account=account, new_status="paused",
            actor="agent", actor_email="optimizer@marketer.sh",
        )
        return {
            "status": "executed", "action": "pause", "rationale": rec.rationale,
            "campaign": updated.model_dump(mode="json"),
        }

    # budget_change
    current = campaign.daily_budget_usd or Decimal("0")
    delta = _clamp_delta(current, Decimal(str(rec.budget_delta_usd)))
    new_budget = max(current + delta, _MIN_BUDGET_USD)
    try:
        result = await propose_budget_change(
            user_id=user_id, campaign_id=campaign.id,
            new_daily_budget_usd=new_budget, actor="agent",
            actor_email="optimizer@marketer.sh", apply_fn=apply_fn,
        )
    except AdSpendDenied as denied:
        return {"status": "denied", "reason": denied.reason, "rationale": rec.rationale}
    result["rationale"] = rec.rationale
    return result


async def optimize_campaign(
    *,
    user_id: str,
    campaign_id: UUID,
    lookback_days: int = 14,
    target_roas: Decimal = Decimal("2"),
    apply_fn=None,
    spend=None,
) -> dict:
    """Evaluate a campaign and, if warranted, act through the safe-execute
    layer. Returns a dict describing the outcome. Never moves money directly
    — every change is guarded and (if large) parked for approval.

    When there's metrics signal, the LLM strategist (agents/ads_strategist.py)
    proposes the action; its budget delta is hard-clamped in code and then
    routed through the exact same guard/approval/audit path as a human
    change. If the strategist call fails for any reason (model unavailable,
    bad output, ...), this falls back to the original transparent
    scale-up/down-by-20%-on-ROAS rule so optimization degrades gracefully
    rather than going silent.
    """
    campaign = await ads_repo.get_campaign(campaign_id, user_id=user_id)
    if campaign is None:
        return {"status": "skipped", "reason": "not found"}
    cutoff = date.today() - timedelta(days=lookback_days)
    metrics = [
        m
        for m in await ads_repo.campaign_metrics(campaign_id, user_id=user_id)
        if m.date >= cutoff
    ]

    if metrics:
        try:
            # TODO(ads): meter this call once there's a reliable niche_id for
            # optimizer-triggered campaigns (SpendContext requires one, and
            # campaign.niche_id is nullable) — skipping metering rather than
            # hacking a SpendContext together. `spend` is accepted so a
            # caller with a real niche/job context can opt in.
            rec = await run_ads_strategist(campaign, metrics, spend=spend)
            return await _apply_strategist_recommendation(
                user_id=user_id, campaign=campaign, rec=rec, apply_fn=apply_fn
            )
        except Exception:  # noqa: BLE001 — LLM unavailable/bad output: fall back to rules
            log.warning(
                "ads strategist unavailable for campaign %s, falling back to rules",
                campaign_id, exc_info=True,
            )

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
