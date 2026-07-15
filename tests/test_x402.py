"""x402 agent payments: envelope shape, atomic-unit math, header decoding,
disabled-by-default gating, and the full route flow (402 -> pay -> credit) with
the facilitator mocked. No real settlement occurs."""
from __future__ import annotations

import base64
import json
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from marketer.services import x402
from marketer.services.x402 import (
    SettleResult,
    X402Disabled,
    X402PaymentError,
)


def _enable(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "x402_enabled", True)
    monkeypatch.setattr(settings, "x402_pay_to", "0xabc")
    monkeypatch.setattr(settings, "x402_asset", "0xusdc")
    monkeypatch.setattr(settings, "x402_network", "base")


# --------------------------------------------------------------------------- unit

def test_disabled_by_default(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "x402_enabled", False)
    assert x402.is_enabled() is False
    with pytest.raises(X402Disabled):
        x402.build_requirements(amount_usd=Decimal("5"), resource="/r", description="d")


def test_atomic_roundtrip():
    assert x402.to_atomic(Decimal("10")) == "10000000"  # 6 decimals
    assert x402.to_atomic(Decimal("1.50")) == "1500000"
    assert x402.from_atomic("2500000") == Decimal("2.50")


def test_requirements_envelope_shape(monkeypatch):
    _enable(monkeypatch)
    req = x402.build_requirements(
        amount_usd=Decimal("10"), resource="/api/v1/x402/credits", description="topup"
    )
    assert req["x402Version"] == 1
    acc = req["accepts"][0]
    assert acc["scheme"] == "exact"
    assert acc["network"] == "base"
    assert acc["maxAmountRequired"] == "10000000"
    assert acc["payTo"] == "0xabc"
    assert acc["asset"] == "0xusdc"
    assert acc["extra"]["name"] == "USDC"


def test_clamp_topup_bounds(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "x402_min_topup_usd", 1.0)
    monkeypatch.setattr(settings, "x402_max_topup_usd", 100.0)
    assert x402.clamp_topup(Decimal("50")) == Decimal("50")
    with pytest.raises(X402PaymentError):
        x402.clamp_topup(Decimal("0.50"))
    with pytest.raises(X402PaymentError):
        x402.clamp_topup(Decimal("500"))


def test_decode_payment_header():
    payload = {"scheme": "exact", "payload": {"signature": "0xsig"}}
    header = base64.b64encode(json.dumps(payload).encode()).decode()
    assert x402.decode_payment_header(header) == payload
    with pytest.raises(X402PaymentError):
        x402.decode_payment_header("")
    with pytest.raises(X402PaymentError):
        x402.decode_payment_header("!!!not-base64!!!")


async def test_verify_and_settle_success(monkeypatch):
    _enable(monkeypatch)

    async def fake_post(path, body):
        if path == "/verify":
            return {"isValid": True, "payer": "0xpayer"}
        return {"success": True, "transaction": "0xtxhash"}

    monkeypatch.setattr(x402, "_facilitator_post", fake_post)
    req = x402.build_requirements(
        amount_usd=Decimal("10"), resource="/r", description="d"
    )
    res = await x402.verify_and_settle(payment_payload={}, requirements=req)
    assert res.success and res.settlement_id == "0xtxhash"
    assert res.amount_usd == Decimal("10.00")
    assert res.payer == "0xpayer"


async def test_verify_failure_returns_unsuccessful(monkeypatch):
    _enable(monkeypatch)

    async def fake_post(path, body):
        return {"isValid": False, "invalidReason": "insufficient funds"}

    monkeypatch.setattr(x402, "_facilitator_post", fake_post)
    req = x402.build_requirements(amount_usd=Decimal("10"), resource="/r", description="d")
    res = await x402.verify_and_settle(payment_payload={}, requirements=req)
    assert res.success is False
    assert "insufficient" in res.error


# --------------------------------------------------------------------------- route

def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id="user_x402", email="a@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_route_503_when_disabled(monkeypatch):
    from backend.rate_limit import limiter
    limiter._storage.reset()
    from marketer.config import settings
    monkeypatch.setattr(settings, "x402_enabled", False)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/x402/credits?amount_usd=10", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 503


def test_route_402_without_payment(monkeypatch):
    from backend.rate_limit import limiter
    limiter._storage.reset()
    _enable(monkeypatch)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/x402/credits?amount_usd=10", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 402
    body = resp.json()
    assert body["accepts"][0]["maxAmountRequired"] == "10000000"


def test_route_credits_on_valid_payment(monkeypatch):
    from backend.rate_limit import limiter
    limiter._storage.reset()
    _enable(monkeypatch)

    import backend.routes.x402 as route
    import marketer.repos.billing as billing
    import marketer.repos.x402 as x402_repo

    async def fake_settle(*, payment_payload, requirements):
        return SettleResult(True, "0xtxhash", "0xpayer", Decimal("10.00"))

    credited: dict = {}

    async def fake_credit(*, user_id, amount_usd, checkout_session_id, description):
        credited["ref"] = checkout_session_id
        return Decimal("10.00")

    async def fake_record(**kw):
        return True

    monkeypatch.setattr(route.x402, "verify_and_settle", fake_settle)
    monkeypatch.setattr(billing, "credit_purchase", fake_credit)
    monkeypatch.setattr(x402_repo, "record", fake_record)

    client = _client(monkeypatch)
    payment = base64.b64encode(json.dumps({"scheme": "exact"}).encode()).decode()
    resp = client.post(
        "/api/v1/x402/credits?amount_usd=10",
        headers={"Authorization": "Bearer mkt_x", "X-PAYMENT": payment},
    )
    assert resp.status_code == 200
    assert resp.json()["credited_usd"] == "10.00"
    assert resp.headers.get("X-PAYMENT-RESPONSE")
    # Credit is idempotent-keyed on the settlement id.
    assert credited["ref"] == "x402:0xtxhash"


def test_route_402_when_payment_fails_settlement(monkeypatch):
    from backend.rate_limit import limiter
    limiter._storage.reset()
    _enable(monkeypatch)

    import backend.routes.x402 as route

    async def fake_settle(*, payment_payload, requirements):
        return SettleResult(False, "", "", Decimal("0"), error="settlement failed")

    monkeypatch.setattr(route.x402, "verify_and_settle", fake_settle)
    client = _client(monkeypatch)
    payment = base64.b64encode(json.dumps({"scheme": "exact"}).encode()).decode()
    resp = client.post(
        "/api/v1/x402/credits?amount_usd=10",
        headers={"Authorization": "Bearer mkt_x", "X-PAYMENT": payment},
    )
    assert resp.status_code == 402
    assert "settlement failed" in resp.text
