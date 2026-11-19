from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from marketer import rails
from marketer.models import User, UserSettingsUpdate
from marketer.rails.http import rails_request_context, to_http

from ..auth import AuthCtx, CurrentUser
from ..policy import require_permission
from ..security import CurrentPerson, user_rate_limit

# update_me dispatches through marketer.rails when it changes the global daily
# cap; the dependency hands it the request's idempotency-key.
router = APIRouter(dependencies=[Depends(rails_request_context)])

# users.global_daily_cap_usd is numeric(10,2).
MAX_GLOBAL_DAILY_CAP_USD = Decimal("1000000")


@router.get("/me", response_model=User)
async def me(ctx: AuthCtx = CurrentUser) -> User:
    """The workspace's tenant row (settings, credit, notifications). Never
    overwrites the stored address with the caller's: a workspace has many
    people."""
    from marketer.repos import users as users_repo
    return await users_repo.ensure(ctx.user_id, ctx.email)


@router.get("/me/export", dependencies=[user_rate_limit("users.export", "5/minute")])
async def export_my_data(ctx: AuthCtx = CurrentPerson) -> JSONResponse:
    """GDPR data portability: download everything we hold about you as JSON.
    Personal access tokens are exported by prefix only (never the secret).
    Person-only: the agent has no use for a full account dump."""
    from marketer.repos import privacy

    data = await privacy.export_user(ctx.user_id)
    data["exported_at"] = datetime.now(timezone.utc).isoformat()
    return JSONResponse(
        data,
        headers={"Content-Disposition": 'attachment; filename="marketer-export.json"'},
    )


@router.delete("/me", status_code=204)
async def erase_my_account(ctx: AuthCtx = CurrentPerson) -> None:
    """GDPR right to erasure: permanently delete the account and all its data
    (niches, jobs, articles, spend history, tokens) via FK cascade. This is
    irreversible; the frontend must confirm before calling. Person-only: the
    agent's delegated auth is refused (403), so a compromised agent or a leaked
    service token cannot erase tenants."""
    from marketer.repos import privacy

    await privacy.erase_user(ctx.user_id)


@router.patch("/me", response_model=User)
async def update_me(
    body: UserSettingsUpdate,
    ctx: AuthCtx = CurrentUser,
) -> User:
    """Update mutable user settings.

    Supports ``global_daily_cap_usd`` (pass ``null`` to clear; negatives are
    rejected with 422) and ``email_notifications`` (opt out of terminal-state
    emails). All fields optional — only keys present in the request are
    changed.
    """
    if (
        body.global_daily_cap_usd is not None
        and body.global_daily_cap_usd < Decimal(0)
    ):
        raise HTTPException(
            status_code=422,
            detail="global_daily_cap_usd must be >= 0",
        )
    if (
        body.global_daily_cap_usd is not None
        and body.global_daily_cap_usd > MAX_GLOBAL_DAILY_CAP_USD
    ):
        raise HTTPException(
            status_code=422,
            detail=f"global_daily_cap_usd must be <= {MAX_GLOBAL_DAILY_CAP_USD}",
        )

    from marketer.repos import users as users_repo

    # Only forward fields the client actually sent: the repo's `...`
    # sentinel distinguishes "omitted" from "explicit null". Without this,
    # PATCH {} would silently clear the user's spend-cap safety net.
    kwargs: dict[str, object] = {}
    if "global_daily_cap_usd" in body.model_fields_set:
        kwargs["global_daily_cap_usd"] = body.global_daily_cap_usd
    if "email_notifications" in body.model_fields_set:
        kwargs["email_notifications"] = body.email_notifications

    # backend/policy.py: InRoute. Each field needs its own permission.
    if "global_daily_cap_usd" in kwargs:
        await require_permission(ctx, "spend:set_limits")
    if "email_notifications" in kwargs:
        await require_permission(ctx, "workspace:update")

    if not kwargs:
        current = await users_repo.get(ctx.user_id)
        if current is None:
            raise HTTPException(status_code=404, detail="user not found")
        return current

    dispatch: rails.Dispatch | None = None
    if "global_daily_cap_usd" in kwargs:
        # The global cap is the account's last spend limit. Raising or
        # removing it is HIGH and goes through the enforcement point; so does
        # lowering it (recorded, never blocked by a kill switch). Judged
        # against the stored value read now.
        current = await users_repo.get(ctx.user_id)
        if current is None:
            raise HTTPException(status_code=404, detail="user not found")
        old_cap, new_cap = current.global_daily_cap_usd, body.global_daily_cap_usd
        if new_cap != old_cap:
            loosens = new_cap is None or (old_cap is not None and new_cap > old_cap)
            if loosens and ctx.delegated:
                # ADR 0002: the agent may tighten, never loosen. The account's
                # global cap is the limit a person set over everything the
                # agent does; only that person raises or removes it.
                raise HTTPException(
                    status_code=403,
                    detail="only a person can raise or remove the global daily cap",
                )
            try:
                dispatch = await rails.enforce_dispatch(
                    "account.spend_cap.raise" if loosens else "account.spend_cap.lower",
                    user_id=ctx.user_id, principal=rails.principal_of(ctx),
                    actor_email=ctx.email,
                    args={"global_daily_cap_usd": new_cap, "previous_global_daily_cap_usd": old_cap},
                    target_type="user", target_id=ctx.user_id,
                )
            except rails.RailsDenied as e:
                raise to_http(e) from e

    try:
        updated = await users_repo.update_settings(ctx.user_id, **kwargs)
    except Exception as e:
        if dispatch is not None:
            await dispatch.failed(f"{type(e).__name__}: {e}")
        raise
    if dispatch is not None:
        await dispatch.succeeded()
    return updated
