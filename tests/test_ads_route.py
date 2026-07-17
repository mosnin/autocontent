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


def _mk_approval(**kw):
    from marketer.repos.ad_approvals import AdApproval
    base = dict(
        id=uuid4(), user_id="user_ads", ad_account_id=uuid4(), campaign_id=uuid4(),
        action="budget.change", summary="", dollar_delta_usd=Decimal("10"),
        payload={}, status="approved", requested_by="agent", decided_by="a@t.com",
        decided_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdApproval(**base)


def test_decide_approval_approved_executes_budget_change_on_platform(monkeypatch):
    _reset_limiter()
    import backend.routes.ads as ads_route
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals

    approval = _mk_approval(action="budget.change")

    async def _decide(approval_id, *, user_id, status, decided_by):
        return approval

    executed = []

    async def _execute(**kwargs):
        executed.append(kwargs)
        return {"status": "executed"}

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", lambda **kw: _AwaitableNone())
    monkeypatch.setattr(ads_route, "execute_approved_budget_change", _execute)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{approval.id}/decide",
        json={"decision": "approved"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert len(executed) == 1
    assert executed[0]["approval_id"] == approval.id


def test_decide_approval_approved_executes_activation(monkeypatch):
    _reset_limiter()
    import backend.routes.ads as ads_route
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals

    approval = _mk_approval(action="campaign.activate")

    async def _decide(approval_id, *, user_id, status, decided_by):
        return approval

    executed = []

    async def _execute(**kwargs):
        executed.append(kwargs)
        return {"status": "executed"}

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", lambda **kw: _AwaitableNone())
    monkeypatch.setattr(ads_route, "execute_approved_activation", _execute)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{approval.id}/decide",
        json={"decision": "approved"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert len(executed) == 1


def test_decide_approval_execution_failure_surfaces_502(monkeypatch):
    _reset_limiter()
    import backend.routes.ads as ads_route
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    from marketer.services.composio_client import ComposioCallError

    approval = _mk_approval(action="budget.change")

    async def _decide(approval_id, *, user_id, status, decided_by):
        return approval

    async def _execute(**kwargs):
        raise ComposioCallError("platform rejected the change")

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", lambda **kw: _AwaitableNone())
    monkeypatch.setattr(ads_route, "execute_approved_budget_change", _execute)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{approval.id}/decide",
        json={"decision": "approved"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 502


def test_decide_approval_rejected_does_not_execute(monkeypatch):
    _reset_limiter()
    import backend.routes.ads as ads_route
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals

    approval = _mk_approval(action="budget.change", status="rejected")

    async def _decide(approval_id, *, user_id, status, decided_by):
        return approval

    executed = []

    async def _execute(**kwargs):
        executed.append(kwargs)
        return {"status": "executed"}

    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", lambda **kw: _AwaitableNone())
    monkeypatch.setattr(ads_route, "execute_approved_budget_change", _execute)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/approvals/{approval.id}/decide",
        json={"decision": "rejected"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert executed == []


class _AwaitableNone:
    """Tiny awaitable stub so ``ad_actions.record`` can be monkeypatched with
    a plain lambda instead of an async def (keeps those patches one-liners)."""

    def __await__(self):
        async def _inner():
            from marketer.repos.ad_actions import AdActionEntry
            return AdActionEntry(
                id=1, user_id="user_ads", actor="user", actor_email="a@t.com",
                action="x", platform="", target_type="", target_id="",
                dollar_delta_usd=Decimal("0"), created_at=datetime.now(timezone.utc),
            )
        return _inner().__await__()


# --------------------------------------------------------------------------- activation (real platform)


def _wire_guard_repo(monkeypatch, *, account, campaign):
    import marketer.repos.ads as ads_repo

    async def _get_account(account_id, *, user_id):
        return account

    async def _get_campaign(cid, *, user_id):
        return campaign

    async def _committed(**kw):
        return Decimal("0")

    async def _spend(*a, **kw):
        return Decimal("0")

    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "active_daily_budget_total", _committed)
    monkeypatch.setattr(ads_repo, "account_spend_on", _spend)
    monkeypatch.setattr(ads_repo, "account_spend_between", _spend)


def test_activate_creates_on_platform_and_stores_external_id(monkeypatch):
    _reset_limiter()
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo
    from marketer.services.composio_client import ComposioCallError as _CCE  # noqa: F401
    from marketer.services import composio_client

    camp = _mk_campaign(daily_budget_usd=Decimal("10"))  # under the $50 default threshold
    acc = _mk_account(status="active", composio_connection_id="conn-1")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)

    def _create(**kwargs):
        return {"external_campaign_id": "gads-1", "raw": {}}

    def _set_status(**kwargs):
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        return _mk_campaign(
            id=camp.id, status=kw.get("status", camp.status),
            external_campaign_id=kw.get("external_campaign_id", ""),
        )

    async def _record(**kw):
        from marketer.repos.ad_actions import AdActionEntry
        return AdActionEntry(
            id=1, user_id="user_ads", actor="user", actor_email="a@t.com",
            action=kw["action"], platform="", target_type="ad_campaign",
            target_id=str(camp.id), dollar_delta_usd=Decimal("0"),
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(composio_client, "create_campaign", _create)
    monkeypatch.setattr(composio_client, "set_campaign_status", _set_status)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _record)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{camp.id}/status",
        json={"status": "active"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["external_campaign_id"] == "gads-1"


def test_activate_over_threshold_pends_approval_and_skips_platform(monkeypatch):
    _reset_limiter()
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    from marketer.services import composio_client

    camp = _mk_campaign(daily_budget_usd=Decimal("100"))  # over the $50 default threshold
    acc = _mk_account(status="active")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)

    create_calls = []

    def _create(**kwargs):
        create_calls.append(kwargs)
        return {"external_campaign_id": "gads-1", "raw": {}}

    async def _approval_create(**kwargs):
        from marketer.repos.ad_approvals import AdApproval
        return AdApproval(
            id=uuid4(), user_id="user_ads", action="campaign.activate",
            summary=kwargs.get("summary", ""), dollar_delta_usd=Decimal("100"),
            payload=kwargs.get("payload", {}), status="pending",
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )

    async def _record(**kw):
        from marketer.repos.ad_actions import AdActionEntry
        return AdActionEntry(
            id=1, user_id="user_ads", actor="user", actor_email="a@t.com",
            action=kw["action"], platform="", target_type="ad_campaign",
            target_id=str(camp.id), dollar_delta_usd=Decimal("0"),
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(composio_client, "create_campaign", _create)
    monkeypatch.setattr(ad_approvals, "create", _approval_create)
    monkeypatch.setattr(ad_actions, "record", _record)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{camp.id}/status",
        json={"status": "active"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending_approval"
    assert create_calls == []  # never touched the platform without approval


# --------------------------------------------------------------------------- creatives


def test_generate_creatives_stores_variants(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo
    import marketer.repos.brand_kit as brand_kit_repo
    from marketer.agents import ads_strategist

    camp = _mk_campaign(name="Spring Sale", niche_id=None)

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _get_brand_kit(user_id):
        return None

    async def _run_copywriter(**kwargs):
        return ads_strategist.AdCreativeBatch(
            variants=[
                ads_strategist.AdCreativeVariant(headline="Save big", body="Deal ends soon", cta="Shop now"),
                ads_strategist.AdCreativeVariant(headline="Fresh drops", body="New styles weekly", cta="Browse"),
            ]
        )

    created = []

    async def _create_creative(**kwargs):
        from marketer.repos.ads import AdCreative
        created.append(kwargs)
        return AdCreative(
            id=uuid4(), user_id="user_ads", campaign_id=camp.id, kind="text",
            headline=kwargs["headline"], body=kwargs["body"], cta=kwargs["cta"],
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(brand_kit_repo, "get", _get_brand_kit)
    monkeypatch.setattr(ads_strategist, "run_ad_copywriter", _run_copywriter)
    monkeypatch.setattr(ads_repo, "create_creative", _create_creative)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{camp.id}/creatives",
        json={"count": 2},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body) == 2
    assert body[0]["headline"] == "Save big"
    assert len(created) == 2


def test_generate_creatives_404_for_missing_campaign(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo

    async def _get_campaign(cid, *, user_id):
        return None

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/ads/campaigns/{uuid4()}/creatives",
        json={},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_list_creatives_returns_stored(monkeypatch):
    _reset_limiter()
    import marketer.repos.ads as ads_repo
    from marketer.repos.ads import AdCreative

    camp = _mk_campaign()
    stored = [
        AdCreative(
            id=uuid4(), user_id="user_ads", campaign_id=camp.id, kind="text",
            headline="H", body="B", cta="Go", created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
    ]

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _list_creatives(user_id, *, campaign_id=None):
        return stored

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "list_creatives", _list_creatives)

    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/ads/campaigns/{camp.id}/creatives",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["headline"] == "H"
