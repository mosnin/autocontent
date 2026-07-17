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


# ---------------------------------------------------------------------------
# Press autopilot — scheduled/cadence-driven article generation.
#
# Mirrors modal_app.py's nightly_batch shape (a read-only scan that spawns
# one fire-and-forget unit of work per due entity) but for the article side
# of the platform: walk every niche with a weekly article cadence, and for
# any niche below target for the trailing 7 days, enqueue exactly one
# article — consuming the oldest approved topic_proposal if the approval
# queue has one, else falling back to the pipeline's own pick_topic path
# (topic="").
#
# Not wired to a Modal cron here (modal_app.py is owned by another team);
# this is the callable the coordinator can hook up to a schedule.
# ---------------------------------------------------------------------------


async def _due_niches() -> list[dict]:
    """Niches with autopilot enabled (articles_per_week > 0), read directly
    off the niches table rather than through the shared Niche pydantic
    model/repo — this feature only needs three columns and querying them
    directly avoids a cross-team dependency on a model file this team
    doesn't own."""
    from ..db import get_pool

    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, user_id, articles_per_week
          from niches
         where articles_per_week > 0 and archived_at is null
        """
    )
    return [dict(r) for r in rows]


async def _articles_this_week(niche_id) -> int:
    from ..db import get_pool

    pool = await get_pool()
    val = await pool.fetchval(
        """
        select count(*) from articles
         where niche_id = $1
           and created_at >= now() - interval '7 days'
           and status != 'failed'
        """,
        niche_id,
    )
    return int(val or 0)


async def run_press_autopilot() -> dict:
    """One autopilot pass. For each niche below its weekly cadence, enqueue
    one article generation run via the exact same insert+spawn contract as
    a manual POST /articles (articles_repo.create_and_spawn) — no forked
    enqueue path.

    A no-op (returns immediately) unless MARKETER_PRESS_AUTOPILOT_ENABLED
    is set. Per-niche opt-in is separate: articles_per_week defaults to 0,
    so a niche only participates once an operator sets a cadence.

    Auto-publish on completion is intentionally NOT done here — publishing
    is a distinct, explicit step (see services/publishing.py /
    POST /press/articles/{id}/publish). The one narrow exception the spec
    allows (autopilot-generated + exactly one enabled publish target) is
    handled by `_maybe_auto_publish`, called after the pipeline finishes,
    not from this scan.
    """
    from ..config import settings
    from ..repos import articles as articles_repo
    from ..repos import topic_proposals as topic_proposals_repo

    if not settings.press_autopilot_enabled:
        return {"enqueued": 0, "skipped": 0}

    enqueued = 0
    skipped = 0
    for niche in await _due_niches():
        niche_id = niche["id"]
        target = niche["articles_per_week"]
        count = await _articles_this_week(niche_id)
        if count >= target:
            skipped += 1
            continue

        proposal = await topic_proposals_repo.consume_oldest_approved(niche_id)
        topic = proposal.title if proposal else ""
        focus_keyword = proposal.focus_keyword if proposal else ""

        await articles_repo.create_and_spawn(
            user_id=niche["user_id"], niche_id=niche_id, topic=topic,
            focus_keyword=focus_keyword,
        )
        enqueued += 1

    return {"enqueued": enqueued, "skipped": skipped}


async def maybe_auto_publish(article) -> None:
    """The one narrow auto-publish rule the spec allows: an
    autopilot-generated article that just reached `done` auto-publishes
    only when the user has exactly one enabled publish target — any more
    (or zero) and the choice is left to a manual
    POST /press/articles/{id}/publish instead. Fail-open: a publish error
    here must never make the article itself look failed.

    Not currently called from the pipeline (articles/pipeline.py belongs to
    this team too, but wiring this in changes the video-pipeline-mirroring
    terminal-state contract non-trivially) — exposed here so the
    coordinator can invoke it right after a press-autopilot article
    finishes, e.g. from the Modal task that awaits run_article_pipeline for
    an autopilot-spawned article.

    NOT auto-wired into articles/pipeline.py: run_article_pipeline's
    signature (in modal_app.py, owned by another team) is
    (user_id, niche_id, article_id, topic) with no "origin" flag, so the
    pipeline has no reliable way to tell an autopilot-spawned run apart
    from a manual one with an empty topic (both auto-pick via pick_topic).
    Wiring this in correctly needs either an origin flag threaded through
    that Modal function signature or a DB column recording provenance,
    neither of which is in this deliverable's schema — left as a documented
    gap rather than guessed at.
    """
    import logging

    from ..articles.models import ArticleStatus
    from ..repos.publish_targets import sole_enabled
    from .publishing import PublishError, publish_article

    if article.status != ArticleStatus.done or not article.article_markdown:
        return
    target = await sole_enabled(article.user_id)
    if target is None:
        return
    try:
        await publish_article(article, target)
    except PublishError as exc:  # noqa: BLE001 — auto-publish must never fail the article
        logging.getLogger(__name__).warning(
            "auto-publish failed for article %s: %s", article.id, exc
        )
