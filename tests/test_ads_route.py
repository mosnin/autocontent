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


def _approval(*, action="budget.change"):
    from marketer.repos.ad_approvals import AdApproval
    now = datetime.now(timezone.utc)
    return AdApproval(
        id=uuid4(), user_id="user_ads", action=action,
        summary="Set daily budget to $50", dollar_delta_usd=Decimal("40"),
        payload={"new_daily_budget_usd": "50"}, status="approved",
        created_at=now, updated_at=now,
    )


def test_decide_approval_executes_budget_change(monkeypatch):
    """Human 'yes' must run the safe-execute layer, not just flip the row."""
    _reset_limiter()
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    import backend.routes.ads as ads_routes

    decided = _approval()
    executed: list[dict] = []

    async def _decide(approval_id, *, user_id, status, decided_by):
        assert status == "approved"
        assert user_id == "user_ads"
        return decided

    async def _record(**kw):
        return None

    async def _execute(*, user_id, approval_id, actor_email):
        executed.append({
            "user_id": user_id, "approval_id": approval_id,
            "actor_email": actor_email,
        })
        return {"status": "executed"}

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", _record)
    monkeypatch.setattr(ads_routes, "execute_approved_budget_change", _execute)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{decided.id}/decide",
        json={"decision": "approved"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "executed"
    assert executed == [{
        "user_id": "user_ads",
        "approval_id": decided.id,
        "actor_email": "a@t.com",
    }]


def test_decide_approval_surfaces_re_guard_deny_as_402(monkeypatch):
    """If state moved since the human approved, re-guard must fail closed."""
    _reset_limiter()
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    import backend.routes.ads as ads_routes
    from marketer.services.ad_actions_exec import AdSpendDenied

    decided = _approval()

    async def _decide(approval_id, *, user_id, status, decided_by):
        return decided

    async def _record(**kw):
        return None

    async def _execute(**kw):
        raise AdSpendDenied("killswitch engaged")

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", _record)
    monkeypatch.setattr(ads_routes, "execute_approved_budget_change", _execute)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{decided.id}/decide",
        json={"decision": "approved"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
    assert "killswitch" in resp.json()["detail"]


def test_decide_approval_reject_does_not_execute(monkeypatch):
    _reset_limiter()
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    import backend.routes.ads as ads_routes

    decided = _approval()
    decided = decided.model_copy(update={"status": "rejected"})

    async def _decide(approval_id, *, user_id, status, decided_by):
        assert status == "rejected"
        return decided

    async def _record(**kw):
        return None

    async def explode(**kw):
        raise AssertionError("reject must never execute a spend change")

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", _record)
    monkeypatch.setattr(ads_routes, "execute_approved_budget_change", explode)
    monkeypatch.setattr(ads_routes, "execute_approved_activation", explode)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{decided.id}/decide",
        json={"decision": "rejected"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
