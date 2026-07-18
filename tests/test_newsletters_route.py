"""HTTP surface for backend/routes/newsletters.py: settings CRUD, manual
compose, send, and digest listing. Repos + services are monkeypatched --
no real DB/LLM/email involved."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.repos.newsletters import NewsletterDigest, NewsletterSettings
from marketer.repos.spend import SpendCapExceeded

_USER = "user_newsletters_route"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="route@example.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _digest(**overrides) -> NewsletterDigest:
    base = dict(
        id=uuid4(), user_id=_USER, subject="Hi", markdown="body", html="<p>body</p>",
        article_ids=[], status="draft", error="", created_at=datetime.now(timezone.utc),
        sent_at=None,
    )
    base.update(overrides)
    return NewsletterDigest(**base)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


def test_get_settings_returns_defaults_when_unset(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    async def _get(user_id):
        return None

    monkeypatch.setattr(newsletters_repo, "get_settings", _get)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/newsletters/settings", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["cadence"] == "weekly"
    assert body["user_id"] == _USER


def test_put_settings_upserts(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    seen = {}

    async def _upsert(user_id, *, enabled, cadence, send_to):
        seen.update(user_id=user_id, enabled=enabled, cadence=cadence, send_to=send_to)
        return NewsletterSettings(
            user_id=user_id, enabled=enabled, cadence=cadence, send_to=send_to
        )

    monkeypatch.setattr(newsletters_repo, "upsert_settings", _upsert)
    client = _client(monkeypatch)
    resp = client.put(
        "/api/v1/newsletters/settings",
        json={"enabled": True, "cadence": "biweekly", "send_to": "you@example.com"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen == {
        "user_id": _USER, "enabled": True, "cadence": "biweekly",
        "send_to": "you@example.com",
    }
    assert resp.json()["cadence"] == "biweekly"


def test_put_settings_rejects_bad_cadence(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.put(
        "/api/v1/newsletters/settings",
        json={"enabled": True, "cadence": "daily"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /compose
# ---------------------------------------------------------------------------


def _fake_article(**overrides):
    from marketer.articles.models import Article, ArticleStatus

    base = dict(
        id=uuid4(), user_id=_USER, niche_id=uuid4(), status=ArticleStatus.done,
        topic="t", title="A finished article", created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return Article(**base)


def test_compose_returns_409_when_no_new_articles(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo
    import marketer.repos.newsletters as newsletters_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    async def _get_user(user_id):
        return User(id=user_id, email="acct@example.com")

    async def _get_settings(user_id):
        return None

    async def _list_articles(user_id, *, status=None, niche_id=None, limit=50):
        return []

    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(newsletters_repo, "get_settings", _get_settings)
    monkeypatch.setattr(articles_repo, "list_for_user", _list_articles)

    client = _client(monkeypatch)
    resp = client.post("/api/v1/newsletters/compose", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 409


def test_compose_success_persists_a_draft(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.newsletters as newsletters_repo
    import marketer.repos.users as users_repo
    from marketer.models import User
    from marketer.services.newsletter import ComposedDigest

    article = _fake_article()

    async def _get_user(user_id):
        return User(id=user_id, email="acct@example.com")

    async def _get_settings(user_id):
        return None

    async def _list_articles(user_id, *, status=None, niche_id=None, limit=50):
        return [article]

    async def _brand(user_id):
        return None

    async def _compose(user, articles, brand, *, spend=None):
        assert articles == [article]
        return ComposedDigest(subject="Ready", markdown="md", html="<p>md</p>", article_ids=[article.id])

    created = {}

    async def _create_digest(**kw):
        created.update(kw)
        return NewsletterDigest(
            id=uuid4(), user_id=kw["user_id"], subject=kw["subject"], markdown=kw["markdown"],
            html=kw["html"], article_ids=kw["article_ids"], status="draft",
        )

    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(newsletters_repo, "get_settings", _get_settings)
    monkeypatch.setattr(articles_repo, "list_for_user", _list_articles)
    monkeypatch.setattr(brand_kit_repo, "get", _brand)
    import backend.routes.newsletters as route_mod

    monkeypatch.setattr(route_mod, "compose", _compose)
    monkeypatch.setattr(newsletters_repo, "create_digest", _create_digest)

    client = _client(monkeypatch)
    resp = client.post("/api/v1/newsletters/compose", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["subject"] == "Ready"
    assert body["status"] == "draft"
    assert created["user_id"] == _USER


def test_compose_propagates_402_on_spend_cap(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.newsletters as newsletters_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    article = _fake_article()

    async def _get_user(user_id):
        return User(id=user_id, email="acct@example.com")

    async def _get_settings(user_id):
        return None

    async def _list_articles(user_id, *, status=None, niche_id=None, limit=50):
        return [article]

    async def _brand(user_id):
        return None

    async def _compose(user, articles, brand, *, spend=None):
        raise SpendCapExceeded("cap hit", scope="global")

    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(newsletters_repo, "get_settings", _get_settings)
    monkeypatch.setattr(articles_repo, "list_for_user", _list_articles)
    monkeypatch.setattr(brand_kit_repo, "get", _brand)
    import backend.routes.newsletters as route_mod

    monkeypatch.setattr(route_mod, "compose", _compose)

    client = _client(monkeypatch)
    resp = client.post("/api/v1/newsletters/compose", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 402


# ---------------------------------------------------------------------------
# POST /{digest_id}/send
# ---------------------------------------------------------------------------


def test_send_digest_404_when_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    async def _get_digest(digest_id, *, user_id):
        return None

    monkeypatch.setattr(newsletters_repo, "get_digest", _get_digest)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/newsletters/{uuid4()}/send", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 404


def test_send_digest_409_when_already_sent(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    digest = _digest(status="sent")

    async def _get_digest(digest_id, *, user_id):
        return digest

    monkeypatch.setattr(newsletters_repo, "get_digest", _get_digest)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/newsletters/{digest.id}/send", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 409


def test_send_digest_success_falls_back_to_account_email(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    digest = _digest()

    async def _get_digest(digest_id, *, user_id):
        return digest

    async def _get_settings(user_id):
        return None  # no send_to override -> falls back to ctx.email

    monkeypatch.setattr(newsletters_repo, "get_digest", _get_digest)
    monkeypatch.setattr(newsletters_repo, "get_settings", _get_settings)

    seen = {}

    async def _fake_send(d, to):
        seen["to"] = to
        return NewsletterDigest(
            id=d.id, user_id=d.user_id, subject=d.subject, status="sent",
            sent_at=datetime.now(timezone.utc),
        )

    import backend.routes.newsletters as route_mod

    monkeypatch.setattr(route_mod, "send", _fake_send)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/newsletters/{digest.id}/send", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "sent"
    assert seen["to"] == "route@example.com"  # ctx.email fallback


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def test_list_digests(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    digests = [_digest(), _digest(status="sent")]

    async def _list(user_id, *, limit=50):
        return digests

    monkeypatch.setattr(newsletters_repo, "list_digests", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/newsletters", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_digest_404_when_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    async def _get(digest_id, *, user_id):
        return None

    monkeypatch.setattr(newsletters_repo, "get_digest", _get)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/newsletters/{uuid4()}", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 404


def test_get_digest_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.newsletters as newsletters_repo

    digest = _digest()

    async def _get(digest_id, *, user_id):
        return digest

    monkeypatch.setattr(newsletters_repo, "get_digest", _get)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/newsletters/{digest.id}", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == str(digest.id)
