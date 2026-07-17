"""GET /api/v1/press/links — cross-corpus internal-link opportunities built
from interlink_candidates (live corpus) + each article's stored
link_suggestions, filtered to targets still present in the corpus."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.articles.models import Article, ArticleStatus, InterlinkSuggestion

_USER = "user_press_links"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="l@l.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_links_filters_to_live_corpus(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    async def _candidates(user_id, *, limit=200):
        return [{"title": "Grinder guide", "slug": "grinder-guide"}]

    a1 = Article(
        id=uuid4(), user_id=_USER, niche_id=uuid4(), status=ArticleStatus.done,
        topic="t1", title="Dial in espresso", created_at=datetime.now(timezone.utc),
        link_suggestions=[
            InterlinkSuggestion(anchor="grinder guide", targetUrl="/grinder-guide", score=0.9),
            # Points at an article that no longer exists in the corpus.
            InterlinkSuggestion(anchor="stale", targetUrl="/deleted-post", score=0.5),
        ],
    )
    a2 = Article(
        id=uuid4(), user_id=_USER, niche_id=uuid4(), status=ArticleStatus.done,
        topic="t2", title="No suggestions", created_at=datetime.now(timezone.utc),
    )

    async def _list_for_user(user_id, *, status=None, niche_id=None, limit=50):
        assert status == ArticleStatus.done
        return [a1, a2]

    monkeypatch.setattr(articles_repo, "interlink_candidates", _candidates)
    monkeypatch.setattr(articles_repo, "list_for_user", _list_for_user)

    client = _client(monkeypatch)
    resp = client.get("/api/v1/press/links", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["article_id"] == str(a1.id)
    assert body[0]["title"] == "Dial in espresso"
    assert len(body[0]["suggestions"]) == 1
    assert body[0]["suggestions"][0]["targetUrl"] == "/grinder-guide"
