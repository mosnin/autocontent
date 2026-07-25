"""Zernio connect flow.

POST /api/v1/connect/zernio/{platform}
    Ensure a Zernio profile for the caller, then return the OAuth URL to
    send them to for that platform. Idempotent: an existing profile is
    reused rather than a second one created.

GET /api/v1/connect/zernio/status
    Which accounts this user has connected, reconciled against Zernio.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from marketer.config import settings
from marketer.repos import social_accounts as accounts_repo
from marketer.repos import users as users_repo
from marketer.services import zernio, zernio_profiles

from ..auth import AuthCtx, CurrentUser
from ..rate_limit import limiter

router = APIRouter()
log = logging.getLogger(__name__)


class ZernioConnectResponse(BaseModel):
    profile_id: str
    auth_url: str


class ConnectedAccount(BaseModel):
    platform: str
    username: str
    is_active: bool


class ZernioStatusResponse(BaseModel):
    connected: bool
    profile_id: str | None
    accounts: list[ConnectedAccount]


async def _ensure_profile(ctx: AuthCtx) -> str:
    user = await users_repo.get(ctx.user_id)
    profile_id = user.zernio_profile_id if user else None
    if profile_id:
        return profile_id
    profile_id = await zernio_profiles.create_profile(
        name=ctx.email or ctx.user_id,
        # Stable per user, so a retried create replays rather than making
        # a second profile for the same person.
        idempotency_key=f"marketer-profile-{ctx.user_id}",
    )
    await users_repo.set_zernio_profile_id(ctx.user_id, profile_id)
    return profile_id


@router.post("/zernio/{platform}", response_model=ZernioConnectResponse)
@limiter.limit("5/minute")
async def connect_zernio(
    request: Request, platform: str, ctx: AuthCtx = CurrentUser
) -> ZernioConnectResponse:
    if platform not in zernio.PLATFORM_MAP:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown platform {platform!r}",
        )
    profile_id = await _ensure_profile(ctx)
    redirect_url = f"{settings.app_url.rstrip('/')}/connect" if settings.app_url else ""
    if not redirect_url:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MARKETER_APP_URL must be set for the connect redirect",
        )
    auth_url = await zernio_profiles.connect_url(
        platform=platform, profile_id=profile_id, redirect_url=redirect_url
    )
    return ZernioConnectResponse(profile_id=profile_id, auth_url=auth_url)


@router.get("/zernio/status", response_model=ZernioStatusResponse)
async def connect_zernio_status(ctx: AuthCtx = CurrentUser) -> ZernioStatusResponse:
    user = await users_repo.get(ctx.user_id)
    profile_id = user.zernio_profile_id if user else None
    if not profile_id:
        return ZernioStatusResponse(connected=False, profile_id=None, accounts=[])

    # Reconcile against Zernio. A failure here degrades to our own rows
    # rather than 500ing: a stale-but-present list is far more useful than
    # an error page on the screen where users go to fix connections.
    try:
        remote = await zernio_profiles.list_accounts(profile_id=profile_id)
        rows = await accounts_repo.reconcile(
            user_id=ctx.user_id, zernio_profile_id=profile_id, accounts=remote
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("zernio connect status reconcile failed: %s", exc)
        rows = await accounts_repo.list_for_user(ctx.user_id, active_only=False)

    return ZernioStatusResponse(
        connected=any(a.is_active for a in rows),
        profile_id=profile_id,
        accounts=[
            ConnectedAccount(
                platform=a.platform, username=a.username, is_active=a.is_active
            )
            for a in rows
        ],
    )
