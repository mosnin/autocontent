"""Critical billing/entitlement cases: pack authority, refunds, disputes,
atomic reserve, and $0 enqueue gates."""
from __future__ import annotations

from datetime import UTC
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.auth import AuthCtx, require_user
from backend.main import create_app
from backend.rate_limit import limiter
from marketer.billing.packs import (
    charge_is_fully_refunded,
    credit_usd_for_paid_session,
    dispute_covers_full_charge,
    ledger_purchase_reference,
    stripe_livemode_matches_secret,
)
from marketer.repos.spend import SpendCapExceeded
from marketer.services.spend_context import SpendContext


@pytest.fixture()
def client():
    limiter.reset()
    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    return TestClient(app)


def _paid_session(**over) -> dict:
    session = {
        "id": "cs_test_123",
        "livemode": False,
        "mode": "payment",
        "currency": "usd",
        "amount_total": 2000,
        "payment_status": "paid",
        "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
    }
    session.update(over)
    return session


def _post_event(client, monkeypatch, event: dict):
    import stripe as stripe_mod

    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(
        stripe_mod.Webhook, "construct_event", staticmethod(lambda p, s, sec: event)
    )
    return client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )


# --------------------------------------------------------------------------- packs / authority

def test_paid_session_credits_from_amount_total_not_metadata():
    session = _paid_session(metadata={"user_id": "user_a", "credit_usd": "50.00"})
    # $20 collected, metadata claims $50 — refuse rather than grant unearned credit
    assert credit_usd_for_paid_session(session) is None


def test_paid_session_without_amount_total_credits_nothing():
    session = _paid_session()
    session.pop("amount_total")
    assert credit_usd_for_paid_session(session) is None


def test_paid_session_jpy_matching_cents_credits_nothing():
    session = _paid_session(currency="jpy", amount_total=2000)
    assert credit_usd_for_paid_session(session) is None


def test_subscription_mode_credits_nothing():
    session = _paid_session(mode="subscription")
    assert credit_usd_for_paid_session(session) is None


def test_known_pack_amount_credits():
    assert credit_usd_for_paid_session(_paid_session()) == Decimal("20.00")
    assert credit_usd_for_paid_session(_paid_session(amount_total=500, metadata={})) == Decimal("5.00")


def test_ledger_reference_rejects_payment_intent_and_charge_ids():
    assert ledger_purchase_reference("pi_abc") is None
    assert ledger_purchase_reference("ch_abc") is None
    assert ledger_purchase_reference("cs_test_1") == "cs_test_1"
    assert ledger_purchase_reference("x402:0xabc") == "x402:0xabc"
    assert ledger_purchase_reference("x402:") is None


def test_livemode_matches_secret_prefix():
    assert stripe_livemode_matches_secret(True, "sk_live_x") is True
    assert stripe_livemode_matches_secret(False, "sk_live_x") is False
    assert stripe_livemode_matches_secret(False, "sk_test_x") is True
    assert stripe_livemode_matches_secret(True, "sk_test_x") is False
    assert stripe_livemode_matches_secret(True, "") is False
    assert stripe_livemode_matches_secret("true", "sk_live_x") is False


def test_partial_refund_is_not_full():
    assert charge_is_fully_refunded({"amount": 2000, "amount_refunded": 500, "refunded": True}) is False
    assert charge_is_fully_refunded({"amount": 2000, "amount_refunded": 2000, "refunded": True}) is True


def test_partial_dispute_is_not_full():
    dispute = {"amount": 500, "currency": "usd"}
    charge = {"amount": 2000, "currency": "usd"}
    assert dispute_covers_full_charge(dispute, charge) is False
    assert dispute_covers_full_charge({"amount": 2000, "currency": "usd"}, charge) is True


# --------------------------------------------------------------------------- webhook

def test_webhook_refuses_metadata_only_credit(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    credited = []

    async def fake_credit(**kwargs):
        credited.append(kwargs)
        return Decimal(50)

    monkeypatch.setattr(billing_repo, "credit_purchase", fake_credit)
    session = _paid_session()
    session.pop("amount_total")
    session["metadata"] = {"user_id": "user_a", "credit_usd": "50.00"}
    resp = _post_event(client, monkeypatch, {
        "type": "checkout.session.completed",
        "livemode": False,
        "data": {"object": session},
    })
    assert resp.status_code == 200
    assert credited == []


def test_webhook_refuses_livemode_mismatch(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    credited = []

    async def fake_credit(**kwargs):
        credited.append(kwargs)
        return Decimal(20)

    monkeypatch.setattr(billing_repo, "credit_purchase", fake_credit)
    resp = _post_event(client, monkeypatch, {
        "type": "checkout.session.completed",
        "livemode": True,  # live event against sk_test
        "data": {"object": _paid_session(livemode=True)},
    })
    assert resp.status_code == 200
    assert credited == []


def test_webhook_reverses_full_refund(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    reversed_ids = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_ids.append(checkout_session_id)
        return Decimal(0)

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = _post_event(client, monkeypatch, {
        "type": "charge.refunded",
        "livemode": False,
        "data": {
            "object": {
                "id": "ch_1",
                "livemode": False,
                "currency": "usd",
                "amount": 2000,
                "amount_refunded": 2000,
                "refunded": True,
                "metadata": {"checkout_session_id": "cs_test_refund"},
            }
        },
    })
    assert resp.status_code == 200
    assert reversed_ids == ["cs_test_refund"]


def test_webhook_does_not_reverse_partial_refund(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    async def explode(**kwargs):
        raise AssertionError("partial refund must not reverse a pack")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = _post_event(client, monkeypatch, {
        "type": "charge.refunded",
        "livemode": False,
        "data": {
            "object": {
                "id": "ch_1",
                "livemode": False,
                "currency": "usd",
                "amount": 2000,
                "amount_refunded": 500,
                "refunded": True,
                "metadata": {"checkout_session_id": "cs_test_refund"},
            }
        },
    })
    assert resp.status_code == 200


def test_webhook_reverses_full_dispute(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    reversed_ids = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_ids.append((checkout_session_id, description))
        return Decimal(0)

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = _post_event(client, monkeypatch, {
        "type": "charge.dispute.created",
        "livemode": False,
        "data": {
            "object": {
                "id": "dp_1",
                "livemode": False,
                "amount": 2000,
                "currency": "usd",
                "charge": {
                    "id": "ch_1",
                    "amount": 2000,
                    "currency": "usd",
                    "metadata": {"checkout_session_id": "cs_test_disp"},
                },
            }
        },
    })
    assert resp.status_code == 200
    assert reversed_ids == [("cs_test_disp", "stripe charge disputed — purchase reversed")]


def test_webhook_does_not_reverse_partial_dispute(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    async def explode(**kwargs):
        raise AssertionError("partial dispute must not reverse a pack")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = _post_event(client, monkeypatch, {
        "type": "charge.dispute.created",
        "livemode": False,
        "data": {
            "object": {
                "id": "dp_1",
                "livemode": False,
                "amount": 400,
                "currency": "usd",
                "charge": {
                    "id": "ch_1",
                    "amount": 2000,
                    "currency": "usd",
                    "metadata": {"checkout_session_id": "cs_test_disp"},
                },
            }
        },
    })
    assert resp.status_code == 200


def test_webhook_reverses_async_payment_failed(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    reversed_ids = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_ids.append(checkout_session_id)
        return Decimal(5)

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = _post_event(client, monkeypatch, {
        "type": "checkout.session.async_payment_failed",
        "livemode": False,
        "data": {
            "object": {
                "id": "cs_test_async",
                "livemode": False,
                "mode": "payment",
                "currency": "usd",
                "payment_status": "unpaid",
                "metadata": {"user_id": "user_a"},
            }
        },
    })
    assert resp.status_code == 200
    assert reversed_ids == ["cs_test_async"]


# --------------------------------------------------------------------------- atomic reserve

def _ctx() -> SpendContext:
    async def record(entry):
        return None

    return SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=record
    )


async def test_preflight_reserve_blocks_fanout_after_balance_exhausted(monkeypatch):
    """N concurrent-style preflights must not all pass a $5 snapshot."""
    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.0)

    remaining = Decimal("5.00")

    async def fake_reserve(*, user_id, amount_usd, job_id, description):
        nonlocal remaining
        if remaining < amount_usd:
            return None
        remaining -= amount_usd
        return remaining

    monkeypatch.setattr(billing_repo, "reserve", fake_reserve)
    ctx = _ctx()
    await ctx.ensure_can_spend(Decimal("2.00"))
    await ctx.ensure_can_spend(Decimal("2.00"))
    with pytest.raises(SpendCapExceeded) as e:
        await ctx.ensure_can_spend(Decimal("2.00"))
    assert e.value.scope == "credits"
    assert remaining == Decimal("1.00")


async def test_log_does_not_double_charge_after_reserve(monkeypatch):
    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.0)

    async def fake_reserve(*, user_id, amount_usd, job_id, description):
        return Decimal("4.00")

    debits: list[Decimal] = []

    async def fake_debit(*, user_id, amount_usd, job_id, description):
        debits.append(amount_usd)
        return Decimal("3.50")

    async def fake_balance(user_id):
        return Decimal("4.00")

    monkeypatch.setattr(billing_repo, "reserve", fake_reserve)
    monkeypatch.setattr(billing_repo, "debit", fake_debit)
    monkeypatch.setattr(billing_repo, "balance", fake_balance)

    ctx = _ctx()
    await ctx.ensure_can_spend(Decimal("1.00"))  # reserved 1.00
    await ctx.log(provider="openai", sku="tts", units=Decimal(1), cost_usd=Decimal("0.80"))
    assert debits == []  # actual 0.80 < reserved 1.00 — no second debit


async def test_log_true_up_when_actual_exceeds_reserve(monkeypatch):
    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.0)

    async def fake_reserve(*, user_id, amount_usd, job_id, description):
        return Decimal("4.00")

    debits: list[Decimal] = []

    async def fake_debit(*, user_id, amount_usd, job_id, description):
        debits.append(amount_usd)
        return Decimal("3.50")

    monkeypatch.setattr(billing_repo, "reserve", fake_reserve)
    monkeypatch.setattr(billing_repo, "debit", fake_debit)

    ctx = _ctx()
    await ctx.ensure_can_spend(Decimal("1.00"))
    await ctx.log(provider="fal", sku="i2v", units=Decimal(1), cost_usd=Decimal("1.40"))
    assert debits == [Decimal("0.40")]


# --------------------------------------------------------------------------- HTTP / campaign gates

def test_enqueue_job_402_when_billing_on_and_broke(monkeypatch):
    from types import SimpleNamespace

    from marketer.config import settings
    from marketer.repos import billing as billing_repo
    from marketer.repos import niches as niches_repo

    limiter.reset()
    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    async def fake_balance(user_id):
        return Decimal(0)

    monkeypatch.setattr(billing_repo, "balance", fake_balance)

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, platforms=["tiktok"])

    monkeypatch.setattr(niches_repo, "get", _niche_get)

    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_broke", email="b@b"
    )
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(uuid4()), "platform": "tiktok"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
    assert "prepaid credit" in resp.json()["detail"]


async def test_campaign_tick_skips_when_credit_exhausted(monkeypatch):
    from datetime import datetime

    from marketer.config import settings
    from marketer.models import Campaign
    from marketer.repos import billing as billing_repo
    from marketer.repos import campaigns as campaigns_repo
    from marketer.services import campaign_runner

    monkeypatch.setattr(settings, "billing_enabled", True)

    async def fake_balance(user_id):
        return Decimal(0)

    async def fake_spent(cid, *, user_id):
        return Decimal(0)

    spawned = []

    async def spawn_video(*args):
        spawned.append(args)

    monkeypatch.setattr(billing_repo, "balance", fake_balance)
    monkeypatch.setattr(campaigns_repo, "spent_usd", fake_spent)

    now = datetime(2026, 7, 19, 12, 0, tzinfo=UTC)
    campaign = Campaign(
        id=uuid4(), user_id="user_broke", name="c", status="running",
        budget_usd=Decimal(50), starts_at=now,
    )
    result = await campaign_runner.run_campaign_tick(
        campaign,
        spawn_video=spawn_video,
        now=now,
    )
    assert result["action"] == "skipped"
    assert spawned == []


async def test_credit_purchase_rejects_non_positive_and_pi_refs():
    from marketer.repos import billing as billing_repo

    # These return None without touching the pool when validation fails.
    assert await billing_repo.credit_purchase(
        user_id="u", amount_usd=Decimal(-5), checkout_session_id="cs_test_1"
    ) is None
    assert await billing_repo.credit_purchase(
        user_id="u", amount_usd=Decimal(5), checkout_session_id="pi_abc"
    ) is None
    assert await billing_repo.reverse_purchase(checkout_session_id="pi_abc") is None
