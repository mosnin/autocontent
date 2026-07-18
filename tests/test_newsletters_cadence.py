"""newsletter_cron cadence-window logic and the per-user autopilot pass.

Covers:
  - _cadence_elapsed boundaries for weekly/biweekly/monthly, and the
    never-sent-yet (last_sent_at is None) always-due case.
  - run() is a full no-op when settings.newsletters_enabled is False.
  - a user whose cadence window hasn't elapsed yet is skipped without
    touching articles/compose/send at all.
  - a user whose window has elapsed but has zero new done articles is
    skipped (never sends an empty digest on cadence alone).
  - a user who is due AND has new articles gets composed + sent, and
    last_sent_at is bumped only on a successful send.
  - a send failure is recorded (status stays counted as 'failed') and
    last_sent_at is NOT bumped, so the user is retried next pass.
  - one user's failure (compose raises) never stops the pass for others.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from marketer.repos.newsletters import NewsletterDigest, NewsletterSettings
from marketer.repos.spend import SpendCapExceeded
from marketer.services import newsletter_cron


# ---------------------------------------------------------------------------
# _cadence_elapsed
# ---------------------------------------------------------------------------


def test_cadence_elapsed_never_sent_is_always_due():
    assert newsletter_cron._cadence_elapsed("weekly", None) is True
    assert newsletter_cron._cadence_elapsed("monthly", None) is True


def test_cadence_elapsed_weekly_boundary():
    now = datetime(2026, 7, 18, tzinfo=timezone.utc)
    just_under = now - timedelta(days=7) + timedelta(minutes=1)
    exactly = now - timedelta(days=7)
    over = now - timedelta(days=8)
    assert newsletter_cron._cadence_elapsed("weekly", just_under, now=now) is False
    assert newsletter_cron._cadence_elapsed("weekly", exactly, now=now) is True
    assert newsletter_cron._cadence_elapsed("weekly", over, now=now) is True


def test_cadence_elapsed_biweekly_boundary():
    now = datetime(2026, 7, 18, tzinfo=timezone.utc)
    assert newsletter_cron._cadence_elapsed(
        "biweekly", now - timedelta(days=13), now=now
    ) is False
    assert newsletter_cron._cadence_elapsed(
        "biweekly", now - timedelta(days=14), now=now
    ) is True


def test_cadence_elapsed_monthly_boundary():
    now = datetime(2026, 7, 18, tzinfo=timezone.utc)
    assert newsletter_cron._cadence_elapsed(
        "monthly", now - timedelta(days=29), now=now
    ) is False
    assert newsletter_cron._cadence_elapsed(
        "monthly", now - timedelta(days=30), now=now
    ) is True


def test_cadence_elapsed_unknown_cadence_falls_back_to_weekly():
    now = datetime(2026, 7, 18, tzinfo=timezone.utc)
    assert newsletter_cron._cadence_elapsed(
        "bogus", now - timedelta(days=6), now=now
    ) is False
    assert newsletter_cron._cadence_elapsed(
        "bogus", now - timedelta(days=7), now=now
    ) is True


# ---------------------------------------------------------------------------
# run() -- feature flag
# ---------------------------------------------------------------------------


async def test_run_disabled_is_a_full_noop(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "newsletters_enabled", False)

    async def _boom():
        raise AssertionError("must not scan settings when newsletters are disabled")

    import marketer.repos.newsletters as newsletters_repo

    monkeypatch.setattr(newsletters_repo, "list_enabled_settings", _boom)

    result = await newsletter_cron.run()
    assert result == {"skipped": "disabled"}


# ---------------------------------------------------------------------------
# run() -- per-user gating + fail-soft isolation
# ---------------------------------------------------------------------------


def _setting(user_id, *, cadence="weekly", last_sent_at=None, send_to=""):
    return NewsletterSettings(
        user_id=user_id, enabled=True, cadence=cadence, send_to=send_to,
        last_sent_at=last_sent_at,
    )


def _article(created_at):
    from marketer.articles.models import Article, ArticleStatus

    return Article(
        id=uuid4(), user_id="u", niche_id=uuid4(), status=ArticleStatus.done,
        topic="t", title="A great article", created_at=created_at,
    )


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "newsletters_enabled", True)


async def test_cadence_not_elapsed_is_skipped_without_touching_articles(monkeypatch):
    import marketer.repos.newsletters as newsletters_repo

    setting = _setting("u1", last_sent_at=datetime.now(timezone.utc))

    async def _list():
        return [setting]

    async def _boom(*a, **k):
        raise AssertionError("must not look up articles when cadence hasn't elapsed")

    monkeypatch.setattr(newsletters_repo, "list_enabled_settings", _list)
    monkeypatch.setattr(newsletter_cron, "_new_done_articles", _boom)

    result = await newsletter_cron.run()
    assert result == {"sent": 0, "skipped": 1, "failed": 0}


async def test_due_but_no_new_articles_is_skipped(monkeypatch):
    import marketer.repos.newsletters as newsletters_repo

    setting = _setting("u1", last_sent_at=None)  # never sent -> always due

    async def _list():
        return [setting]

    async def _articles(user_id, since):
        return []

    async def _boom(*a, **k):
        raise AssertionError("must not compose with zero new articles")

    monkeypatch.setattr(newsletters_repo, "list_enabled_settings", _list)
    monkeypatch.setattr(newsletter_cron, "_new_done_articles", _articles)
    import marketer.services.newsletter as newsletter_svc

    monkeypatch.setattr(newsletter_svc, "compose", _boom)

    result = await newsletter_cron.run()
    assert result == {"sent": 0, "skipped": 1, "failed": 0}


async def test_due_with_new_articles_composes_sends_and_bumps_last_sent_at(monkeypatch):
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.newsletters as newsletters_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    setting = _setting("u1", last_sent_at=None, send_to="reader@example.com")
    article = _article(datetime.now(timezone.utc))

    async def _list():
        return [setting]

    async def _articles(user_id, since):
        assert user_id == "u1"
        return [article]

    async def _get_user(user_id):
        return User(id="u1", email="acct@example.com")

    async def _brand(user_id):
        return None

    monkeypatch.setattr(newsletters_repo, "list_enabled_settings", _list)
    monkeypatch.setattr(newsletter_cron, "_new_done_articles", _articles)
    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(brand_kit_repo, "get", _brand)

    from marketer.services.newsletter import ComposedDigest

    async def _compose(user, articles, brand, *, spend=None):
        assert articles == [article]
        return ComposedDigest(subject="Hi", markdown="body", html="<p>body</p>", article_ids=[article.id])

    created = {}

    async def _create_digest(**kw):
        created.update(kw)
        return NewsletterDigest(id=uuid4(), user_id="u1", subject=kw["subject"], status="draft")

    sent_calls = []

    async def _send(digest, to):
        sent_calls.append(to)
        return NewsletterDigest(
            id=digest.id, user_id="u1", subject=digest.subject, status="sent",
            sent_at=datetime.now(timezone.utc),
        )

    bumped = {}

    async def _mark_sent_at(user_id, *, when):
        bumped["user_id"] = user_id
        bumped["when"] = when

    import marketer.services.newsletter as newsletter_svc

    monkeypatch.setattr(newsletter_svc, "compose", _compose)
    monkeypatch.setattr(newsletter_svc, "send", _send)
    monkeypatch.setattr(newsletters_repo, "create_digest", _create_digest)
    monkeypatch.setattr(newsletters_repo, "mark_sent_at", _mark_sent_at)

    result = await newsletter_cron.run()

    assert result == {"sent": 1, "skipped": 0, "failed": 0}
    # send_to on the settings row wins over the account email fallback.
    assert sent_calls == ["reader@example.com"]
    assert bumped["user_id"] == "u1"
    assert created["subject"] == "Hi"


async def test_send_failure_is_counted_failed_and_does_not_bump_last_sent_at(monkeypatch):
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.newsletters as newsletters_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    setting = _setting("u1", last_sent_at=None)
    article = _article(datetime.now(timezone.utc))

    async def _list():
        return [setting]

    async def _articles(user_id, since):
        return [article]

    async def _get_user(user_id):
        return User(id="u1", email="acct@example.com")

    async def _brand(user_id):
        return None

    from marketer.services.newsletter import ComposedDigest

    async def _compose(user, articles, brand, *, spend=None):
        return ComposedDigest(subject="Hi", markdown="body", html="<p>body</p>", article_ids=[])

    async def _create_digest(**kw):
        return NewsletterDigest(id=uuid4(), user_id="u1", subject=kw["subject"], status="draft")

    async def _send(digest, to):
        return NewsletterDigest(id=digest.id, user_id="u1", status="failed", error="boom")

    async def _boom_mark_sent_at(*a, **k):
        raise AssertionError("must not bump last_sent_at on a failed send")

    import marketer.services.newsletter as newsletter_svc

    monkeypatch.setattr(newsletters_repo, "list_enabled_settings", _list)
    monkeypatch.setattr(newsletter_cron, "_new_done_articles", _articles)
    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(brand_kit_repo, "get", _brand)
    monkeypatch.setattr(newsletter_svc, "compose", _compose)
    monkeypatch.setattr(newsletter_svc, "send", _send)
    monkeypatch.setattr(newsletters_repo, "create_digest", _create_digest)
    monkeypatch.setattr(newsletters_repo, "mark_sent_at", _boom_mark_sent_at)

    result = await newsletter_cron.run()
    assert result == {"sent": 0, "skipped": 0, "failed": 1}


async def test_one_user_failure_does_not_stop_the_pass(monkeypatch):
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.newsletters as newsletters_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    broken = _setting("broken", last_sent_at=None)
    ok = _setting("ok", last_sent_at=None)
    article = _article(datetime.now(timezone.utc))

    async def _list():
        return [broken, ok]

    async def _articles(user_id, since):
        return [article]

    async def _get_user(user_id):
        if user_id == "broken":
            raise RuntimeError("db exploded")
        return User(id=user_id, email="acct@example.com")

    async def _brand(user_id):
        return None

    from marketer.services.newsletter import ComposedDigest

    async def _compose(user, articles, brand, *, spend=None):
        return ComposedDigest(subject="Hi", markdown="body", html="<p>body</p>", article_ids=[])

    async def _create_digest(**kw):
        return NewsletterDigest(id=uuid4(), user_id=kw["user_id"], subject=kw["subject"], status="draft")

    async def _send(digest, to):
        return NewsletterDigest(id=digest.id, user_id=digest.user_id, status="sent",
                                 sent_at=datetime.now(timezone.utc))

    async def _mark_sent_at(user_id, *, when):
        pass

    import marketer.services.newsletter as newsletter_svc

    monkeypatch.setattr(newsletters_repo, "list_enabled_settings", _list)
    monkeypatch.setattr(newsletter_cron, "_new_done_articles", _articles)
    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(brand_kit_repo, "get", _brand)
    monkeypatch.setattr(newsletter_svc, "compose", _compose)
    monkeypatch.setattr(newsletter_svc, "send", _send)
    monkeypatch.setattr(newsletters_repo, "create_digest", _create_digest)
    monkeypatch.setattr(newsletters_repo, "mark_sent_at", _mark_sent_at)

    result = await newsletter_cron.run()
    # "broken" raised inside users_repo.get -> counted failed; "ok" still sends.
    assert result == {"sent": 1, "skipped": 0, "failed": 1}


async def test_spend_cap_exceeded_is_caught_and_counted_failed(monkeypatch):
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.newsletters as newsletters_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    setting = _setting("u1", last_sent_at=None)
    article = _article(datetime.now(timezone.utc))

    async def _list():
        return [setting]

    async def _articles(user_id, since):
        return [article]

    async def _get_user(user_id):
        return User(id="u1", email="acct@example.com")

    async def _brand(user_id):
        return None

    async def _compose(user, articles, brand, *, spend=None):
        raise SpendCapExceeded("cap hit", scope="global")

    import marketer.services.newsletter as newsletter_svc

    monkeypatch.setattr(newsletters_repo, "list_enabled_settings", _list)
    monkeypatch.setattr(newsletter_cron, "_new_done_articles", _articles)
    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(brand_kit_repo, "get", _brand)
    monkeypatch.setattr(newsletter_svc, "compose", _compose)

    result = await newsletter_cron.run()
    assert result == {"sent": 0, "skipped": 0, "failed": 1}
