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
  5. RAILED    — every execution passes ``marketer.rails.enforce_dispatch``
                 (global kill switch, caps via this module's guard, unknown
                 outcomes on the campaign, args-bound approvals), and the
                 platform call runs through ``Dispatch.run`` so a timeout is
                 recorded ``indeterminate`` and never retried
                 (docs/rails/enforcement-point.md).

Nothing else in the codebase may call the Composio executor for a spend action
directly. Reads and drafts are unrestricted; money is not.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Awaitable, Callable
from uuid import UUID

from .. import rails
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
    to the caller — never silently swallowed. ``status_code`` is 402 for a
    guard denial; a rails refusal carries its own (409 when the approval no
    longer matches or an earlier attempt has an unknown outcome, 503 when the
    rails store is unreachable)."""

    def __init__(self, reason: str, status_code: int = 402) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status_code = status_code

    @classmethod
    def from_rails(cls, denied: rails.RailsDenied) -> AdSpendDenied:
        return cls(f"{denied.code}: {denied.reason}", denied.status_code)


async def _noop_apply(_campaign: AdCampaign, _budget: Decimal) -> dict:
    """Default apply for draft/local campaigns with no external id yet — there
    is nothing to call on the platform, so applying is a metadata-only update."""
    return {"applied": "local"}


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


# --------------------------------------------------------------------------- rails binding
# An approval is bound to the exact change a person saw (docs/rails/approvals.md):
# the campaign, the budget it moves FROM and TO, and the account's governance.
# The binding is stored in the approval's payload under "rails", written in the
# same INSERT as the approval, and recomputed from current facts at execution.


def budget_change_args(campaign: AdCampaign, new_daily_budget_usd: Decimal) -> dict:
    return {
        "campaign_id": campaign.id,
        "ad_account_id": campaign.ad_account_id,
        "prev_daily_budget_usd": campaign.daily_budget_usd or Decimal("0"),
        "new_daily_budget_usd": new_daily_budget_usd,
    }


def activation_args(campaign: AdCampaign) -> dict:
    return {
        "campaign_id": campaign.id,
        "ad_account_id": campaign.ad_account_id,
        "daily_budget_usd": campaign.daily_budget_usd or Decimal("0"),
    }


async def current_governance(campaign: AdCampaign) -> AccountGovernance | None:
    account = await ads_repo.get_account(campaign.ad_account_id, user_id=campaign.user_id)
    if account is None:
        return None
    return AccountGovernance(
        status=account.status, killswitch=account.killswitch,
        daily_cap_usd=account.daily_cap_usd, monthly_cap_usd=account.monthly_cap_usd,
    )


def rails_binding(action: str, args: dict, governance: AccountGovernance | None) -> dict:
    """The ``payload["rails"]`` entry stored with a new approval."""
    return {
        "action": action,
        "args_hash": rails.args_hash(action, args),
        "governance_hash": rails.governance_hash(governance),
    }


def _binding_check(approval, action: str, args: dict, governance: AccountGovernance | None) -> rails.ApprovalBinding:
    stored = (approval.payload or {}).get("rails") or {}
    return rails.ApprovalBinding(
        status=approval.status,
        stored_args_hash=stored.get("args_hash"),
        current_args_hash=rails.args_hash(action, args),
        stored_governance_hash=stored.get("governance_hash"),
        current_governance_hash=rails.governance_hash(governance),
    )


def _principal(actor: str) -> str:
    return actor if actor in ("user", "agent") else "system"


async def _gather_and_guard(
    campaign: AdCampaign,
    new_daily_budget_usd: Decimal,
    *,
    prev_daily_budget_usd: Decimal | None = None,
) -> tuple[Decimal, Decimal, str]:
    """Returns (dollar_delta, decision-ok requires_approval, reason) after
    running the guard. Raises AdSpendDenied on a hard deny.

    ``prev_daily_budget_usd`` overrides what counts as the "previous" budget
    when computing the delta — normally the campaign's currently-stored
    budget (a budget change on an already-spending campaign), but callers
    guarding an ACTIVATION pass 0 here: the campaign wasn't spending before,
    so its whole stored budget is the delta coming online."""
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
    prev = (
        campaign.daily_budget_usd or Decimal("0")
        if prev_daily_budget_usd is None
        else prev_daily_budget_usd
    )
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

    guarded: dict = {}

    async def _caps() -> rails.CapsVerdict:
        # The existing fail-closed guard, read now. A hard deny raises
        # AdSpendDenied, which propagates out of enforce_dispatch unchanged.
        guarded["delta"], guarded["requires_approval"], _ = await _gather_and_guard(
            campaign, new_daily_budget_usd
        )
        return rails.CapsVerdict(True)

    args = budget_change_args(campaign, new_daily_budget_usd)
    try:
        dispatch = await rails.enforce_dispatch(
            "ads.budget.change", user_id=user_id, principal=_principal(actor),
            actor_email=actor_email, args=args,
            target_type="ad_campaign", target_id=str(campaign_id), caps=_caps,
        )
    except (AdSpendDenied, rails.RailsDenied) as raised:
        denied = AdSpendDenied.from_rails(raised) if isinstance(raised, rails.RailsDenied) else raised
        reason = denied.reason
        await ad_actions.record(
            user_id=user_id, actor=actor, actor_email=actor_email,
            action="budget.denied", target_type="ad_campaign",
            target_id=str(campaign_id), dollar_delta_usd=Decimal("0"),
            after={"reason": reason,
                   "requested_daily_budget": str(new_daily_budget_usd)},
            ip=ip, user_agent=user_agent,
        )
        if denied is raised:
            raise
        raise denied from raised
    delta, requires_approval = guarded["delta"], guarded["requires_approval"]

    if requires_approval:
        governance = await current_governance(campaign)
        approval = await ad_approvals.create(
            user_id=user_id, action="budget.change",
            summary=f"Set daily budget to ${new_daily_budget_usd}",
            dollar_delta_usd=delta, ad_account_id=campaign.ad_account_id,
            campaign_id=campaign.id,
            payload={
                "new_daily_budget_usd": str(new_daily_budget_usd),
                "rails": rails_binding("ads.budget.change", args, governance),
            },
            requested_by=actor,
        )
        await ad_actions.record(
            user_id=user_id, actor=actor, actor_email=actor_email,
            action="budget.approval_requested", target_type="ad_campaign",
            target_id=str(campaign_id), dollar_delta_usd=delta,
            after={"approval_id": str(approval.id)}, ip=ip, user_agent=user_agent,
        )
        # Nothing reached the platform: the dispatch's effect is the parked approval.
        await dispatch.succeeded({"result": "pending_approval", "approval_id": str(approval.id)})
        await _notify_approval_needed(user_id, approval.summary, delta)
        return {"status": "pending_approval", "approval_id": str(approval.id)}

    updated = await _apply_budget(
        campaign, new_daily_budget_usd, delta, actor, actor_email,
        apply_fn or _noop_apply, ip, user_agent, dispatch,
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
    guarded: dict = {}

    async def _caps() -> rails.CapsVerdict:
        # Re-guard at execution time; a hard deny aborts (kept as approved so it
        # can be retried after the blocker clears — we do not silently execute).
        guarded["delta"], _requires, _ = await _gather_and_guard(campaign, new_budget)
        return rails.CapsVerdict(True)

    # The approval must still describe this exact change: same campaign, same
    # from/to budget, same account governance (args-bound, docs/rails/approvals.md).
    binding = _binding_check(
        approval, "ads.budget.change", budget_change_args(campaign, new_budget),
        await current_governance(campaign),
    )
    try:
        dispatch = await rails.enforce_dispatch(
            "ads.approval.execute", user_id=user_id, principal="user",
            actor_email=actor_email, args={"approval_id": approval_id},
            target_type="ad_campaign", target_id=str(campaign.id), caps=_caps,
            approval=binding, approval_id=approval_id, idempotency_key="",
        )
    except rails.RailsDenied as denied:
        raise AdSpendDenied.from_rails(denied) from denied
    delta = guarded["delta"]

    updated = await _apply_budget(
        campaign, new_budget, delta, "user", actor_email,
        apply_fn or _noop_apply, None, None, dispatch,
    )
    await ad_approvals.mark_executed(approval_id, user_id=user_id)
    return {"status": "executed", "campaign": updated.model_dump(mode="json")}


async def guard_activation(campaign: AdCampaign) -> tuple[Decimal, bool]:
    """Run the SAME budget guard ``propose_budget_change`` uses against a
    campaign that is about to be ACTIVATED, using its stored
    ``daily_budget_usd`` as the spend newly coming online (previous
    contribution treated as zero, since a draft/paused campaign spends
    nothing). Returns (dollar_delta, requires_approval). Raises
    AdSpendDenied on a hard deny (over cap, kill-switch, inactive account,
    …) — activation must never bypass the cap/approval checks that a budget
    change would go through."""
    budget = campaign.daily_budget_usd or Decimal("0")
    delta, requires_approval, _ = await _gather_and_guard(
        campaign, budget, prev_daily_budget_usd=Decimal("0"),
    )
    return delta, requires_approval


async def execute_approved_activation(
    *,
    user_id: str,
    approval_id: UUID,
    actor_email: str = "",
    apply_fn: ApplyFn | None = None,
) -> dict:
    """Run a campaign activation that a human already approved. Re-validates
    the guard at execution time (state may have moved since the approval was
    granted), applies (platform call + status flip), audits, and marks the
    approval executed so it can't be replayed."""
    approval = await ad_approvals.get(approval_id, user_id=user_id)
    if approval is None or approval.status != "approved":
        raise AdSpendDenied("approval is not in an approved state")
    if approval.campaign_id is None:
        raise AdSpendDenied("approval has no campaign")
    campaign = await ads_repo.get_campaign(approval.campaign_id, user_id=user_id)
    if campaign is None:
        raise AdSpendDenied("campaign not found")

    guarded: dict = {}

    async def _caps() -> rails.CapsVerdict:
        # Re-guard at execution time; a hard deny aborts and leaves the approval
        # 'approved' so it can be retried once the blocker clears.
        guarded["delta"], _requires = await guard_activation(campaign)
        return rails.CapsVerdict(True)

    # Bound to the budget the person saw: editing the draft's budget after the
    # request invalidates the approval instead of activating a different spend.
    binding = _binding_check(
        approval, "ads.campaign.activate", activation_args(campaign),
        await current_governance(campaign),
    )
    try:
        dispatch = await rails.enforce_dispatch(
            "ads.approval.execute", user_id=user_id, principal="user",
            actor_email=actor_email, args={"approval_id": approval_id},
            target_type="ad_campaign", target_id=str(campaign.id), caps=_caps,
            approval=binding, approval_id=approval_id, idempotency_key="",
        )
    except rails.RailsDenied as denied:
        raise AdSpendDenied.from_rails(denied) from denied
    delta = guarded["delta"]

    budget = campaign.daily_budget_usd or Decimal("0")
    fn = apply_fn or _noop_apply
    result = await dispatch.run(lambda: fn(campaign, budget), definite=(AdSpendDenied,))
    updated = await ads_repo.update_campaign(
        campaign.id, user_id=user_id, status="active"
    )
    await ad_actions.record(
        user_id=user_id, actor="user", actor_email=actor_email,
        action="campaign.activate", platform="",
        target_type="ad_campaign", target_id=str(campaign.id),
        dollar_delta_usd=delta,
        before={"status": campaign.status},
        after={"status": "active", "result": result},
    )
    await ad_approvals.mark_executed(approval_id, user_id=user_id)
    return {"status": "executed", "campaign": (updated or campaign).model_dump(mode="json")}


async def _apply_budget(
    campaign: AdCampaign,
    new_budget: Decimal,
    delta: Decimal,
    actor: str,
    actor_email: str,
    apply_fn: ApplyFn,
    ip: str | None,
    user_agent: str | None,
    dispatch: rails.Dispatch,
) -> AdCampaign:
    """Make the platform call, persist the new budget, and audit — in that
    order. If the platform call raises, we never record a fake success: a
    definite failure re-raises, an ambiguous one (timeout after sending) is
    recorded ``indeterminate`` and raised as ``rails.OutcomeUnknown``."""
    result = await dispatch.run(lambda: apply_fn(campaign, new_budget), definite=(AdSpendDenied,))
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
