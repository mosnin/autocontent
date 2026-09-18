"""Scheduled-article cron + the public-URL SQL predicates.

`plan_publish` is already covered in test_cms_publish.py. This file pins the
repo and Modal wiring that actually flip scheduled rows live: a wrong WHERE
clause publishes drafts, a missing user/article predicate leaks another
tenant's revision, and un-wiring publish_due from the minute tick leaves
scheduled articles unpublished forever.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from marketer.cms.schemas import CmsArticle, PublicationState, Revision
from marketer.repos import article_revisions as repo

_USER = "user_cms_due"
_NOW = datetime(2026, 9, 18, 10, 0, tzinfo=timezone.utc)
_ARTICLE_ID = UUID("55555555-5555-5555-5555-555555555555")
_REVISION_ID = UUID("66666666-6666-6666-6666-666666666666")


def _article_row(**overrides) -> dict:
    base = {
        "id": _ARTICLE_ID,
        "user_id": _USER,
        "niche_id": uuid4(),
        "status": "done",
        "publication_state": PublicationState.published,
        "title": "SEO Basics",
        "slug": "seo-basics",
        "meta_description": None,
        "article_markdown": "# SEO Basics",
        "word_count": 12,
        "published_at": _NOW,
        "scheduled_at": None,
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    base.update(overrides)
    return base


def _revision_row(**overrides) -> dict:
    base = {
        "id": _REVISION_ID,
        "article_id": _ARTICLE_ID,
        "revision_number": 2,
        "changed_fields": ["title"],
        "summary": "title",
        "source": "edit",
        "restored_from_revision_id": None,
        "created_at": _NOW,
        "title": "Older",
        "slug": "seo-basics",
        "meta_description": None,
        "article_markdown": "# Older",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# publish_due — the minute-tick flip
# ---------------------------------------------------------------------------


async def test_publish_due_only_flips_scheduled_rows_that_are_due(monkeypatch):
    captured: dict = {}

    class _Pool:
        async def execute(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return "UPDATE 3"

    async def _pool():
        return _Pool()

    monkeypatch.setattr(repo, "get_pool", _pool)
    assert await repo.publish_due(now=_NOW) == 3

    sql = " ".join(captured["sql"].split())
    assert "update articles" in sql
    assert "publication_state = 'published'" in sql
    assert "publication_state = 'scheduled'" in sql
    assert "scheduled_at <= coalesce($1::timestamptz, now())" in sql
    # Never re-stamp a dateline that already exists — crawlers treat a
    # moving published_at as content churn.
    assert "published_at = coalesce(published_at, scheduled_at, now())" in sql
    assert "scheduled_at = null" in sql
    assert captured["args"] == (_NOW,)


async def test_publish_due_is_idempotent_when_nothing_is_due(monkeypatch):
    class _Pool:
        async def execute(self, sql, *args):
            return "UPDATE 0"

    async def _pool():
        return _Pool()

    monkeypatch.setattr(repo, "get_pool", _pool)
    assert await repo.publish_due(now=_NOW) == 0


def test_dispatch_cron_publishes_due_articles_on_the_same_tick():
    """The repo docstring still says this is unwired. The minute cron in
    modal_app.py is the live clock — dropping the call leaves every
    scheduled article stuck until someone hits POST /publish."""
    source = Path(__file__).resolve().parent.parent.joinpath("modal_app.py").read_text()
    fn = source.split("async def dispatch_scheduled_posts")[1].split(
        "async def publish_scheduled_post"
    )[0]
    assert "from marketer.repos.article_revisions import publish_due" in fn
    assert "result[\"published_articles\"] = await publish_due()" in fn


# ---------------------------------------------------------------------------
# Public-URL / revision predicates the HTTP suite stubs away
# ---------------------------------------------------------------------------


async def test_get_article_by_slug_sql_requires_published(monkeypatch):
    """A draft that happens to hold the slug must not answer a public URL."""
    captured: dict = {}

    class _Pool:
        async def fetchrow(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return _article_row()

    async def _pool():
        return _Pool()

    monkeypatch.setattr(repo, "get_pool", _pool)
    article = await repo.get_article_by_slug("seo-basics", user_id=_USER)
    assert isinstance(article, CmsArticle)
    assert article.slug == "seo-basics"

    sql = " ".join(captured["sql"].split())
    assert "publication_state = 'published'" in sql
    assert "user_id = $1" in sql
    assert "slug = $2" in sql
    assert captured["args"] == (_USER, "seo-basics")


async def test_get_article_by_slug_returns_none_when_no_live_row(monkeypatch):
    class _Pool:
        async def fetchrow(self, sql, *args):
            return None

    async def _pool():
        return _Pool()

    monkeypatch.setattr(repo, "get_pool", _pool)
    assert await repo.get_article_by_slug("draft-only", user_id=_USER) is None


async def test_get_revision_sql_binds_article_and_user(monkeypatch):
    """A revision id from another article of the same user must not resolve
    under this article's URL — both ids are predicates, not just user_id."""
    captured: dict = {}

    class _Pool:
        async def fetchrow(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return _revision_row()

    async def _pool():
        return _Pool()

    monkeypatch.setattr(repo, "get_pool", _pool)
    revision = await repo.get_revision(
        _REVISION_ID, article_id=_ARTICLE_ID, user_id=_USER
    )
    assert isinstance(revision, Revision)
    assert revision.id == _REVISION_ID

    sql = " ".join(captured["sql"].split())
    assert "id = $1 and article_id = $2 and user_id = $3" in sql
    assert captured["args"] == (_REVISION_ID, _ARTICLE_ID, _USER)
