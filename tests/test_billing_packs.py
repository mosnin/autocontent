"""Credit-pack catalog and fail-closed Stripe session resolution."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient

from marketer.billing.packs import (
    PACKS,
    as_checkout_session_id,
    charge_currency_is_usd,
    charge_is_fully_refunded,
    checkout_session_id_for_livemode,
    checkout_session_id_from_refund_source,
    credit_usd_for_amount_cents,
    credit_usd_for_paid_session,
    ledger_purchase_reference,
    stripe_livemode_matches_secret,
)

_REPO = Path(__file__).resolve().parent.parent


def test_known_stripe_amounts_map_to_pack_credit():
    assert credit_usd_for_amount_cents(500) == Decimal("5.00")
    assert credit_usd_for_amount_cents(2000) == Decimal("20.00")
    assert credit_usd_for_amount_cents(5000) == Decimal("50.00")
    assert credit_usd_for_amount_cents(1) is None
    assert credit_usd_for_amount_cents("nope") is None
    assert credit_usd_for_amount_cents(None) is None
    assert credit_usd_for_amount_cents(True) is None
    assert credit_usd_for_amount_cents(2000.5) is None
    assert credit_usd_for_amount_cents(-500) is None
    assert credit_usd_for_amount_cents(0) is None


def test_amount_subtotal_without_total_is_refused():
    """Subtotal alone must never grant credit — only amount_total counts."""
    session = {
        "mode": "payment",
        "amount_subtotal": 2000,
        "currency": "usd",
        "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
    }
    assert credit_usd_for_paid_session(session) is None


def test_paid_session_credits_from_amount_not_metadata():
    session = {
        "mode": "payment",
        "amount_total": 500,
        "currency": "usd",
        "metadata": {"user_id": "user_a", "credit_usd": "5.00"},
    }
    assert credit_usd_for_paid_session(session) == Decimal("5.00")


def test_inflated_metadata_is_refused():
    """$5 collected + metadata claiming $50 must not grant $50."""
    session = {
        "mode": "payment",
        "amount_total": 500,
        "currency": "usd",
        "metadata": {"user_id": "user_a", "credit_usd": "50.00"},
    }
    assert credit_usd_for_paid_session(session) is None


def test_unknown_amount_is_refused():
    session = {
        "mode": "payment",
        "amount_total": 9999,
        "currency": "usd",
        "metadata": {"user_id": "user_a", "credit_usd": "5.00"},
    }
    assert credit_usd_for_paid_session(session) is None


def test_non_usd_currency_is_refused():
    session = {
        "mode": "payment",
        "amount_total": 2000,
        "currency": "eur",
        "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
    }
    assert credit_usd_for_paid_session(session) is None


def test_non_payment_mode_is_refused():
    session = {
        "mode": "subscription",
        "amount_total": 2000,
        "currency": "usd",
        "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
    }
    assert credit_usd_for_paid_session(session) is None


def test_livemode_must_match_secret_prefix():
    assert stripe_livemode_matches_secret(False, "sk_test_x") is True
    assert stripe_livemode_matches_secret(True, "sk_live_x") is True
    assert stripe_livemode_matches_secret(True, "sk_test_x") is False
    assert stripe_livemode_matches_secret(False, "sk_live_x") is False
    assert stripe_livemode_matches_secret(False, "") is False
    assert stripe_livemode_matches_secret("false", "sk_test_x") is False


def test_missing_amount_total_is_refused():
    session = {"metadata": {"user_id": "user_a", "credit_usd": "20.00"}}
    assert credit_usd_for_paid_session(session) is None


def test_refund_source_resolves_stamped_session_only():
    assert (
        checkout_session_id_from_refund_source(
            {"metadata": {"checkout_session_id": "cs_abc"}}
        )
        == "cs_abc"
    )
    assert checkout_session_id_from_refund_source({"metadata": {}}) is None
    assert checkout_session_id_from_refund_source(
        {"object": "checkout.session", "id": "cs_from_session"}
    ) == "cs_from_session"
    assert (
        checkout_session_id_from_refund_source(
            {"metadata": {"checkout_session_id": "not_a_session"}}
        )
        is None
    )
    assert (
        checkout_session_id_from_refund_source(
            {"object": "checkout.session", "id": "ch_not_checkout"}
        )
        is None
    )
    assert charge_is_fully_refunded({"refunded": True, "amount": 2000}) is True
    assert charge_is_fully_refunded(
        {"refunded": False, "amount": 2000, "amount_refunded": 500}
    ) is False
    assert charge_is_fully_refunded(
        {"refunded": False, "amount": 2000, "amount_refunded": 2000}
    ) is True
    assert checkout_session_id_for_livemode("cs_test_123", False) == "cs_test_123"
    assert checkout_session_id_for_livemode("cs_abc", False) == "cs_abc"
    assert checkout_session_id_for_livemode("cs_live_abc", False) is None
    assert checkout_session_id_for_livemode("cs_live_abc", True) == "cs_live_abc"
    assert checkout_session_id_for_livemode("cs_test_123", True) is None
    assert checkout_session_id_for_livemode("cs_abc", True) is None
    assert checkout_session_id_for_livemode("cs_test_123", None) is None
    assert ledger_purchase_reference("cs_abc") == "cs_abc"
    assert ledger_purchase_reference("x402:0xtxhash") == "x402:0xtxhash"
    assert ledger_purchase_reference("x402:") is None
    assert ledger_purchase_reference("cs_") is None
    assert as_checkout_session_id("cs_") is None
    assert ledger_purchase_reference("pi_not_checkout") is None
    assert ledger_purchase_reference("ch_charge") is None
    assert charge_currency_is_usd({"currency": "usd"}) is True
    assert charge_currency_is_usd({"currency": "USD"}) is True
    assert charge_currency_is_usd({"currency": "jpy"}) is False
    assert charge_currency_is_usd({}) is False


def test_marketing_and_billing_ui_pack_amounts_match_backend():
    """Conversion copy and checkout must advertise the same packs."""
    pricing = (_REPO / "web/components/marketing/pricing-data.ts").read_text()
    billing_ui = (
        _REPO / "web/app/(app)/settings/billing/BillingClient.tsx"
    ).read_text()
    for key, pack in PACKS.items():
        dollars = pack["amount_cents"] // 100
        assert f"amount: {dollars}" in pricing, f"pricing-data.ts missing ${dollars}"
        assert f'key: "{key}"' in billing_ui, f"BillingClient missing pack {key}"


def test_packs_endpoint_returns_catalog(monkeypatch):
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.rate_limit import limiter
    from marketer.config import settings

    limiter.reset()
    monkeypatch.setattr(settings, "billing_enabled", True)
    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    client = TestClient(app)
    resp = client.get(
        "/api/v1/billing/packs", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 200
    body = resp.json()
    keys = [p["key"] for p in body["packs"]]
    assert keys == ["starter", "creator", "studio"]
    creator = next(p for p in body["packs"] if p["key"] == "creator")
    assert creator["featured"] is True
    assert creator["amount_cents"] == 2000
    assert body["billing_enabled"] is True
