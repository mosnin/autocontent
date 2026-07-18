"""Admin API — privileged, cross-tenant, fully audited.

Every route depends on `require_admin` (RBAC) and records exactly one
append-only audit entry describing the action, target, and request
context. Read routes audit as `*.view`; mutations audit before returning.
SOC2 posture: least privilege (role gate), complete audit trail
(CC7.2), and no silent cross-tenant access.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.repos import admin as admin_repo
from marketer.repos import admin_audit
from marketer.repos import feature_flags as flags_repo

from ..auth import AdminCtx, CurrentAdmin

router = APIRouter()


async def _audit(
    ctx: AdminCtx,
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    await admin_audit.record(
        actor_id=ctx.user_id,
        actor_email=ctx.email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        ip=ctx.ip,
        user_agent=ctx.user_agent,
        metadata=metadata,
    )


# --------------------------------------------------------------------------- overview

@router.get("/overview", response_model=admin_repo.PlatformOverview)
async def overview(ctx: AdminCtx = CurrentAdmin) -> admin_repo.PlatformOverview:
    result = await admin_repo.overview()
    await _audit(ctx, "overview.view", target_type="system")
    return result


# --------------------------------------------------------------------------- users

@router.get("/users", response_model=list[admin_repo.AdminUserRow])
async def list_users(
    ctx: AdminCtx = CurrentAdmin,
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[admin_repo.AdminUserRow]:
    rows = await admin_repo.list_users(query=q, limit=limit, offset=offset)
    await _audit(ctx, "users.list", target_type="system", metadata={"q": q or "", "count": len(rows)})
    return rows


@router.get("/users/{user_id}", response_model=admin_repo.AdminUserRow)
async def get_user(user_id: str, ctx: AdminCtx = CurrentAdmin) -> admin_repo.AdminUserRow:
    row = await admin_repo.get_user(user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    await _audit(ctx, "user.view", target_type="user", target_id=user_id)
    return row


class SuspendBody(BaseModel):
    suspended: bool
    reason: str = Field(default="", max_length=500)


@router.post("/users/{user_id}/suspension", response_model=admin_repo.AdminUserRow)
async def set_suspension(
    user_id: str, body: SuspendBody, ctx: AdminCtx = CurrentAdmin
) -> admin_repo.AdminUserRow:
    if user_id == ctx.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot suspend yourself")
    ok = await admin_repo.set_suspended(user_id, suspended=body.suspended, reason=body.reason)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    await _audit(
        ctx,
        "user.suspend" if body.suspended else "user.unsuspend",
        target_type="user", target_id=user_id, metadata={"reason": body.reason},
    )
    row = await admin_repo.get_user(user_id)
    assert row is not None
    return row


class RoleBody(BaseModel):
    role: str  # 'user' | 'admin'


@router.post("/users/{user_id}/role", response_model=admin_repo.AdminUserRow)
async def set_role(user_id: str, body: RoleBody, ctx: AdminCtx = CurrentAdmin) -> admin_repo.AdminUserRow:
    if body.role not in ("user", "admin"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "role must be user|admin")
    if user_id == ctx.user_id and body.role != "admin":
        # Prevent an admin from accidentally locking the whole org out by
        # demoting themselves; another admin must do it.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot demote yourself")
    ok = await admin_repo.set_role(user_id, body.role)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    await _audit(ctx, "user.role", target_type="user", target_id=user_id, metadata={"role": body.role})
    row = await admin_repo.get_user(user_id)
    assert row is not None
    return row


class GrantBody(BaseModel):
    amount_usd: Decimal = Field(gt=0, le=Decimal("10000"))
    note: str = Field(default="", max_length=500)


@router.post("/users/{user_id}/credits")
async def grant_credits(user_id: str, body: GrantBody, ctx: AdminCtx = CurrentAdmin) -> dict:
    try:
        new_balance = await admin_repo.grant_credit(user_id, body.amount_usd)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found") from None
    await _audit(
        ctx, "credits.grant", target_type="user", target_id=user_id,
        metadata={"amount_usd": str(body.amount_usd), "note": body.note},
    )
    return {"user_id": user_id, "new_balance_usd": str(new_balance)}


# --------------------------------------------------------------------------- feature flags

@router.get("/flags", response_model=list[flags_repo.FeatureFlag])
async def list_flags(ctx: AdminCtx = CurrentAdmin) -> list[flags_repo.FeatureFlag]:
    return await flags_repo.list_all()


class FlagBody(BaseModel):
    enabled: bool
    description: str = Field(default="", max_length=500)


@router.put("/flags/{key}", response_model=flags_repo.FeatureFlag)
async def upsert_flag(key: str, body: FlagBody, ctx: AdminCtx = CurrentAdmin) -> flags_repo.FeatureFlag:
    if not key or len(key) > 100:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid flag key")
    flag = await flags_repo.upsert(
        key, enabled=body.enabled, description=body.description, updated_by=ctx.user_id
    )
    await _audit(
        ctx, "flag.set", target_type="flag", target_id=key,
        metadata={"enabled": body.enabled},
    )
    return flag


# --------------------------------------------------------------------------- system health

@router.get("/health")
async def system_health(ctx: AdminCtx = CurrentAdmin) -> dict:
    """Operational snapshot: DB reachability + recent failure/skew signals.
    Read-only; audited as a view."""
    from marketer.db import get_pool

    pool = await get_pool()
    db_ok = True
    try:
        await pool.fetchval("select 1")
    except Exception:  # noqa: BLE001
        db_ok = False

    stuck = await pool.fetchval(
        """
        select count(*) from jobs
         where status not in ('done', 'failed', 'skipped', 'awaiting_approval')
           and updated_at < now() - interval '2 hours'
        """
    ) if db_ok else None
    failed_24h = await pool.fetchval(
        "select count(*) from jobs where status = 'failed' and created_at >= now() - interval '24 hours'"
    ) if db_ok else None

    await _audit(ctx, "health.view", target_type="system")
    return {"db_ok": db_ok, "stuck_jobs": stuck, "failed_jobs_24h": failed_24h}


# --------------------------------------------------------------------------- integrations

class IntegrationStatus(BaseModel):
    """Presence-only status for one provider. Never carries the key value."""

    configured: bool


class IntegrationsStatus(BaseModel):
    """Go-live checklist: which provider keys are set, booleans only.

    Every field is derived from `marketer.config.settings`; no secret value
    is ever read into a response.
    """

    openai: IntegrationStatus
    xai: IntegrationStatus
    ayrshare: IntegrationStatus
    pixabay: IntegrationStatus
    exa: IntegrationStatus
    fal: IntegrationStatus
    composio: IntegrationStatus
    google_oauth: IntegrationStatus
    resend: IntegrationStatus
    stripe: IntegrationStatus
    inngest: IntegrationStatus
    sentry: IntegrationStatus

    # Master flags that gate whole products/features regardless of keys.
    ads_enabled: bool
    billing_enabled: bool
    press_autopilot_enabled: bool
    newsletters_enabled: bool
    x402_enabled: bool


@router.get("/integrations", response_model=IntegrationsStatus)
async def integrations_status(ctx: AdminCtx = CurrentAdmin) -> IntegrationsStatus:
    """Read-only go-live checklist: presence booleans for every external
    provider key plus the master feature flags, so an operator can see at a
    glance what still needs to be configured before flipping a flag on."""
    from marketer.config import settings

    def present(value: str) -> IntegrationStatus:
        return IntegrationStatus(configured=bool(value))

    result = IntegrationsStatus(
        openai=present(settings.openai_api_key),
        xai=present(settings.xai_api_key),
        ayrshare=present(settings.ayrshare_api_key),
        pixabay=present(settings.pixabay_api_key),
        exa=present(settings.exa_api_key),
        fal=present(settings.fal_api_key),
        composio=present(settings.composio_api_key),
        google_oauth=IntegrationStatus(
            configured=bool(
                settings.google_oauth_client_id and settings.google_oauth_client_secret
            )
        ),
        resend=present(settings.resend_api_key),
        stripe=present(settings.stripe_secret_key),
        inngest=IntegrationStatus(
            configured=bool(settings.inngest_signing_key and settings.inngest_event_key)
        ),
        sentry=present(settings.sentry_dsn),
        ads_enabled=settings.ads_enabled,
        billing_enabled=settings.billing_enabled,
        press_autopilot_enabled=settings.press_autopilot_enabled,
        newsletters_enabled=settings.newsletters_enabled,
        x402_enabled=settings.x402_enabled,
    )
    await _audit(ctx, "integrations.view", target_type="system")
    return result


# --------------------------------------------------------------------------- audit log

@router.get("/audit-log", response_model=list[admin_audit.AuditEntry])
async def audit_log(
    ctx: AdminCtx = CurrentAdmin,
    actor_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    action: str | None = None,
    before_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[admin_audit.AuditEntry]:
    # Reading the audit trail is itself audited (who looked at what).
    entries = await admin_audit.list_(
        actor_id=actor_id, target_type=target_type, target_id=target_id,
        action=action, before_id=before_id, limit=limit,
    )
    await _audit(ctx, "audit.view", target_type="system")
    return entries
