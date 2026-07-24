"""Zernio profile + account connection (the multi-tenant onboarding half).

Three calls against ``https://zernio.com/api/v1`` with the team API key:

  1. POST /v1/profiles                       {"name": "<label>"}
     -> { "profile": { "_id": ... } }          one profile per end user
  2. GET  /v1/connect/{platform}?profileId=…&redirect_url=…
     -> { "authUrl": "..." }                   redirect the user's browser
  3. GET  /v1/accounts?profileId=…
     -> { "accounts": [ { "_id", "platform", "username", "isActive" } ] }

The profile is created once and stored on ``users.zernio_profile_id``.
Connecting is per platform: the user is sent to ``authUrl``, authorizes on
the platform, and Zernio fires an ``account.connected`` webhook carrying
both ``accountId`` and ``profileId`` — which is the mapping we persist.

Reconciliation matters here. Webhooks are at-least-once and can be missed
entirely, so ``list_accounts`` exists as the safety net: the connect status
endpoint reconciles our ``social_accounts`` rows against Zernio's truth
rather than trusting that every webhook arrived.
"""
from __future__ import annotations

from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings
from .zernio import BASE_URL, PLATFORM_MAP, ZernioError

HTTP_TIMEOUT_SEC = 30.0

_transient = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
)


def _headers(**extra: str) -> dict[str, str]:
    if not settings.zernio_api_key:
        raise ZernioError("MARKETER_ZERNIO_API_KEY is not set")
    return {"Authorization": f"Bearer {settings.zernio_api_key}", **extra}


@_transient
async def create_profile(*, name: str, idempotency_key: str) -> str:
    """Create one end user's profile; returns its id.

    ``idempotency_key`` makes the create safe to retry: Zernio replays the
    original 201 for the same key and body. A duplicate *name* returns 409
    carrying the existing id, which we accept rather than fail on — a user
    who already has a profile does not need a second one.
    """
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            f"{BASE_URL}/profiles",
            headers=_headers(**{
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key,
            }),
            json={"name": name},
        )

    if resp.status_code == 409:
        body: dict[str, Any] = resp.json() if resp.content else {}
        existing = (body.get("details") or {}).get("existingProfileId")
        if existing:
            return existing
        raise ZernioError(f"profile name conflict with no id: {resp.text!r}")
    if resp.status_code >= 400:
        raise ZernioError(f"create_profile failed: {resp.status_code} {resp.text!r}")

    body = resp.json()
    profile_id = (body.get("profile") or {}).get("_id")
    if not profile_id:
        raise ZernioError(f"create_profile response missing profile._id: {body!r}")
    return profile_id


@_transient
async def connect_url(
    *, platform: str, profile_id: str, redirect_url: str
) -> str:
    """Start the OAuth flow for one platform, scoped to one profile.

    ``platform`` is OUR name ("tiktok" / "reels" / "shorts"); it is mapped
    to Zernio's before the call so a caller cannot accidentally connect an
    account to a platform we cannot publish to.
    """
    zernio_platform = PLATFORM_MAP.get(platform, platform)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.get(
            f"{BASE_URL}/connect/{zernio_platform}",
            headers=_headers(),
            params={"profileId": profile_id, "redirect_url": redirect_url},
        )
    if resp.status_code >= 400:
        raise ZernioError(f"connect_url failed: {resp.status_code} {resp.text!r}")
    body = resp.json()
    auth_url = body.get("authUrl")
    if not auth_url:
        raise ZernioError(f"connect response missing authUrl: {body!r}")
    return auth_url


@_transient
async def list_accounts(*, profile_id: str) -> list[dict[str, Any]]:
    """Every account connected to one profile, as Zernio sees it.

    This is the reconciliation source: a missed ``account.connected``
    webhook means our table is stale, and only asking Zernio can fix that.
    """
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.get(
            f"{BASE_URL}/accounts",
            headers=_headers(),
            params={"profileId": profile_id},
        )
    if resp.status_code >= 400:
        raise ZernioError(f"list_accounts failed: {resp.status_code} {resp.text!r}")
    body = resp.json()
    accounts = body.get("accounts")
    if not isinstance(accounts, list):
        raise ZernioError(f"accounts response missing list: {body!r}")
    return accounts
