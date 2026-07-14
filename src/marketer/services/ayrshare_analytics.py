"""Ayrshare analytics client.

Fetches per-post engagement metrics from the Ayrshare
POST /api/analytics/post endpoint.

Ayrshare's analytics response shape (superset of all platforms):
  {
    "id": "<provider_post_id>",
    "analytics": {
      "tiktok": {
        "views": 1234,
        "likes": 56,
        "comments": 7,
        "shares": 8,
        "saved": 9,
        "videoViews": 1234,           # alias for views on TikTok
        "averageWatchTime": 12.5,     # seconds
        "totalWatchTime": 15432.0,    # seconds
        "completionRate": 0.34,       # 0..1
        "reach": 900,
        "impressions": 1100,
        ...
      },
      "instagram": { ... },           # Reels
      "youtube": { ... }              # Shorts
    }
  }

Different platforms expose different subsets; all fields are optional
downstream. We store raw + parsed nullable columns in post_metrics.
"""
from __future__ import annotations

import httpx

from ..config import settings

BASE_URL = "https://app.ayrshare.com/api"
HTTP_TIMEOUT_SEC = 60.0


class AyrshareAnalyticsError(RuntimeError):
    """Raised on non-200 responses from the Ayrshare analytics endpoint."""


def _api_key() -> str:
    if not settings.ayrshare_api_key:
        raise RuntimeError("MARKETER_AYRSHARE_API_KEY not set")
    return settings.ayrshare_api_key


async def fetch_post_analytics(provider_post_id: str, platforms: list[str]) -> dict:
    """Call Ayrshare's /analytics/post endpoint for a specific posted item.

    ``platforms`` uses our internal names (``'tiktok'``, ``'reels'``,
    ``'shorts'``).  We pass them verbatim to Ayrshare — the analytics
    endpoint accepts the same names as our internal platform values.

    Returns the raw JSON dict. Raises :class:`AyrshareAnalyticsError` on
    4xx / 5xx responses.
    """
    body = {
        "id": provider_post_id,
        "platforms": platforms,
    }
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            "/analytics/post",
            headers={
                "Authorization": f"Bearer {_api_key()}",
                "Content-Type": "application/json",
            },
            json=body,
        )
    if resp.status_code != 200:
        raise AyrshareAnalyticsError(
            f"Ayrshare analytics returned {resp.status_code}: {resp.text!r}"
        )
    return resp.json() or {}
