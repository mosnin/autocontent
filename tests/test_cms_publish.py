"""Publication-state transitions and their guards.

Each guard exists to stop a specific way a public URL goes wrong; the tests
are named after the failure, not the branch.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from marketer.cms import publish
from marketer.cms.schemas import CmsArticle, PublicationState

_NOW = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)
_ARTICLE_ID = UUID("55555555-5555-5555-5555-555555555555")


def _article(**overrides) -> CmsArticle:
    base = {
        "id": _ARTICLE_ID,
        "user_id": "u1",
        "niche_id": uuid4(),
        "status": "done",
        "publication_state": PublicationState.draft,
        "title": "SEO Basics",
        "slug": "seo-basics",
        "article_markdown": "# SEO Basics\n\nBody text.",
    }
    base.update(overrides)
    return CmsArticle(**base)


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------


def test_cannot_publish_an_article_with_no_content():
    """A live URL rendering an empty page is worse than a 404: it gets
    crawled and indexed as thin content."""
    with pytest.raises(publish.PublishGuard) as exc:
        publish.plan_publish(_article(article_markdown=None), scheduled_at=None)
    assert exc.value.code == "no_content"


def test_whitespace_only_content_is_not_content():
    with pytest.raises(publish.PublishGuard) as exc:
        publish.plan_publish(_article(article_markdown="   \n\n  "), scheduled_at=None)
    assert exc.value.code == "no_content"


def test_cannot_publish_without_a_title():
    with pytest.raises(publish.PublishGuard) as exc:
        publish.plan_publish(_article(title="  "), scheduled_at=None)
    assert exc.value.code == "no_title"


@pytest.mark.parametrize("status", ["queued", "writing", "qa", "metadata", "failed"])
def test_cannot_publish_while_the_pipeline_has_not_finished(status):
    """The pipeline rewrites the row as it runs and only its final stages
    produce the meta description, JSON-LD and quality score. Publishing
    mid-run puts a URL in front of content still being rewritten."""
    with pytest.raises(publish.PublishGuard) as exc:
        publish.plan_publish(_article(status=status), scheduled_at=None)
    assert exc.value.code == "not_finished"


def test_cannot_publish_when_neither_slug_nor_title_makes_a_url():
    with pytest.raises(publish.PublishGuard) as exc:
        publish.plan_publish(_article(slug=None, title="🎉"), scheduled_at=None)
    assert exc.value.code == "no_slug"


# ---------------------------------------------------------------------------
# Publish now
# ---------------------------------------------------------------------------


def test_publish_now_moves_a_draft_live_and_stamps_the_date():
    t = publish.plan_publish(_article(), scheduled_at=None, now=_NOW)
    assert t.state is PublicationState.published
    assert t.published_at == _NOW
    assert t.scheduled_at is None
    assert t.changed


def test_publish_now_on_a_live_article_is_a_no_op_that_keeps_the_dateline():
    """Idempotent: clients retry. Re-stamping published_at would read as
    content churn to crawlers and re-fire feed readers for an article
    nobody touched."""
    original = _NOW - timedelta(days=30)
    article = _article(
        publication_state=PublicationState.published, published_at=original
    )
    t = publish.plan_publish(article, scheduled_at=None, now=_NOW)
    assert not t.changed
    assert t.state is PublicationState.published
    assert t.published_at == original


def test_publish_now_from_scheduled_goes_live_early():
    article = _article(
        publication_state=PublicationState.scheduled,
        scheduled_at=_NOW + timedelta(days=2),
    )
    t = publish.plan_publish(article, scheduled_at=None, now=_NOW)
    assert t.changed
    assert t.state is PublicationState.published
    assert t.published_at == _NOW
    assert t.scheduled_at is None


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------


def test_scheduling_a_draft_sets_the_target_instant():
    target = _NOW + timedelta(days=1)
    t = publish.plan_publish(_article(), scheduled_at=target, now=_NOW)
    assert t.state is PublicationState.scheduled
    assert t.scheduled_at == target
    assert t.published_at is None
    assert t.changed


def test_a_past_schedule_means_publish_now():
    """Clock skew makes "now" fuzzy; rejecting a 200ms-stale timestamp is
    hostile and a past instant has exactly one sensible reading."""
    t = publish.plan_publish(
        _article(), scheduled_at=_NOW - timedelta(minutes=5), now=_NOW
    )
    assert t.state is PublicationState.published
    assert t.published_at == _NOW


def test_rescheduling_to_the_same_instant_is_idempotent():
    target = _NOW + timedelta(days=1)
    article = _article(
        publication_state=PublicationState.scheduled, scheduled_at=target
    )
    t = publish.plan_publish(article, scheduled_at=target, now=_NOW)
    assert not t.changed
    assert t.scheduled_at == target


def test_rescheduling_to_a_different_instant_moves_it():
    article = _article(
        publication_state=PublicationState.scheduled,
        scheduled_at=_NOW + timedelta(days=1),
    )
    later = _NOW + timedelta(days=3)
    t = publish.plan_publish(article, scheduled_at=later, now=_NOW)
    assert t.changed
    assert t.scheduled_at == later


def test_naive_datetimes_are_treated_as_utc():
    """Comparing a naive to an aware instant raises; the API is UTC."""
    target = _NOW + timedelta(days=1)
    article = _article(
        publication_state=PublicationState.scheduled,
        scheduled_at=target.replace(tzinfo=None),
    )
    t = publish.plan_publish(article, scheduled_at=target, now=_NOW)
    assert not t.changed


def test_cannot_schedule_an_already_live_article():
    """That would take the URL down now and bring it back later — a silent
    unpublish wearing a publish call's clothes."""
    article = _article(
        publication_state=PublicationState.published, published_at=_NOW
    )
    with pytest.raises(publish.PublishGuard) as exc:
        publish.plan_publish(
            article, scheduled_at=_NOW + timedelta(days=1), now=_NOW
        )
    assert exc.value.code == "already_published"


# ---------------------------------------------------------------------------
# Unpublish
# ---------------------------------------------------------------------------


def test_unpublish_returns_a_live_article_to_draft_but_keeps_the_dateline():
    article = _article(
        publication_state=PublicationState.published, published_at=_NOW
    )
    t = publish.plan_unpublish(article)
    assert t.changed
    assert t.state is PublicationState.draft
    assert t.scheduled_at is None
    # Kept, so a re-publish restores the original dateline AND so the slug
    # stays reserved to this article (the index predicate keys on it).
    assert t.published_at == _NOW


def test_unpublish_cancels_a_pending_schedule():
    article = _article(
        publication_state=PublicationState.scheduled,
        scheduled_at=_NOW + timedelta(days=1),
    )
    t = publish.plan_unpublish(article)
    assert t.changed
    assert t.state is PublicationState.draft
    assert t.scheduled_at is None


def test_unpublish_of_a_draft_is_a_no_op():
    t = publish.plan_unpublish(_article())
    assert not t.changed
    assert t.state is PublicationState.draft


def test_unpublishing_never_requires_content():
    """Taking a page down must always be possible — even if the article was
    somehow emptied since it went live."""
    article = _article(
        publication_state=PublicationState.published,
        published_at=_NOW,
        article_markdown=None,
        title=None,
    )
    assert publish.plan_unpublish(article).state is PublicationState.draft


# ---------------------------------------------------------------------------
# Slug freezing
# ---------------------------------------------------------------------------


def test_a_draft_slug_can_be_changed_freely():
    publish.guard_slug_change(_article(), "a-better-slug")  # no raise


def test_a_live_slug_is_frozen():
    """Changing it breaks every inbound link and frees the old URL for some
    other article to claim."""
    article = _article(
        publication_state=PublicationState.published, published_at=_NOW
    )
    with pytest.raises(publish.PublishGuard) as exc:
        publish.guard_slug_change(article, "a-better-slug")
    assert exc.value.code == "slug_frozen"


def test_an_unpublished_slug_stays_frozen():
    """Unpublishing does NOT release the slug: otherwise a stale inbound
    link could later resolve to a completely different article."""
    article = _article(
        publication_state=PublicationState.draft, published_at=_NOW
    )
    with pytest.raises(publish.PublishGuard) as exc:
        publish.guard_slug_change(article, "a-better-slug")
    assert exc.value.code == "slug_frozen"


def test_setting_the_same_slug_on_a_live_article_is_not_a_change():
    article = _article(
        publication_state=PublicationState.published, published_at=_NOW
    )
    publish.guard_slug_change(article, "SEO Basics")  # normalizes to seo-basics
