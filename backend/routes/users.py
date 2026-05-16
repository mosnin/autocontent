from __future__ import annotations

from fastapi import APIRouter

from autocontent.models import User

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("/me", response_model=User)
async def me(ctx: AuthCtx = CurrentUser) -> User:
    from autocontent.repos import users as users_repo
    return await users_repo.upsert(ctx.user_id, ctx.email)
