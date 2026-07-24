"""Social publishing via Zernio (multi-tenant).

Replaces the Ayrshare integration. The shape is different in one way that
matters, so it is worth stating up front:

* Ayrshare scoped every call with a per-user ``Profile-Key`` header, so
  "which user's accounts" was implicit in the transport.
* Zernio addresses **accounts by id in the request body**. Profiles are an
  organizational boundary above accounts, and — per Zernio's own docs —
  ``accountId`` is validated against the whole team, *not* against a
  profile. Passing one tenant another tenant's account id would publish to
  the wrong customer's socials and Zernio would accept it.

Which is why account ownership lives in OUR database
(``repos.social_accounts``), scoped by ``user_id``, and every publish here
takes account ids that were already looked up under the caller's user id.
This module never resolves accounts itself.

Posting flow (docs.zernio.com)
------------------------------
  1. POST /v1/media/presign  {filename, contentType, size}
     -> { uploadUrl, publicUrl, key, expiresIn }
  2. PUT <uploadUrl> with the file bytes           (expires in 1 hour)
  3. POST /v1/posts  { content, mediaItems, platforms, scheduledFor }
     -> 201 { post: { _id, ... } }

Idempotency
-----------
Zernio applies two independent guards, and we use both deliberately:

* ``x-request-id`` (~5 min): a repeat with the same id returns the ORIGINAL
  post with HTTP 200 instead of creating a second one. We derive it from
  the caller's own stable id (job id, image-post id) rather than a random
  UUID, so a Modal retry of the same unit of work is recognised as a retry.
  A random id per call — which the official SDKs generate — would defeat
  exactly the case we need it for.
* Content-hash dedup (24h): identical content to the same account inside a
  day is rejected with 409. That is a *correct* refusal for us — it means
  the post already exists — so ``DuplicatePost`` carries the existing post
  id and callers treat it as success rather than retrying into a loop.

Our internal platform names map onto Zernio's:
    "tiktok" -> "tiktok"
    "reels"  -> "instagram"
    "shorts" -> "youtube"
"""
from __future__ import annotations

import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

BASE_URL = "https://zernio.com/api/v1"
HTTP_TIMEOUT_SEC = 60.0
# Zernio accepts up to 5 GB per upload. Our own ceiling is far lower: a
# short-form render that exceeds this is a bug in the render, not a large
# legitimate post, and shipping it would waste the upload either way.
MAX_UPLOAD_BYTES = 512 * 1024 * 1024

PLATFORM_MAP: dict[str, str] = {
    "tiktok": "tiktok",
    "reels": "instagram",
    "shorts": "youtube",
}

# Content types Zernio's presign endpoint accepts.
ALLOWED_CONTENT_TYPES = frozenset({
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/mpeg", "video/quicktime", "video/avi",
    "video/x-msvideo", "video/webm", "video/x-m4v", "application/pdf",
})


class ZernioError(RuntimeError):
    """A Zernio call failed in a way the caller has to handle."""


class DuplicatePost(ZernioError):
    """Zernio already has this exact content on this account (24h dedup).

    Not a failure: the post exists. ``existing_post_id`` identifies it so
    the caller can record it instead of retrying.
    """

    def __init__(self, message: str, *, existing_post_id: str | None = None):
        super().__init__(message)
        self.existing_post_id = existing_post_id


class AccountDisconnected(ZernioError):
    """A target account's platform connection is dead (token expired or
    revoked). The user has to reconnect — retrying cannot fix it."""


def enabled() -> bool:
    return bool(settings.zernio_api_key)


def _api_key() -> str:
    if not settings.zernio_api_key:
        raise ZernioError("MARKETER_ZERNIO_API_KEY is not set")
    return settings.zernio_api_key


def _headers(**extra: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {_api_key()}", **extra}


def _content_type(path: Path) -> str:
    guessed = mimetypes.guess_type(path.name)[0] or "video/mp4"
    if guessed not in ALLOWED_CONTENT_TYPES:
        raise ZernioError(
            f"{path.name} is {guessed}, which Zernio does not accept for upload"
        )
    return guessed


def _media_kind(content_type: str) -> str:
    return "video" if content_type.startswith("video/") else "image"


def format_caption(caption: str, hashtags: Iterable[str]) -> str:
    tags = [f"#{h.lstrip('#')}" for h in hashtags]
    parts = [caption.strip()]
    if tags:
        parts.append(" ".join(tags))
    return "\n\n".join(p for p in parts if p)


def _iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _retryable(exc: BaseException) -> bool:
    """Transient only. A 4xx that is not 429 will never succeed on retry,
    and burning three attempts on it just delays the real error."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        return status == 429 or status >= 500
    return isinstance(exc, (httpx.TimeoutException, httpx.TransportError))


_retry = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_retryable),
)


# ---------------------------------------------------------------- media


@_retry
async def upload_media(path: Path) -> str:
    """Presign, PUT the bytes, return the public URL to reference in a post.

    The uploaded object sits in Zernio's temporary storage for 7 days,
    which is ample for a scheduled post — but it means the URL is not a
    media library. Our own library (object storage) stays authoritative.
    """
    size = path.stat().st_size
    if size <= 0:
        raise ZernioError(f"{path.name} is empty")
    if size > MAX_UPLOAD_BYTES:
        raise ZernioError(
            f"{path.name} is {size} bytes, over our {MAX_UPLOAD_BYTES}-byte upload ceiling"
        )
    content_type = _content_type(path)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        presign = await client.post(
            f"{BASE_URL}/media/presign",
            headers=_headers(**{"Content-Type": "application/json"}),
            json={
                "filename": path.name,
                "contentType": content_type,
                "size": size,
            },
        )
        if presign.status_code >= 400:
            raise ZernioError(
                f"presign failed: {presign.status_code} {presign.text!r}"
            )
        body = presign.json()
        upload_url = body.get("uploadUrl")
        public_url = body.get("publicUrl")
        if not upload_url or not public_url:
            raise ZernioError(f"presign response missing urls: {body!r}")

        with path.open("rb") as fp:
            put = await client.put(
                upload_url,
                content=fp.read(),
                headers={"Content-Type": content_type},
            )
        if put.status_code >= 400:
            raise ZernioError(f"upload failed: {put.status_code} {put.text!r}")

    return public_url


# ---------------------------------------------------------------- posting


def _raise_for_post_error(resp: httpx.Response) -> None:
    """Turn Zernio's documented failure codes into types callers can act on."""
    if resp.status_code < 400:
        return
    try:
        body: dict[str, Any] = resp.json()
    except ValueError:
        body = {}

    if resp.status_code == 409:
        details = body.get("details") or {}
        raise DuplicatePost(
            body.get("error") or "duplicate content within 24h",
            existing_post_id=details.get("existingPostId"),
        )
    if resp.status_code == 403 and body.get("code") == "ACCOUNT_DISCONNECTED":
        raise AccountDisconnected(body.get("error") or "account disconnected")
    raise ZernioError(f"post failed: {resp.status_code} {resp.text!r}")


async def create_post(
    *,
    content: str,
    media_urls: list[str],
    media_kind: str,
    targets: list[tuple[str, str]],
    scheduled_for: datetime | None,
    request_id: str,
) -> str:
    """Create one post against one or more (platform, account_id) targets.

    ``targets`` carries Zernio platform names and account ids the caller
    already resolved under its own user scope — see the module docstring
    for why this function refuses to look them up itself.

    ``request_id`` must be stable for a logical post and distinct across
    posts; it is what makes a worker retry idempotent.

    Returns the Zernio post id. Raises ``DuplicatePost`` (carrying the
    existing id) when the same content already went to the same account
    inside 24 hours.
    """
    if not targets:
        raise ZernioError("no target accounts")
    if not content.strip() and not media_urls:
        raise ZernioError("a post needs content, media, or both")

    body: dict[str, Any] = {
        "content": content,
        "platforms": [
            {"platform": platform, "accountId": account_id}
            for platform, account_id in targets
        ],
    }
    if media_urls:
        body["mediaItems"] = [
            {"type": media_kind, "url": url} for url in media_urls
        ]
    if scheduled_for is not None:
        body["scheduledFor"] = _iso_utc(scheduled_for)
        body["timezone"] = "UTC"
    else:
        body["publishNow"] = True

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            f"{BASE_URL}/posts",
            headers=_headers(**{
                "Content-Type": "application/json",
                "x-request-id": request_id,
            }),
            json=body,
        )
    _raise_for_post_error(resp)

    out = resp.json()
    # A same-x-request-id retry returns 200 with the original under
    # `existingPost` — that is a success, not a duplicate.
    post = out.get("post") or out.get("existingPost") or {}
    post_id = post.get("_id")
    if not post_id:
        raise ZernioError(f"post response missing _id: {out!r}")
    return post_id


async def schedule_media_post(
    *,
    paths: list[Path],
    caption: str,
    hashtags: list[str],
    platform: str,
    scheduled_for: datetime | None,
    account_id: str,
    request_id: str,
) -> str:
    """Upload every file and schedule one post carrying them.

    One file is a normal post; several are a carousel on platforms that
    support it. ``platform`` is OUR name ("tiktok" / "reels" / "shorts").
    """
    if not paths:
        raise ZernioError("no media to post")
    zernio_platform = PLATFORM_MAP.get(platform)
    if not zernio_platform:
        raise ZernioError(f"unknown platform {platform!r}")

    kinds = {_media_kind(_content_type(p)) for p in paths}
    if len(kinds) > 1:
        raise ZernioError("a post cannot mix images and video")

    media_urls = [await upload_media(p) for p in paths]
    return await create_post(
        content=format_caption(caption, hashtags),
        media_urls=media_urls,
        media_kind=kinds.pop(),
        targets=[(zernio_platform, account_id)],
        scheduled_for=scheduled_for,
        request_id=request_id,
    )
