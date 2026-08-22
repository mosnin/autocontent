"""Campaign route lifecycle + tenant isolation.

The runner units (test_campaign_runner / test_audit_round2_fixes) cover
cadence and budget math. These tests prove the HTTP surface cannot restart
a completed campaign, pause a non-running one, or attach another tenant's
niche / ad campaign as a lane.
"""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.models import Campaign, CampaignItem, Niche, PostingWindow

_USER_ID = "user_test"
NOW = datetime(2026, 8, 22, 12, 0, tzinfo=UTC)


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def _campaign(*, status: str = "draft", cid: UUID | None = None) -> Campaign:
    return Campaign(
        id=cid or uuid4(),
        user_id=_USER_ID,
        name="launch",
        status=status,
        budget_usd=Decimal(50),
        starts_at=NOW,
        created_at=NOW,
        updated_at=NOW,
    )


def _niche(nid: UUID) -> Niche:
    return Niche(
        id=nid,
        user_id=_USER_ID,
        title="t",
        description="d",
        target_audience="a",
        visual_style="v",
        voice="onyx",
        target_duration_sec=30,
        scene_count=2,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal(5),
    )


def test_create_rejects_non_positive_budget(monkeypatch):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    r = client.post("/api/v1/campaigns", json={"name": "zero", "budget_usd": "0"})
    assert r.status_code == 422


def test_start_completed_campaign_conflicts(monkeypatch):
    _reset_limiter()
    import marketer.repos.campaigns as campaigns_repo

    camp = _campaign(status="completed")
    status_calls: list[str] = []

    async def fake_get(cid, *, user_id):
        assert user_id == _USER_ID
        return camp

    async def fake_set(cid, *, user_id, status):
        status_calls.append(status)
        return camp

    monkeypatch.setattr(campaigns_repo, "get", fake_get)
    monkeypatch.setattr(campaigns_repo, "set_status", fake_set)
    client = _make_authed_client(monkeypatch)
    r = client.post(f"/api/v1/campaigns/{camp.id}/start")
    assert r.status_code == 409
    assert "cannot restart" in r.json()["detail"]
    assert status_calls == []


def test_start_missing_campaign_404(monkeypatch):
    _reset_limiter()
    import marketer.repos.campaigns as campaigns_repo

    async def fake_get(cid, *, user_id):
        pass

    monkeypatch.setattr(campaigns_repo, "get", fake_get)
    client = _make_authed_client(monkeypatch)
    r = client.post(f"/api/v1/campaigns/{uuid4()}/start")
    assert r.status_code == 404


def test_start_draft_sets_running(monkeypatch):
    _reset_limiter()
    import marketer.repos.campaigns as campaigns_repo

    camp = _campaign(status="draft")

    async def fake_get(cid, *, user_id):
        return camp

    async def fake_set(cid, *, user_id, status):
        assert user_id == _USER_ID
        return camp.model_copy(update={"status": status})

    monkeypatch.setattr(campaigns_repo, "get", fake_get)
    monkeypatch.setattr(campaigns_repo, "set_status", fake_set)
    client = _make_authed_client(monkeypatch)
    r = client.post(f"/api/v1/campaigns/{camp.id}/start")
    assert r.status_code == 200
    assert r.json()["status"] == "running"


def test_pause_non_running_conflicts(monkeypatch):
    _reset_limiter()
    import marketer.repos.campaigns as campaigns_repo

    camp = _campaign(status="paused")
    status_calls: list[str] = []

    async def fake_get(cid, *, user_id):
        return camp

    async def fake_set(cid, *, user_id, status):
        status_calls.append(status)
        return camp

    monkeypatch.setattr(campaigns_repo, "get", fake_get)
    monkeypatch.setattr(campaigns_repo, "set_status", fake_set)
    client = _make_authed_client(monkeypatch)
    r = client.post(f"/api/v1/campaigns/{camp.id}/pause")
    assert r.status_code == 409
    assert "not running" in r.json()["detail"]
    assert status_calls == []


def test_add_item_rejects_unowned_niche(monkeypatch):
    _reset_limiter()
    import marketer.repos.campaigns as campaigns_repo
    import marketer.repos.niches as niches_repo

    camp = _campaign()
    added = []

    async def fake_get(cid, *, user_id):
        return camp

    async def fake_niche(nid, *, user_id):
        assert user_id == _USER_ID

    async def fake_add(**kwargs):
        added.append(kwargs)
        raise AssertionError("must not attach an unowned niche")

    monkeypatch.setattr(campaigns_repo, "get", fake_get)
    monkeypatch.setattr(niches_repo, "get", fake_niche)
    monkeypatch.setattr(campaigns_repo, "add_item", fake_add)
    client = _make_authed_client(monkeypatch)
    r = client.post(
        f"/api/v1/campaigns/{camp.id}/items",
        json={"kind": "video", "ref_id": str(uuid4()), "cadence_per_week": 3},
    )
    assert r.status_code == 404
    assert added == []


def test_add_item_rejects_unowned_ad_campaign(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo
    import marketer.repos.campaigns as campaigns_repo

    camp = _campaign()
    added = []

    async def fake_get(cid, *, user_id):
        return camp

    async def fake_ad(cid, *, user_id):
        assert user_id == _USER_ID

    async def fake_add(**kwargs):
        added.append(kwargs)
        raise AssertionError("must not attach an unowned ad campaign")

    monkeypatch.setattr(campaigns_repo, "get", fake_get)
    monkeypatch.setattr(ads_repo, "get_campaign", fake_ad)
    monkeypatch.setattr(campaigns_repo, "add_item", fake_add)
    client = _make_authed_client(monkeypatch)
    r = client.post(
        f"/api/v1/campaigns/{camp.id}/items",
        json={"kind": "ad", "ref_id": str(uuid4())},
    )
    assert r.status_code == 404
    assert added == []


def test_add_item_owned_niche_passes_caller_scope(monkeypatch):
    _reset_limiter()
    import marketer.repos.campaigns as campaigns_repo
    import marketer.repos.niches as niches_repo

    camp = _campaign()
    nid = uuid4()
    item = CampaignItem(
        id=uuid4(),
        campaign_id=camp.id,
        user_id=_USER_ID,
        kind="image",
        ref_id=nid,
        created_at=NOW,
    )

    async def fake_get(cid, *, user_id):
        return camp

    async def fake_niche(rid, *, user_id):
        return _niche(rid)

    async def fake_add(*, campaign_id, user_id, kind, ref_id, cadence_per_week):
        assert campaign_id == camp.id
        assert user_id == _USER_ID
        assert kind == "image"
        assert ref_id == nid
        assert cadence_per_week == 2
        return item

    monkeypatch.setattr(campaigns_repo, "get", fake_get)
    monkeypatch.setattr(niches_repo, "get", fake_niche)
    monkeypatch.setattr(campaigns_repo, "add_item", fake_add)
    client = _make_authed_client(monkeypatch)
    r = client.post(
        f"/api/v1/campaigns/{camp.id}/items",
        json={"kind": "image", "ref_id": str(nid), "cadence_per_week": 2},
    )
    assert r.status_code == 201
    assert r.json()["kind"] == "image"


def test_add_item_rejects_out_of_range_cadence(monkeypatch):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    cid = uuid4()
    for cadence in (0, 57):
        r = client.post(
            f"/api/v1/campaigns/{cid}/items",
            json={"kind": "video", "ref_id": str(uuid4()), "cadence_per_week": cadence},
        )
        assert r.status_code == 422, cadence
