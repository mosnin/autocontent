"""Due-post selection and per-platform publishing.

The dispatch loop is the only place in this feature that touches a user's
real social accounts, so it is built around one requirement: **running it
twice must not post twice.** Three independent guards, in order:

1. `repos.scheduled_posts.claim_due` — a single atomic UPDATE that moves
   due posts `scheduled -> dispatching`. Two dispatcher containers on the
   same tick cannot both claim the same post; the loser's query returns
   zero rows (see that function for why selection and claim are one
   statement).
2. `repos.scheduled_posts.claim_variant` — the same WHERE-status trick per
   platform, so re-dispatching a partially-failed post re-sends only the
   platforms that never landed.
3. `services.idempotency.claim_spawn` — the durable, cross-process key.
   Guards 1 and 2 are per-row state; this one survives a claim being
   legitimately re-armed and catches the case where the same unit of work
   arrives through two different doors (the cron loop and the publish-now
   button at the same instant).

The key scheme is `scheduled_post:{post_id}:{platform}:{scheduled_at}`.
Post + platform identifies the destination; `scheduled_at` is what makes a
*legitimate* new attempt distinguishable from a duplicate — the user has
to move the post (which rewrites `scheduled_at`) to get a fresh key, and
that is precisely the action that means "I want this to go out again".

Publishing itself reuses `services/scheduler.py`'s Ayrshare primitives
(base URL, bearer + Profile-Key headers, caption formatting) rather than
re-implementing them. That module owns the Ayrshare contract; it just has
no by-URL post function because the render pipeline always uploads a local
file first, and a hand-authored post already has hosted media URLs.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

import httpx

from ..repos import scheduled_posts as repo
from ..repos import users as users_repo
from ..services import idempotency
from ..services.scheduler import BASE_URL, HTTP_TIMEOUT_SEC, AyrshareError, _headers
from .schemas import PlatformVariant, ScheduledPost

log = logging.getLogger(__name__)

# A claim TTL just longer than the dispatch timeout: long enough that a
# slow publish can't have its key reclaimed underneath it, short enough
# that a crashed container's key doesn't block a human retry for hours.
IDEMPOTENCY_TTL_SECONDS = 30 * 60

DEFAULT_BATCH = 50


def variant_key(post: ScheduledPost, platform: str) -> str:
    ts = post.scheduled_at.astimezone(timezone.utc).isoformat(timespec="microseconds")
    return f"scheduled_post:{post.id}:{platform}:{ts}"


async def _profile_key(user_id: str) -> str:
    user = await users_repo.get(user_id)
    key = getattr(user, "ayrshare_profile_key", None) if user else None
    if not key:
        raise AyrshareError(
            f"user {user_id} has no ayrshare_profile_key; complete connect flow first"
        )
    return key


async def publish_variant(
    *,
    profile_key: str,
    platform: str,
    content: str,
    media_urls: list[str],
) -> str:
    """POST one platform's copy to Ayrshare. Returns the provider post id.

    No `scheduleDate`: we are the scheduler. Handing Ayrshare a future date
    would put the same post in two queues (theirs and ours) with no way to
    cancel ours without orphaning theirs.
    """
    body: dict = {"post": content, "platforms": [platform]}
    if media_urls:
        body["mediaUrls"] = media_urls
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            "/post",
            headers={**_headers(profile_key), "Content-Type": "application/json"},
            json=body,
        )
    if resp.status_code >= 400:
        raise AyrshareError(f"publish failed: {resp.status_code} {resp.text!r}")
    out = resp.json()
    if out.get("status") not in ("scheduled", "success"):
        raise AyrshareError(f"unexpected response: {out!r}")
    post_id = out.get("id")
    if not post_id:
        raise AyrshareError(f"publish response missing id: {out!r}")
    return str(post_id)


async def _dispatch_variant(
    post: ScheduledPost, variant: PlatformVariant, *, profile_key: str
) -> str:
    """Claim, publish, record. Returns the resulting variant status."""
    if variant.id is None:  # pragma: no cover - defensive; rows always carry an id
        return "skipped"

    if not await repo.claim_variant(variant.id):
        # Someone else already owns this platform (or it already posted).
        log.info(
            "variant %s of post %s not claimable — skipping duplicate publish",
            variant.platform, post.id,
        )
        return "skipped"

    key = variant_key(post, variant.platform)
    if not await idempotency.claim_spawn(key, ttl_seconds=IDEMPOTENCY_TTL_SECONDS):
        # The durable guard says this exact destination+time already went
        # out. Release our row claim back to pending would re-open the
        # double-post window, so park it as failed with an explicit reason.
        await repo.mark_variant_failed(
            variant.id, error="duplicate dispatch suppressed by idempotency guard"
        )
        return "skipped"

    try:
        provider_post_id = await publish_variant(
            profile_key=profile_key,
            platform=variant.platform,
            content=variant.resolved_content(post.content),
            media_urls=variant.resolved_media(post.media_urls),
        )
    except Exception as e:  # noqa: BLE001 - any provider failure is per-platform
        log.warning("publish failed post=%s platform=%s: %s", post.id, variant.platform, e)
        await repo.mark_variant_failed(variant.id, error=str(e))
        return "failed"

    await repo.mark_variant_posted(variant.id, provider_post_id=provider_post_id)
    await idempotency.mark_done(key, result={"provider_post_id": provider_post_id})
    return "posted"


async def dispatch_post(post: ScheduledPost) -> dict:
    """Fan one already-claimed post out to every pending platform.

    The post must already be in `dispatching` — callers get there via
    `claim_due` or `claim_for_publish_now`. Never call this on a post you
    read rather than claimed.
    """
    counts = {"posted": 0, "failed": 0, "skipped": 0}
    try:
        profile_key = await _profile_key(post.user_id)
    except AyrshareError as e:
        # No connected profile: fail every pending variant with one clear
        # reason rather than N identical provider errors.
        for variant in post.variants:
            if variant.status == "pending" and variant.id is not None:
                if await repo.claim_variant(variant.id):
                    await repo.mark_variant_failed(variant.id, error=str(e))
                    counts["failed"] += 1
        await repo.finalize(post.id)
        return {"post_id": str(post.id), **counts}

    for variant in post.variants:
        if variant.status != "pending":
            counts["skipped"] += 1
            continue
        counts[await _dispatch_variant(post, variant, profile_key=profile_key)] += 1

    final = await repo.finalize(post.id)
    return {
        "post_id": str(post.id),
        "status": final.status if final else None,
        **counts,
    }


async def run_due_dispatch(*, now: datetime | None = None, limit: int = DEFAULT_BATCH) -> dict:
    """One pass of the dispatch loop: claim what's due, publish it.

    Safe to run concurrently with itself — that is the whole point of the
    claim in `claim_due`. A pass that claims nothing returns zeros.
    """
    now = now or datetime.now(timezone.utc)
    claimed = await repo.claim_due(now=now, limit=limit)
    results = []
    for post in claimed:
        try:
            results.append(await dispatch_post(post))
        except Exception:  # noqa: BLE001 - one bad post must not stop the batch
            log.exception("dispatch_post crashed for %s", post.id)
            await repo.finalize(post.id)
    return {"claimed": len(claimed), "results": results}


async def dispatch_claimed_post(*, user_id: str, post_id: UUID) -> dict:
    """Entry point for the publish-now path: the route already claimed the
    post, so we only re-read it (with its freshly claimed variants) and fan
    it out."""
    post = await repo.get(post_id, user_id=user_id)
    if post is None:
        return {"post_id": str(post_id), "error": "not found"}
    return await dispatch_post(post)
