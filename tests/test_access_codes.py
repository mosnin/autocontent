"""Invite and pilot codes: the redeem route, the access read, and the admin routes."""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.auth import AdminCtx, require_admin, require_user
from backend.main import create_app
from marketer.repos import access_codes as codes_repo
from tests.auth_helpers import ctx_for


def _client(ctx) -> TestClient:
    app = create_app()
    app.dependency_overrides[require_user] = lambda: ctx
    return TestClient(app)


@pytest.fixture()
def billing_on(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)


@pytest.fixture()
def audits(monkeypatch):
    from backend import audit

    rows: list[dict] = []

    async def record(ctx, action, **kw):
        rows.append({"action": action, **kw})

    monkeypatch.setattr(audit, "record", record)
    return rows


def test_normalize_folds_case_dashes_and_confusables():
    assert codes_repo.normalize(" plt-ab0o-iL12 ") == "PLTAB001112"
    assert codes_repo.code_hash("PLT-AB00-1112") == codes_repo.code_hash("plt ab0o il12")


def test_generated_codes_have_prefix_and_entropy():
    a, b = codes_repo.generate("invite"), codes_repo.generate("pilot")
    assert a.startswith("INV-") and b.startswith("PLT-")
    assert len(codes_repo.normalize(a)) == 15
    assert len({codes_repo.generate("invite") for _ in range(50)}) == 50


def test_redeem_success_is_audited_without_the_code(monkeypatch, billing_on, audits):
    seen = {}

    async def redeem(*, code, tenant_id, actor_id):
        seen.update(code=code, tenant_id=tenant_id, actor_id=actor_id)
        return codes_repo.Redemption(kind="pilot", credit_usd=Decimal("25"), trial_days=30, access_until=None, redeemed_at=datetime.now(UTC))

    monkeypatch.setattr(codes_repo, "redeem", redeem)
    r = _client(ctx_for("owner", actor_id="person_1")).post("/api/v1/billing/redeem", json={"code": "PLT-AAAA-BBBB-CCCC"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "pilot" and r.json()["credit_usd"] == "25"
    assert seen == {"code": "PLT-AAAA-BBBB-CCCC", "tenant_id": "user_test", "actor_id": "person_1"}
    assert audits[-1]["action"] == "billing.code_redeemed" and audits[-1]["outcome"] == "success"
    assert "AAAA" not in repr(audits)


@pytest.mark.parametrize(
    ("reason", "status"),
    [("code_unknown", 404), ("code_expired", 410), ("code_used_up", 409), ("code_already_redeemed", 409)],
)
def test_redeem_failures_have_clear_codes(monkeypatch, billing_on, audits, reason, status):
    async def redeem(**_kw):
        raise codes_repo.RedeemFailed(reason)

    monkeypatch.setattr(codes_repo, "redeem", redeem)
    r = _client(ctx_for("owner")).post("/api/v1/billing/redeem", json={"code": "INV-0000-0000-0000"})
    assert r.status_code == status
    assert r.json()["detail"] == reason
    assert audits[-1]["outcome"] == "failure" and audits[-1]["metadata"]["reason"] == reason


@pytest.mark.parametrize("ctx", [ctx_for("agent", actor_role="owner"), ctx_for("owner", actor_type="token")])
def test_redeem_is_for_a_person_only(monkeypatch, billing_on, ctx):
    async def redeem(**_kw):
        raise AssertionError("must not redeem")

    monkeypatch.setattr(codes_repo, "redeem", redeem)
    ctx.permissions = ctx.permissions | {"billing:manage"}
    r = _client(ctx).post("/api/v1/billing/redeem", json={"code": "INV-0000-0000-0000"})
    assert r.status_code == 403
    assert r.json()["detail"] == "person_only"


def test_redeem_needs_billing_manage(billing_on):
    r = _client(ctx_for("analyst")).post("/api/v1/billing/redeem", json={"code": "INV-0000-0000-0000"})
    assert r.status_code == 403
    assert r.json()["permission"] == "billing:manage"


def test_redeem_is_rate_limited(monkeypatch, billing_on, audits):
    async def redeem(**_kw):
        raise codes_repo.RedeemFailed("code_unknown")

    monkeypatch.setattr(codes_repo, "redeem", redeem)
    c = _client(ctx_for("owner"))
    codes = [c.post("/api/v1/billing/redeem", json={"code": "INV-0000-0000-0000"}).status_code for _ in range(6)]
    assert codes[:5] == [404] * 5 and codes[5] == 429


def test_access_needs_plan_only_when_empty(monkeypatch, billing_on):
    from marketer.repos import billing as billing_repo

    state = {"bal": Decimal("0"), "purchased": False, "red": None}

    async def balance(_):
        return state["bal"]

    async def purchased(_):
        return state["purchased"]

    async def red(_):
        return state["red"]

    monkeypatch.setattr(billing_repo, "balance", balance)
    monkeypatch.setattr(codes_repo, "has_purchased", purchased)
    monkeypatch.setattr(codes_repo, "redemption_for", red)
    c = _client(ctx_for("owner"))
    body = c.get("/api/v1/billing/access").json()
    assert body["needs_plan"] is True and body["can_manage"] is True
    assert [p["id"] for p in body["packs"]] == ["starter", "creator", "studio"]
    state["red"] = codes_repo.Redemption(kind="invite", credit_usd=Decimal("5"), access_until=None, redeemed_at=datetime.now(UTC))
    assert c.get("/api/v1/billing/access").json()["needs_plan"] is False
    state.update(red=None, purchased=True)
    assert c.get("/api/v1/billing/access").json()["needs_plan"] is False
    # Every member may read it; the balance only with billing:read.
    analyst = _client(ctx_for("analyst")).get("/api/v1/billing/access").json()
    assert analyst["can_manage"] is False and analyst["balance_usd"] is None


def test_access_without_billing_never_needs_a_plan(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    body = _client(ctx_for("owner")).get("/api/v1/billing/access").json()
    assert body["needs_plan"] is False and body["billing_enabled"] is False


def test_checkout_return_to_is_a_fixed_choice(billing_on):
    r = _client(ctx_for("owner")).post("/api/v1/billing/checkout", json={"pack": "starter", "return_to": "https://evil.example"})
    assert r.status_code == 422


def test_admin_create_list_disable(monkeypatch):
    app = create_app()
    app.dependency_overrides[require_admin] = lambda: AdminCtx(user_id="staff_1", email="s@m", ip="", user_agent="")
    logged: list[str] = []

    async def record(**kw):
        logged.append(kw["action"])
        assert "code" not in (kw.get("metadata") or {})

    from marketer.repos import admin_audit

    monkeypatch.setattr(admin_audit, "record", record)
    row = codes_repo.AccessCode(id=uuid4(), code_hint="CCCC", kind="pilot", credit_usd=Decimal("25"), trial_days=30, max_redemptions=10, redemption_count=0, expires_at=None, disabled_at=None, note="", created_by="staff_1", created_at=datetime.now(UTC))

    async def create(**kw):
        assert kw["created_by"] == "staff_1"
        return "PLT-AAAA-BBBB-CCCC", row

    async def list_codes(**_kw):
        return [row]

    async def disable(_id):
        return row

    monkeypatch.setattr(codes_repo, "create", create)
    monkeypatch.setattr(codes_repo, "list_codes", list_codes)
    monkeypatch.setattr(codes_repo, "disable", disable)
    c = TestClient(app)
    r = c.post("/api/v1/admin/access-codes", json={"kind": "pilot", "credit_usd": "25", "trial_days": 30, "max_redemptions": 10})
    assert r.status_code == 201 and r.json()["code"] == "PLT-AAAA-BBBB-CCCC"
    assert "code_hash" not in r.json()["access_code"]
    assert c.get("/api/v1/admin/access-codes").json()[0]["code_hint"] == "CCCC"
    assert c.post(f"/api/v1/admin/access-codes/{row.id}/disable").status_code == 200
    assert logged == ["access_code.created", "access_code.list", "access_code.disabled"]
    assert c.post("/api/v1/admin/access-codes", json={"kind": "invite"}).status_code == 422


def test_admin_routes_refuse_non_admins():
    r = _client(ctx_for("owner")).get("/api/v1/admin/access-codes")
    assert r.status_code in (401, 403)
