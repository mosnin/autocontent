"""Article -> social repurposing (content multiplication)."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.articles.models import Article, ArticleStatus

_USER = "user_social_1"
_AID = uuid4()


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="s@s.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _article(status=ArticleStatus.done, md="# T\n\nBody.") -> Article:
    return Article(
        id=_AID, user_id=_USER, niche_id=uuid4(), status=status,
        topic="espresso", title="Dial in espresso", article_markdown=md,
        created_at=datetime.now(timezone.utc),
    )


def test_repurpose_returns_snippets(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as arepo
    import marketer.repos.niches as nrepo
    import marketer.articles.llm as llm
    import marketer.services.spend_context as sc
    from marketer.articles.models import SocialSnippet
    from types import SimpleNamespace

    async def _get(aid, *, user_id):
        return _article()

    async def _niche(nid, *, user_id):
        return SimpleNamespace(daily_spend_cap_usd=Decimal("3"))

    async def _ctx(**kw):
        return SimpleNamespace()

    async def _gen(title, md, platforms, *, spend=None):
        return [
            SocialSnippet(platform="twitter", body="Great espresso tips", hashtags=["#coffee"]),
            SocialSnippet(platform="linkedin", body="How to dial in espresso", hashtags=[]),
        ]

    monkeypatch.setattr(arepo, "get", _get)
    monkeypatch.setattr(nrepo, "get", _niche)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(llm, "generate_social_snippets", _gen)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/articles/{_AID}/social",
        json={"platforms": ["twitter", "linkedin"]},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    plats = {s["platform"] for s in resp.json()["snippets"]}
    assert plats == {"twitter", "linkedin"}


def test_repurpose_409_when_not_done(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as arepo

    async def _get(aid, *, user_id):
        return _article(status=ArticleStatus.writing, md=None)

    monkeypatch.setattr(arepo, "get", _get)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/articles/{_AID}/social", json={},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_repurpose_402_on_cap(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as arepo
    import marketer.repos.niches as nrepo
    import marketer.articles.llm as llm
    import marketer.services.spend_context as sc
    from marketer.repos.spend import SpendCapExceeded
    from types import SimpleNamespace

    async def _get(aid, *, user_id):
        return _article()

    async def _niche(nid, *, user_id):
        return SimpleNamespace(daily_spend_cap_usd=Decimal("3"))

    async def _ctx(**kw):
        return SimpleNamespace()

    async def _gen(*a, **k):
        raise SpendCapExceeded("niche cap hit", scope="niche")

    monkeypatch.setattr(arepo, "get", _get)
    monkeypatch.setattr(nrepo, "get", _niche)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(llm, "generate_social_snippets", _gen)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/articles/{_AID}/social", json={},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
