"""The publishing seam: resolve a target, then publish through Zernio.

The pipeline and the image-post runner call this module rather than the
vendor client directly, because publishing needs one thing done first that
the vendor client deliberately refuses to do for itself: decide *whose*
account a post goes to.

Zernio takes an `accountId` in the request body and — per its own docs —
validates it against the whole team, not against a profile. An id from the
wrong user would publish to the wrong customer's socials and Zernio would
accept it. So the target is resolved here, from `social_accounts`, scoped
by `user_id`, and `services.zernio` only ever receives an id that was
looked up under the caller's own identity.

`NotConnected` is raised — never swallowed — when a user has no usable
account for a platform. A skipped publish that reports success is how a
scheduled post silently disappears.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import UUID

from ..config import settings
from ..logging import get_logger
from ..repos import social_accounts as accounts_repo
from . import zernio, zernio_analytics

log = get_logger(__name__)


class NotConnected(RuntimeError):
    """The user has no live account for this platform. Reconnect required."""


def enabled() -> bool:
    return bool(settings.zernio_api_key)


def _request_id(kind: str, ref_id: UUID | str, platform: str) -> str:
    """A stable idempotency key for one logical post.

    Derived from the work item rather than randomly generated, so a worker
    retry of the same job is recognised by Zernio as a retry and returns
    the original post instead of publishing a second one.
    """
    return f"marketer-{kind}-{ref_id}-{platform}"


async def _target(user_id: str, platform: str) -> str:
    account = await accounts_repo.publish_target(user_id, platform)
    if account is None:
        raise NotConnected(
            f"no live {platform} account for user {user_id}; connect or reconnect it"
        )
    return account.zernio_account_id


async def schedule_post(
    *,
    video_path: Path,
    caption: str,
    hashtags: list[str],
    platform: str,
    scheduled_for: datetime,
    user_id: str,
    job_id: UUID | str | None = None,
) -> str:
    """Schedule one video. Returns the Zernio post id."""
    account_id = await _target(user_id, platform)
    return await zernio.schedule_media_post(
        paths=[video_path],
        caption=caption,
        hashtags=hashtags,
        platform=platform,
        scheduled_for=scheduled_for,
        account_id=account_id,
        request_id=_request_id("job", job_id or video_path.stem, platform),
    )


async def schedule_image_post(
    *,
    image_paths: list[Path],
    caption: str,
    hashtags: list[str],
    platform: str,
    scheduled_for: datetime,
    user_id: str,
    image_post_id: UUID | str | None = None,
) -> str:
    """Schedule one still or carousel. Returns the Zernio post id."""
    if not image_paths:
        raise ValueError("no images to post")
    account_id = await _target(user_id, platform)
    return await zernio.schedule_media_post(
        paths=image_paths,
        caption=caption,
        hashtags=hashtags,
        platform=platform,
        scheduled_for=scheduled_for,
        account_id=account_id,
        request_id=_request_id(
            "image", image_post_id or image_paths[0].stem, platform
        ),
    )


async def fetch_post_analytics(provider_post_id: str, platforms: list[str]) -> dict:
    """Per-post metrics, normalized to ``{id, analytics: {platform: {...}}}``."""
    return await zernio_analytics.fetch_post_analytics(provider_post_id, platforms)
