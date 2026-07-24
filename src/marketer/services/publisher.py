"""The publishing seam: one interface, two providers, one switch.

The pipeline and the image-post runner call this module, not a vendor
module. `MARKETER_PUBLISHER_PROVIDER` decides which integration actually
runs — "ayrshare" (the default, unchanged behaviour) or "zernio".

Why a seam rather than a rewrite in place: publishing is the one stage
that cannot be safely tested by running it. A mistake does not fail a job,
it posts the wrong thing to a real audience, and there is no undo worth
the name. So both integrations ship side by side, the switch is
per-deploy, and the cutover is a config change that can be reverted in
seconds rather than a deploy that has to be rolled back.

The two providers differ in how a target is addressed, and the difference
is load-bearing:

* Ayrshare  — a per-user profile key in a header; the account is whatever
  that profile has connected for the platform.
* Zernio    — an explicit account id in the body, validated against the
  whole team. We resolve it from `social_accounts` under the caller's
  user id, so a user can only ever publish to their own accounts.

`NotConnected` is raised — never swallowed — when a user has no usable
account for a platform. A skipped publish that looks like a success is
how a scheduled post silently disappears.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import UUID

from ..config import settings
from ..logging import get_logger
from ..repos import social_accounts as accounts_repo

log = get_logger(__name__)


class NotConnected(RuntimeError):
    """The user has no live account for this platform. Reconnect required."""


def provider() -> str:
    return (settings.publisher_provider or "ayrshare").strip().lower()


def using_zernio() -> bool:
    return provider() == "zernio"


def _request_id(kind: str, ref_id: UUID | str, platform: str) -> str:
    """A stable idempotency key for one logical post.

    Derived from the work item rather than randomly generated, so a worker
    retry of the same job is recognised by Zernio as a retry and returns
    the original post instead of publishing a second one.
    """
    return f"marketer-{kind}-{ref_id}-{platform}"


async def _zernio_target(user_id: str, platform: str) -> str:
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
    """Schedule one video. Returns the provider's post id."""
    if using_zernio():
        from . import zernio

        account_id = await _zernio_target(user_id, platform)
        return await zernio.schedule_media_post(
            paths=[video_path],
            caption=caption,
            hashtags=hashtags,
            platform=platform,
            scheduled_for=scheduled_for,
            account_id=account_id,
            request_id=_request_id("job", job_id or video_path.stem, platform),
        )

    from . import scheduler

    return await scheduler.schedule_post(
        video_path=video_path,
        caption=caption,
        hashtags=hashtags,
        platform=platform,
        scheduled_for=scheduled_for,
        profile_key=None,  # resolved inside scheduler from user_id
        user_id=user_id,
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
    """Schedule one still or carousel. Returns the provider's post id."""
    if using_zernio():
        from . import zernio

        account_id = await _zernio_target(user_id, platform)
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

    from . import scheduler

    return await scheduler.schedule_image_post(
        image_paths=image_paths,
        caption=caption,
        hashtags=hashtags,
        platform=platform,
        scheduled_for=scheduled_for,
        profile_key=None,  # resolved inside scheduler from user_id
        user_id=user_id,
    )


async def fetch_post_analytics(provider_post_id: str, platforms: list[str]) -> dict:
    """Per-post metrics, normalized to ``{id, analytics: {platform: {...}}}``
    by whichever provider is live."""
    if using_zernio():
        from . import zernio_analytics

        return await zernio_analytics.fetch_post_analytics(
            provider_post_id, platforms
        )

    from . import ayrshare_analytics

    return await ayrshare_analytics.fetch_post_analytics(
        provider_post_id, platforms
    )


def enabled() -> bool:
    """True when the live provider has a key configured."""
    if using_zernio():
        return bool(settings.zernio_api_key)
    return bool(settings.ayrshare_api_key)
