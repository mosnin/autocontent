"""Ayrshare User Profile management.

Two calls against api.ayrshare.com using the master API key (no Profile-Key
header — these create / inspect the profile itself):

  1. POST /api/profiles                  body: {"title": "<label>"}
     -> { "profileKey": "...", "refId": "...", ... }
  2. GET  /api/profiles/generateJWT      query: profileKey=<key>
     -> { "url": "https://app.ayrshare.com/connect/...", ... }

The returned `url` is a short-lived OAuth chooser the end user clicks to
link their TikTok / Instagram / YouTube accounts. Once authorized, the
provider OAuth tokens land on the profile identified by `profileKey`.
"""
from __future__ import annotations

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings

BASE_URL = "https://api.ayrshare.com/api"
HTTP_TIMEOUT_SEC = 30.0


class AyrshareProfileError(RuntimeError):
    pass


def _api_key() -> str:
    if not settings.ayrshare_api_key:
        raise RuntimeError("AUTOCONTENT_AYRSHARE_API_KEY not set")
    return settings.ayrshare_api_key


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_api_key()}"}


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type(httpx.HTTPError),
)
async def create_profile(*, title: str) -> tuple[str, str]:
    """Create a new Ayrshare User Profile. Returns (profile_key, ref_id)."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            "/profiles",
            headers={**_headers(), "Content-Type": "application/json"},
            json={"title": title},
        )
    if resp.status_code >= 400:
        raise AyrshareProfileError(
            f"create_profile failed: {resp.status_code} {resp.text!r}"
        )
    body = resp.json()
    profile_key = body.get("profileKey")
    ref_id = body.get("refId")
    if not profile_key or not ref_id:
        raise AyrshareProfileError(
            f"create_profile response missing profileKey/refId: {body!r}"
        )
    return profile_key, ref_id


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type(httpx.HTTPError),
)
async def generate_login_jwt(*, profile_key: str) -> str:
    """Generate a short-lived hosted-OAuth URL for the given profile."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.get(
            "/profiles/generateJWT",
            headers=_headers(),
            params={"profileKey": profile_key},
        )
    if resp.status_code >= 400:
        raise AyrshareProfileError(
            f"generate_login_jwt failed: {resp.status_code} {resp.text!r}"
        )
    body = resp.json()
    url = body.get("url")
    if not url:
        raise AyrshareProfileError(
            f"generate_login_jwt response missing url: {body!r}"
        )
    return url
