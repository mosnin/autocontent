"""Route-level tests for /api/v1/library and /api/v1/style-presets.

Auth bypassed via dependency_overrides; media repo + storage mocked.
"""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.models import Composition, MediaAsset

_USER_ID = "user_test"


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


def _asset(kind: str = "clip", storage: str = "volume", key: str = "/tmp/x.mp4") -> MediaAsset:
    return MediaAsset(
        id=uuid4(), user_id=_USER_ID, kind=kind, storage=storage, object_key=key,
    )


def test_list_assets_passes_filters(monkeypatch):
    import marketer.repos.media as media_repo

    seen = {}

    async def fake_list(**kwargs):
        seen.update(kwargs)
        return [_asset()]

    monkeypatch.setattr(media_repo, "list_assets", fake_list)
    client = _make_authed_client(monkeypatch)

    r = client.get("/api/v1/library", params={"kind": "clip", "limit": 500})
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert seen["kind"] == "clip"
    assert seen["limit"] == 200  # clamped
    assert seen["user_id"] == _USER_ID


def test_invalid_kind_rejected(monkeypatch):
    client = _make_authed_client(monkeypatch)
    r = client.get("/api/v1/library", params={"kind": "spreadsheet"})
    assert r.status_code == 422


def test_media_volume_streams_file(monkeypatch, tmp_path: Path):
    import marketer.repos.media as media_repo

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"MP4DATA")
    asset = _asset(storage="volume", key=str(f))

    async def fake_get(asset_id, *, user_id):
        return asset

    monkeypatch.setattr(media_repo, "get_asset", fake_get)
    client = _make_authed_client(monkeypatch)

    r = client.get(f"/api/v1/library/{asset.id}/media")
    assert r.status_code == 200
    assert r.content == b"MP4DATA"
    assert r.headers["content-type"] == "video/mp4"


def test_media_wasabi_redirects_presigned(monkeypatch):
    import marketer.repos.media as media_repo
    from marketer.services import object_storage

    asset = _asset(storage="wasabi", key="users/u/j/clips/scene_0.mp4")

    async def fake_get(asset_id, *, user_id):
        return asset

    async def fake_presign(key, *, expires_sec=None):
        return "https://signed.example/" + key

    monkeypatch.setattr(media_repo, "get_asset", fake_get)
    monkeypatch.setattr(object_storage, "presigned_get_url", fake_presign)
    client = _make_authed_client(monkeypatch)

    r = client.get(f"/api/v1/library/{asset.id}/media", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"].startswith("https://signed.example/")


def test_media_missing_asset_404(monkeypatch):
    import marketer.repos.media as media_repo

    async def fake_get(asset_id, *, user_id):
        return None

    monkeypatch.setattr(media_repo, "get_asset", fake_get)
    client = _make_authed_client(monkeypatch)
    r = client.get(f"/api/v1/library/{uuid4()}/media")
    assert r.status_code == 404


def test_create_composition_validates_and_spawns(monkeypatch):
    import marketer.repos.media as media_repo

    clips = [_asset(), _asset()]

    async def fake_bulk(ids, *, user_id):
        return clips

    created = {}

    async def fake_create(**kwargs):
        created.update(kwargs)
        return Composition(
            id=uuid4(), user_id=_USER_ID,
            clip_asset_ids=kwargs["clip_asset_ids"],
            audio_mode=kwargs["audio_mode"], title=kwargs["title"],
        )

    monkeypatch.setattr(media_repo, "get_assets_bulk", fake_bulk)
    monkeypatch.setattr(media_repo, "create_composition", fake_create)

    spawned = {}

    class _FakeFn:
        def spawn(self, *args):
            spawned["args"] = args

    import modal
    monkeypatch.setattr(modal.Function, "from_name",
                        staticmethod(lambda app, name: _FakeFn()))

    client = _make_authed_client(monkeypatch)
    r = client.post("/api/v1/library/compositions", json={
        "clip_asset_ids": [str(c.id) for c in clips],
        "title": "  remix one  ",
        "audio_mode": "mute",
    })
    assert r.status_code == 202
    assert created["title"] == "remix one"
    assert created["audio_mode"] == "mute"
    assert spawned["args"][0] == _USER_ID


def test_create_composition_missing_clip_404(monkeypatch):
    import marketer.repos.media as media_repo

    async def fake_bulk(ids, *, user_id):
        return []  # nothing owned by this user

    monkeypatch.setattr(media_repo, "get_assets_bulk", fake_bulk)
    client = _make_authed_client(monkeypatch)
    r = client.post("/api/v1/library/compositions", json={
        "clip_asset_ids": [str(uuid4())],
    })
    assert r.status_code == 404


def test_create_composition_rejects_non_video_assets(monkeypatch):
    import marketer.repos.media as media_repo

    kf = _asset(kind="keyframe")

    async def fake_bulk(ids, *, user_id):
        return [kf]

    monkeypatch.setattr(media_repo, "get_assets_bulk", fake_bulk)
    client = _make_authed_client(monkeypatch)
    r = client.post("/api/v1/library/compositions", json={
        "clip_asset_ids": [str(kf.id)],
    })
    assert r.status_code == 422


def test_style_presets_listed(monkeypatch):
    client = _make_authed_client(monkeypatch)
    r = client.get("/api/v1/style-presets")
    assert r.status_code == 200
    presets = r.json()
    assert len(presets) >= 6
    ids = {p["id"] for p in presets}
    assert "claymation" in ids
    clay = next(p for p in presets if p["id"] == "claymation")
    assert clay["visual_style"]
    assert "reference_video_url" in clay
