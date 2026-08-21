"""Credits billing: pre-flight gate, debit mirror, checkout + webhook."""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.services.spend_context import SpendContext
from backend.auth import AuthCtx, require_user
from backend.main import create_app
from backend.rate_limit import limiter


@pytest.fixture()
def client():
    limiter.reset()
    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    return TestClient(app)


def _ctx() -> SpendContext:
    async def record(entry):
        return None

    return SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=record
    )


async def test_credit_purchase_refuses_non_ledger_reference(monkeypatch):
    from marketer.repos import billing as billing_repo

    async def explode():
        raise AssertionError("must not touch the pool for a non-ledger reference")

    monkeypatch.setattr(billing_repo, "get_pool", explode)
    assert (
        await billing_repo.credit_purchase(
            user_id="user_a",
            amount_usd=Decimal("20.00"),
            checkout_session_id="pi_not_checkout",
        )
        is None
    )
    assert (
        await billing_repo.reverse_purchase(checkout_session_id="ch_not_checkout")
        is None
    )
    assert await billing_repo.reverse_purchase(checkout_session_id="x402:") is None
    assert await billing_repo.reverse_purchase(checkout_session_id="cs_") is None


async def test_credit_purchase_allows_x402_settlement_reference(monkeypatch):
    from marketer.repos import billing as billing_repo

    async def explode():
        raise RuntimeError("pool")

    monkeypatch.setattr(billing_repo, "get_pool", explode)
    with pytest.raises(RuntimeError, match="pool"):
        await billing_repo.credit_purchase(
            user_id="user_a",
            amount_usd=Decimal("5.00"),
            checkout_session_id="x402:0xtxhash",
        )


async def test_preflight_blocks_when_credit_short(monkeypatch):
    from marketer.config import settings
    from marketer.repos import billing as billing_repo
    from marketer.repos.spend import SpendCapExceeded

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.5)

    async def fake_balance(user_id):
        return Decimal("0.10")

    monkeypatch.setattr(billing_repo, "balance", fake_balance)

    ctx = _ctx()
    # 0.10 estimated * 1.5 margin = 0.15 charge > 0.10 balance
    with pytest.raises(SpendCapExceeded) as e:
        await ctx.ensure_can_spend(Decimal("0.10"))
    assert e.value.scope == "credits"


async def test_preflight_allows_with_credit(monkeypatch):
    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", True)

    async def fake_balance(user_id):
        return Decimal("10.00")

    monkeypatch.setattr(billing_repo, "balance", fake_balance)
    await _ctx().ensure_can_spend(Decimal("0.10"))  # no raise


async def test_billing_disabled_never_touches_repo(monkeypatch):
    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", False)

    async def explode(user_id):
        raise AssertionError("balance() must not be called when disabled")

    monkeypatch.setattr(billing_repo, "balance", explode)
    await _ctx().ensure_can_spend(Decimal("100"))  # no raise, no DB


async def test_log_debits_at_margin(monkeypatch):
    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 2.0)

    debits: list[Decimal] = []

    async def fake_debit(*, user_id, amount_usd, job_id, description):
        debits.append(amount_usd)
        return Decimal("1.00")

    monkeypatch.setattr(billing_repo, "debit", fake_debit)

    ctx = _ctx()
    await ctx.log(
        provider="openai", sku="tts", units=Decimal("1"), cost_usd=Decimal("0.05")
    )
    assert debits == [Decimal("0.10")]  # 0.05 * 2.0


async def test_log_trips_abort_when_credit_crosses_zero(monkeypatch):
    """The debit still lands (charge is real), but a non-positive resulting
    balance must flip abort_event and raise so fan-out siblings and later
    stages stop spending. This is the concurrency guard the pre-flight
    snapshot alone can't provide."""
    from marketer.config import settings
    from marketer.repos import billing as billing_repo
    from marketer.repos.spend import SpendCapExceeded

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.0)

    recorded: list = []

    async def fake_record(entry):
        recorded.append(entry)

    async def fake_debit(*, user_id, amount_usd, job_id, description):
        return Decimal("-0.25")  # this call crossed zero

    monkeypatch.setattr(billing_repo, "debit", fake_debit)

    ctx = SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=fake_record
    )
    with pytest.raises(SpendCapExceeded) as e:
        await ctx.log(
            provider="grok", sku="imagine", units=Decimal("1"),
            cost_usd=Decimal("0.25"),
        )
    assert e.value.scope == "credits"
    assert ctx.abort_event.is_set()
    assert ctx.abort_scope == "credits"
    # The charge was still recorded — we don't silently drop real spend.
    assert len(recorded) == 1

    # A subsequent pre-flight check short-circuits cheaply with the right scope,
    # without even reading the balance again.
    async def explode(user_id):
        raise AssertionError("must not re-read balance after abort")

    monkeypatch.setattr(billing_repo, "balance", explode)
    with pytest.raises(SpendCapExceeded) as e2:
        await ctx.ensure_can_spend(Decimal("0.01"))
    assert e2.value.scope == "credits"


def test_checkout_503_when_disabled(client, monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    resp = client.post(
        "/api/v1/billing/checkout",
        json={"pack": "starter"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 503


def test_checkout_unknown_pack_422(client, monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    resp = client.post(
        "/api/v1/billing/checkout",
        json={"pack": "yacht"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_checkout_stamps_session_id_on_payment_intent(client, monkeypatch):
    """charge.refunded inherits PI metadata — stamp the session id after create."""
    import stripe as stripe_mod

    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "app_url", "https://app.example")

    class FakeSession:
        id = "cs_new"
        url = "https://checkout.stripe.com/pay/cs_new"
        payment_intent = "pi_new"

    modified: list[tuple[str, dict]] = []

    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "create",
        staticmethod(lambda **kw: FakeSession()),
    )
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "modify",
        staticmethod(lambda pi, **kw: modified.append((pi, kw))),
    )
    resp = client.post(
        "/api/v1/billing/checkout",
        json={"pack": "creator"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["url"] == "https://checkout.stripe.com/pay/cs_new"
    assert modified == [
        (
            "pi_new",
            {
                "metadata": {
                    "user_id": "user_a",
                    "credit_usd": "20.00",
                    "pack": "creator",
                    "checkout_session_id": "cs_new",
                }
            },
        )
    ]


def test_webhook_missing_secret_is_503_not_200(client, monkeypatch):
    """An unconfigured Stripe webhook must not accept events."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "")
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 503
    assert "not configured" in resp.json()["detail"]
    assert "whsec" not in resp.text.lower()


def test_webhook_missing_signature_header_is_401(client, monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    resp = client.post("/api/v1/billing/webhook", content=b"{}")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "invalid webhook"
    assert "whsec" not in resp.text.lower()


def test_webhook_rejects_bad_signature(client, monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=bogus"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "invalid webhook"
    assert "whsec" not in resp.text.lower()


def test_webhook_does_not_echo_constructor_error(client, monkeypatch):
    import stripe as stripe_mod

    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")

    def _boom(payload, sig, secret):
        raise ValueError("internal stripe secret leak xyz")

    monkeypatch.setattr(stripe_mod.Webhook, "construct_event", staticmethod(_boom))
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "invalid webhook"
    assert "xyz" not in resp.text
    assert "secret leak" not in resp.text


def _paid_checkout_event(
    *,
    session_id: str,
    amount_total: int = 2000,
    currency: str = "usd",
    credit: str = "20.00",
    typ: str = "checkout.session.completed",
    livemode: bool = False,
    mode: str = "payment",
) -> dict:
    return {
        "id": f"evt_{session_id}",
        "livemode": livemode,
        "type": typ,
        "data": {
            "object": {
                "id": session_id,
                "livemode": livemode,
                "mode": mode,
                "payment_status": "paid",
                "amount_total": amount_total,
                "currency": currency,
                "metadata": {"user_id": "user_a", "credit_usd": credit},
            }
        },
    }


def _patch_webhook(monkeypatch, event, *, secret_key: str = "sk_test_x") -> None:
    import stripe as stripe_mod

    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "stripe_secret_key", secret_key)
    monkeypatch.setattr(
        stripe_mod.Webhook, "construct_event", staticmethod(lambda p, s, sec: event)
    )


def test_webhook_refuses_inflated_credit_metadata(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(
        session_id="cs_inflated", amount_total=500, credit="50.00"
    )
    _patch_webhook(monkeypatch, event)
    async def explode(**kwargs):
        raise AssertionError("must not credit a mismatched session")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_webhook_credits_on_completed_session(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_test_123")
    _patch_webhook(monkeypatch, event)

    credited: list[tuple] = []

    async def fake_credit(*, user_id, amount_usd, checkout_session_id, description):
        credited.append((user_id, amount_usd, checkout_session_id))
        return Decimal("20.00")

    monkeypatch.setattr(billing_repo, "credit_purchase", fake_credit)

    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert credited == [("user_a", Decimal("20.00"), "cs_test_123")]


def test_webhook_replay_same_session_credits_once(client, monkeypatch):
    """Stripe retry of the same checkout.session.completed must not double-credit."""
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_replay")
    _patch_webhook(monkeypatch, event)

    applied: list[Decimal] = []
    seen: set[str] = set()

    async def fake_credit(*, user_id, amount_usd, checkout_session_id, description):
        # Mirrors credit_purchase ON CONFLICT DO NOTHING on session id.
        if checkout_session_id in seen:
            return None
        seen.add(checkout_session_id)
        applied.append(amount_usd)
        return amount_usd

    monkeypatch.setattr(billing_repo, "credit_purchase", fake_credit)
    headers = {"stripe-signature": "t=1,v1=ok"}
    first = client.post("/api/v1/billing/webhook", content=b"{}", headers=headers)
    second = client.post("/api/v1/billing/webhook", content=b"{}", headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert applied == [Decimal("20.00")]
    assert seen == {"cs_replay"}


def test_webhook_non_usd_currency_credits_nothing(client, monkeypatch):
    """A matching cent amount in JPY must not grant the USD pack."""
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_jpy", currency="jpy")
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not credit a non-USD session")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_webhook_livemode_mismatch_credits_nothing(client, monkeypatch):
    """A live Stripe event must not credit a test secret (and vice versa)."""
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_live_on_test", livemode=True)
    _patch_webhook(monkeypatch, event, secret_key="sk_test_x")

    async def explode(**kwargs):
        raise AssertionError("must not credit a livemode-mismatched event")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_webhook_live_session_id_on_test_event_credits_nothing(client, monkeypatch):
    """livemode=false + sk_test_ still must not credit a cs_live_ id."""
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_live_on_test_event", livemode=False)
    _patch_webhook(monkeypatch, event, secret_key="sk_test_x")

    async def explode(**kwargs):
        raise AssertionError("must not credit a live session id on a test event")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_test_session_id_on_live_event_credits_nothing(client, monkeypatch):
    """livemode=true + sk_live_ still must not credit a cs_test_ id."""
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_test_on_live_event", livemode=True)
    _patch_webhook(monkeypatch, event, secret_key="sk_live_x")

    async def explode(**kwargs):
        raise AssertionError("must not credit a test session id on a live event")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_missing_session_livemode_credits_nothing(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_session_nolive", livemode=False)
    del event["data"]["object"]["livemode"]
    _patch_webhook(monkeypatch, event, secret_key="sk_test_x")

    async def explode(**kwargs):
        raise AssertionError("must not credit when session livemode is missing")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_session_livemode_contradicts_event_credits_nothing(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_test_obj_live", livemode=False)
    event["data"]["object"]["livemode"] = True
    _patch_webhook(monkeypatch, event, secret_key="sk_test_x")

    async def explode(**kwargs):
        raise AssertionError("must not credit when session livemode contradicts event")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_subscription_mode_credits_nothing(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_sub", mode="subscription")
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not credit a non-payment checkout mode")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_webhook_credits_on_async_payment_succeeded(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(
        session_id="cs_async",
        typ="checkout.session.async_payment_succeeded",
    )
    _patch_webhook(monkeypatch, event)
    credited: list[tuple] = []

    async def fake_credit(*, user_id, amount_usd, checkout_session_id, description):
        credited.append((user_id, amount_usd, checkout_session_id))
        return Decimal("20.00")

    monkeypatch.setattr(billing_repo, "credit_purchase", fake_credit)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert credited == [("user_a", Decimal("20.00"), "cs_async")]


def test_webhook_non_checkout_session_id_credits_nothing(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="pi_not_checkout")
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not credit a non-cs_ session id")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_webhook_async_payment_failed_reverses_prior_credit(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_async_fail",
                "livemode": False,
                "mode": "payment",
                "currency": "usd",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    reversed_sessions: list[str] = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_sessions.append(checkout_session_id)
        return Decimal("15.00")

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert reversed_sessions == ["cs_async_fail"]


def test_webhook_async_payment_failed_missing_livemode_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_nolive",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_async_fail_nolive",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse when session livemode is missing")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_async_payment_failed_non_usd_does_not_reverse(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_jpy",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_async_fail_jpy",
                "livemode": False,
                "mode": "payment",
                "currency": "jpy",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a non-USD async failure")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_async_payment_failed_missing_currency_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_noccy",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_async_fail_noccy",
                "livemode": False,
                "mode": "payment",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse an async failure with no currency")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_async_payment_failed_live_id_on_test_event_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_live",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_live_async_fail",
                "livemode": False,
                "mode": "payment",
                "currency": "usd",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a live session id on a test event")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_async_payment_failed_non_checkout_id_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_bad",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "pi_not_checkout",
                "livemode": False,
                "mode": "payment",
                "currency": "usd",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a non-cs_ session id")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_missing_livemode_credits_nothing(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = _paid_checkout_event(session_id="cs_no_livemode")
    del event["livemode"]
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not credit when livemode is missing")

    monkeypatch.setattr(billing_repo, "credit_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_webhook_full_charge_refund_reverses_credit(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_refund",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_refunded"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    reversed_sessions: list[str] = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_sessions.append(checkout_session_id)
        return Decimal("0.00")

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert reversed_sessions == ["cs_refunded"]


def test_webhook_full_refund_live_session_id_on_test_event_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_live_id",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_live_id",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_live_refund"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a live session id on a test refund")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_resolves_session_from_payment_intent(client, monkeypatch):
    """Production charges do not carry checkout_session_id — look it up."""
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_pi",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_pi",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_lookup",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {
                "data": [
                    {
                        "id": "cs_from_pi",
                        "mode": "payment",
                        "currency": "usd",
                        "livemode": False,
                    }
                ]
            }
        ),
    )
    reversed_sessions: list[str] = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_sessions.append(checkout_session_id)
        return Decimal("0.00")

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert reversed_sessions == ["cs_from_pi"]


def test_webhook_full_refund_reads_session_from_expanded_payment_intent(
    client, monkeypatch
):
    """Stripe may expand payment_intent; metadata on the PI is enough."""
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_pi_meta",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_pi_meta",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": {
                    "id": "pi_expanded",
                    "livemode": False,
                    "metadata": {"checkout_session_id": "cs_from_pi_meta"},
                },
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    reversed_sessions: list[str] = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_sessions.append(checkout_session_id)
        return Decimal("0.00")

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert reversed_sessions == ["cs_from_pi_meta"]


def test_webhook_full_refund_ignores_non_checkout_list_id(client, monkeypatch):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_garbage",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_garbage",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_garbage",
                "metadata": {"checkout_session_id": "not_a_session"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(lambda **kw: {"data": [{"id": "ch_not_checkout"}]}),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a non-cs_ session id")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_reads_payment_session_from_list(client, monkeypatch):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_list",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_list",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_list",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {
                "data": [
                    {
                        "id": "cs_from_list",
                        "mode": "payment",
                        "currency": "usd",
                        "livemode": False,
                    }
                ]
            }
        ),
    )
    reversed_sessions: list[str] = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_sessions.append(checkout_session_id)
        return Decimal("0.00")

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert reversed_sessions == ["cs_from_list"]


def test_webhook_full_refund_listed_non_payment_mode_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_sub_list",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_sub_list",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_sub_list",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {"data": [{"id": "cs_subscription", "mode": "subscription"}]}
        ),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a listed non-payment session")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_listed_session_missing_mode_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_nomode_list",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_nomode_list",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_nomode_list",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(lambda **kw: {"data": [{"id": "cs_nomode"}]}),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a listed session with no mode")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_listed_non_usd_does_not_reverse(client, monkeypatch):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_jpy_list",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_jpy_list",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_jpy_list",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {
                "data": [{"id": "cs_jpy_list", "mode": "payment", "currency": "jpy"}]
            }
        ),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a listed non-USD session")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_listed_session_missing_currency_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_noccy_list",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_noccy_list",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_noccy_list",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {"data": [{"id": "cs_noccy_list", "mode": "payment"}]}
        ),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a listed session with no currency")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_listed_livemode_contradicts_event_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_list_live",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_list_live",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_list_live",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {
                "data": [
                    {
                        "id": "cs_list_live_obj",
                        "mode": "payment",
                        "currency": "usd",
                        "livemode": True,
                    }
                ]
            }
        ),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a listed session whose livemode contradicts")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_listed_live_id_on_test_event_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_list_live_id",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_list_live_id",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_list_live_id",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"livemode": False, "metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {
                "data": [
                    {
                        "id": "cs_live_from_list",
                        "mode": "payment",
                        "currency": "usd",
                        "livemode": False,
                    }
                ]
            }
        ),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a listed live session id on a test event")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_charge_livemode_contradicts_event_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_ch_live",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_obj_live",
                "livemode": True,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_obj_live"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse when charge livemode contradicts event")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_missing_charge_livemode_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_ch_nolive",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_obj_nolive",
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_obj_nolive"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse when charge livemode is missing")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_listed_session_missing_livemode_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_list_nolive",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_list_nolive",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_list_nolive",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(
            lambda **kw: {
                "data": [
                    {
                        "id": "cs_list_nolive",
                        "mode": "payment",
                        "currency": "usd",
                    }
                ]
            }
        ),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a listed session without livemode")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_async_payment_failed_non_payment_mode_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_sub",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_async_fail_sub",
                "livemode": False,
                "mode": "subscription",
                "currency": "usd",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a non-payment async failure")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_async_payment_failed_missing_mode_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_nomode",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_async_fail_nomode",
                "livemode": False,
                "currency": "usd",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse an async failure with no mode")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_async_payment_failed_paid_status_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_async_fail_paid",
        "livemode": False,
        "type": "checkout.session.async_payment_failed",
        "data": {
            "object": {
                "id": "cs_async_fail_paid",
                "livemode": False,
                "mode": "payment",
                "payment_status": "paid",
                "currency": "usd",
                "metadata": {"user_id": "user_a"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse an async failure marked paid")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_retrieved_pi_missing_livemode_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_pi_nolive",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_pi_nolive",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_nolive",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(
            lambda *_a, **_k: {
                "metadata": {"checkout_session_id": "cs_from_pi_nolive"}
            }
        ),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(lambda **kw: {"data": []}),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a retrieved PI without livemode")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_retrieved_pi_livemode_contradicts_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_pi_live",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_pi_live",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_live_obj",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(
            lambda *_a, **_k: {
                "livemode": True,
                "metadata": {"checkout_session_id": "cs_from_pi_live"},
            }
        ),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(lambda **kw: {"data": []}),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a retrieved PI whose livemode contradicts")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_retrieved_pi_live_stamp_on_test_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_pi_live_stamp",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_pi_live_stamp",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_live_stamp",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(
            lambda *_a, **_k: {
                "livemode": False,
                "metadata": {"checkout_session_id": "cs_live_from_pi"},
            }
        ),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(lambda **kw: {"data": []}),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse a live session stamp on a test PI")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_expanded_pi_missing_livemode_does_not_reverse(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_pi_exp_nolive",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_pi_exp_nolive",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": {
                    "id": "pi_expanded_nolive",
                    "metadata": {"checkout_session_id": "cs_from_pi_exp_nolive"},
                },
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(lambda **kw: {"data": []}),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse an expanded PI without livemode")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_without_session_does_not_reverse(client, monkeypatch):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_orphan",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_orphan",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_unknown",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(lambda *_a, **_k: {"metadata": {}}),
    )
    monkeypatch.setattr(
        stripe_mod.checkout.Session,
        "list",
        staticmethod(lambda **kw: {"data": []}),
    )

    async def explode(**kwargs):
        raise AssertionError("must not reverse when no checkout session is found")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_reads_session_from_retrieved_payment_intent(
    client, monkeypatch
):
    import stripe as stripe_mod

    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_retrieve",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_retrieve",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "usd",
                "payment_intent": "pi_stamped",
                "metadata": {},
            }
        },
    }
    _patch_webhook(monkeypatch, event)
    monkeypatch.setattr(
        stripe_mod.PaymentIntent,
        "retrieve",
        staticmethod(
            lambda *_a, **_k: {
                "livemode": False,
                "metadata": {"checkout_session_id": "cs_from_retrieve"},
            }
        ),
    )
    reversed_sessions: list[str] = []

    async def fake_reverse(*, checkout_session_id, description):
        reversed_sessions.append(checkout_session_id)
        return Decimal("0.00")

    monkeypatch.setattr(billing_repo, "reverse_purchase", fake_reverse)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200
    assert reversed_sessions == ["cs_from_retrieve"]


def test_webhook_full_refund_non_usd_does_not_reverse(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_jpy",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_jpy",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "currency": "jpy",
                "metadata": {"checkout_session_id": "cs_jpy_refund"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a non-USD refund")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_full_refund_missing_currency_does_not_reverse(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_refund_noccy",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_noccy",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 2000,
                "metadata": {"checkout_session_id": "cs_noccy"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a refund with no currency")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_partial_charge_refund_does_not_reverse(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_partial",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_partial",
                "refunded": False,
                "amount": 2000,
                "amount_refunded": 500,
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_partial"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a partial refund")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_refunded_flag_with_partial_amount_does_not_reverse(
    client, monkeypatch
):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_partial_flag",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_partial_flag",
                "livemode": False,
                "refunded": True,
                "amount": 2000,
                "amount_refunded": 500,
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_partial_flag"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a partial refund flagged refunded")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_refunded_bool_amounts_do_not_reverse(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_bool_amt",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_bool_amt",
                "livemode": False,
                "refunded": True,
                "amount": True,
                "amount_refunded": True,
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_bool_amt"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a refund whose amounts are bools")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


def test_webhook_refunded_unparseable_amounts_do_not_reverse(client, monkeypatch):
    from marketer.repos import billing as billing_repo

    event = {
        "id": "evt_bad_amt",
        "livemode": False,
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_bad_amt",
                "livemode": False,
                "refunded": True,
                "amount": "2000.5",
                "amount_refunded": "2000.5",
                "currency": "usd",
                "metadata": {"checkout_session_id": "cs_bad_amt"},
            }
        },
    }
    _patch_webhook(monkeypatch, event)

    async def explode(**kwargs):
        raise AssertionError("must not reverse a refund whose amounts do not parse")

    monkeypatch.setattr(billing_repo, "reverse_purchase", explode)
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=ok"},
    )
    assert resp.status_code == 200


async def test_email_noop_without_key(monkeypatch):
    from marketer.config import settings
    from marketer.services import email as email_svc

    monkeypatch.setattr(settings, "resend_api_key", "")
    assert (
        await email_svc.send_email(to="a@a.com", subject="s", html="<p>x</p>")
        is False
    )


async def test_email_sends_with_key(monkeypatch):
    import httpx

    from marketer.config import settings
    from marketer.services import email as email_svc

    monkeypatch.setattr(settings, "resend_api_key", "re_test")

    sent: list[dict] = []

    class FakeResp:
        status_code = 200
        text = "ok"

    class FakeClient:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append(json)
            return FakeResp()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    ok = await email_svc.send_email(to="a@a.com", subject="s", html="<p>x</p>")
    assert ok is True
    assert sent[0]["to"] == ["a@a.com"]


def test_email_templates_render_links_and_prefs(monkeypatch):
    from marketer.config import settings
    from marketer.services import email as email_svc

    monkeypatch.setattr(settings, "app_url", "https://app.marketer.sh")

    subj, html = email_svc.render_article_done("art_1", "Dialing In Espresso")
    assert "Dialing In Espresso" in html
    assert "https://app.marketer.sh/articles/art_1" in html
    # Every email carries a manage-notifications (unsubscribe) link.
    assert "https://app.marketer.sh/settings" in html
    assert subj

    _, failed = email_svc.render_article_failed("art_2", None)
    assert "https://app.marketer.sh/articles/art_2" in failed

    _, vfailed = email_svc.render_video_failed("job_9", "a hook")
    assert "https://app.marketer.sh/queue/job_9" in vfailed
    assert "Manage email notifications" in vfailed

    subj, scheduled = email_svc.render_video_scheduled("job_8", "a hook")
    assert subj == "Your video is scheduled"
    assert "queued to publish" in scheduled
    assert "just went out" not in scheduled
    assert "https://app.marketer.sh/queue/job_8" in scheduled
