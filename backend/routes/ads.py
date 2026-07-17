"""Ads REST surface: connected accounts, governance, campaigns, creatives,
approvals, and the action log. Every spend-affecting mutation (budget change,
activate, pause/end, approval execution) flows through the safe-execute layer
in services/ad_actions_exec.py — guarded, approval-gated, audited, and (when
the campaign is live on a platform) applied there too.

Every route is user_id-scoped. Composio calls can raise AdsDisabled (feature
off/misconfigured -> 409) or ComposioCallError (the platform call executed
but failed -> 502); neither is ever swallowed into a fake success.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.repos import ad_actions, ad_approvals
from marketer.repos import ads as ads_repo
from marketer.services import ad_connections
from marketer.services.ad_actions_exec import (
    AdSpendDenied,
    activate_campaign,
    apply_status_change,
    execute_approved_activation,
    execute_approved_budget_change,
    propose_budget_change,
)
from marketer.services.ad_spend_guard import AccountGovernance, evaluate_non_budget_action
from marketer.services.composio_client import AdsDisabled, ComposioCallError

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


# --------------------------------------------------------------------------- accounts

class ConnectBody(BaseModel):
    platform: str


@router.get("/accounts", response_model=list[ads_repo.AdAccount])
async def list_accounts(ctx: AuthCtx = CurrentUser) -> list[ads_repo.AdAccount]:
    return await ads_repo.list_accounts(ctx.user_id)


@router.post("/accounts/connect")
async def connect_account(body: ConnectBody, ctx: AuthCtx = CurrentUser) -> dict:
    try:
        return await ad_connections.start_connection(
            user_id=ctx.user_id, platform=body.platform
        )
    except AdsDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e


@router.post("/accounts/{account_id}/refresh", response_model=ads_repo.AdAccount)
async def refresh_account(
    account_id: UUID, ctx: AuthCtx = CurrentUser
) -> ads_repo.AdAccount:
    acc = await ad_connections.refresh_status(user_id=ctx.user_id, account_id=account_id)
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    return acc


@router.delete("/accounts/{account_id}", response_model=ads_repo.AdAccount)
async def disconnect_account(
    account_id: UUID, ctx: AuthCtx = CurrentUser
) -> ads_repo.AdAccount:
    acc = await ad_connections.disconnect(user_id=ctx.user_id, account_id=account_id)
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    return acc


class GovernanceBody(BaseModel):
    daily_cap_usd: Decimal | None = Field(default=None, ge=0)
    monthly_cap_usd: Decimal | None = Field(default=None, ge=0)
    killswitch: bool | None = None


@router.patch("/accounts/{account_id}/governance", response_model=ads_repo.AdAccount)
async def set_governance(
    account_id: UUID, body: GovernanceBody, ctx: AuthCtx = CurrentUser
) -> ads_repo.AdAccount:
    kwargs: dict = {}
    if "daily_cap_usd" in body.model_fields_set:
        kwargs["daily_cap_usd"] = body.daily_cap_usd
    if "monthly_cap_usd" in body.model_fields_set:
        kwargs["monthly_cap_usd"] = body.monthly_cap_usd
    if "killswitch" in body.model_fields_set:
        kwargs["killswitch"] = body.killswitch
    acc = await ads_repo.set_account_governance(
        account_id, user_id=ctx.user_id, **kwargs
    )
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    # Governance changes are audited (kill-switch especially).
    await ad_actions.record(
        user_id=ctx.user_id, actor="user", actor_email=ctx.email,
        action="account.governance", platform=acc.platform,
        target_type="ad_account", target_id=str(acc.id),
        after={
            "daily_cap_usd": str(acc.daily_cap_usd) if acc.daily_cap_usd else None,
            "monthly_cap_usd": str(acc.monthly_cap_usd) if acc.monthly_cap_usd else None,
            "killswitch": acc.killswitch,
        },
    )
    return acc


# --------------------------------------------------------------------------- campaigns

@router.get("/campaigns", response_model=list[ads_repo.AdCampaign])
async def list_campaigns(
    account_id: UUID | None = None, ctx: AuthCtx = CurrentUser
) -> list[ads_repo.AdCampaign]:
    return await ads_repo.list_campaigns(ctx.user_id, ad_account_id=account_id)


class CreateCampaignBody(BaseModel):
    ad_account_id: UUID
    name: str = Field(min_length=1, max_length=200)
    objective: str = Field(default="", max_length=100)
    # Intended daily budget stored on the draft. It does NOT spend until the
    # campaign is activated, which routes through the guard.
    daily_budget_usd: Decimal | None = Field(default=None, ge=0)
    niche_id: UUID | None = None


@router.post("/campaigns", response_model=ads_repo.AdCampaign, status_code=201)
async def create_campaign(
    body: CreateCampaignBody, ctx: AuthCtx = CurrentUser
) -> ads_repo.AdCampaign:
    """Create a DRAFT campaign. No spend — drafts are never on a platform until
    activated. The account must belong to the caller."""
    account = await ads_repo.get_account(body.ad_account_id, user_id=ctx.user_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ad account not found")
    camp = await ads_repo.create_campaign(
        user_id=ctx.user_id, ad_account_id=body.ad_account_id, name=body.name,
        objective=body.objective, status="draft",
        daily_budget_usd=body.daily_budget_usd, niche_id=body.niche_id,
    )
    await ad_actions.record(
        user_id=ctx.user_id, actor="user", actor_email=ctx.email,
        action="campaign.create", platform=account.platform,
        target_type="ad_campaign", target_id=str(camp.id),
        after={"name": camp.name, "objective": camp.objective},
    )
    return camp


class BudgetBody(BaseModel):
    daily_budget_usd: Decimal = Field(ge=0)


@router.post("/campaigns/{campaign_id}/budget")
async def change_budget(
    campaign_id: UUID, body: BudgetBody, ctx: AuthCtx = CurrentUser
) -> dict:
    """Change a campaign's daily budget through the safe-execute layer:
    guarded, approval-gated for large deltas, and audited. 402 on a hard
    deny. When the campaign is live on a platform (has an external id) on an
    actively-connected account, the change is ALSO applied there (see
    ad_actions_exec.resolve_apply_fn — propose_budget_change resolves it
    internally per-campaign); campaigns without an external id remain local
    drafts (no platform call)."""
    try:
        return await propose_budget_change(
            user_id=ctx.user_id, campaign_id=campaign_id,
            new_daily_budget_usd=body.daily_budget_usd,
            actor="user", actor_email=ctx.email,
        )
    except AdSpendDenied as e:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, e.reason) from e
    except AdsDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except ComposioCallError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e


class StatusBody(BaseModel):
    status: str  # 'active' | 'paused' | 'ended'


@router.post("/campaigns/{campaign_id}/status")
async def change_status(
    campaign_id: UUID, body: StatusBody, ctx: AuthCtx = CurrentUser
) -> dict:
    """Activate / pause / end a campaign. Activation is spend-affecting and
    passes the guard's non-budget check first (account health/kill-switch,
    unconditional); a campaign with no external id yet is then ALSO guarded
    on its daily budget (approval threshold applies) before it's created on
    the platform — see ad_actions_exec.activate_campaign. Pausing/ending
    always passes the coarse gate and propagates to the platform when the
    campaign has an external id. Returns either the updated campaign or
    ``{"status": "pending_approval", "approval_id": ...}``."""
    if body.status not in {"active", "paused", "ended"}:
        raise HTTPException(422, "status must be active, paused, or ended")
    camp = await ads_repo.get_campaign(campaign_id, user_id=ctx.user_id)
    if camp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")

    action = "campaign.activate" if body.status == "active" else f"campaign.{body.status}"
    account = await ads_repo.get_account(camp.ad_account_id, user_id=ctx.user_id)
    gov = (
        AccountGovernance(
            status=account.status, killswitch=account.killswitch,
            daily_cap_usd=account.daily_cap_usd, monthly_cap_usd=account.monthly_cap_usd,
        )
        if account
        else None
    )
    decision = evaluate_non_budget_action(account=gov, action=action)
    if not decision.allowed:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, decision.reason)

    try:
        if body.status == "active" and not camp.external_campaign_id:
            result = await activate_campaign(
                user_id=ctx.user_id, campaign=camp, account=account,
                actor="user", actor_email=ctx.email,
            )
            if result["status"] == "pending_approval":
                return result
            return result["campaign"]
        updated = await apply_status_change(
            campaign=camp, account=account, new_status=body.status,
            actor="user", actor_email=ctx.email,
        )
        return updated.model_dump(mode="json")
    except AdSpendDenied as e:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, e.reason) from e
    except AdsDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except ComposioCallError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e


class CreativesBody(BaseModel):
    count: int = Field(default=3, ge=1, le=10)


@router.post("/campaigns/{campaign_id}/creatives", response_model=list[ads_repo.AdCreative],
             status_code=201)
async def generate_creatives(
    campaign_id: UUID, body: CreativesBody = CreativesBody(), ctx: AuthCtx = CurrentUser
) -> list[ads_repo.AdCreative]:
    """Generate N ad-copy variants for a campaign via the LLM (no image
    generation — another team owns fal), steered by the campaign's linked
    niche and the user's brand kit when present, and store them."""
    camp = await ads_repo.get_campaign(campaign_id, user_id=ctx.user_id)
    if camp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")

    from marketer.agents.ads_strategist import run_ad_copywriter
    from marketer.repos import brand_kit as brand_kit_repo
    from marketer.repos import niches as niches_repo

    niche_context = ""
    if camp.niche_id is not None:
        niche = await niches_repo.get(camp.niche_id, user_id=ctx.user_id)
        if niche is not None:
            niche_context = (
                f"Niche: {niche.title} — {niche.description}\n"
                f"Audience: {niche.target_audience}"
            )
    brand_context = brand_kit_repo.as_prompt_context(await brand_kit_repo.get(ctx.user_id))

    try:
        batch = await run_ad_copywriter(
            campaign_name=camp.name, objective=camp.objective,
            niche_context=niche_context, brand_context=brand_context, count=body.count,
        )
    except Exception as e:  # noqa: BLE001 — surface as a clean 502
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"could not generate ad copy: {e}"
        ) from e

    return [
        await ads_repo.create_creative(
            user_id=ctx.user_id, campaign_id=camp.id, kind="text",
            headline=v.headline, body=v.body, cta=v.cta,
        )
        for v in batch.variants
    ]


@router.get("/campaigns/{campaign_id}/creatives", response_model=list[ads_repo.AdCreative])
async def list_creatives(
    campaign_id: UUID, ctx: AuthCtx = CurrentUser
) -> list[ads_repo.AdCreative]:
    camp = await ads_repo.get_campaign(campaign_id, user_id=ctx.user_id)
    if camp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")
    return await ads_repo.list_creatives(ctx.user_id, campaign_id=campaign_id)


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    camp = await ads_repo.get_campaign(campaign_id, user_id=ctx.user_id)
    if camp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")
    metrics = await ads_repo.campaign_metrics(campaign_id, user_id=ctx.user_id)
    return {
        "campaign": camp.model_dump(mode="json"),
        "metrics": [m.model_dump(mode="json") for m in metrics],
    }


# --------------------------------------------------------------------------- approvals

@router.get("/approvals", response_model=list[ad_approvals.AdApproval])
async def list_approvals(
    status_filter: str | None = None, ctx: AuthCtx = CurrentUser
) -> list[ad_approvals.AdApproval]:
    return await ad_approvals.list_(user_id=ctx.user_id, status=status_filter)


class DecideBody(BaseModel):
    decision: str  # 'approved' | 'rejected'


@router.post("/approvals/{approval_id}/decide", response_model=ad_approvals.AdApproval)
async def decide_approval(
    approval_id: UUID, body: DecideBody, ctx: AuthCtx = CurrentUser
) -> ad_approvals.AdApproval:
    """Approve or reject a pending spend action. An APPROVED decision is
    immediately executed here — re-guarded at execution time and applied to
    the platform — so "approve" is a single, complete human action rather
    than a decision that silently waits for some other process to run it.
    A failure to execute (denied on re-guard, Composio unconfigured/failed)
    is surfaced as an error; the approval itself stays 'approved' (not
    'executed'), so the human sees the failure and can retry."""
    if body.decision not in {"approved", "rejected"}:
        raise HTTPException(422, "decision must be 'approved' or 'rejected'")
    decided = await ad_approvals.decide(
        approval_id, user_id=ctx.user_id, status=body.decision,
        decided_by=ctx.email or ctx.user_id,
    )
    if decided is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "approval not found or already decided"
        )
    await ad_actions.record(
        user_id=ctx.user_id, actor="user", actor_email=ctx.email,
        action=f"approval.{body.decision}", target_type="ad_approval",
        target_id=str(decided.id), dollar_delta_usd=decided.dollar_delta_usd,
    )
    if body.decision == "approved":
        try:
            if decided.action == "budget.change":
                await execute_approved_budget_change(
                    user_id=ctx.user_id, approval_id=decided.id, actor_email=ctx.email,
                )
            elif decided.action == "campaign.activate":
                await execute_approved_activation(
                    user_id=ctx.user_id, approval_id=decided.id, actor_email=ctx.email,
                )
        except AdSpendDenied as e:
            raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, e.reason) from e
        except AdsDisabled as e:
            raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
        except ComposioCallError as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    return decided


# --------------------------------------------------------------------------- audit + overview

@router.get("/actions", response_model=list[ad_actions.AdActionEntry])
async def list_actions(
    limit: int = 100, ctx: AuthCtx = CurrentUser
) -> list[ad_actions.AdActionEntry]:
    return await ad_actions.list_(user_id=ctx.user_id, limit=min(limit, 500))


@router.get("/overview")
async def overview(ctx: AuthCtx = CurrentUser) -> dict:
    """Ads dashboard summary: spend today / 30d, active campaigns, pending
    approvals. Cheap read-only aggregation across the user's accounts."""
    accounts = await ads_repo.list_accounts(ctx.user_id)
    campaigns = await ads_repo.list_campaigns(ctx.user_id, limit=500)
    today = date.today()
    month_start = today.replace(day=1)

    spend_today = Decimal("0")
    spend_30d = Decimal("0")
    thirty_ago = today - timedelta(days=30)
    for acc in accounts:
        spend_today += await ads_repo.account_spend_on(
            acc.id, user_id=ctx.user_id, day=today
        )
        spend_30d += await ads_repo.account_spend_between(
            acc.id, user_id=ctx.user_id, start=thirty_ago, end=today
        )

    pending = await ad_approvals.list_(user_id=ctx.user_id, status="pending")
    active = [c for c in campaigns if c.status == "active"]
    return {
        "accounts": len(accounts),
        "active_accounts": len([a for a in accounts if a.status == "active"]),
        "campaigns": len(campaigns),
        "active_campaigns": len(active),
        "spend_today_usd": str(spend_today),
        "spend_30d_usd": str(spend_30d),
        "pending_approvals": len(pending),
        "month_start": month_start.isoformat(),
    }
