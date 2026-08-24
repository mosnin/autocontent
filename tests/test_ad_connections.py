"""Ad-account connection orchestration: status mapping and tenant 404s.

A wrong status map can treat an expired OAuth grant as spendable; a missed
user_id scope can refresh or revoke someone else's ad account.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.services import ad_connections
from marketer.services.composio_client import AdsDisabled


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


def test_map_status_active_failed_and_pending():
    assert ad_connections._map_status("ACTIVE") == "active"
    assert ad_connections._map_status("active") == "active"
    for raw in ("FAILED", "EXPIRED", "DELETED", "INACTIVE"):
        assert ad_connections._map_status(raw) == "error"
    assert ad_connections._map_status("INITIATED") == "pending"
    assert ad_connections._map_status("unknown") == "pending"


def test_refresh_and_disconnect_404_for_other_tenant(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo

    async def _missing(account_id, *, user_id):
        return None

    monkeypatch.setattr(ads_repo, "get_account", _missing)
    client = _client(monkeypatch)
    headers = {"Authorization": "Bearer mkt_x"}
    aid = uuid4()
    assert client.post(
        f"/api/v1/ads/accounts/{aid}/refresh", headers=headers
    ).status_code == 404
    assert client.delete(
        f"/api/v1/ads/accounts/{aid}", headers=headers
    ).status_code == 404


def test_get_campaign_404_for_other_tenant(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo

    async def _missing(campaign_id, *, user_id):
        return None

    monkeypatch.setattr(ads_repo, "get_campaign", _missing)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/ads/campaigns/{uuid4()}",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


async def test_refresh_leaves_status_when_composio_disabled(monkeypatch):
    from marketer.repos.ads import AdAccount
    from marketer.services import composio_client

    acc = AdAccount(
        id=uuid4(), user_id="user_ads", platform="google_ads",
        external_account_id="", name="", composio_connection_id="conn_1",
        status="pending", currency="USD", daily_cap_usd=None,
        monthly_cap_usd=None, killswitch=False, last_error="",
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )

    async def _get(account_id, *, user_id):
        return acc

    async def _must_not_set(*a, **k):
        raise AssertionError("must not flip status when ads are disabled")

    import marketer.repos.ads as ads_repo

    monkeypatch.setattr(ads_repo, "get_account", _get)
    monkeypatch.setattr(ads_repo, "set_account_status", _must_not_set)
    monkeypatch.setattr(
        composio_client, "connection_status",
        lambda **k: (_ for _ in ()).throw(AdsDisabled("off")),
    )

    out = await ad_connections.refresh_status(user_id="user_ads", account_id=acc.id)
    assert out is acc
    assert out.status == "pending"
