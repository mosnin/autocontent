"""Unit tests for the ad_actions_exec safe-execute layer's platform wiring:
resolve_apply_fn (real vs local-noop), activation (creates on platform,
persists the external id, respects the approval threshold), and approved-
action execution actually applying to the platform. Composio is fully
monkeypatched — no network calls, no real spend."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from marketer.repos.ad_approvals import AdApproval
from marketer.repos.ads import AdAccount, AdCampaign
from marketer.services import ad_actions_exec as ex
from marketer.services import composio_client


def _account(**kw) -> AdAccount:
    base = dict(
        id=uuid4(), user_id="u1", platform="google_ads", external_account_id="",
        name="", composio_connection_id="conn_abc", status="active", currency="USD",
        daily_cap_usd=None, monthly_cap_usd=None, killswitch=False, last_error="",
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdAccount(**base)


def _campaign(**kw) -> AdCampaign:
    base = dict(
        id=uuid4(), user_id="u1", ad_account_id=uuid4(), external_campaign_id="",
        name="Launch", objective="conversions", status="draft",
        daily_budget_usd=Decimal("10"), lifetime_budget_usd=None, niche_id=None,
        last_error="", created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdCampaign(**base)


def _wire_guard_repo(monkeypatch, *, account: AdAccount, campaign: AdCampaign):
    """Monkeypatch the repo calls _gather_and_guard needs so the guard sees a
    healthy account with no committed spend/caps in play."""
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


async def _noop_record(**kw):
    from marketer.repos.ad_actions import AdActionEntry
    return AdActionEntry(
        id=1, user_id=kw.get("user_id", "u1"), actor=kw.get("actor", "user"),
        actor_email=kw.get("actor_email", ""), action=kw.get("action", ""),
        platform=kw.get("platform", ""), target_type=kw.get("target_type", ""),
        target_id=kw.get("target_id", ""),
        dollar_delta_usd=kw.get("dollar_delta_usd", Decimal("0")),
        created_at=datetime.now(timezone.utc),
    )


# --------------------------------------------------------------------------- resolve_apply_fn


async def test_resolve_apply_fn_noop_without_external_id(monkeypatch):
    camp = _campaign(external_campaign_id="")
    fn = await ex.resolve_apply_fn(camp)
    result = await fn(camp, Decimal("20"))
    assert result == {"applied": "local"}


async def test_resolve_apply_fn_noop_when_account_not_active(monkeypatch):
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="ext-1")
    acc = _account(status="pending")

    async def _get_account(account_id, *, user_id):
        return acc

    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    fn = await ex.resolve_apply_fn(camp)
    result = await fn(camp, Decimal("20"))
    assert result == {"applied": "local"}


async def test_resolve_apply_fn_calls_platform_when_connected(monkeypatch):
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="ext-1")
    acc = _account(status="active")
    calls = []

    async def _get_account(account_id, *, user_id):
        return acc

    def _set_budget(**kwargs):
        calls.append(kwargs)
        return {"applied": "platform"}

    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    monkeypatch.setattr(composio_client, "set_budget", _set_budget)
    fn = await ex.resolve_apply_fn(camp)
    result = await fn(camp, Decimal("20"))
    assert result == {"applied": "platform"}
    assert calls == [{
        "user_id": "u1", "connected_account_id": "conn_abc", "platform": "google_ads",
        "external_campaign_id": "ext-1", "daily_budget_usd": Decimal("20"),
    }]


async def test_propose_budget_change_applies_to_platform_when_connected(monkeypatch):
    """End-to-end: propose_budget_change with no explicit apply_fn resolves
    the real one when the campaign is live on an active account."""
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="ext-1", daily_budget_usd=Decimal("10"))
    acc = _account(status="active")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)

    calls = []

    def _set_budget(**kwargs):
        calls.append(kwargs)
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        return _campaign(id=camp.id, daily_budget_usd=kw["daily_budget_usd"])

    monkeypatch.setattr(composio_client, "set_budget", _set_budget)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    out = await ex.propose_budget_change(
        user_id="u1", campaign_id=camp.id, new_daily_budget_usd=Decimal("15"),
    )
    assert out["status"] == "executed"
    assert len(calls) == 1
    assert calls[0]["external_campaign_id"] == "ext-1"


async def test_propose_budget_change_stays_local_without_external_id(monkeypatch):
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="", daily_budget_usd=Decimal("10"))
    acc = _account(status="active")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)

    calls = []

    def _set_budget(**kwargs):  # must NOT be called
        calls.append(kwargs)
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        return _campaign(id=camp.id, daily_budget_usd=kw["daily_budget_usd"])

    monkeypatch.setattr(composio_client, "set_budget", _set_budget)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    out = await ex.propose_budget_change(
        user_id="u1", campaign_id=camp.id, new_daily_budget_usd=Decimal("15"),
    )
    assert out["status"] == "executed"
    assert calls == []  # never touched the platform — a local draft


# --------------------------------------------------------------------------- activate_campaign


async def test_activate_campaign_creates_on_platform_and_stores_external_id(monkeypatch):
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="", daily_budget_usd=Decimal("10"))  # under threshold
    acc = _account(status="active")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)

    create_calls, status_calls, updates = [], [], []

    def _create(**kwargs):
        create_calls.append(kwargs)
        return {"external_campaign_id": "gads-999", "raw": {}}

    def _set_status(**kwargs):
        status_calls.append(kwargs)
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        updates.append(kw)
        return _campaign(id=camp.id, status=kw.get("status", camp.status),
                          external_campaign_id=kw.get("external_campaign_id", ""))

    monkeypatch.setattr(composio_client, "create_campaign", _create)
    monkeypatch.setattr(composio_client, "set_campaign_status", _set_status)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    out = await ex.activate_campaign(user_id="u1", campaign=camp, account=acc)
    assert out["status"] == "executed"
    assert out["campaign"]["external_campaign_id"] == "gads-999"
    assert create_calls[0]["connected_account_id"] == "conn_abc"
    assert status_calls[0]["external_campaign_id"] == "gads-999"
    assert status_calls[0]["status"] == "active"
    assert updates[0]["external_campaign_id"] == "gads-999"
    assert updates[0]["status"] == "active"


async def test_activate_campaign_respects_approval_threshold(monkeypatch):
    """A daily budget at/over the approval threshold parks for a human and
    must NOT touch the platform yet."""
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_approval_threshold_usd", 50.0)
    camp = _campaign(external_campaign_id="", daily_budget_usd=Decimal("100"))
    acc = _account(status="active")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)

    create_calls = []
    approvals_created = []

    def _create(**kwargs):  # must NOT be called
        create_calls.append(kwargs)
        return {"external_campaign_id": "gads-999", "raw": {}}

    async def _approval_create(**kwargs):
        approvals_created.append(kwargs)
        return AdApproval(
            id=uuid4(), user_id="u1", action="campaign.activate",
            summary=kwargs.get("summary", ""),
            dollar_delta_usd=kwargs.get("dollar_delta_usd", Decimal("0")),
            payload=kwargs.get("payload", {}), status="pending",
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(composio_client, "create_campaign", _create)
    monkeypatch.setattr(ad_approvals, "create", _approval_create)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    out = await ex.activate_campaign(user_id="u1", campaign=camp, account=acc)
    assert out["status"] == "pending_approval"
    assert create_calls == []
    assert approvals_created[0]["payload"] == {"daily_budget_usd": "100"}


async def test_activate_campaign_denied_raises(monkeypatch):
    import marketer.repos.ad_actions as ad_actions

    camp = _campaign(external_campaign_id="", daily_budget_usd=Decimal("10"))
    acc = _account(status="active", killswitch=True, daily_cap_usd=Decimal("0"))
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    with pytest.raises(ex.AdSpendDenied):
        await ex.activate_campaign(user_id="u1", campaign=camp, account=acc)


# --------------------------------------------------------------------------- approved execution


async def test_execute_approved_budget_change_applies_to_platform(monkeypatch):
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="ext-1", daily_budget_usd=Decimal("10"))
    acc = _account(status="active")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)
    approval_id = uuid4()

    async def _get_approval(aid, *, user_id):
        return AdApproval(
            id=approval_id, user_id="u1", campaign_id=camp.id, action="budget.change",
            payload={"new_daily_budget_usd": "15"}, status="approved",
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )

    marked = []

    async def _mark_executed(aid, *, user_id):
        marked.append(aid)

    calls = []

    def _set_budget(**kwargs):
        calls.append(kwargs)
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        return _campaign(id=camp.id, daily_budget_usd=kw["daily_budget_usd"])

    monkeypatch.setattr(ad_approvals, "get", _get_approval)
    monkeypatch.setattr(ad_approvals, "mark_executed", _mark_executed)
    monkeypatch.setattr(composio_client, "set_budget", _set_budget)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    out = await ex.execute_approved_budget_change(user_id="u1", approval_id=approval_id)
    assert out["status"] == "executed"
    assert len(calls) == 1  # applied to the platform
    assert marked == [approval_id]


async def test_execute_approved_activation_creates_on_platform(monkeypatch):
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ad_approvals as ad_approvals
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="", daily_budget_usd=Decimal("100"))
    acc = _account(status="active")
    _wire_guard_repo(monkeypatch, account=acc, campaign=camp)
    approval_id = uuid4()

    async def _get_approval(aid, *, user_id):
        return AdApproval(
            id=approval_id, user_id="u1", campaign_id=camp.id, action="campaign.activate",
            payload={"daily_budget_usd": "100"}, status="approved",
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )

    marked = []

    async def _mark_executed(aid, *, user_id):
        marked.append(aid)

    create_calls = []

    def _create(**kwargs):
        create_calls.append(kwargs)
        return {"external_campaign_id": "gads-42", "raw": {}}

    def _set_status(**kwargs):
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        return _campaign(id=camp.id, status="active",
                          external_campaign_id=kw.get("external_campaign_id", ""))

    monkeypatch.setattr(ad_approvals, "get", _get_approval)
    monkeypatch.setattr(ad_approvals, "mark_executed", _mark_executed)
    monkeypatch.setattr(composio_client, "create_campaign", _create)
    monkeypatch.setattr(composio_client, "set_campaign_status", _set_status)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    out = await ex.execute_approved_activation(user_id="u1", approval_id=approval_id)
    assert out["status"] == "executed"
    assert out["campaign"]["external_campaign_id"] == "gads-42"
    assert len(create_calls) == 1
    assert marked == [approval_id]


# --------------------------------------------------------------------------- apply_status_change


async def test_apply_status_change_propagates_to_platform_with_external_id(monkeypatch):
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="ext-1", status="active")
    acc = _account(status="active")
    calls = []

    def _set_status(**kwargs):
        calls.append(kwargs)
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        return _campaign(id=camp.id, status=kw["status"])

    monkeypatch.setattr(composio_client, "set_campaign_status", _set_status)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    updated = await ex.apply_status_change(
        campaign=camp, account=acc, new_status="paused", actor="user",
    )
    assert updated.status == "paused"
    assert calls[0]["status"] == "paused"


async def test_apply_status_change_local_only_without_external_id(monkeypatch):
    import marketer.repos.ad_actions as ad_actions
    import marketer.repos.ads as ads_repo

    camp = _campaign(external_campaign_id="", status="draft")
    acc = _account(status="active")
    calls = []

    def _set_status(**kwargs):  # must NOT be called
        calls.append(kwargs)
        return {"applied": "platform"}

    async def _update(cid, *, user_id, **kw):
        return _campaign(id=camp.id, status=kw["status"])

    monkeypatch.setattr(composio_client, "set_campaign_status", _set_status)
    monkeypatch.setattr(ads_repo, "update_campaign", _update)
    monkeypatch.setattr(ad_actions, "record", _noop_record)

    updated = await ex.apply_status_change(
        campaign=camp, account=acc, new_status="paused", actor="user",
    )
    assert updated.status == "paused"
    assert calls == []
