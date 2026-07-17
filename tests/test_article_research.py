"""GET /api/v1/articles/{id}/research — the stored SERP analysis, link
suggestions, and QA score for one article."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.articles.models import Article, InterlinkSuggestion, QualityScore

_USER = "user_research"
_ARTICLE_ID = UUID("88888888-8888-8888-8888-888888888888")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="r@r.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_research_returns_stored_fields(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    art = Article(
        id=_ARTICLE_ID, user_id=_USER, niche_id=uuid4(), topic="espresso",
        title="Dial in espresso", created_at=datetime.now(timezone.utc),
        serp_analysis={"avgWordCount": 1800, "commonHeadings": ["Grind size"]},
        link_suggestions=[InterlinkSuggestion(anchor="grinders", targetUrl="/grinders", score=0.9)],
        quality=QualityScore(overall=0.85, keywordDensity=0.01, eeatScore=0.8, readability=0.9),
    )

    async def _get(article_id, *, user_id):
        assert article_id == _ARTICLE_ID
        assert user_id == _USER
        return art

    monkeypatch.setattr(articles_repo, "get", _get)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/articles/{_ARTICLE_ID}/research",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["serp_analysis"]["avgWordCount"] == 1800
    assert body["link_suggestions"][0]["targetUrl"] == "/grinders"
    assert body["quality"]["overall"] == 0.85


def test_research_returns_nulls_when_not_researched_yet(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    art = Article(
        id=_ARTICLE_ID, user_id=_USER, niche_id=uuid4(), topic="espresso",
        created_at=datetime.now(timezone.utc),
    )

    async def _get(article_id, *, user_id):
        return art

    monkeypatch.setattr(articles_repo, "get", _get)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/articles/{_ARTICLE_ID}/research",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["serp_analysis"] is None
    assert body["link_suggestions"] == []
    assert body["quality"] is None


def test_research_404_when_article_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    async def _get(article_id, *, user_id):
        return None

    monkeypatch.setattr(articles_repo, "get", _get)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/articles/{_ARTICLE_ID}/research",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
