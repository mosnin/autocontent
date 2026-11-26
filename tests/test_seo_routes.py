"""SEO article routes through the real app: permissions, the WordPress
connection (sealed secret never returned, SSRF refusal), metadata
validation, publishing and the batch endpoints. No database, no network."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.repos.wordpress import WordPressConnection
from tests.auth_helpers import DEFAULT_TENANT, as_role
from tests.seo_fakes import KEY, FakeWordPress, SeoStore, connect, done_article, public_resolver

PASSWORD = "abcd efgh ijkl mnop"


@pytest.fixture
def audit_rows(monkeypatch):
    from marketer.repos import security_audit

    rows: list[dict] = []

    async def _insert(**kw):
        rows.append(kw)
        return len(rows)

    monkeypatch.setattr(security_audit, "insert", _insert)
    return rows


@pytest.fixture
def app(monkeypatch, audit_rows):
    from marketer.config import settings

    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "auth_database_url", "")
    monkeypatch.setattr(settings, "integration_secret_key", KEY)
    from backend.main import create_app

    a = create_app()
    yield a
    a.dependency_overrides.clear()


@pytest.fixture
def wp_repo(monkeypatch):
    """Fake wordpress_connections table, keeping what was written."""
    from marketer.repos import wordpress as repo

    saved: dict = {}

    async def upsert(**kw):
        saved.update(kw)
        return WordPressConnection(
            id=uuid4(), user_id=kw["user_id"], site_url=kw["site_url"], username=kw["username"],
            seo_plugin=kw["seo_plugin"], status="active",
        )

    async def get(user_id):
        if not saved:
            return None
        return WordPressConnection(
            id=uuid4(), user_id=user_id, site_url=saved["site_url"], username=saved["username"],
            seo_plugin=saved["seo_plugin"], status="active",
        )

    async def delete(user_id):
        had = bool(saved)
        saved.clear()
        return had

    monkeypatch.setattr(repo, "upsert", upsert)
    monkeypatch.setattr(repo, "get", get)
    monkeypatch.setattr(repo, "delete", delete)
    return saved


@pytest.fixture
def fake_site(monkeypatch):
    """Every WordPressClient built by the routes talks to a fake site."""
    from marketer.services import wordpress as wp

    site = FakeWordPress()
    real_init = wp.WordPressClient.__init__

    def init(self, s, *, transport=None, resolver=None):
        real_init(self, s, transport=site.transport, resolver=resolver or public_resolver)

    monkeypatch.setattr(wp.WordPressClient, "__init__", init)
    return site


def _connect_body(**kw):
    return {"site_url": "https://blog.example.com", "username": "editor", "app_password": PASSWORD, "seo_plugin": "yoast", **kw}


# ── WordPress connection ─────────────────────────────────────────────────────


def test_connect_seals_the_password_and_never_returns_it(app, wp_repo, fake_site, audit_rows):
    as_role(app, "marketer")
    client = TestClient(app)
    r = client.put("/api/v1/integrations/wordpress", json=_connect_body())
    assert r.status_code == 200, r.text
    assert PASSWORD not in r.text and PASSWORD.replace(" ", "") not in r.text
    body = r.json()
    assert body["connected"] and body["has_password"] and body["can_publish"] is True
    assert "app_password" not in body and "password_sealed" not in body
    assert wp_repo["password_sealed"].startswith("v1:")
    assert PASSWORD.replace(" ", "") not in wp_repo["password_sealed"]
    g = client.get("/api/v1/integrations/wordpress")
    assert g.status_code == 200 and PASSWORD.replace(" ", "") not in g.text and "sealed" not in g.text
    assert any(row["action"] == "integration.connected" and row["outcome"] == "success" for row in audit_rows)
    assert all(PASSWORD.replace(" ", "") not in json.dumps(row, default=str) for row in audit_rows)


@pytest.mark.parametrize("url", ["https://127.0.0.1", "https://169.254.169.254", "http://blog.example.com"])
def test_connect_refuses_internal_or_plain_http_sites(app, wp_repo, monkeypatch, url):
    from marketer.services import wordpress as wp

    site = FakeWordPress()
    real_init = wp.WordPressClient.__init__
    monkeypatch.setattr(wp.WordPressClient, "__init__", lambda self, s, **k: real_init(self, s, transport=site.transport))
    as_role(app, "owner")
    r = TestClient(app).put("/api/v1/integrations/wordpress", json=_connect_body(site_url=url))
    assert r.status_code == 422
    assert site.requests == [] and wp_repo == {}


def test_connect_with_bad_credentials_saves_nothing(app, wp_repo, monkeypatch):
    from marketer.services import wordpress as wp

    site = FakeWordPress(fail=401)
    real_init = wp.WordPressClient.__init__
    monkeypatch.setattr(wp.WordPressClient, "__init__", lambda self, s, **k: real_init(self, s, transport=site.transport, resolver=public_resolver))
    as_role(app, "owner")
    r = TestClient(app).put("/api/v1/integrations/wordpress", json=_connect_body())
    assert r.status_code == 422 and wp_repo == {}


def test_connect_without_a_sealing_key_is_refused(app, wp_repo, fake_site, monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "integration_secret_key", "")
    as_role(app, "owner")
    r = TestClient(app).put("/api/v1/integrations/wordpress", json=_connect_body())
    assert r.status_code == 503 and wp_repo == {}


@pytest.mark.parametrize("role,status", [("analyst", 403), ("billing", 403), ("marketer", 200), ("admin", 200)])
def test_connect_needs_integration_connect(app, wp_repo, fake_site, role, status):
    as_role(app, role)
    r = TestClient(app).put("/api/v1/integrations/wordpress", json=_connect_body())
    assert r.status_code == status
    if status == 403:
        assert r.json()["permission"] == "integration:connect"


def test_agent_cannot_connect_or_disconnect(app, wp_repo, fake_site):
    as_role(app, "agent", actor_role="owner")
    client = TestClient(app)
    assert client.put("/api/v1/integrations/wordpress", json=_connect_body()).status_code == 403
    assert client.delete("/api/v1/integrations/wordpress").status_code == 403


@pytest.mark.parametrize("role,status", [("marketer", 403), ("admin", 404)])
def test_disconnect_needs_integration_disconnect(app, wp_repo, role, status):
    as_role(app, role)
    assert TestClient(app).delete("/api/v1/integrations/wordpress").status_code == status


# ── Article routes ───────────────────────────────────────────────────────────


@pytest.fixture
def store(monkeypatch):
    s = SeoStore().install(monkeypatch)
    connect(s, monkeypatch)
    return s


@pytest.mark.parametrize("role,status", [("analyst", 403), ("billing", 403), ("marketer", 200), ("owner", 200)])
def test_publish_needs_content_publish(app, store, fake_site, role, status):
    a = store.add(done_article())
    as_role(app, role)
    r = TestClient(app).post(f"/api/v1/articles/{a.id}/publish", json={"mode": "draft"})
    assert r.status_code == status, r.text
    if status == 403:
        assert r.json()["permission"] == "content:publish"
    else:
        assert r.json()["publish_status"] == "published"
        assert "sealed" not in r.text and PASSWORD.replace(" ", "") not in r.text


def test_agent_live_publish_needs_a_person(app, store, fake_site, audit_rows):
    a = store.add(done_article())
    as_role(app, "agent", actor_role="owner")
    r = TestClient(app).post(f"/api/v1/articles/{a.id}/publish", json={"mode": "live"})
    assert r.status_code == 403 and "person_required" in r.json()["detail"]
    assert fake_site.requests == []


def test_kill_switch_maps_to_402(app, store, fake_site, rails_store):
    rails_store.kill_switches.add("publish")
    a = store.add(done_article())
    as_role(app, "owner")
    r = TestClient(app).post(f"/api/v1/articles/{a.id}/publish", json={"mode": "live"})
    assert r.status_code == 402 and r.json()["detail"].startswith("kill_switch")


def test_same_idempotency_key_dispatches_once(app, store, fake_site):
    a = store.add(done_article())
    as_role(app, "agent", actor_role="owner")
    client = TestClient(app)
    h = {"idempotency-key": "run-1:call-1"}
    assert client.post(f"/api/v1/articles/{a.id}/publish", json={"mode": "draft"}, headers=h).status_code == 200
    r = client.post(f"/api/v1/articles/{a.id}/publish", json={"mode": "draft"}, headers=h)
    assert r.status_code == 409 and "duplicate_dispatch" in r.json()["detail"]
    assert len(fake_site.requests) == 1


def test_schedule_then_drag_then_unschedule(app, store, audit_rows):
    a = store.add(done_article())
    as_role(app, "marketer")
    client = TestClient(app)
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = client.post(f"/api/v1/articles/{a.id}/publish", json={"mode": "live", "publish_at": when})
    assert r.status_code == 200 and r.json()["publish_status"] == "scheduled"
    later = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    r = client.patch(f"/api/v1/articles/{a.id}/schedule", json={"publish_at": later})
    assert r.status_code == 200
    assert {row["action"] for row in audit_rows} >= {"content.article.scheduled", "content.article.rescheduled"}


def test_schedule_draft_is_refused(app, store):
    a = store.add(done_article())
    as_role(app, "owner")
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = TestClient(app).post(f"/api/v1/articles/{a.id}/publish", json={"mode": "draft", "publish_at": when})
    assert r.status_code == 422


def test_reschedule_needs_content_publish(app, store):
    a = store.add(done_article())
    as_role(app, "analyst")
    r = TestClient(app).patch(f"/api/v1/articles/{a.id}/schedule", json={"publish_at": datetime.now(timezone.utc).isoformat()})
    assert r.status_code == 403


def test_seo_edit_validates_by_field(app, store, monkeypatch):
    from marketer.repos import article_seo

    a = store.add(done_article())
    captured: dict = {}

    async def set_seo_meta(article_id, *, user_id, **kw):
        captured.update(kw)
        return a

    monkeypatch.setattr(article_seo, "set_seo_meta", set_seo_meta)
    as_role(app, "marketer")
    client = TestClient(app)
    bad = {"meta_title": "x" * 61, "meta_description": "ok", "slug": "Not A Slug", "focus_keyword": "k", "secondary_keywords": []}
    r = client.patch(f"/api/v1/articles/{a.id}/seo", json=bad)
    assert r.status_code == 422
    errors = r.json()["detail"]["errors"]
    assert set(errors) == {"meta_title", "slug"}
    good = {"meta_title": "Cold Brew Guide", "meta_description": "Make it.", "slug": "cold-brew", "focus_keyword": "cold brew", "secondary_keywords": [" iced coffee ", ""]}
    assert client.patch(f"/api/v1/articles/{a.id}/seo", json=good).status_code == 200
    assert captured["secondary_keywords"] == ["iced coffee"]


def test_seo_edit_needs_content_update(app, store):
    a = store.add(done_article())
    as_role(app, "analyst")
    r = TestClient(app).patch(f"/api/v1/articles/{a.id}/seo", json={})
    assert r.status_code == 403 and r.json()["permission"] == "content:update"


def test_foreign_article_is_404(app, store):
    a = store.add(done_article(user_id="someone_else"))
    as_role(app, "owner")
    assert TestClient(app).post(f"/api/v1/articles/{a.id}/publish", json={"mode": "draft"}).status_code == 404


def test_cover_search_never_exposes_the_key_or_download_link(app, store, monkeypatch):
    from marketer.config import settings
    from marketer.services import unsplash

    monkeypatch.setattr(settings, "unsplash_access_key", "unsplash-secret-key")
    a = store.add(done_article())

    async def search(query, **kw):
        return [unsplash.UnsplashPhoto(
            id="abc", url="https://images.unsplash.com/p", thumb_url="https://images.unsplash.com/t",
            author_name="Ana", author_url="https://unsplash.com/@ana?x", photo_url="https://unsplash.com/photos/abc?x",
            download_location="https://api.unsplash.com/photos/abc/download?ixid=1",
        )]

    monkeypatch.setattr(unsplash, "search", search)
    as_role(app, "marketer")
    r = TestClient(app).get(f"/api/v1/articles/{a.id}/cover/search?q=jar")
    assert r.status_code == 200
    assert "unsplash-secret-key" not in r.text and "download" not in r.text
    assert r.json()["photos"][0]["author_name"] == "Ana"


def test_cover_is_reread_by_id_and_download_is_tracked(app, store, monkeypatch):
    from marketer.config import settings
    from marketer.repos import article_seo
    from marketer.services import unsplash

    monkeypatch.setattr(settings, "unsplash_access_key", "k")
    a = store.add(done_article())
    photo = unsplash.UnsplashPhoto(
        id="abc", url="https://images.unsplash.com/p", thumb_url="https://images.unsplash.com/t",
        author_name="Ana", author_url="https://unsplash.com/@ana?x", photo_url="https://unsplash.com/photos/abc?x",
        download_location="https://api.unsplash.com/photos/abc/download",
    )
    tracked: list = []

    async def get_photo(pid, **kw):
        return photo if pid == "abc" else None

    async def track(p, **kw):
        tracked.append(p.id)

    async def set_cover(article_id, *, user_id, cover):
        return a.model_copy(update={"cover_image": cover})

    monkeypatch.setattr(unsplash, "get_photo", get_photo)
    monkeypatch.setattr(unsplash, "track_download", track)
    monkeypatch.setattr(article_seo, "set_cover", set_cover)
    as_role(app, "marketer")
    client = TestClient(app)
    r = client.put(f"/api/v1/articles/{a.id}/cover", json={"photo_id": "abc"})
    assert r.status_code == 200 and tracked == ["abc"]
    assert r.json()["cover_image"]["attribution"] == "Photo by Ana on Unsplash"
    assert client.put(f"/api/v1/articles/{a.id}/cover", json={"photo_id": "nope"}).status_code == 404


# ── Batches ──────────────────────────────────────────────────────────────────


def test_batch_needs_content_create(app):
    as_role(app, "analyst")
    r = TestClient(app).post("/api/v1/article-batches", json={"niche_id": str(uuid4()), "keywords": ["a"]})
    assert r.status_code == 403 and r.json()["permission"] == "content:create"


def test_batch_create_starts_items(app, monkeypatch):
    from marketer.articles import bulk
    from marketer.repos import article_batches as repo
    from marketer.repos.article_batches import Batch

    batch = Batch(id=uuid4(), user_id=DEFAULT_TENANT, niche_id=UUID(int=1), status="running", total=2)
    ticks: list = []

    async def create(**kw):
        assert kw["keywords"] == "cold brew\niced latte"
        return batch

    async def tick(batch_id, *, user_id, spawn):
        ticks.append(batch_id)
        return {"started": 2, "held": 0}

    async def get(batch_id, *, user_id):
        return batch

    monkeypatch.setattr(bulk, "create", create)
    monkeypatch.setattr(bulk, "tick_batch", tick)
    monkeypatch.setattr(repo, "get", get)
    as_role(app, "marketer")
    r = TestClient(app).post("/api/v1/article-batches", json={"niche_id": str(UUID(int=1)), "keywords": "cold brew\niced latte"})
    assert r.status_code == 202 and ticks == [batch.id]
