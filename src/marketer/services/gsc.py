"""Google Search Console — OAuth (authorization code + refresh) and the
Search Analytics API, talked to directly over httpx. No ``google-api-python-
client`` / ``google-auth`` dependency: the OAuth surface we need (code
exchange, refresh, one REST endpoint) is small enough that pulling in the
SDK would cost more than it saves.

Design rules mirror ``composio_client.py``:
- **Config-gated.** ``MARKETER_GOOGLE_OAUTH_CLIENT_ID`` /
  ``MARKETER_GOOGLE_OAUTH_CLIENT_SECRET`` unset -> every entry point raises
  ``GscDisabled``, fail-closed, never a partial/garbled call to Google.
- **Thin + mockable.** All network calls funnel through the functions here;
  tests monkeypatch ``httpx.AsyncClient`` with a ``MockTransport``, so no
  real Google call is ever made in CI.

Stateless CSRF state
---------------------
The OAuth callback (``GET /callback``) is a top-level browser navigation
initiated by Google — it carries no ``Authorization`` header, so identity
can't ride on the usual bearer-token auth. Instead ``sign_state`` embeds the
initiating user_id (plus an expiry) in the ``state`` param and HMAC-signs it
with the OAuth client secret; ``verify_state`` checks the signature and
expiry before trusting the payload. No server-side session/cookie storage
needed, and a tampered or replayed-after-expiry state is rejected outright.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from dataclasses import dataclass
from urllib.parse import quote, urlencode

import httpx

from ..config import settings

TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SITES_URL = "https://www.googleapis.com/webmasters/v3/sites"
_SEARCH_ANALYTICS_URL = "https://www.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query"

# Read-only scope — we only ever pull analytics, never mutate a property.
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"

_HTTP_TIMEOUT = 20.0
# How long a signed `state` is valid for — the user has this long to complete
# the Google consent screen after hitting GET /connect.
_STATE_TTL_SEC = 600


class GscDisabled(RuntimeError):
    """Raised when a GSC operation is attempted while the feature is
    unconfigured (no OAuth client id/secret). Callers surface this as a
    clean 4xx, never a 500."""


class GscApiError(RuntimeError):
    """The feature IS configured but a specific Google call failed (bad
    code, expired/revoked refresh token, non-2xx Search Analytics response,
    a tampered/expired state, ...). Distinct from GscDisabled."""


def is_enabled() -> bool:
    return bool(settings.google_oauth_client_id and settings.google_oauth_client_secret)


def _require_enabled() -> None:
    if not is_enabled():
        raise GscDisabled(
            "Google Search Console is not configured — set "
            "MARKETER_GOOGLE_OAUTH_CLIENT_ID / MARKETER_GOOGLE_OAUTH_CLIENT_SECRET."
        )


# --------------------------------------------------------------------------- state (CSRF)

@dataclass(frozen=True)
class StatePayload:
    user_id: str
    return_to: str = ""


def sign_state(*, user_id: str, return_to: str = "") -> str:
    """Build a signed, tamper-proof ``state`` value carrying *user_id* through
    the Google redirect round trip. Format: ``<b64 payload>.<hex hmac>``."""
    _require_enabled()
    payload = f"{user_id}:{int(time.time()) + _STATE_TTL_SEC}:{return_to}"
    b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    sig = _sign(b64)
    return f"{b64}.{sig}"


def verify_state(state: str) -> StatePayload:
    """Validate a signed state produced by :func:`sign_state`. Raises
    ``GscApiError`` on any tamper, malformed input, or expiry — never
    returns a payload that wasn't produced (and unexpired) by us."""
    _require_enabled()
    try:
        b64, sig = state.split(".", 1)
    except ValueError as e:
        raise GscApiError("malformed state") from e
    if not hmac.compare_digest(sig, _sign(b64)):
        raise GscApiError("invalid state signature")
    try:
        padded = b64 + "=" * (-len(b64) % 4)
        payload = base64.urlsafe_b64decode(padded.encode()).decode()
        user_id, expiry_s, return_to = payload.split(":", 2)
    except (ValueError, UnicodeDecodeError) as e:
        raise GscApiError("malformed state payload") from e
    if not user_id or int(expiry_s) < int(time.time()):
        raise GscApiError("state expired")
    return StatePayload(user_id=user_id, return_to=return_to)


def _sign(b64_payload: str) -> str:
    return hmac.new(
        settings.google_oauth_client_secret.encode(), b64_payload.encode(), hashlib.sha256
    ).hexdigest()


# --------------------------------------------------------------------------- authorize URL

def authorize_url(*, redirect_uri: str, state: str) -> str:
    """The URL to send the user to for the Search Console consent screen.
    ``access_type=offline`` + ``prompt=consent`` so a refresh_token is
    reliably issued even on a re-connect."""
    _require_enabled()
    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


# --------------------------------------------------------------------------- token exchange/refresh

@dataclass(frozen=True)
class TokenSet:
    access_token: str
    refresh_token: str  # "" on a refresh response — Google only issues it once
    expires_in: int


async def exchange_code(*, code: str, redirect_uri: str) -> TokenSet:
    """Exchange an OAuth authorization code for an access+refresh token
    pair. Raises GscApiError if Google rejects the code or omits a
    refresh_token (which would leave us with a connection we can never
    refresh)."""
    _require_enabled()
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if resp.status_code >= 400:
        raise GscApiError(f"token exchange failed: {resp.status_code} {resp.text!r}")
    body = resp.json()
    access_token = body.get("access_token")
    refresh_token = body.get("refresh_token")
    if not access_token or not refresh_token:
        raise GscApiError(
            f"token exchange missing access_token/refresh_token: {body!r}"
        )
    return TokenSet(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=int(body.get("expires_in") or 3600),
    )


async def refresh_access_token(*, refresh_token: str) -> TokenSet:
    """Exchange a refresh_token for a fresh access_token. Google normally
    omits ``refresh_token`` on this response — the caller keeps using the
    one it already has unless a new one is (rarely) issued."""
    _require_enabled()
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "grant_type": "refresh_token",
            },
        )
    if resp.status_code >= 400:
        raise GscApiError(f"token refresh failed: {resp.status_code} {resp.text!r}")
    body = resp.json()
    access_token = body.get("access_token")
    if not access_token:
        raise GscApiError(f"token refresh missing access_token: {body!r}")
    return TokenSet(
        access_token=access_token,
        refresh_token=body.get("refresh_token") or "",
        expires_in=int(body.get("expires_in") or 3600),
    )


# --------------------------------------------------------------------------- Search Analytics + sites

async def list_sites(*, access_token: str) -> list[dict]:
    """GSC properties the connected account has access to. Returns Google's
    raw ``siteEntry`` list (``siteUrl``, ``permissionLevel``)."""
    _require_enabled()
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(
            SITES_URL, headers={"Authorization": f"Bearer {access_token}"}
        )
    if resp.status_code >= 400:
        raise GscApiError(f"sites list failed: {resp.status_code} {resp.text!r}")
    return resp.json().get("siteEntry") or []


async def query_search_analytics(
    *,
    access_token: str,
    site_url: str,
    start_date: str,
    end_date: str,
    dimensions: list[str],
    row_limit: int = 1000,
) -> list[dict]:
    """POST ``searchAnalytics/query`` for *dimensions* (e.g. ``["date",
    "query", "page"]``) over ``[start_date, end_date]`` (YYYY-MM-DD,
    inclusive). Returns Google's raw ``rows`` list — each row has ``keys``
    positionally aligned to *dimensions* plus clicks/impressions/ctr/
    position — or ``[]`` when there's no data."""
    _require_enabled()
    url = _SEARCH_ANALYTICS_URL.format(site=quote(site_url, safe=""))
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={
                "startDate": start_date,
                "endDate": end_date,
                "dimensions": dimensions,
                "rowLimit": row_limit,
            },
        )
    if resp.status_code >= 400:
        raise GscApiError(
            f"searchAnalytics query failed: {resp.status_code} {resp.text!r}"
        )
    return resp.json().get("rows") or []
