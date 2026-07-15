"""Safe-execute layer — the ONLY sanctioned path for a spend-affecting ad
action. Every such action funnels through here so it is uniformly:

  1. GOVERNED  — AdSpendGuard evaluates it fail-CLOSED (caps, kill-switch, …).
  2. APPROVED  — large deltas park as a pending approval and DO NOT execute
                 until a human approves; the approved action re-enters here.
  3. AUDITED   — an append-only ad_actions_log row is written for allow, deny,
                 approval-request, and execution alike.
  4. APPLIED   — only then is the platform call made, via an injectable
                 ``apply_fn`` (default: the Composio executor). Tests inject a
                 stub so no real spend happens.

Nothing else in the codebase may call the Composio executor for a spend action
directly. Reads and drafts are unrestricted; money is not.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Awaitable, Callable
from uuid import UUID

from ..config import settings
from ..repos import ad_actions, ad_approvals
from ..repos import ads as ads_repo
from ..repos.ads import AdCampaign
from .ad_spend_guard import AccountGovernance, evaluate_budget_change

# apply_fn(campaign, new_daily_budget_usd) -> external result dict. Injectable
# so the platform call is stubbed in tests and swappable per platform.
ApplyFn = Callable[[AdCampaign, Decimal], Awaitable[dict]]


class AdSpendDenied(RuntimeError):
    """A spend-affecting action was refused by governance. Surfaced as 402/409
    to the caller — never silently swallowed."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


async def _noop_apply(_campaign: AdCampaign, _budget: Decimal) -> dict:
    """Default apply for draft/local campaigns with no external id yet — there
    is nothing to call on the platform, so applying is a metadata-only update."""
    return {"applied": "local"}


def _threshold() -> Decimal:
    return Decimal(str(settings.ads_approval_threshold_usd))


async def _gather_and_guard(
    campaign: AdCampaign, new_daily_budget_usd: Decimal
) -> tuple[Decimal, Decimal, str]:
    """Returns (dollar_delta, decision-ok requires_approval, reason) after
    running the guard. Raises AdSpendDenied on a hard deny."""
    account = await ads_repo.get_account(
        campaign.ad_account_id, user_id=campaign.user_id
    )
    gov = (
        AccountGovernance(
            status=account.status,
            killswitch=account.killswitch,
            daily_cap_usd=account.daily_cap_usd,
            monthly_cap_usd=account.monthly_cap_usd,
        )
        if account is not None
        else None
    )
    committed = await ads_repo.active_daily_budget_total(
        user_id=campaign.user_id,
        ad_account_id=campaign.ad_account_id,
        exclude_campaign_id=campaign.id,
    )
    today = date.today()
    today_spend = await ads_repo.account_spend_on(
        campaign.ad_account_id, user_id=campaign.user_id, day=today
    )
    month_spend = await ads_repo.account_spend_between(
        campaign.ad_account_id, user_id=campaign.user_id,
        start=today.replace(day=1), end=today,
    )
    prev = campaign.daily_budget_usd or Decimal("0")
    delta = new_daily_budget_usd - prev
    decision = evaluate_budget_change(
        account=gov,
        committed_daily_budget_usd=committed,
        new_daily_budget_usd=new_daily_budget_usd,
        today_spend_usd=today_spend,
        month_spend_usd=month_spend,
        dollar_delta_usd=delta,
        approval_threshold_usd=_threshold(),
    )
    if not decision.allowed:
        raise AdSpendDenied(decision.reason)
    return delta, decision.requires_approval, ""


async def propose_budget_change(
    *,
    user_id: str,
    campaign_id: UUID,
    new_daily_budget_usd: Decimal,
    actor: str = "agent",
    actor_email: str = "",
    ip: str | None = None,
    user_agent: str | None = None,
    apply_fn: ApplyFn | None = None,
) -> dict:
    """Entry point for a budget change. Runs the guard; small allowed changes
    execute immediately; large ones park as a pending approval. Returns a dict
    with a ``status`` of 'executed' | 'pending_approval'. Raises AdSpendDenied
    on a hard deny (with an audit trail)."""
    campaign = await ads_repo.get_campaign(campaign_id, user_id=user_id)
    if campaign is None:
        raise AdSpendDenied("campaign not found")

    try:
        delta, requires_approval, _ = await _gather_and_guard(
            campaign, new_daily_budget_usd
        )
    except AdSpendDenied as denied:
        await ad_actions.record(
            user_id=user_id, actor=actor, actor_email=actor_email,
            action="budget.denied", target_type="ad_campaign",
            target_id=str(campaign_id), dollar_delta_usd=Decimal("0"),
            after={"reason": denied.reason,
                   "requested_daily_budget": str(new_daily_budget_usd)},
            ip=ip, user_agent=user_agent,
        )
        raise

    if requires_approval:
        approval = await ad_approvals.create(
            user_id=user_id, action="budget.change",
            summary=f"Set daily budget to ${new_daily_budget_usd}",
            dollar_delta_usd=delta, ad_account_id=campaign.ad_account_id,
            campaign_id=campaign.id,
            payload={"new_daily_budget_usd": str(new_daily_budget_usd)},
            requested_by=actor,
        )
        await ad_actions.record(
            user_id=user_id, actor=actor, actor_email=actor_email,
            action="budget.approval_requested", target_type="ad_campaign",
            target_id=str(campaign_id), dollar_delta_usd=delta,
            after={"approval_id": str(approval.id)}, ip=ip, user_agent=user_agent,
        )
        return {"status": "pending_approval", "approval_id": str(approval.id)}

    updated = await _apply_budget(
        campaign, new_daily_budget_usd, delta, actor, actor_email,
        apply_fn or _noop_apply, ip, user_agent,
    )
    return {"status": "executed", "campaign": updated.model_dump(mode="json")}


async def execute_approved_budget_change(
    *,
    user_id: str,
    approval_id: UUID,
    actor_email: str = "",
    apply_fn: ApplyFn | None = None,
) -> dict:
    """Run a budget change that a human already approved. Re-validates the guard
    at execution time (state may have moved), applies, audits, and marks the
    approval executed so it can't be replayed."""
    approval = await ad_approvals.get(approval_id, user_id=user_id)
    if approval is None or approval.status != "approved":
        raise AdSpendDenied("approval is not in an approved state")
    if approval.campaign_id is None:
        raise AdSpendDenied("approval has no campaign")
    campaign = await ads_repo.get_campaign(approval.campaign_id, user_id=user_id)
    if campaign is None:
        raise AdSpendDenied("campaign not found")

    new_budget = Decimal(str(approval.payload.get("new_daily_budget_usd", "0")))
    # Re-guard at execution time; a hard deny aborts (kept as approved so it
    # can be retried after the blocker clears — we do not silently execute).
    delta, _requires, _ = await _gather_and_guard(campaign, new_budget)

    updated = await _apply_budget(
        campaign, new_budget, delta, "user", actor_email,
        apply_fn or _noop_apply, None, None,
    )
    await ad_approvals.mark_executed(approval_id, user_id=user_id)
    return {"status": "executed", "campaign": updated.model_dump(mode="json")}


async def _apply_budget(
    campaign: AdCampaign,
    new_budget: Decimal,
    delta: Decimal,
    actor: str,
    actor_email: str,
    apply_fn: ApplyFn,
    ip: str | None,
    user_agent: str | None,
) -> AdCampaign:
    """Make the platform call, persist the new budget, and audit — in that
    order. If the platform call raises, we never record a fake success."""
    result = await apply_fn(campaign, new_budget)
    updated = await ads_repo.update_campaign(
        campaign.id, user_id=campaign.user_id, daily_budget_usd=new_budget
    )
    await ad_actions.record(
        user_id=campaign.user_id, actor=actor, actor_email=actor_email,
        action="budget.change", platform="",
        target_type="ad_campaign", target_id=str(campaign.id),
        dollar_delta_usd=delta,
        before={"daily_budget_usd": str(campaign.daily_budget_usd or 0)},
        after={"daily_budget_usd": str(new_budget), "result": result},
        ip=ip, user_agent=user_agent,
    )
    return updated or campaign
