"""Publication-state transitions and their guards — pure.

Publishing is the one CMS action with consequences outside the database: it
mints a URL that crawlers index and humans link to. Every guard below exists
to stop a specific way that goes wrong, and each says which one.

The functions here compute a `Transition` and never touch the DB; the repo
applies it. That keeps "may this go live, and what should the timestamps
become" testable without Postgres, and keeps the SQL a dumb write.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from . import slugs
from .schemas import CmsArticle, PublicationState

#: Pipeline statuses from which publishing is allowed. Only `done` — see
#: guard_publishable.
_PUBLISHABLE_PIPELINE_STATUS = "done"


class PublishGuard(ValueError):
    """A publication transition was refused. `code` is stable for clients."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Transition:
    """The publication columns after the transition.

    `changed` False means the request was a no-op — the article was already
    in exactly the requested state. Callers return 200 with the unchanged
    article rather than an error: publish/schedule must be idempotent
    because clients retry, and a retried publish that 409s (or, worse,
    re-stamps published_at) is a bug in us, not in the client.
    """

    state: PublicationState
    published_at: datetime | None
    scheduled_at: datetime | None
    changed: bool
    reason: str = ""


def _utc(dt: datetime) -> datetime:
    """Naive datetimes are assumed UTC: the API is UTC everywhere, and
    comparing a naive to an aware instant raises."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def guard_publishable(article: CmsArticle) -> None:
    """Refuse to mint a public URL for something that shouldn't have one."""
    # WHY: a live URL rendering an empty page is strictly worse than a 404.
    # It gets crawled, indexed as thin content, and drags the domain's
    # quality signals down — and unlike a 404 nobody notices for weeks.
    if not article.has_content:
        raise PublishGuard(
            "no_content", "article has no content to publish"
        )

    # WHY: the title is the <title> tag and the SERP headline. Publishing
    # without one ships a page titled "Untitled" into the index.
    if not (article.title or "").strip():
        raise PublishGuard("no_title", "article has no title to publish")

    # WHY: the pipeline writes the row repeatedly as it runs (research ->
    # outline -> write -> QA -> metadata), and its final stages are what
    # produce the meta description, JSON-LD and quality score. Publishing
    # mid-run puts a URL in front of content that is still being rewritten
    # underneath it, and publishing a `failed` run ships a partial draft
    # that was never QA-scored.
    if article.status != _PUBLISHABLE_PIPELINE_STATUS:
        raise PublishGuard(
            "not_finished",
            f"article generation is '{article.status}', not 'done'",
        )

    # WHY: something must go in the URL. The repo derives one from the
    # title when slug is null, so this only fires when both are unusable.
    if not slugs.normalize(article.slug or article.title, fallback=""):
        raise PublishGuard(
            "no_slug", "article has no usable slug or title for a URL"
        )


def guard_slug_change(article: CmsArticle, new_slug: str) -> None:
    """Refuse to change the slug of an article that has ever been public.

    WHY: the slug IS the public URL. Changing it on a live (or previously
    live) article breaks every inbound link and every indexed result, and
    frees the old slug for some other article to claim — at which point an
    old link silently resolves to unrelated content. Renaming a live URL is
    a redirect problem, not an UPDATE, so we refuse it here rather than
    pretend it is harmless. Drafts that have never been published are free
    to change slug as often as the author likes.
    """
    current = slugs.normalize(article.slug, fallback="") if article.slug else ""
    if slugs.normalize(new_slug, fallback="") == current:
        return  # No-op; nothing to guard.
    if article.publication_state is not PublicationState.draft or article.published_at:
        raise PublishGuard(
            "slug_frozen",
            "the slug of a published article is frozen — unpublishing does "
            "not release it, because the old URL must never resolve to "
            "different content",
        )


def plan_publish(
    article: CmsArticle,
    *,
    scheduled_at: datetime | None,
    now: datetime | None = None,
) -> Transition:
    """Plan `POST /publish`: go live now, or schedule a future publish."""
    now = _utc(now or datetime.now(timezone.utc))
    target = _utc(scheduled_at) if scheduled_at else None

    # WHY: clock skew between a client and the server makes "now" fuzzy;
    # rejecting a scheduled_at that is 200ms stale would be hostile, and a
    # past instant has exactly one sensible reading — publish immediately.
    if target is not None and target <= now:
        target = None

    guard_publishable(article)

    if target is None:
        if article.publication_state is PublicationState.published:
            # Idempotent re-publish. published_at is deliberately NOT
            # re-stamped: a moving publish date reads as content churn to
            # crawlers and re-fires feed readers for an article nobody
            # touched.
            return Transition(
                state=PublicationState.published,
                published_at=article.published_at,
                scheduled_at=None,
                changed=False,
                reason="already published",
            )
        return Transition(
            state=PublicationState.published,
            published_at=now,
            scheduled_at=None,
            changed=True,
            reason="published",
        )

    # Scheduling from here down.
    if article.publication_state is PublicationState.published:
        # WHY: moving a LIVE article to 'scheduled' would take its URL down
        # now and bring it back later — a silent unpublish disguised as a
        # publish call. The caller has to say `unpublish` out loud.
        raise PublishGuard(
            "already_published",
            "article is already published; unpublish it before scheduling",
        )

    if (
        article.publication_state is PublicationState.scheduled
        and article.scheduled_at is not None
        and _utc(article.scheduled_at) == target
    ):
        # Idempotent re-schedule at the same instant (a client retry).
        return Transition(
            state=PublicationState.scheduled,
            published_at=article.published_at,
            scheduled_at=article.scheduled_at,
            changed=False,
            reason="already scheduled",
        )

    return Transition(
        state=PublicationState.scheduled,
        published_at=article.published_at,
        scheduled_at=target,
        changed=True,
        reason="scheduled",
    )


def plan_unpublish(article: CmsArticle) -> Transition:
    """Plan `POST /unpublish`: back to draft, URL retired."""
    if article.publication_state is PublicationState.draft:
        # Idempotent: already a draft, nothing to take down.
        return Transition(
            state=PublicationState.draft,
            published_at=article.published_at,
            scheduled_at=None,
            changed=False,
            reason="already draft",
        )

    # published_at is carried through, not cleared. Two reasons: a later
    # re-publish restores the original dateline instead of minting a new
    # one, and it is the marker that keeps this article's slug reserved
    # (see guard_slug_change and the partial unique index in 0037) so the
    # retired URL can never be re-pointed at different content.
    return Transition(
        state=PublicationState.draft,
        published_at=article.published_at,
        scheduled_at=None,
        changed=True,
        reason="unpublished",
    )
