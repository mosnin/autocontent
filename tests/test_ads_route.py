"""Route-level tests for /api/v1/ads. Repos + Composio are monkeypatched; auth
is bypassed via dependency_overrides. Confirms the connect flow surfaces
AdsDisabled as 409, governance validates + audits, and approvals decide is
single-use."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id="user_ads", email="a@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _mk_account(**kw):
    from marketer.repos.ads import AdAccount
    base = dict(
        id=uuid4(), user_id="user_ads", platform="google_ads",
        external_account_id="", name="", composio_connection_id="",
        status="active", currency="USD", daily_cap_usd=None,
        monthly_cap_usd=None, killswitch=False, last_error="",
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdAccount(**base)


def test_list_accounts_empty(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo

    async def _list(user_id):
        return []

    monkeypatch.setattr(ads_repo, "list_accounts", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/ads/accounts", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_connect_returns_409_when_ads_disabled(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    # ads disabled by default → start_connection raises AdsDisabled → 409
    monkeypatch.setattr(settings, "ads_enabled", False)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/ads/accounts/connect",
        json={"platform": "google_ads"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_connect_happy_path_returns_redirect(monkeypatch):
    _reset_limiter()
    import marketer.services.ad_connections as conn

    async def _start(*, user_id, platform):
        return {
            "account_id": str(uuid4()),
            "redirect_url": "https://auth.example/oauth",
            "platform": platform,
        }

    monkeypatch.setattr(conn, "start_connection", _start)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/ads/accounts/connect",
        json={"platform": "meta_ads"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["redirect_url"].startswith("https://")


def test_governance_rejects_negative_cap(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.patch(
        f"/api/v1/ads/accounts/{uuid4()}/governance",
        json={"daily_cap_usd": "-5"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_governance_sets_killswitch_and_audits(monkeypatch):
    _reset_limiter()
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo

    seen: dict = {}
    acc = _mk_account(killswitch=True)

    async def _set(account_id, *, user_id, **kwargs):
        seen["kwargs"] = kwargs
        return acc

    async def _record(**kwargs):
        seen["audited"] = kwargs["action"]
        from marketer.repos.ad_actions import AdActionEntry
        return AdActionEntry(
            id=1, user_id=kwargs.get("user_id", "user_ads"), actor="user",
            actor_email="a@t.com", action=kwargs["action"], platform="google_ads",
            target_type="ad_account", target_id=str(acc.id),
            dollar_delta_usd=Decimal("0"), created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(ads_repo, "set_account_governance", _set)
    monkeypatch.setattr(ad_actions, "record", _record)
    client = _client(monkeypatch)
    resp = client.patch(
        f"/api/v1/ads/accounts/{acc.id}/governance",
        json={"killswitch": True},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["killswitch"] is True
    assert seen["kwargs"] == {"killswitch": True}
    assert seen["audited"] == "account.governance"


def test_decide_approval_conflict_when_already_decided(monkeypatch):
    _reset_limiter()
    import marketer.repos.ad_approvals as ad_approvals

    async def _decide(approval_id, *, user_id, status, decided_by):
        return None  # already decided / not found

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{uuid4()}/decide",
        json={"decision": "approved"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409
