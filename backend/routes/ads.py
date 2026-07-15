"""Ads REST surface: connected accounts, governance, campaigns (read),
approvals, and the action log. Spend-affecting mutations flow through the
safe-execute layer (added in a later phase); this module exposes the read/
manage surface plus the OAuth connect flow.

Every route is user_id-scoped. Composio calls can raise AdsDisabled, which we
surface as 409 (feature off / not configured), never a 500.
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
from marketer.services.composio_client import AdsDisabled

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
