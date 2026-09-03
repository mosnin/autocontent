"""HTTP lifecycle for /api/v1/campaigns.

Runner ticks already have thorough coverage. These cases pin the route
state machine and tenant-scoped lane refs — start/pause on the wrong
status or a foreign campaign must not flip rows, and a guessed niche/ad
id must not attach another tenant's work to the caller's campaign.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.models import Campaign

_USER_ID = "user_campaigns_test"
_CAMPAIGN_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


def _campaign(*, status: str = "draft", campaign_id: UUID | None = None) -> Campaign:
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)
    return Campaign(
        id=campaign_id or _CAMPAIGN_ID,
        user_id=_USER_ID,
        name="launch",
        status=status,  # type: ignore[arg-type]
        budget_usd=Decimal("50.00"),
        starts_at=now,
        created_at=now,
        updated_at=now,
    )


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def test_start_draft_sets_running(monkeypatch):
    import marketer.repos.campaigns as campaigns_repo

    status_writes: list[str] = []

    async def _get(campaign_id, *, user_id):
        assert user_id == _USER_ID
        return _campaign(status="draft")

    async def _set_status(campaign_id, *, user_id, status):
        status_writes.append(status)
        return _campaign(status=status)

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(campaigns_repo, "set_status", _set_status)
    client = _make_authed_client(monkeypatch)

    resp = client.post(f"/api/v1/campaigns/{_CAMPAIGN_ID}/start")
    assert resp.status_code == 200
    assert resp.json()["status"] == "running"
    assert status_writes == ["running"]


def test_start_completed_is_409_and_does_not_write(monkeypatch):
    """A finished campaign must not re-enter the hourly runner."""
    import marketer.repos.campaigns as campaigns_repo

    writes: list[tuple] = []

    async def _get(campaign_id, *, user_id):
        return _campaign(status="completed")

    async def _set_status(campaign_id, *, user_id, status):
        writes.append((campaign_id, user_id, status))
        raise AssertionError("completed campaigns must not restart")

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(campaigns_repo, "set_status", _set_status)
    client = _make_authed_client(monkeypatch)

    resp = client.post(f"/api/v1/campaigns/{_CAMPAIGN_ID}/start")
    assert resp.status_code == 409
    assert "cannot restart" in resp.json()["detail"]
    assert writes == []


def test_start_unowned_is_404(monkeypatch):
    import marketer.repos.campaigns as campaigns_repo

    writes: list = []

    async def _get(campaign_id, *, user_id):
        assert user_id == _USER_ID
        return None

    async def _set_status(*a, **k):
        writes.append((a, k))
        raise AssertionError("unowned campaign must not change status")

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(campaigns_repo, "set_status", _set_status)
    client = _make_authed_client(monkeypatch)

    resp = client.post(f"/api/v1/campaigns/{uuid4()}/start")
    assert resp.status_code == 404
    assert writes == []


def test_pause_running_sets_paused(monkeypatch):
    import marketer.repos.campaigns as campaigns_repo

    async def _get(campaign_id, *, user_id):
        return _campaign(status="running")

    async def _set_status(campaign_id, *, user_id, status):
        return _campaign(status=status)

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(campaigns_repo, "set_status", _set_status)
    client = _make_authed_client(monkeypatch)

    resp = client.post(f"/api/v1/campaigns/{_CAMPAIGN_ID}/pause")
    assert resp.status_code == 200
    assert resp.json()["status"] == "paused"


def test_pause_non_running_is_409_and_does_not_write(monkeypatch):
    import marketer.repos.campaigns as campaigns_repo

    writes: list = []

    async def _get(campaign_id, *, user_id):
        return _campaign(status="draft")

    async def _set_status(*a, **k):
        writes.append((a, k))
        raise AssertionError("non-running campaigns must not pause")

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(campaigns_repo, "set_status", _set_status)
    client = _make_authed_client(monkeypatch)

    resp = client.post(f"/api/v1/campaigns/{_CAMPAIGN_ID}/pause")
    assert resp.status_code == 409
    assert "not running" in resp.json()["detail"]
    assert writes == []


def test_add_item_rejects_foreign_niche(monkeypatch):
    """A guessed niche UUID must not become a video/article/image lane."""
    import marketer.repos.campaigns as campaigns_repo
    import marketer.repos.niches as niches_repo

    added: list = []

    async def _get(campaign_id, *, user_id):
        return _campaign()

    async def _niche_get(niche_id, *, user_id):
        assert user_id == _USER_ID
        return None

    async def _add_item(**kwargs):
        added.append(kwargs)
        raise AssertionError("foreign niche must not be attached")

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(campaigns_repo, "add_item", _add_item)
    client = _make_authed_client(monkeypatch)

    resp = client.post(
        f"/api/v1/campaigns/{_CAMPAIGN_ID}/items",
        json={"kind": "image", "ref_id": str(uuid4()), "cadence_per_week": 3},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "niche not found"
    assert added == []


def test_add_item_rejects_foreign_ad_campaign(monkeypatch):
    import marketer.repos.ads as ads_repo
    import marketer.repos.campaigns as campaigns_repo

    added: list = []

    async def _get(campaign_id, *, user_id):
        return _campaign()

    async def _ad_get(campaign_id, *, user_id):
        assert user_id == _USER_ID
        return None

    async def _add_item(**kwargs):
        added.append(kwargs)
        raise AssertionError("foreign ad campaign must not be attached")

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(ads_repo, "get_campaign", _ad_get)
    monkeypatch.setattr(campaigns_repo, "add_item", _add_item)
    client = _make_authed_client(monkeypatch)

    resp = client.post(
        f"/api/v1/campaigns/{_CAMPAIGN_ID}/items",
        json={"kind": "ad", "ref_id": str(uuid4()), "cadence_per_week": 1},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "ad campaign not found"
    assert added == []
