"""Press autopilot scheduler selection logic (services/scheduler.py):
below-cadence niches consume the oldest approved proposal (or fall back to
pick_topic via an empty topic), niches already at/above target are
skipped, and the whole pass is a no-op when the feature flag is off."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from marketer.repos.topic_proposals import TopicProposal
from marketer.services import scheduler


def _niche_row(niche_id, user_id="user_a", articles_per_week=3):
    return {"id": niche_id, "user_id": user_id, "articles_per_week": articles_per_week}


def _proposal(niche_id, *, title="A great topic", focus_keyword="great topic") -> TopicProposal:
    return TopicProposal(
        id=uuid4(), user_id="user_a", niche_id=niche_id, title=title,
        focus_keyword=focus_keyword, rationale="r", score=0.7, status="rejected",
        created_at=datetime.now(timezone.utc), decided_at=datetime.now(timezone.utc),
    )


@pytest.fixture(autouse=True)
def _enable_autopilot(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "press_autopilot_enabled", True)


async def test_below_target_niche_consumes_oldest_approved_proposal(monkeypatch):
    niche_id = uuid4()

    async def _due():
        return [_niche_row(niche_id, articles_per_week=3)]

    async def _count(nid):
        assert nid == niche_id
        return 1  # below target of 3

    proposal = _proposal(niche_id, title="Best burr grinders", focus_keyword="burr grinders")

    async def _consume(nid):
        assert nid == niche_id
        return proposal

    spawned: list[dict] = []

    async def _create_and_spawn(*, user_id, niche_id, topic, focus_keyword=""):
        spawned.append({"user_id": user_id, "niche_id": niche_id, "topic": topic,
                         "focus_keyword": focus_keyword})
        return None

    monkeypatch.setattr(scheduler, "_due_niches", _due)
    monkeypatch.setattr(scheduler, "_articles_this_week", _count)

    import marketer.repos.topic_proposals as proposals_repo
    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(proposals_repo, "consume_oldest_approved", _consume)
    monkeypatch.setattr(articles_repo, "create_and_spawn", _create_and_spawn)

    result = await scheduler.run_press_autopilot()

    assert result == {"enqueued": 1, "skipped": 0}
    assert spawned == [{
        "user_id": "user_a", "niche_id": niche_id,
        "topic": "Best burr grinders", "focus_keyword": "burr grinders",
    }]


async def test_below_target_niche_falls_back_to_pick_topic_when_no_proposal(monkeypatch):
    niche_id = uuid4()

    async def _due():
        return [_niche_row(niche_id, articles_per_week=2)]

    async def _count(nid):
        return 0

    async def _consume(nid):
        return None  # no approved proposal for this niche

    spawned: list[dict] = []

    async def _create_and_spawn(*, user_id, niche_id, topic, focus_keyword=""):
        spawned.append({"topic": topic, "focus_keyword": focus_keyword})
        return None

    monkeypatch.setattr(scheduler, "_due_niches", _due)
    monkeypatch.setattr(scheduler, "_articles_this_week", _count)

    import marketer.repos.topic_proposals as proposals_repo
    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(proposals_repo, "consume_oldest_approved", _consume)
    monkeypatch.setattr(articles_repo, "create_and_spawn", _create_and_spawn)

    result = await scheduler.run_press_autopilot()

    assert result == {"enqueued": 1, "skipped": 0}
    # Empty topic -> the pipeline's own pick_topic path takes over at run time.
    assert spawned == [{"topic": "", "focus_keyword": ""}]


async def test_niche_at_target_is_skipped(monkeypatch):
    niche_id = uuid4()

    async def _due():
        return [_niche_row(niche_id, articles_per_week=2)]

    async def _count(nid):
        return 2  # already at target

    async def _boom(*a, **k):
        raise AssertionError("must not touch the proposal queue when at cadence")

    spawned: list[dict] = []

    async def _create_and_spawn(**kw):
        spawned.append(kw)

    monkeypatch.setattr(scheduler, "_due_niches", _due)
    monkeypatch.setattr(scheduler, "_articles_this_week", _count)

    import marketer.repos.topic_proposals as proposals_repo
    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(proposals_repo, "consume_oldest_approved", _boom)
    monkeypatch.setattr(articles_repo, "create_and_spawn", _create_and_spawn)

    result = await scheduler.run_press_autopilot()

    assert result == {"enqueued": 0, "skipped": 1}
    assert spawned == []


async def test_multiple_niches_mixed(monkeypatch):
    below_id, at_id = uuid4(), uuid4()

    async def _due():
        return [
            _niche_row(below_id, articles_per_week=5),
            _niche_row(at_id, articles_per_week=1),
        ]

    async def _count(nid):
        return 5 if nid == at_id else 1

    async def _consume(nid):
        return None

    spawned: list = []

    async def _create_and_spawn(*, user_id, niche_id, topic, focus_keyword=""):
        spawned.append(niche_id)

    monkeypatch.setattr(scheduler, "_due_niches", _due)
    monkeypatch.setattr(scheduler, "_articles_this_week", _count)

    import marketer.repos.topic_proposals as proposals_repo
    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(proposals_repo, "consume_oldest_approved", _consume)
    monkeypatch.setattr(articles_repo, "create_and_spawn", _create_and_spawn)

    result = await scheduler.run_press_autopilot()

    assert result == {"enqueued": 1, "skipped": 1}
    assert spawned == [below_id]


async def test_autopilot_disabled_is_a_full_noop(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "press_autopilot_enabled", False)

    async def _boom():
        raise AssertionError("must not scan niches when autopilot is disabled")

    monkeypatch.setattr(scheduler, "_due_niches", _boom)

    result = await scheduler.run_press_autopilot()
    assert result == {"enqueued": 0, "skipped": 0}


# ---------------------------------------------------------------------------
# maybe_auto_publish — the narrow single-target auto-publish exception
# ---------------------------------------------------------------------------


def _done_article():
    from marketer.articles.models import Article, ArticleStatus
    return Article(
        id=uuid4(), user_id="user_a", niche_id=uuid4(), status=ArticleStatus.done,
        topic="t", article_markdown="# T\n\nBody.",
        created_at=datetime.now(timezone.utc),
    )


async def test_maybe_auto_publish_noop_when_not_done(monkeypatch):
    from marketer.articles.models import Article, ArticleStatus

    async def _boom(user_id):
        raise AssertionError("must not look up targets for a non-done article")

    import marketer.repos.publish_targets as targets_repo
    monkeypatch.setattr(targets_repo, "sole_enabled", _boom)

    article = Article(
        id=uuid4(), user_id="user_a", niche_id=uuid4(), status=ArticleStatus.writing,
        topic="t", created_at=datetime.now(timezone.utc),
    )
    await scheduler.maybe_auto_publish(article)  # must not raise


async def test_maybe_auto_publish_noop_without_exactly_one_target(monkeypatch):
    async def _none(user_id):
        return None

    import marketer.repos.publish_targets as targets_repo
    monkeypatch.setattr(targets_repo, "sole_enabled", _none)

    import marketer.services.publishing as publishing_svc

    async def _boom(article, target):
        raise AssertionError("must not publish without a sole enabled target")

    monkeypatch.setattr(publishing_svc, "publish_article", _boom)

    await scheduler.maybe_auto_publish(_done_article())


async def test_maybe_auto_publish_calls_publish_with_sole_target(monkeypatch):
    from marketer.repos.publish_targets import PublishTargetSecret

    target = PublishTargetSecret(
        id=uuid4(), user_id="user_a", kind="webhook", name="hook",
        base_url="https://x.com/hook", username="", secret="s", disabled=False,
        created_at=datetime.now(timezone.utc),
    )

    async def _sole(user_id):
        return target

    import marketer.repos.publish_targets as targets_repo
    monkeypatch.setattr(targets_repo, "sole_enabled", _sole)

    seen = {}

    async def _publish(article, tgt):
        seen["article_id"] = article.id
        seen["target_id"] = tgt.id
        return object()

    # scheduler.maybe_auto_publish does `from .publishing import publish_article`
    # inline, so patch it on the publishing module itself.
    import marketer.services.publishing as publishing_svc
    monkeypatch.setattr(publishing_svc, "publish_article", _publish)

    article = _done_article()
    await scheduler.maybe_auto_publish(article)

    assert seen["article_id"] == article.id
    assert seen["target_id"] == target.id


async def test_maybe_auto_publish_swallows_publish_error(monkeypatch):
    from marketer.repos.publish_targets import PublishTargetSecret
    from marketer.services.publishing import PublishError

    target = PublishTargetSecret(
        id=uuid4(), user_id="user_a", kind="webhook", name="hook",
        base_url="https://x.com/hook", username="", secret="s", disabled=False,
        created_at=datetime.now(timezone.utc),
    )

    async def _sole(user_id):
        return target

    import marketer.repos.publish_targets as targets_repo
    monkeypatch.setattr(targets_repo, "sole_enabled", _sole)

    async def _publish(article, tgt):
        raise PublishError("boom")

    import marketer.services.publishing as publishing_svc
    monkeypatch.setattr(publishing_svc, "publish_article", _publish)

    # Must not raise — auto-publish failures never surface to the caller.
    await scheduler.maybe_auto_publish(_done_article())
