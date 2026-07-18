"""Route-level tests for POST /api/v1/uploads — user file uploads into
the Content Studio media library (source='upload').

Same shape as tests/test_media_route.py: FastAPI TestClient, auth
bypassed via dependency_overrides, media_repo.insert monkeypatched. No
DB, no network. `settings.artifacts_dir` is redirected to `tmp_path` so
nothing is written outside the test sandbox.
"""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.models import MediaAsset

_USER_ID = "user_test"
_OTHER_USER_ID = "user_other"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch, tmp_path: Path, *, user_id: str = _USER_ID) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path))

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=user_id, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def _stub_media_insert(monkeypatch):
    calls: list[dict] = []
    import marketer.repos.media as media_repo

    async def _insert(**kwargs):
        calls.append(kwargs)
        return MediaAsset(
            id=uuid4(), user_id=kwargs["user_id"], kind=kwargs["kind"],
            source=kwargs["source"], path=kwargs.get("path", ""),
            mime=kwargs.get("mime", ""), meta=kwargs.get("meta") or {},
        )
    monkeypatch.setattr(media_repo, "insert", _insert)
    return calls


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_upload_image_happy_path(monkeypatch, tmp_path):
    _reset_limiter()
    calls = _stub_media_insert(monkeypatch)

    client = _make_authed_client(monkeypatch, tmp_path)
    data = b"\x89PNG\r\n\x1a\n" + b"fake png bytes"
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("photo.png", data, "image/png")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["kind"] == "image"
    assert body["source"] == "upload"
    assert body["user_id"] == _USER_ID

    assert len(calls) == 1
    assert calls[0]["kind"] == "image"
    assert calls[0]["source"] == "upload"
    assert calls[0]["user_id"] == _USER_ID
    assert calls[0]["mime"] == "image/png"

    # File actually landed under {artifacts_dir}/uploads/{user_id}/...
    written = Path(calls[0]["path"])
    assert written.exists()
    assert written.read_bytes() == data
    assert written.parent == tmp_path / "uploads" / _USER_ID
    assert written.suffix == ".png"


def test_upload_video_happy_path(monkeypatch, tmp_path):
    _reset_limiter()
    calls = _stub_media_insert(monkeypatch)

    client = _make_authed_client(monkeypatch, tmp_path)
    data = b"fake mp4 bytes" * 100
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("clip.mp4", data, "video/mp4")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    assert resp.json()["kind"] == "video"
    assert calls[0]["kind"] == "video"


def test_upload_audio_happy_path(monkeypatch, tmp_path):
    _reset_limiter()
    calls = _stub_media_insert(monkeypatch)

    client = _make_authed_client(monkeypatch, tmp_path)
    data = b"fake wav bytes" * 100
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("track.wav", data, "audio/wav")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    assert resp.json()["kind"] == "audio"
    assert calls[0]["kind"] == "audio"


# ---------------------------------------------------------------------------
# Rejections
# ---------------------------------------------------------------------------

def test_upload_rejects_disallowed_mime_type(monkeypatch, tmp_path):
    _reset_limiter()
    _stub_media_insert(monkeypatch)

    client = _make_authed_client(monkeypatch, tmp_path)
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 415
    assert "content-type" in resp.json()["detail"]


def test_upload_rejects_mime_extension_mismatch(monkeypatch, tmp_path):
    """content-type says image/png but the extension says .txt — the
    allowlist requires both to agree, so this is a 415 not a happy path."""
    _reset_limiter()
    _stub_media_insert(monkeypatch)

    client = _make_authed_client(monkeypatch, tmp_path)
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("sneaky.txt", b"not really a png", "image/png")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 415
    assert "extension" in resp.json()["detail"]


def test_upload_rejects_oversized_file(monkeypatch, tmp_path):
    _reset_limiter()
    calls = _stub_media_insert(monkeypatch)

    from marketer.config import settings
    client = _make_authed_client(monkeypatch, tmp_path)
    monkeypatch.setattr(settings, "upload_max_mb", 1)  # 1 MB cap

    oversized = b"x" * (2 * 1024 * 1024)  # 2 MB > 1 MB cap
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("big.png", oversized, "image/png")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 413
    assert "max upload size" in resp.json()["detail"] or "MB" in resp.json()["detail"]
    # Nothing should have been registered into the media library.
    assert calls == []
    # No partial file left behind under the user's upload dir.
    upload_dir = tmp_path / "uploads" / _USER_ID
    assert not upload_dir.exists() or list(upload_dir.iterdir()) == []


def test_upload_within_size_cap_succeeds(monkeypatch, tmp_path):
    _reset_limiter()
    calls = _stub_media_insert(monkeypatch)

    from marketer.config import settings
    client = _make_authed_client(monkeypatch, tmp_path)
    monkeypatch.setattr(settings, "upload_max_mb", 1)

    small = b"x" * (512 * 1024)  # 512 KB < 1 MB cap
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("ok.png", small, "image/png")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    assert len(calls) == 1


def test_upload_without_auth_returns_401(monkeypatch, tmp_path):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/uploads", files={"file": ("a.png", b"data", "image/png")}
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Ownership
# ---------------------------------------------------------------------------

def test_upload_attributes_asset_to_authenticated_user(monkeypatch, tmp_path):
    _reset_limiter()
    calls = _stub_media_insert(monkeypatch)

    client = _make_authed_client(monkeypatch, tmp_path, user_id=_OTHER_USER_ID)
    resp = client.post(
        "/api/v1/uploads",
        files={"file": ("photo.png", b"pngdata", "image/png")},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    assert resp.json()["user_id"] == _OTHER_USER_ID
    assert calls[0]["user_id"] == _OTHER_USER_ID
    written = Path(calls[0]["path"])
    assert written.parent == tmp_path / "uploads" / _OTHER_USER_ID
