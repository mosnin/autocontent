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


class AyrshareRejected(AyrshareError):
    """Definitive client error — this attempt will never succeed.

    Callers must rotate the idempotency key before a later retry, or
    Ayrshare will keep refusing the same key even after a validation
    failure (their keys survive error / pending / deleted states).
    """


class AyrshareDuplicate(AyrshareError):
    """Same idempotencyKey was already accepted for this profile.

    The original /post likely succeeded (or was accepted) and the
    caller lost the response — typically an HTTP timeout. `post_id`
    is the existing Ayrshare id when the error body includes one.
    """

    def __init__(self, message: str, post_id: str | None = None) -> None:
        super().__init__(message)
        self.post_id = post_id


_DUPLICATE_MARKERS = ("idempotency", "duplicate key", "duplicate idempot")


def _api_key() -> str:
    if not settings.ayrshare_api_key:
        raise RuntimeError("MARKETER_AYRSHARE_API_KEY not set")
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


def _is_duplicate_response(body: dict, text: str) -> bool:
    blob = f"{body.get('message', '')} {body.get('status', '')} {text}".lower()
    return any(marker in blob for marker in _DUPLICATE_MARKERS)


def _extract_post_id(body: dict) -> str | None:
    post_id = body.get("id")
    if post_id:
        return str(post_id)
    for key in ("postId", "post_id"):
        if body.get(key):
            return str(body[key])
    return None


async def _submit_post(body: dict, *, profile_key: str | None) -> str:
    """POST /post and classify the outcome.

    Duplicate idempotencyKey → AyrshareDuplicate (safe to treat as
    already-scheduled). Other 4xx / status=error → AyrshareRejected
    (rotate the key). 5xx / transport errors propagate as HTTPError
    so the caller keeps the same key and can retry the same attempt.
    """
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            "/post",
            headers={**_headers(profile_key), "Content-Type": "application/json"},
            json=body,
        )
    try:
        body_out = resp.json()
    except ValueError:
        body_out = {}
    text = resp.text[:500]
    if _is_duplicate_response(body_out if isinstance(body_out, dict) else {}, text):
        raise AyrshareDuplicate(
            f"duplicate idempotency key: {text!r}",
            post_id=_extract_post_id(body_out) if isinstance(body_out, dict) else None,
        )
    if resp.status_code >= 500:
        resp.raise_for_status()
    if resp.status_code >= 400:
        raise AyrshareRejected(f"ayrshare rejected post ({resp.status_code}): {text!r}")
    if not isinstance(body_out, dict):
        raise AyrshareError(f"unexpected response: {text!r}")
    if body_out.get("status") not in ("scheduled", "success"):
        raise AyrshareRejected(f"unexpected response: {body_out!r}")
    post_id = _extract_post_id(body_out)
    if not post_id:
        raise AyrshareError(f"schedule response missing id: {body_out!r}")
    return post_id


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
            import mimetypes

            mime = mimetypes.guess_type(video_path.name)[0] or "video/mp4"
            resp = await client.post(
                "/media/upload",
                headers=_headers(profile_key),
                files={"file": (video_path.name, fp, mime)},
                data={"fileName": video_path.name},
            )
    resp.raise_for_status()
    url = resp.json().get("url")
    if not url:
        raise AyrshareError(f"upload response missing url: {resp.text!r}")
    return url


async def schedule_image_post(
    *,
    image_paths: list[Path],
    caption: str,
    hashtags: list[str],
    platform: str,
    scheduled_for: datetime,
    user_id: str,
    profile_key: str | None = None,
    idempotency_key: str | None = None,
) -> str:
    """Upload every slide and schedule one multi-image post (a carousel
    on platforms that support it). Returns the Ayrshare post id."""
    if not image_paths:
        raise AyrshareError("no images to post")
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

    media_urls = [
        await upload_media(p, profile_key=profile_key) for p in image_paths
    ]
    body = {
        "post": _format_caption(caption, hashtags),
        "platforms": [ayr_platform],
        "mediaUrls": media_urls,
        "scheduleDate": _iso_utc(scheduled_for),
    }
    if idempotency_key:
        body["idempotencyKey"] = idempotency_key
    from ..repos import feature_flags as flags_repo

    if not await flags_repo.allowed("publish"):
        raise AyrshareRejected("feature 'publish' is disabled")
    return await _submit_post(body, profile_key=profile_key)


async def schedule_post(
    *,
    video_path: Path,
    caption: str,
    hashtags: list[str],
    platform: str,
    scheduled_for: datetime,
    user_id: str,
    profile_key: str | None = None,
    idempotency_key: str | None = None,
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
    if idempotency_key:
        body["idempotencyKey"] = idempotency_key

    from ..repos import feature_flags as flags_repo

    if not await flags_repo.allowed("publish"):
        raise AyrshareRejected("feature 'publish' is disabled")
    return await _submit_post(body, profile_key=profile_key)
