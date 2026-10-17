"""Route tests for /api/v1/cms — the editorial surface over articles."""
from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.cms.schemas import (
    CmsArticle,
    Collection,
    PublicationState,
    Revision,
    RevisionSummary,
)

_USER_ID = "user_cms_test"
_NICHE_ID = UUID("44444444-4444-4444-4444-444444444444")
_ARTICLE_ID = UUID("55555555-5555-5555-5555-555555555555")
_REVISION_ID = UUID("66666666-6666-6666-6666-666666666666")
_COLLECTION_ID = UUID("77777777-7777-7777-7777-777777777777")
_NOW = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)
_AUTH = {"Authorization": "Bearer mkt_x"}


def _article(**overrides) -> CmsArticle:
    base = {
        "id": _ARTICLE_ID,
        "user_id": _USER_ID,
        "niche_id": _NICHE_ID,
        "status": "done",
        "publication_state": PublicationState.draft,
        "title": "SEO Basics",
        "slug": "seo-basics",
        "meta_description": "A short guide.",
        "article_markdown": "# SEO Basics\n\nBody.",
        "created_at": _NOW,
    }
    base.update(overrides)
    return CmsArticle(**base)


def _revision(**overrides) -> Revision:
    base = {
        "id": _REVISION_ID,
        "article_id": _ARTICLE_ID,
        "revision_number": 1,
        "changed_fields": ["title"],
        "summary": "title",
        "created_at": _NOW,
        "title": "Older Title",
        "slug": "seo-basics",
        "meta_description": "Older meta.",
        "article_markdown": "# Older",
    }
    base.update(overrides)
    return Revision(**base)


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
    from backend.routes import cms

    app = create_app()
    # The lead owns backend/main.py, so the router line lands there
    # separately; mount it here (idempotently) so these tests exercise the
    # real app wiring whether or not that line is in place yet.
    try:
        app.url_path_for("list_collections")
    except Exception:  # noqa: BLE001 — not mounted yet
        app.include_router(cms.router, prefix="/api/v1/cms", tags=["cms"])
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def client(monkeypatch) -> TestClient:
    _reset_limiter()
    return _make_authed_client(monkeypatch)


# ---------------------------------------------------------------------------
# PATCH — editing
# ---------------------------------------------------------------------------


def test_patch_edits_and_reports_the_captured_revision(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    seen: dict = {}

    async def _apply(article_id, *, user_id, edit):
        seen["article_id"] = article_id
        seen["user_id"] = user_id
        seen["changes"] = edit.changes()
        return _article(title="SEO Basics, Revised"), RevisionSummary(
            id=_REVISION_ID,
            article_id=_ARTICLE_ID,
            revision_number=4,
            changed_fields=["title"],
            summary="title",
            created_at=_NOW,
        )

    monkeypatch.setattr(repo, "apply_edit", _apply)
    resp = client.patch(
        f"/api/v1/cms/articles/{_ARTICLE_ID}",
        json={"title": "SEO Basics, Revised"},
        headers=_AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["article"]["title"] == "SEO Basics, Revised"
    assert body["revision"]["revision_number"] == 4
    # Scoped to the caller, and only the sent field is treated as an edit.
    assert seen["user_id"] == _USER_ID
    assert seen["changes"] == {"title": "SEO Basics, Revised"}


def test_patch_of_a_foreign_or_missing_article_404s(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    async def _apply(article_id, *, user_id, edit):
        return None

    monkeypatch.setattr(repo, "apply_edit", _apply)
    resp = client.patch(
        f"/api/v1/cms/articles/{_ARTICLE_ID}", json={"title": "x"}, headers=_AUTH
    )
    assert resp.status_code == 404


def test_patch_no_op_returns_the_article_with_no_revision(client, monkeypatch):
    """An edit that changed nothing must not burn a revision number."""
    from marketer.repos import article_revisions as repo

    async def _apply(article_id, *, user_id, edit):
        return _article(), None

    monkeypatch.setattr(repo, "apply_edit", _apply)
    resp = client.patch(
        f"/api/v1/cms/articles/{_ARTICLE_ID}", json={"title": "SEO Basics"},
        headers=_AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["revision"] is None


def test_patch_slug_collision_is_a_409_not_a_silent_rename(client, monkeypatch):
    """The collision path: a hand-typed slug that is taken must be reported,
    not quietly turned into "pricing-2"."""
    from marketer.repos import article_revisions as repo

    async def _apply(article_id, *, user_id, edit):
        raise repo.SlugTaken("pricing")

    monkeypatch.setattr(repo, "apply_edit", _apply)
    resp = client.patch(
        f"/api/v1/cms/articles/{_ARTICLE_ID}", json={"slug": "Pricing"}, headers=_AUTH
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "slug_taken"


def test_patch_of_a_frozen_slug_is_a_409(client, monkeypatch):
    from marketer.cms import publish as publish_rules
    from marketer.repos import article_revisions as repo

    async def _apply(article_id, *, user_id, edit):
        raise publish_rules.PublishGuard("slug_frozen", "frozen")

    monkeypatch.setattr(repo, "apply_edit", _apply)
    resp = client.patch(
        f"/api/v1/cms/articles/{_ARTICLE_ID}", json={"slug": "new"}, headers=_AUTH
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "slug_frozen"


def test_patch_rejects_unknown_fields(client):
    """extra="forbid": a typo'd field name must not silently do nothing."""
    resp = client.patch(
        f"/api/v1/cms/articles/{_ARTICLE_ID}",
        json={"titel": "typo"},
        headers=_AUTH,
    )
    assert resp.status_code == 422


def test_patch_cannot_reach_pipeline_fields(client):
    resp = client.patch(
        f"/api/v1/cms/articles/{_ARTICLE_ID}",
        json={"status": "done", "hero_image_path": "/etc/passwd"},
        headers=_AUTH,
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------


def test_list_revisions_newest_first(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    async def _get_article(article_id, *, user_id):
        return _article()

    async def _list(article_id, *, user_id, limit=100):
        return [
            RevisionSummary(
                id=uuid4(), article_id=_ARTICLE_ID, revision_number=n,
                changed_fields=["title"], summary="title", created_at=_NOW,
            )
            for n in (2, 1)
        ]

    monkeypatch.setattr(repo, "get_article", _get_article)
    monkeypatch.setattr(repo, "list_revisions", _list)
    resp = client.get(f"/api/v1/cms/articles/{_ARTICLE_ID}/revisions", headers=_AUTH)
    assert resp.status_code == 200
    assert [r["revision_number"] for r in resp.json()] == [2, 1]
    # The list view carries the summary, not the content blob.
    assert "article_markdown" not in resp.json()[0]


def test_list_revisions_404s_on_a_foreign_article(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    async def _get_article(article_id, *, user_id):
        return None

    monkeypatch.setattr(repo, "get_article", _get_article)
    resp = client.get(f"/api/v1/cms/articles/{_ARTICLE_ID}/revisions", headers=_AUTH)
    assert resp.status_code == 404


def test_get_revision_returns_full_content(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    seen: dict = {}

    async def _get(revision_id, *, article_id, user_id):
        seen.update(revision_id=revision_id, article_id=article_id, user_id=user_id)
        return _revision()

    monkeypatch.setattr(repo, "get_revision", _get)
    resp = client.get(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/revisions/{_REVISION_ID}", headers=_AUTH
    )
    assert resp.status_code == 200
    assert resp.json()["article_markdown"] == "# Older"
    # Both ids are predicates: another article's revision must not resolve
    # under this article's URL.
    assert seen["article_id"] == _ARTICLE_ID
    assert seen["user_id"] == _USER_ID


def test_restore_writes_a_new_revision(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    async def _restore(article_id, *, user_id, revision_id):
        return _article(title="Older Title"), RevisionSummary(
            id=uuid4(),
            article_id=_ARTICLE_ID,
            revision_number=5,
            changed_fields=["title"],
            summary="restored v1: title",
            source="restore",
            restored_from_revision_id=revision_id,
            created_at=_NOW,
        )

    monkeypatch.setattr(repo, "restore", _restore)
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/revisions/{_REVISION_ID}/restore",
        headers=_AUTH,
    )
    assert resp.status_code == 200
    revision = resp.json()["revision"]
    # A NEW, higher revision number — history is appended, never rewound.
    assert revision["revision_number"] == 5
    assert revision["source"] == "restore"
    assert revision["restored_from_revision_id"] == str(_REVISION_ID)


def test_restore_of_an_unknown_revision_404s(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    async def _restore(article_id, *, user_id, revision_id):
        raise repo.RevisionNotFound(revision_id)

    monkeypatch.setattr(repo, "restore", _restore)
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/revisions/{_REVISION_ID}/restore",
        headers=_AUTH,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Publish / unpublish — the planner runs for real against a fake row
# ---------------------------------------------------------------------------


def _stub_set_publication(monkeypatch, article: CmsArticle | None):
    """Run the real pure planner against `article`, as the repo does under
    its row lock, so the route's guard->HTTP mapping is exercised."""
    from marketer.repos import article_revisions as repo

    async def _set(article_id, *, user_id, planner):
        if article is None:
            return None
        transition = planner(article)
        return article.model_copy(
            update={
                "publication_state": transition.state,
                "published_at": transition.published_at,
                "scheduled_at": transition.scheduled_at,
            }
        )

    monkeypatch.setattr(repo, "set_publication", _set)


def test_publish_now_goes_live(client, monkeypatch):
    _stub_set_publication(monkeypatch, _article())
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/publish",
        json={"scheduled_at": None},
        headers=_AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["publication_state"] == "published"
    assert body["published_at"] is not None


def test_publish_schedules_a_future_instant(client, monkeypatch):
    _stub_set_publication(monkeypatch, _article())
    target = _NOW + timedelta(days=365 * 10)
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/publish",
        json={"scheduled_at": target.isoformat()},
        headers=_AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["publication_state"] == "scheduled"


def test_publishing_empty_content_is_refused(client, monkeypatch):
    _stub_set_publication(monkeypatch, _article(article_markdown=""))
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/publish", json={}, headers=_AUTH
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "no_content"


def test_publishing_an_unfinished_article_is_refused(client, monkeypatch):
    _stub_set_publication(monkeypatch, _article(status="writing"))
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/publish", json={}, headers=_AUTH
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "not_finished"


def test_republish_is_idempotent_and_keeps_the_original_dateline(client, monkeypatch):
    original = _NOW - timedelta(days=30)
    _stub_set_publication(
        monkeypatch,
        _article(publication_state=PublicationState.published, published_at=original),
    )
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/publish", json={}, headers=_AUTH
    )
    assert resp.status_code == 200
    assert resp.json()["published_at"] == original.isoformat().replace("+00:00", "Z")


def test_publish_404s_when_the_article_is_not_the_callers(client, monkeypatch):
    _stub_set_publication(monkeypatch, None)
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/publish", json={}, headers=_AUTH
    )
    assert resp.status_code == 404


def test_unpublish_returns_to_draft(client, monkeypatch):
    _stub_set_publication(
        monkeypatch,
        _article(publication_state=PublicationState.published, published_at=_NOW),
    )
    resp = client.post(
        f"/api/v1/cms/articles/{_ARTICLE_ID}/unpublish", headers=_AUTH
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["publication_state"] == "draft"
    # The slug is retained: the URL is retired to this article forever.
    assert body["slug"] == "seo-basics"


def test_by_slug_only_resolves_published_articles(client, monkeypatch):
    from marketer.repos import article_revisions as repo

    async def _by_slug(slug, *, user_id):
        return _article(publication_state=PublicationState.published) if slug == "seo-basics" else None

    monkeypatch.setattr(repo, "get_article_by_slug", _by_slug)
    assert client.get("/api/v1/cms/articles/by-slug/seo-basics", headers=_AUTH).status_code == 200
    # Route ordering: the literal segment is not swallowed by /{article_id}.
    assert client.get("/api/v1/cms/articles/by-slug/nope", headers=_AUTH).status_code == 404


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------


def _collection(**overrides) -> Collection:
    base = {
        "id": _COLLECTION_ID,
        "user_id": _USER_ID,
        "name": "Guides",
        "slug": "guides",
        "description": "",
        "article_count": 2,
        "created_at": _NOW,
    }
    base.update(overrides)
    return Collection(**base)


def test_collections_list_and_create(client, monkeypatch):
    from marketer.repos import collections as repo

    async def _list(user_id, *, limit=200):
        return [_collection()]

    created: dict = {}

    async def _create(*, user_id, name, description="", slug=None):
        created.update(user_id=user_id, name=name, slug=slug)
        return _collection(name=name, article_count=0)

    monkeypatch.setattr(repo, "list_for_user", _list)
    monkeypatch.setattr(repo, "create", _create)

    resp = client.get("/api/v1/cms/collections", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.json()[0]["article_count"] == 2

    resp = client.post(
        "/api/v1/cms/collections", json={"name": "Guides"}, headers=_AUTH
    )
    assert resp.status_code == 201
    assert created["user_id"] == _USER_ID


def test_collection_routes_are_not_shadowed_by_the_article_id_route(client, monkeypatch):
    """`/collections` sits on a different first segment than
    `/articles/{id}`, so it must never be parsed as a UUID."""
    from marketer.repos import collections as repo

    async def _list(user_id, *, limit=200):
        return []

    monkeypatch.setattr(repo, "list_for_user", _list)
    resp = client.get("/api/v1/cms/collections", headers=_AUTH)
    assert resp.status_code == 200


def test_collection_update_and_delete(client, monkeypatch):
    from marketer.repos import collections as repo

    async def _update(collection_id, *, user_id, name=None, description=None, slug=None):
        return _collection(name=name or "Guides")

    async def _delete(collection_id, *, user_id):
        return True

    monkeypatch.setattr(repo, "update", _update)
    monkeypatch.setattr(repo, "delete", _delete)

    resp = client.patch(
        f"/api/v1/cms/collections/{_COLLECTION_ID}",
        json={"name": "How-To Guides"},
        headers=_AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "How-To Guides"

    resp = client.delete(f"/api/v1/cms/collections/{_COLLECTION_ID}", headers=_AUTH)
    assert resp.status_code == 204


def test_collection_delete_404s_when_not_the_callers(client, monkeypatch):
    from marketer.repos import collections as repo

    async def _delete(collection_id, *, user_id):
        return False

    monkeypatch.setattr(repo, "delete", _delete)
    resp = client.delete(f"/api/v1/cms/collections/{_COLLECTION_ID}", headers=_AUTH)
    assert resp.status_code == 404


def test_assign_articles_to_a_collection(client, monkeypatch):
    from marketer.repos import collections as repo

    async def _get(collection_id, *, user_id):
        return _collection()

    async def _assign(collection_id, *, user_id, article_ids):
        return len(article_ids)

    async def _ids(collection_id, *, user_id):
        return [_ARTICLE_ID]

    monkeypatch.setattr(repo, "get", _get)
    monkeypatch.setattr(repo, "assign", _assign)
    monkeypatch.setattr(repo, "article_ids", _ids)

    resp = client.post(
        f"/api/v1/cms/collections/{_COLLECTION_ID}/articles",
        json={"article_ids": [str(_ARTICLE_ID)]},
        headers=_AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["added"] == 1
    assert resp.json()["article_ids"] == [str(_ARTICLE_ID)]


def test_assign_to_a_foreign_collection_404s(client, monkeypatch):
    from marketer.repos import collections as repo

    async def _get(collection_id, *, user_id):
        return None

    monkeypatch.setattr(repo, "get", _get)
    resp = client.post(
        f"/api/v1/cms/collections/{_COLLECTION_ID}/articles",
        json={"article_ids": [str(_ARTICLE_ID)]},
        headers=_AUTH,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Bulk topics
# ---------------------------------------------------------------------------


def _stub_modal(monkeypatch, spawned: list[tuple]):
    class _FakeFn:
        def spawn(self, *a):
            spawned.append(a)

    monkeypatch.setitem(
        sys.modules,
        "modal",
        types.SimpleNamespace(
            Function=types.SimpleNamespace(from_name=lambda app, name: _FakeFn())
        ),
    )


def test_bulk_topics_queues_one_pipeline_run_per_topic(client, monkeypatch):
    from marketer.repos import articles as articles_repo
    from marketer.repos import niches as niches_repo

    async def _niche_get(niche_id, *, user_id):
        return types.SimpleNamespace(id=niche_id)

    async def _create(*, user_id, niche_id, topic=""):
        return types.SimpleNamespace(id=uuid4(), topic=topic)

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(articles_repo, "create", _create)
    spawned: list[tuple] = []
    _stub_modal(monkeypatch, spawned)

    resp = client.post(
        "/api/v1/cms/bulk-topics",
        json={"niche_id": str(_NICHE_ID), "topics": ["topic a", "topic b", "topic c"]},
        headers=_AUTH,
    )
    assert resp.status_code == 202
    assert resp.json()["queued"] == 3
    # Reuses the existing enqueue path: same Modal entrypoint, same args.
    assert [s[3] for s in spawned] == ["topic a", "topic b", "topic c"]
    assert all(s[0] == _USER_ID for s in spawned)


def test_bulk_topics_dedupes_within_one_request(client, monkeypatch):
    """Each duplicate is a real metered pipeline run — always a paste
    mistake, never an intent."""
    from marketer.repos import articles as articles_repo
    from marketer.repos import niches as niches_repo

    async def _niche_get(niche_id, *, user_id):
        return types.SimpleNamespace(id=niche_id)

    async def _create(*, user_id, niche_id, topic=""):
        return types.SimpleNamespace(id=uuid4(), topic=topic)

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(articles_repo, "create", _create)
    spawned: list[tuple] = []
    _stub_modal(monkeypatch, spawned)

    resp = client.post(
        "/api/v1/cms/bulk-topics",
        json={"niche_id": str(_NICHE_ID), "topics": ["Topic A", "topic a", "  ", "B"]},
        headers=_AUTH,
    )
    assert resp.status_code == 202
    assert resp.json()["queued"] == 2


def test_bulk_topics_404s_on_a_foreign_niche(client, monkeypatch):
    from marketer.repos import niches as niches_repo

    async def _niche_get(niche_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    resp = client.post(
        "/api/v1/cms/bulk-topics",
        json={"niche_id": str(_NICHE_ID), "topics": ["a"]},
        headers=_AUTH,
    )
    assert resp.status_code == 404


def test_bulk_topics_bounds_the_batch(client):
    """An unbounded topic list is an unbounded spend request."""
    resp = client.post(
        "/api/v1/cms/bulk-topics",
        json={"niche_id": str(_NICHE_ID), "topics": [f"t{n}" for n in range(51)]},
        headers=_AUTH,
    )
    assert resp.status_code == 422


def test_bulk_topics_rejects_an_empty_list(client):
    resp = client.post(
        "/api/v1/cms/bulk-topics",
        json={"niche_id": str(_NICHE_ID), "topics": []},
        headers=_AUTH,
    )
    assert resp.status_code == 422


def test_bulk_topics_refuses_when_unbilled_usage_disabled(client, monkeypatch):
    """Bulk generate must not spawn when billing is off and unbilled is refused."""
    from marketer.config import settings
    from marketer.repos import articles as articles_repo

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    created: list[str] = []

    async def _create(*, user_id, niche_id, topic=""):
        created.append(topic)
        return types.SimpleNamespace(id=uuid4(), topic=topic)

    monkeypatch.setattr(articles_repo, "create", _create)
    resp = client.post(
        "/api/v1/cms/bulk-topics",
        json={"niche_id": str(_NICHE_ID), "topics": ["should not run"]},
        headers=_AUTH,
    )
    assert resp.status_code == 402
    assert created == []


def test_bulk_topics_403_when_generate_flag_off(client, monkeypatch):
    """Bulk enqueue must honor the same generate kill-switch as POST /articles."""
    from marketer.repos import feature_flags as flags_repo
    from marketer.repos import articles as articles_repo

    async def _denied(key):
        return key != "generate"

    created: list[str] = []

    async def _create(*, user_id, niche_id, topic=""):
        created.append(topic)
        return types.SimpleNamespace(id=uuid4(), topic=topic)

    monkeypatch.setattr(flags_repo, "allowed", _denied)
    monkeypatch.setattr(articles_repo, "create", _create)
    resp = client.post(
        "/api/v1/cms/bulk-topics",
        json={"niche_id": str(_NICHE_ID), "topics": ["should not run"]},
        headers=_AUTH,
    )
    assert resp.status_code == 403
    assert created == []
