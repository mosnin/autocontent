"""Social scheduling via Ayrshare.

Two-step posting flow against api.ayrshare.com:

  1. POST /api/media/upload    (multipart: file + fileName)
     -> { "id": "...", "url": "https://images.ayrshare.com/.../video.mp4" }
  2. POST /api/post            (JSON: post, platforms, mediaUrls,
                                scheduleDate)
     -> { "status": "scheduled", "id": "<provider post id>", ... }

Each end-user has their own Ayrshare User Profile, identified by the
`profile_key` we stored on `users.ayrshare_profile_key`. Both calls send
it as the `Profile-Key` header so the post lands on that user's
connected socials.

Our internal `platform` values map to Ayrshare platforms:
    "tiktok" -> "tiktok"
    "reels"  -> "instagram"   (mp4 video posts default to Reels)
    "shorts" -> "youtube"     (vertical short mp4 defaults to Shorts)
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings
from ..repos import users as users_repo

BASE_URL = "https://api.ayrshare.com/api"
HTTP_TIMEOUT_SEC = 60.0
MAX_UPLOAD_BYTES = 30 * 1024 * 1024  # Ayrshare's documented limit

PLATFORM_MAP: dict[str, str] = {
    "tiktok": "tiktok",
    "reels":  "instagram",
    "shorts": "youtube",
}


class AyrshareError(RuntimeError):
    pass


def _api_key() -> str:
    if not settings.ayrshare_api_key:
        raise RuntimeError("AUTOCONTENT_AYRSHARE_API_KEY not set")
    return settings.ayrshare_api_key


def _headers(profile_key: str | None) -> dict[str, str]:
    h = {"Authorization": f"Bearer {_api_key()}"}
    if profile_key:
        h["Profile-Key"] = profile_key
    return h


def _format_caption(caption: str, hashtags: list[str]) -> str:
    parts = [caption.strip()]
    if hashtags:
        parts.append(" ".join(f"#{h.lstrip('#')}" for h in hashtags))
    return "\n\n".join(p for p in parts if p)


def _iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type(httpx.HTTPError),
)
async def upload_media(video_path: Path, *, profile_key: str | None = None) -> str:
    size = video_path.stat().st_size
    if size > MAX_UPLOAD_BYTES:
        raise AyrshareError(
            f"{video_path.name} is {size} bytes; Ayrshare upload limit is {MAX_UPLOAD_BYTES}"
        )
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT_SEC) as client:
        with video_path.open("rb") as fp:
            resp = await client.post(
                "/media/upload",
                headers=_headers(profile_key),
                files={"file": (video_path.name, fp, "video/mp4")},
                data={"fileName": video_path.name},
            )
    resp.raise_for_status()
    url = resp.json().get("url")
    if not url:
        raise AyrshareError(f"upload response missing url: {resp.text!r}")
    return url


async def schedule_post(
    *,
    video_path: Path,
    caption: str,
    hashtags: list[str],
    platform: str,
    scheduled_for: datetime,
    user_id: str,
    profile_key: str | None = None,
) -> str:
    """Upload `video_path` and schedule it for `scheduled_for` on the
    given user's Ayrshare profile. Returns the Ayrshare post id."""
    if profile_key is None:
        user = await users_repo.get(user_id)
        profile_key = user.ayrshare_profile_key if user else None
    if not profile_key:
        raise AyrshareError(
            f"user {user_id} has no ayrshare_profile_key; complete connect flow first"
        )

    ayr_platform = PLATFORM_MAP.get(platform)
    if not ayr_platform:
        raise AyrshareError(f"unknown platform {platform!r}")

    media_url = await upload_media(video_path, profile_key=profile_key)

    body = {
        "post": _format_caption(caption, hashtags),
        "platforms": [ayr_platform],
        "mediaUrls": [media_url],
        "scheduleDate": _iso_utc(scheduled_for),
    }

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            "/post",
            headers={**_headers(profile_key), "Content-Type": "application/json"},
            json=body,
        )
    resp.raise_for_status()
    body_out = resp.json()

    if body_out.get("status") not in ("scheduled", "success"):
        raise AyrshareError(f"unexpected response: {body_out!r}")

    post_id = body_out.get("id")
    if not post_id:
        raise AyrshareError(f"schedule response missing id: {body_out!r}")
    return post_id
