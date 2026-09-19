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


def _mk_campaign(**kw):
    from marketer.repos.ads import AdCampaign
    base = dict(
        id=uuid4(), user_id="user_ads", ad_account_id=uuid4(),
        external_campaign_id="", name="C", objective="", status="draft",
        daily_budget_usd=None, lifetime_budget_usd=None, niche_id=None,
        last_error="", created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdCampaign(**base)


def test_create_campaign_requires_owned_account(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo

    async def _get_account(account_id, *, user_id):
        return None  # not owned / missing

    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/ads/campaigns",
        json={"ad_account_id": str(uuid4()), "name": "Launch"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_budget_change_denied_returns_402(monkeypatch):
    _reset_limiter()
    import backend.routes.ads as ads_route
    from marketer.services.ad_actions_exec import AdSpendDenied

    async def _propose(**kwargs):
        raise AdSpendDenied("account kill-switch is engaged")

    monkeypatch.setattr(ads_route, "propose_budget_change", _propose)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{uuid4()}/budget",
        json={"daily_budget_usd": "20"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
    assert "kill-switch" in resp.text


def test_budget_change_pending_approval_passthrough(monkeypatch):
    _reset_limiter()
    import backend.routes.ads as ads_route

    async def _propose(**kwargs):
        return {"status": "pending_approval", "approval_id": str(uuid4())}

    monkeypatch.setattr(ads_route, "propose_budget_change", _propose)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{uuid4()}/budget",
        json={"daily_budget_usd": "100"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending_approval"


def test_activate_denied_when_killswitch(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo

    camp = _mk_campaign()
    acc = _mk_account(killswitch=True)

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _get_account(aid, *, user_id):
        return acc

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{camp.id}/status",
        json={"status": "active"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
    assert "kill-switch" in resp.text


def test_pause_allowed_even_when_killswitch(monkeypatch):
    _reset_limiter()
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo

    camp = _mk_campaign(status="active")
    acc = _mk_account(killswitch=True)

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _get_account(aid, *, user_id):
        return acc

    async def _update(cid, *, user_id, **kw):
        return _mk_campaign(id=camp.id, status="paused")

    async def _record(**kw):
        from marketer.repos.ad_actions import AdActionEntry
        return AdActionEntry(
            id=1, user_id="user_ads", actor="user", actor_email="a@t.com",
            action=kw["action"], platform="", target_type="ad_campaign",
            target_id=str(camp.id), dollar_delta_usd=Decimal("0"),
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _record)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{camp.id}/status",
        json={"status": "paused"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "paused"


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


def test_disconnect_foreign_account_404s_without_composio_revoke(monkeypatch):
    """A guessed account id must 404 and must not revoke anyone's OAuth."""
    _reset_limiter()
    import marketer.services.ad_connections as conn
    import marketer.services.composio_client as composio
    import marketer.repos.ads as ads_repo

    revoked: list[str] = []

    async def _get(account_id, *, user_id):
        assert user_id == "user_ads"
        return None

    def _disconnect(*, connection_id):
        revoked.append(connection_id)

    monkeypatch.setattr(ads_repo, "get_account", _get)
    monkeypatch.setattr(composio, "disconnect", _disconnect)
    # Route calls the service; keep the real one so the 404 is the service's None.
    monkeypatch.setattr(conn, "composio_client", composio)

    client = _client(monkeypatch)
    resp = client.delete(
        f"/api/v1/ads/accounts/{uuid4()}",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
    assert revoked == []


async def test_disconnect_revokes_owned_connection_then_marks_disconnected(monkeypatch):
    import marketer.services.ad_connections as conn
    import marketer.services.composio_client as composio
    import marketer.repos.ads as ads_repo

    acc = _mk_account(composio_connection_id="conn_abc", status="active")
    seen: dict = {}

    async def _get(account_id, *, user_id):
        assert user_id == "user_ads"
        assert account_id == acc.id
        return acc

    def _revoke(*, connection_id):
        seen["revoked"] = connection_id

    async def _set(account_id, *, user_id, status, last_error=""):
        seen["status"] = status
        seen["set_user"] = user_id
        return _mk_account(id=account_id, status=status, composio_connection_id="conn_abc")

    monkeypatch.setattr(ads_repo, "get_account", _get)
    monkeypatch.setattr(ads_repo, "set_account_status", _set)
    monkeypatch.setattr(composio, "disconnect", _revoke)

    out = await conn.disconnect(user_id="user_ads", account_id=acc.id)
    assert out is not None
    assert out.status == "disconnected"
    assert seen == {"revoked": "conn_abc", "status": "disconnected", "set_user": "user_ads"}


async def test_disconnect_still_flips_local_status_when_composio_disabled(monkeypatch):
    import marketer.services.ad_connections as conn
    import marketer.services.composio_client as composio
    import marketer.repos.ads as ads_repo

    acc = _mk_account(composio_connection_id="conn_abc")

    async def _get(account_id, *, user_id):
        return acc

    def _revoke(*, connection_id):
        raise composio.AdsDisabled("ads off")

    async def _set(account_id, *, user_id, status, last_error=""):
        return _mk_account(id=account_id, status=status)

    monkeypatch.setattr(ads_repo, "get_account", _get)
    monkeypatch.setattr(ads_repo, "set_account_status", _set)
    monkeypatch.setattr(composio, "disconnect", _revoke)

    out = await conn.disconnect(user_id="user_ads", account_id=acc.id)
    assert out is not None
    assert out.status == "disconnected"


def test_refresh_and_governance_404_on_foreign_account(monkeypatch):
    _reset_limiter()
    import marketer.services.ad_connections as conn
    import marketer.repos.ads as ads_repo
    import marketer.repos.ad_actions as ad_actions

    audited: list[str] = []

    async def _refresh(*, user_id, account_id):
        return None

    async def _set_gov(account_id, *, user_id, **kwargs):
        return None

    async def _record(**kwargs):
        audited.append(kwargs["action"])

    monkeypatch.setattr(conn, "refresh_status", _refresh)
    monkeypatch.setattr(ads_repo, "set_account_governance", _set_gov)
    monkeypatch.setattr(ad_actions, "record", _record)
    client = _client(monkeypatch)
    aid = uuid4()
    headers = {"Authorization": "Bearer mkt_x"}
    assert client.post(f"/api/v1/ads/accounts/{aid}/refresh", headers=headers).status_code == 404
    assert client.patch(
        f"/api/v1/ads/accounts/{aid}/governance",
        json={"killswitch": True},
        headers=headers,
    ).status_code == 404
    assert audited == []


def test_overview_reports_enabled_false_when_ads_off(monkeypatch):
    """UI must not imply ads are live when the feature flag is off."""
    _reset_limiter()
    from marketer.config import settings
    import marketer.repos.ad_approvals as ad_approvals
    import marketer.repos.ads as ads_repo

    monkeypatch.setattr(settings, "ads_enabled", False)

    async def _empty_accounts(user_id):
        return []

    async def _empty_campaigns(user_id, limit=500):
        return []

    async def _empty_approvals(*, user_id, status=None):
        return []

    monkeypatch.setattr(ads_repo, "list_accounts", _empty_accounts)
    monkeypatch.setattr(ads_repo, "list_campaigns", _empty_campaigns)
    monkeypatch.setattr(ad_approvals, "list_", _empty_approvals)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/ads/overview", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["accounts"] == 0
    assert body["active_campaigns"] == 0
