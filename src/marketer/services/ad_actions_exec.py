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
from ..repos.ads import AdAccount, AdCampaign
from . import composio_client
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


async def resolve_apply_fn(campaign: AdCampaign) -> ApplyFn:
    """Choose the real, platform-backed apply_fn when the campaign is live
    (has an external id) on an actively-connected account; otherwise the
    local no-op — draft campaigns have nothing to call on a platform yet."""
    if not campaign.external_campaign_id:
        return _noop_apply
    account = await ads_repo.get_account(
        campaign.ad_account_id, user_id=campaign.user_id
    )
    if account is None or account.status != "active":
        return _noop_apply

    async def _apply(camp: AdCampaign, new_budget: Decimal) -> dict:
        return composio_client.set_budget(
            user_id=camp.user_id,
            connected_account_id=account.composio_connection_id,
            platform=account.platform,
            external_campaign_id=camp.external_campaign_id,
            daily_budget_usd=new_budget,
        )

    return _apply


async def _notify_approval_needed(
    user_id: str, summary: str, dollar_delta_usd: Decimal
) -> None:
    """Email the user that a spend change awaits approval. Fail-OPEN (a missed
    email must never block the governance flow) and gated on their preference."""
    try:
        from ..repos import users as users_repo
        from . import email as email_svc

        user = await users_repo.get(user_id)
        if user is None or not user.email or not user.email_notifications:
            return
        subject, html = email_svc.render_ad_approval_needed(
            summary, str(dollar_delta_usd)
        )
        await email_svc.send_email(to=user.email, subject=subject, html=html)
    except Exception:  # noqa: BLE001 — notification must not break governance
        pass


def _threshold() -> Decimal:
    return Decimal(str(settings.ads_approval_threshold_usd))


async def _gather_and_guard(
    campaign: AdCampaign,
    new_daily_budget_usd: Decimal,
    *,
    dollar_delta_usd: Decimal | None = None,
) -> tuple[Decimal, Decimal, str]:
    """Returns (dollar_delta, decision-ok requires_approval, reason) after
    running the guard. Raises AdSpendDenied on a hard deny.

    *dollar_delta_usd*, when given, overrides the delta used for the
    approval-threshold/kill-switch check (still: new_daily_budget_usd - prev
    by default). Activation treats the whole daily budget as new spend for
    this purpose, not the (zero) change to the stored budget number."""
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
    delta = dollar_delta_usd if dollar_delta_usd is not None else (new_daily_budget_usd - prev)
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
        await _notify_approval_needed(user_id, approval.summary, delta)
        return {"status": "pending_approval", "approval_id": str(approval.id)}

    updated = await _apply_budget(
        campaign, new_daily_budget_usd, delta, actor, actor_email,
        apply_fn or await resolve_apply_fn(campaign), ip, user_agent,
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
        apply_fn or await resolve_apply_fn(campaign), None, None,
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
    try:
        result = await apply_fn(campaign, new_budget)
    except Exception as e:  # noqa: BLE001 — audited, then re-raised as-is
        await ad_actions.record(
            user_id=campaign.user_id, actor=actor, actor_email=actor_email,
            action="budget.apply_failed", platform="",
            target_type="ad_campaign", target_id=str(campaign.id),
            dollar_delta_usd=delta,
            before={"daily_budget_usd": str(campaign.daily_budget_usd or 0)},
            after={"error": str(e)}, ip=ip, user_agent=user_agent,
        )
        raise
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


# --------------------------------------------------------------------------- activation / status

async def activate_campaign(
    *,
    user_id: str,
    campaign: AdCampaign,
    account: AdAccount | None,
    actor: str = "user",
    actor_email: str = "",
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """Bring a campaign with no external id live. Treats its daily budget as
    the spend delta for the guard/approval-threshold check — same rule as a
    budget change, because activation IS the first dollar of real spend. A
    small/zero budget executes immediately (creates on the platform, persists
    the external id, flips status active there and locally); a large one
    parks for human approval and touches nothing on the platform until
    approved. Raises AdSpendDenied on a hard deny (caller already ran the
    coarse non-budget gate — this is the fine-grained budget-aware one)."""
    budget = campaign.daily_budget_usd or Decimal("0")
    try:
        delta, requires_approval, _ = await _gather_and_guard(
            campaign, budget, dollar_delta_usd=budget
        )
    except AdSpendDenied as denied:
        await ad_actions.record(
            user_id=user_id, actor=actor, actor_email=actor_email,
            action="campaign.activate.denied", target_type="ad_campaign",
            target_id=str(campaign.id), dollar_delta_usd=Decimal("0"),
            after={"reason": denied.reason}, ip=ip, user_agent=user_agent,
        )
        raise

    if requires_approval:
        approval = await ad_approvals.create(
            user_id=user_id, action="campaign.activate",
            summary=f"Activate campaign with daily budget ${budget}",
            dollar_delta_usd=delta, ad_account_id=campaign.ad_account_id,
            campaign_id=campaign.id,
            payload={"daily_budget_usd": str(budget)}, requested_by=actor,
        )
        await ad_actions.record(
            user_id=user_id, actor=actor, actor_email=actor_email,
            action="campaign.activate.approval_requested", target_type="ad_campaign",
            target_id=str(campaign.id), dollar_delta_usd=delta,
            after={"approval_id": str(approval.id)}, ip=ip, user_agent=user_agent,
        )
        await _notify_approval_needed(user_id, approval.summary, delta)
        return {"status": "pending_approval", "approval_id": str(approval.id)}

    updated = await _create_and_activate(
        campaign, account, actor, actor_email, ip, user_agent
    )
    return {"status": "executed", "campaign": updated.model_dump(mode="json")}


async def execute_approved_activation(
    *, user_id: str, approval_id: UUID, actor_email: str = ""
) -> dict:
    """Run an activation a human already approved. Re-validates the guard at
    execution time (mirrors execute_approved_budget_change), then creates on
    the platform and marks the approval executed so it can't be replayed."""
    approval = await ad_approvals.get(approval_id, user_id=user_id)
    if approval is None or approval.status != "approved":
        raise AdSpendDenied("approval is not in an approved state")
    if approval.campaign_id is None:
        raise AdSpendDenied("approval has no campaign")
    campaign = await ads_repo.get_campaign(approval.campaign_id, user_id=user_id)
    if campaign is None:
        raise AdSpendDenied("campaign not found")
    account = await ads_repo.get_account(campaign.ad_account_id, user_id=user_id)

    budget = Decimal(str(approval.payload.get("daily_budget_usd", "0")))
    await _gather_and_guard(campaign, budget, dollar_delta_usd=budget)

    updated = await _create_and_activate(campaign, account, "user", actor_email, None, None)
    await ad_approvals.mark_executed(approval_id, user_id=user_id)
    return {"status": "executed", "campaign": updated.model_dump(mode="json")}


async def _create_and_activate(
    campaign: AdCampaign,
    account: AdAccount | None,
    actor: str,
    actor_email: str,
    ip: str | None,
    user_agent: str | None,
) -> AdCampaign:
    """Create the campaign on its platform, persist the returned external id,
    then flip status to active both locally and on the platform. If the
    platform call fails, nothing is persisted and the failure is audited —
    we never mark a campaign active that isn't actually running."""
    external_id = ""
    platform_result: dict = {"applied": "local"}
    if account is not None:
        try:
            created = composio_client.create_campaign(
                user_id=campaign.user_id,
                connected_account_id=account.composio_connection_id,
                platform=account.platform,
                payload={
                    "name": campaign.name,
                    "objective": campaign.objective,
                    "daily_budget_usd": str(campaign.daily_budget_usd or 0),
                },
            )
            external_id = created["external_campaign_id"]
            platform_result = composio_client.set_campaign_status(
                user_id=campaign.user_id,
                connected_account_id=account.composio_connection_id,
                platform=account.platform,
                external_campaign_id=external_id,
                status="active",
            )
        except Exception as e:  # noqa: BLE001 — audited, then re-raised as-is
            await ad_actions.record(
                user_id=campaign.user_id, actor=actor, actor_email=actor_email,
                action="campaign.activate.apply_failed", platform=account.platform,
                target_type="ad_campaign", target_id=str(campaign.id),
                after={"error": str(e)}, ip=ip, user_agent=user_agent,
            )
            raise

    updates: dict = {"status": "active"}
    if external_id:
        updates["external_campaign_id"] = external_id
    updated = await ads_repo.update_campaign(
        campaign.id, user_id=campaign.user_id, **updates
    )
    await ad_actions.record(
        user_id=campaign.user_id, actor=actor, actor_email=actor_email,
        action="campaign.activate", platform=account.platform if account else "",
        target_type="ad_campaign", target_id=str(campaign.id),
        after={
            "status": "active", "external_campaign_id": external_id,
            "result": platform_result,
        },
        ip=ip, user_agent=user_agent,
    )
    return updated or campaign


async def apply_status_change(
    *,
    campaign: AdCampaign,
    account: AdAccount | None,
    new_status: str,
    actor: str = "user",
    actor_email: str = "",
    ip: str | None = None,
    user_agent: str | None = None,
) -> AdCampaign:
    """Pause / end / reactivate a campaign that already has an external id:
    propagate to the platform, then persist locally, then audit. Reductions
    in spend are never blocked by config — if Composio is disabled mid-flight
    the local status change still goes through; a genuine platform-side
    failure is raised (never silently swallowed into a fake success, which
    would leave the user believing a still-running campaign had stopped)."""
    result: dict = {"applied": "local"}
    if campaign.external_campaign_id and account is not None:
        try:
            result = composio_client.set_campaign_status(
                user_id=campaign.user_id,
                connected_account_id=account.composio_connection_id,
                platform=account.platform,
                external_campaign_id=campaign.external_campaign_id,
                status=new_status,
            )
        except composio_client.AdsDisabled:
            pass  # feature off mid-flight; a spend-reducing change is never blocked

    updated = await ads_repo.update_campaign(
        campaign.id, user_id=campaign.user_id, status=new_status
    )
    action = "campaign.activate" if new_status == "active" else f"campaign.{new_status}"
    await ad_actions.record(
        user_id=campaign.user_id, actor=actor, actor_email=actor_email,
        action=action, platform=account.platform if account else "",
        target_type="ad_campaign", target_id=str(campaign.id),
        after={"status": new_status, "result": result},
        ip=ip, user_agent=user_agent,
    )
    return updated or campaign
