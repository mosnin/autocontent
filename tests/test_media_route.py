"""Route-level tests for /api/v1/media — the Content Studio media library.

Same shape as tests/test_jobs_route.py: FastAPI TestClient, auth bypassed
via dependency_overrides, repo functions monkeypatched. No DB, no network.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.models import MediaAsset

_USER_ID = "user_test"
_OTHER_USER_ID = "user_other"
_MEDIA_ID = UUID("44444444-4444-4444-4444-444444444444")


def _make_asset(
    *, media_id: UUID | None = None, user_id: str = _USER_ID,
    kind: str = "image", source: str = "studio", path: str = "", url: str = "",
) -> MediaAsset:
    return MediaAsset(
        id=media_id or _MEDIA_ID,
        user_id=user_id,
        kind=kind,
        source=source,
        path=path,
        url=url,
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


# ---------------------------------------------------------------------------
# GET / — list
# ---------------------------------------------------------------------------

def test_list_media_returns_200(monkeypatch):
    _reset_limiter()
    import marketer.repos.media as media_repo

    async def _list(user_id, *, kind=None, source=None, limit=50, cursor=None):
        assert user_id == _USER_ID
        return [_make_asset()]

    monkeypatch.setattr(media_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/media", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == str(_MEDIA_ID)


def test_list_media_forwards_kind_and_source_filters(monkeypatch):
    _reset_limiter()
    import marketer.repos.media as media_repo

    received: dict = {}

    async def _list(user_id, *, kind=None, source=None, limit=50, cursor=None):
        received["kind"] = kind
        received["source"] = source
        return []

    monkeypatch.setattr(media_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/media?kind=video&source=pipeline",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    assert received["kind"] == "video"
    assert received["source"] == "pipeline"


def test_list_media_rejects_invalid_kind(monkeypatch):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/media?kind=not-a-kind", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 422


def test_list_media_sets_next_cursor_on_full_page(monkeypatch):
    _reset_limiter()
    import marketer.repos.media as media_repo

    ids = [uuid4() for _ in range(3)]

    async def _list(user_id, *, kind=None, source=None, limit=50, cursor=None):
        return [_make_asset(media_id=i) for i in ids][:limit]

    monkeypatch.setattr(media_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/media?limit=3", headers={"Authorization": "Bearer mkt_tok"}
    )
    body = resp.json()
    assert body["next_cursor"] == str(ids[-1])


def test_list_media_without_auth_returns_401(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/api/v1/media")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /{id} — ownership
# ---------------------------------------------------------------------------

def test_get_media_returns_200_for_owned(monkeypatch):
    _reset_limiter()
    import marketer.repos.media as media_repo

    asset = _make_asset()

    async def _get(media_id, *, user_id):
        if media_id == _MEDIA_ID and user_id == _USER_ID:
            return asset
        return None

    monkeypatch.setattr(media_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(f"/api/v1/media/{_MEDIA_ID}", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    assert resp.json()["id"] == str(_MEDIA_ID)


def test_get_media_returns_404_for_other_users_asset(monkeypatch):
    """The repo itself scopes by user_id — a foreign id just returns None,
    same 404 as a nonexistent id (no existence leak)."""
    _reset_limiter()
    import marketer.repos.media as media_repo

    async def _get(media_id, *, user_id):
        return None

    monkeypatch.setattr(media_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(f"/api/v1/media/{_MEDIA_ID}", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /{id}/file — local path vs. remote url vs. missing
# ---------------------------------------------------------------------------

def test_get_media_file_streams_local_path(monkeypatch, tmp_path):
    _reset_limiter()
    import marketer.repos.media as media_repo

    f = tmp_path / "out.png"
    f.write_bytes(b"PNGDATA")
    asset = _make_asset(path=str(f))

    async def _get(media_id, *, user_id):
        return asset

    monkeypatch.setattr(media_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/media/{_MEDIA_ID}/file", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 200
    assert resp.content == b"PNGDATA"


def test_get_media_file_redirects_to_remote_url(monkeypatch):
    _reset_limiter()
    import marketer.repos.media as media_repo

    asset = _make_asset(path="", url="https://cdn.fal.ai/asset.png")

    async def _get(media_id, *, user_id):
        return asset

    monkeypatch.setattr(media_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/media/{_MEDIA_ID}/file",
        headers={"Authorization": "Bearer mkt_tok"},
        follow_redirects=False,
    )
    assert resp.status_code == 307
    assert resp.headers["location"] == "https://cdn.fal.ai/asset.png"


def test_get_media_file_404_when_local_file_missing(monkeypatch, tmp_path):
    _reset_limiter()
    import marketer.repos.media as media_repo

    asset = _make_asset(path=str(tmp_path / "gone.png"))

    async def _get(media_id, *, user_id):
        return asset

    monkeypatch.setattr(media_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/media/{_MEDIA_ID}/file", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /{id} — soft delete
# ---------------------------------------------------------------------------

def test_delete_media_returns_204_when_owned(monkeypatch):
    _reset_limiter()
    import marketer.repos.media as media_repo

    async def _soft_delete(media_id, *, user_id):
        return media_id == _MEDIA_ID and user_id == _USER_ID

    monkeypatch.setattr(media_repo, "soft_delete", _soft_delete)

    client = _make_authed_client(monkeypatch)
    resp = client.delete(
        f"/api/v1/media/{_MEDIA_ID}", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 204


def test_delete_media_returns_404_when_not_owned_or_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.media as media_repo

    async def _soft_delete(media_id, *, user_id):
        return False

    monkeypatch.setattr(media_repo, "soft_delete", _soft_delete)

    client = _make_authed_client(monkeypatch)
    resp = client.delete(
        f"/api/v1/media/{_MEDIA_ID}", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 404
