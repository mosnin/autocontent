"""Zernio analytics client.

``GET /v1/analytics?postId=<id>`` returns per-post engagement. Two response
codes are not failures and must not be treated as one:

* **202** — Zernio is still syncing that post from the platform. The right
  response is "ask again later", not "this post has no metrics". Recording
  zeros here would poison the time series with a fabricated data point at
  the moment a post is newest and most interesting.
* **424** — every platform failed to sync it. Terminal for this attempt,
  but distinct from a transport error: retrying immediately will not help.

Both surface as typed results rather than exceptions so the daily sync can
skip and move on without one pending post killing the loop.

The response is normalized into the same shape the Ayrshare client
produced — ``{"id": ..., "analytics": {<platform>: {...}}}`` — so
``post_metrics`` parsing is untouched by the provider swap.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..config import settings
from ..logging import get_logger
from .zernio import BASE_URL, PLATFORM_MAP, ZernioError

log = get_logger(__name__)

HTTP_TIMEOUT_SEC = 60.0

# Zernio platform name -> our internal name, for normalizing the response.
_TO_INTERNAL = {v: k for k, v in PLATFORM_MAP.items()}


class AnalyticsPending(ZernioError):
    """Zernio is still syncing this post (HTTP 202). Try again later."""


class AnalyticsUnavailable(ZernioError):
    """Every platform failed to sync this post (HTTP 424)."""


def _headers() -> dict[str, str]:
    if not settings.zernio_api_key:
        raise ZernioError("MARKETER_ZERNIO_API_KEY is not set")
    return {"Authorization": f"Bearer {settings.zernio_api_key}"}


def _normalize(payload: dict[str, Any]) -> dict[str, Any]:
    """Reshape Zernio's per-post response into ``{id, analytics: {platform}}``.

    Zernio reports per-platform results under ``platforms``; anything we do
    not publish to is dropped rather than stored under a name the metrics
    parser does not know.
    """
    analytics: dict[str, Any] = {}
    for entry in payload.get("platforms") or []:
        if not isinstance(entry, dict):
            continue
        internal = _TO_INTERNAL.get(entry.get("platform"))
        if internal is None:
            continue
        metrics = entry.get("metrics")
        analytics[internal] = metrics if isinstance(metrics, dict) else {}
    return {
        "id": payload.get("postId") or payload.get("_id") or "",
        "analytics": analytics,
    }


async def fetch_post_analytics(provider_post_id: str, platforms: list[str]) -> dict:
    """Metrics for one post, normalized.

    ``platforms`` is accepted for signature parity with the Ayrshare client
    (the caller passes our internal names); Zernio resolves platforms from
    the post itself, so it is not sent.

    Raises ``AnalyticsPending`` (202) or ``AnalyticsUnavailable`` (424) —
    both meaning "no metrics yet", for different reasons the caller may
    want to log differently.
    """
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.get(
            f"{BASE_URL}/analytics",
            headers=_headers(),
            params={"postId": provider_post_id},
        )

    if resp.status_code == 202:
        raise AnalyticsPending(f"analytics still syncing for {provider_post_id}")
    if resp.status_code == 424:
        raise AnalyticsUnavailable(
            f"every platform failed to sync analytics for {provider_post_id}"
        )
    if resp.status_code >= 400:
        raise ZernioError(
            f"analytics returned {resp.status_code}: {resp.text!r}"
        )
    return _normalize(resp.json() or {})
