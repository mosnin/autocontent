"""Ayrshare connect flow.

POST /api/v1/connect/ayrshare
    Idempotent. If the caller already has a profile_key, returns it
    along with a fresh short-lived login URL. Otherwise creates an
    Ayrshare User Profile, persists the key on the users row, then
    returns the new key + login URL.

GET /api/v1/connect/ayrshare/status
    Cheap read for the UI on page load. Returns whether the user has
    a profile_key on file (we don't introspect Ayrshare itself here).
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from autocontent.repos import users as users_repo
from autocontent.services import ayrshare_profiles

from ..auth import AuthCtx, CurrentUser
from ..rate_limit import limiter

router = APIRouter()


class ConnectResponse(BaseModel):
    profile_key: str
    login_url: str


class ConnectStatusResponse(BaseModel):
    connected: bool
    profile_key: str | None


@router.post("/ayrshare", response_model=ConnectResponse)
@limiter.limit("5/minute")
async def connect_ayrshare(request: Request, ctx: AuthCtx = CurrentUser) -> ConnectResponse:
    user = await users_repo.get(ctx.user_id)
    profile_key = user.ayrshare_profile_key if user else None

    if not profile_key:
        title = ctx.email or ctx.user_id
        profile_key, _ref_id = await ayrshare_profiles.create_profile(title=title)
        await users_repo.set_ayrshare_profile_key(ctx.user_id, profile_key)

    login_url = await ayrshare_profiles.generate_login_jwt(profile_key=profile_key)
    return ConnectResponse(profile_key=profile_key, login_url=login_url)


@router.get("/ayrshare/status", response_model=ConnectStatusResponse)
async def connect_ayrshare_status(ctx: AuthCtx = CurrentUser) -> ConnectStatusResponse:
    user = await users_repo.get(ctx.user_id)
    key = user.ayrshare_profile_key if user else None
    return ConnectStatusResponse(connected=bool(key), profile_key=key)
