"""Route tests for /api/v1/articles — the written-content surface."""
from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from marketer.articles.models import Article, ArticleStatus

_USER_ID = "user_articles_test"
_NICHE_ID = UUID("44444444-4444-4444-4444-444444444444")
_ARTICLE_ID = UUID("55555555-5555-5555-5555-555555555555")


def _make_article(
    *,
    status: ArticleStatus = ArticleStatus.queued,
    markdown: str | None = None,
) -> Article:
    return Article(
        id=_ARTICLE_ID,
        user_id=_USER_ID,
        niche_id=_NICHE_ID,
        status=status,
        topic="how to test pipelines",
        slug="how-to-test-pipelines",
        article_markdown=markdown,
        created_at=datetime.now(timezone.utc),
    )


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def _stub_modal(monkeypatch, spawned: list[tuple]):
    class _FakeFn:
        def spawn(self, *a):
            spawned.append(a)

    fake_modal = types.SimpleNamespace(
        Function=types.SimpleNamespace(from_name=lambda app, name: _FakeFn())
    )
    monkeypatch.setitem(sys.modules, "modal", fake_modal)


def test_list_articles_returns_200(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    async def _list(user_id, *, status=None, niche_id=None, limit=50):
        assert user_id == _USER_ID
        return [_make_article()]

    monkeypatch.setattr(articles_repo, "list_for_user", _list)
    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/articles", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json()[0]["topic"] == "how to test pipelines"


def test_list_articles_rejects_bad_limit(monkeypatch):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/articles?limit=-1", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 422


def test_get_article_404_when_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    async def _get(article_id, *, user_id):
        return None

    monkeypatch.setattr(articles_repo, "get", _get)
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/articles/{_ARTICLE_ID}", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 404


def test_markdown_download(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    art = _make_article(status=ArticleStatus.done, markdown="# Hello\n\nWorld.")

    async def _get(article_id, *, user_id):
        return art

    monkeypatch.setattr(articles_repo, "get", _get)
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/articles/{_ARTICLE_ID}/markdown",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.text.startswith("# Hello")
    assert "how-to-test-pipelines.md" in resp.headers["content-disposition"]


def test_enqueue_article_202_and_spawns_with_article_id(monkeypatch):
    """POST creates the row, verifies niche ownership, and passes the
    article id into the Modal spawn so THAT row progresses."""
    _reset_limiter()
    import marketer.repos.articles as articles_repo
    import marketer.repos.niches as niches_repo

    art = _make_article()

    async def _create(*, user_id, niche_id, topic=""):
        assert user_id == _USER_ID
        return art

    async def _niche_get(niche_id, *, user_id):
        return types.SimpleNamespace(id=niche_id)

    monkeypatch.setattr(articles_repo, "create", _create)
    monkeypatch.setattr(niches_repo, "get", _niche_get)

    spawned: list[tuple] = []
    _stub_modal(monkeypatch, spawned)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/articles",
        json={"niche_id": str(_NICHE_ID), "topic": "test topic"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 202
    assert spawned == [(_USER_ID, str(_NICHE_ID), str(_ARTICLE_ID), "test topic")]


def test_enqueue_article_404_on_foreign_niche(monkeypatch):
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _niche_get(niche_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/articles",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_retry_article_conflicts_when_not_failed(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    art = _make_article(status=ArticleStatus.done)

    async def _get(article_id, *, user_id):
        return art

    monkeypatch.setattr(articles_repo, "get", _get)
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/articles/{_ARTICLE_ID}/retry",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_retry_article_respawns_same_row(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    art = _make_article(status=ArticleStatus.failed)
    saved: list[Article] = []

    async def _get(article_id, *, user_id):
        return art

    async def _save(a):
        saved.append(a)

    monkeypatch.setattr(articles_repo, "get", _get)
    monkeypatch.setattr(articles_repo, "save", _save)

    spawned: list[tuple] = []
    _stub_modal(monkeypatch, spawned)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/articles/{_ARTICLE_ID}/retry",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 202
    assert saved and saved[0].status == ArticleStatus.queued
    assert spawned[0][2] == str(_ARTICLE_ID)
