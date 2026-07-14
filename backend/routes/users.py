from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException

from marketer.models import User, UserSettingsUpdate

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("/me", response_model=User)
async def me(ctx: AuthCtx = CurrentUser) -> User:
    from marketer.repos import users as users_repo
    return await users_repo.upsert(ctx.user_id, ctx.email)


@router.patch("/me", response_model=User)
async def update_me(
    body: UserSettingsUpdate,
    ctx: AuthCtx = CurrentUser,
) -> User:
    """Update mutable user settings.

    Currently supports ``global_daily_cap_usd`` only. Pass ``null`` to
    clear an existing cap. Rejects negative values with 422.
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
    if "global_daily_cap_usd" not in body.model_fields_set:
        from marketer.repos.users import get as get_user

        current = await get_user(ctx.user_id)
        if current is None:
            raise HTTPException(status_code=404, detail="user not found")
        return current

    updated = await users_repo.update_settings(
        ctx.user_id,
        global_daily_cap_usd=body.global_daily_cap_usd,
    )
    return updated
