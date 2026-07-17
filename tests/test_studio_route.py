"""Route-level tests for /api/v1/studio — the fal.ai-backed Content Studio
tools.

fal itself is fully mocked (monkeypatched at the `marketer.services.fal`
module level, not via network) per team convention; DB repos are
monkeypatched the same way tests/test_jobs_route.py does. No real keys,
no network.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from marketer.models import MediaAsset

_USER_ID = "user_test"
_MEDIA_ID = UUID("55555555-5555-5555-5555-555555555555")


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


@pytest.fixture(autouse=True)
def _fal_enabled(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "fal_api_key", "fal-test-key")
    monkeypatch.setattr(settings, "fal_image_model", "fal-ai/flux/dev")
    monkeypatch.setattr(settings, "fal_video_model", "fal-ai/kling-video/v1.5/standard/image-to-video")
    monkeypatch.setattr(settings, "fal_image_cost_usd", 0.05)
    monkeypatch.setattr(settings, "fal_video_cost_usd", 0.35)
    monkeypatch.setattr(settings, "billing_enabled", False)


@pytest.fixture
def stub_studio_stack(monkeypatch, tmp_path):
    """Stub the whole chain a studio endpoint touches so no DB/network is
    reached: SpendContext record + today-spend readers, media_repo.insert,
    and fal_svc.run/run_queued + download."""
    import marketer.repos.spend as spend_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    spend_entries: list = []

    async def _fake_record(entry):
        spend_entries.append(entry)
    monkeypatch.setattr(spend_repo, "record", _fake_record)

    async def _fake_today_spend(*, user_id, niche_id):
        return Decimal("0")
    monkeypatch.setattr(spend_repo, "today_spend_usd", _fake_today_spend)

    async def _fake_today_total(*, user_id):
        return Decimal("0")
    monkeypatch.setattr(spend_repo, "today_spend_total_usd", _fake_today_total)

    async def _fake_user_get(user_id):
        return User(
            id=user_id, email="t@t.com", global_daily_cap_usd=None,
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(users_repo, "get", _fake_user_get)

    inserted: list = []

    async def _fake_insert(**kwargs):
        asset = MediaAsset(
            id=_MEDIA_ID,
            user_id=kwargs["user_id"],
            niche_id=kwargs.get("niche_id"),
            kind=kwargs["kind"],
            source=kwargs["source"],
            path=kwargs.get("path", ""),
            url=kwargs.get("url", ""),
            meta=kwargs.get("meta") or {},
            created_at=datetime.now(timezone.utc),
        )
        inserted.append(kwargs)
        return asset

    import marketer.repos.media as media_repo
    monkeypatch.setattr(media_repo, "insert", _fake_insert)

    downloaded: list = []

    async def _fake_download(url, out_path):
        downloaded.append(url)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"ASSETBYTES")
        return out_path

    from marketer.services import fal as fal_svc
    monkeypatch.setattr(fal_svc, "download", _fake_download)
    monkeypatch.setattr(settings_module(), "artifacts_dir", str(tmp_path))

    return {"spend_entries": spend_entries, "inserted": inserted, "downloaded": downloaded}


def settings_module():
    from marketer.config import settings
    return settings


# ---------------------------------------------------------------------------
# StudioDisabled -> 503
# ---------------------------------------------------------------------------

def test_text_to_image_503_when_key_missing(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "fal_api_key", "")

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/image",
        json={"prompt": "a cat astronaut"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 503
    assert "MARKETER_FAL_API_KEY" in resp.json()["detail"]


def test_video_503_when_key_missing(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "fal_api_key", "")

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/video",
        json={"image_url": "https://example.com/a.png"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# Happy path: image flow stores a media row + charges spend
# ---------------------------------------------------------------------------

def test_text_to_image_stores_media_and_charges_spend(monkeypatch, stub_studio_stack):
    _reset_limiter()
    from marketer.services import fal as fal_svc

    async def _fake_run(model_id, payload):
        assert model_id == "fal-ai/flux/dev"
        assert payload == {"prompt": "a cat astronaut"}
        return {"images": [{"url": "https://cdn.fal.ai/out.png"}]}

    monkeypatch.setattr(fal_svc, "run", _fake_run)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/image",
        json={"prompt": "a cat astronaut"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == str(_MEDIA_ID)

    # Spend was recorded through SpendContext, at the configured flat cost.
    entries = stub_studio_stack["spend_entries"]
    assert len(entries) == 1
    assert entries[0].provider == "fal"
    assert entries[0].sku == "fal-ai/flux/dev"
    assert entries[0].cost_usd == Decimal("0.05")

    # The media row was inserted with source='studio', kind='image'.
    inserted = stub_studio_stack["inserted"][0]
    assert inserted["source"] == "studio"
    assert inserted["kind"] == "image"
    assert inserted["meta"]["model"] == "fal-ai/flux/dev"

    # The fal result was downloaded onto the volume before insert.
    assert stub_studio_stack["downloaded"] == ["https://cdn.fal.ai/out.png"]


def test_video_charges_the_video_cost(monkeypatch, stub_studio_stack):
    _reset_limiter()
    from marketer.services import fal as fal_svc

    async def _fake_run_queued(model_id, payload):
        return {"video": {"url": "https://cdn.fal.ai/clip.mp4"}}

    monkeypatch.setattr(fal_svc, "run_queued", _fake_run_queued)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/video",
        json={"image_url": "https://example.com/a.png"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    entries = stub_studio_stack["spend_entries"]
    assert entries[0].cost_usd == Decimal("0.35")
    assert stub_studio_stack["inserted"][0]["kind"] == "video"


def test_image_edit_requires_media_id_or_image_url(monkeypatch, stub_studio_stack):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/image/edit",
        json={"prompt": "make it darker"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Model allowlist
# ---------------------------------------------------------------------------

def test_text_to_image_rejects_off_registry_model(monkeypatch, stub_studio_stack):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/image",
        json={"prompt": "x", "model": "some-rando/unvetted-model"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422
    assert "not allowed" in resp.json()["detail"]


def test_text_to_image_accepts_allowlisted_override(monkeypatch, stub_studio_stack):
    _reset_limiter()
    from marketer.services import fal as fal_svc

    seen: dict = {}

    async def _fake_run(model_id, payload):
        seen["model_id"] = model_id
        return {"images": [{"url": "https://cdn.fal.ai/out.png"}]}

    monkeypatch.setattr(fal_svc, "run", _fake_run)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/image",
        json={"prompt": "x", "model": "fal-ai/flux/schnell"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    assert seen["model_id"] == "fal-ai/flux/schnell"


# ---------------------------------------------------------------------------
# Spend cap -> 402
# ---------------------------------------------------------------------------

def test_text_to_image_402_when_global_cap_exceeded(monkeypatch, stub_studio_stack):
    _reset_limiter()
    import marketer.repos.spend as spend_repo
    import marketer.repos.users as users_repo
    from marketer.models import User

    async def _fake_user_get(user_id):
        return User(
            id=user_id, email="t@t.com", global_daily_cap_usd=Decimal("1.00"),
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(users_repo, "get", _fake_user_get)

    async def _fake_today_total(*, user_id):
        return Decimal("1.00")  # already at the cap
    monkeypatch.setattr(spend_repo, "today_spend_total_usd", _fake_today_total)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/studio/image",
        json={"prompt": "x"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 402


def test_studio_without_auth_returns_401(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post("/api/v1/studio/image", json={"prompt": "x"})
    assert resp.status_code == 401
