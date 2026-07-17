"""POST /press/articles/{id}/publish and GET .../publishes — the route
layer around services/publishing.py (service itself is mocked here; see
test_publish_service.py for the HTTP-level behavior)."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.articles.models import Article, ArticlePublish, ArticleStatus
from marketer.repos.publish_targets import PublishTargetSecret

_USER = "user_publish_route"
_ARTICLE_ID = UUID("66666666-6666-6666-6666-666666666666")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _article(status=ArticleStatus.done, md="# T\n\nBody.") -> Article:
    return Article(
        id=_ARTICLE_ID, user_id=_USER, niche_id=uuid4(), status=status,
        topic="espresso", title="Dial in espresso", article_markdown=md,
        created_at=datetime.now(timezone.utc),
    )


def _target() -> PublishTargetSecret:
    return PublishTargetSecret(
        id=uuid4(), user_id=_USER, kind="wordpress", name="Blog",
        base_url="https://b.com", username="e", secret="s", disabled=False,
        created_at=datetime.now(timezone.utc),
    )


def test_publish_route_success(monkeypatch):
    _reset_limiter()
    import backend.routes.press as press
    import marketer.repos.articles as articles_repo
    import marketer.repos.publish_targets as targets_repo

    tid = uuid4()

    async def _get_article(article_id, *, user_id):
        return _article()

    async def _get_target(target_id, *, user_id):
        return _target()

    async def _publish(article, target):
        return ArticlePublish(
            id=uuid4(), article_id=article.id, target_id=target.id,
            status="ok", external_url="https://b.com/post/1",
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(articles_repo, "get", _get_article)
    monkeypatch.setattr(targets_repo, "get_with_secret", _get_target)
    monkeypatch.setattr(press, "publish_article", _publish)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/press/articles/{_ARTICLE_ID}/publish",
        json={"target_id": str(tid)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["external_url"] == "https://b.com/post/1"


def test_publish_route_409_when_article_not_done(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    async def _get_article(article_id, *, user_id):
        return _article(status=ArticleStatus.writing, md=None)

    monkeypatch.setattr(articles_repo, "get", _get_article)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/press/articles/{_ARTICLE_ID}/publish",
        json={"target_id": str(uuid4())},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_publish_route_404_when_target_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo
    import marketer.repos.publish_targets as targets_repo

    async def _get_article(article_id, *, user_id):
        return _article()

    async def _get_target(target_id, *, user_id):
        return None

    monkeypatch.setattr(articles_repo, "get", _get_article)
    monkeypatch.setattr(targets_repo, "get_with_secret", _get_target)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/press/articles/{_ARTICLE_ID}/publish",
        json={"target_id": str(uuid4())},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_publish_route_502_on_publish_error(monkeypatch):
    _reset_limiter()
    import backend.routes.press as press
    import marketer.repos.articles as articles_repo
    import marketer.repos.publish_targets as targets_repo
    from marketer.services.publishing import PublishError

    async def _get_article(article_id, *, user_id):
        return _article()

    async def _get_target(target_id, *, user_id):
        return _target()

    async def _publish(article, target):
        raise PublishError("wordpress publish failed: 500 boom")

    monkeypatch.setattr(articles_repo, "get", _get_article)
    monkeypatch.setattr(targets_repo, "get_with_secret", _get_target)
    monkeypatch.setattr(press, "publish_article", _publish)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/press/articles/{_ARTICLE_ID}/publish",
        json={"target_id": str(uuid4())},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 502


def test_list_publishes_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    async def _get_article(article_id, *, user_id):
        return _article()

    async def _list_publishes(article_id, *, user_id):
        return [
            ArticlePublish(
                id=uuid4(), article_id=article_id, target_id=uuid4(),
                status="ok", external_url="https://b.com/1",
                created_at=datetime.now(timezone.utc),
            )
        ]

    monkeypatch.setattr(articles_repo, "get", _get_article)
    monkeypatch.setattr(articles_repo, "list_publishes", _list_publishes)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/press/articles/{_ARTICLE_ID}/publishes",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["status"] == "ok"


def test_list_publishes_404_when_article_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.articles as articles_repo

    async def _get_article(article_id, *, user_id):
        return None

    monkeypatch.setattr(articles_repo, "get", _get_article)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/press/articles/{_ARTICLE_ID}/publishes",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
