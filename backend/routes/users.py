from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from marketer.models import User, UserSettingsUpdate

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("/me", response_model=User)
async def me(ctx: AuthCtx = CurrentUser) -> User:
    from marketer.repos import users as users_repo
    return await users_repo.upsert(ctx.user_id, ctx.email)


@router.get("/me/export")
async def export_my_data(ctx: AuthCtx = CurrentUser) -> JSONResponse:
    """GDPR data portability: download everything we hold about you as JSON.
    Personal access tokens are exported by prefix only (never the secret)."""
    from marketer.repos import privacy

    data = await privacy.export_user(ctx.user_id)
    data["exported_at"] = datetime.now(timezone.utc).isoformat()
    return JSONResponse(
        data,
        headers={"Content-Disposition": 'attachment; filename="marketer-export.json"'},
    )


@router.delete("/me", status_code=204)
async def erase_my_account(ctx: AuthCtx = CurrentUser) -> None:
    """GDPR right to erasure: permanently delete the account and all its data
    (niches, jobs, articles, spend history, tokens) via FK cascade. This is
    irreversible; the frontend must confirm before calling."""
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

    from marketer.repos import users as users_repo

    # Only forward fields the client actually sent: the repo's `...`
    # sentinel distinguishes "omitted" from "explicit null". Without this,
    # PATCH {} would silently clear the user's spend-cap safety net.
    kwargs: dict[str, object] = {}
    if "global_daily_cap_usd" in body.model_fields_set:
        kwargs["global_daily_cap_usd"] = body.global_daily_cap_usd
    if "email_notifications" in body.model_fields_set:
        kwargs["email_notifications"] = body.email_notifications

    if not kwargs:
        current = await users_repo.get(ctx.user_id)
        if current is None:
            raise HTTPException(status_code=404, detail="user not found")
        return current

    return await users_repo.update_settings(ctx.user_id, **kwargs)
