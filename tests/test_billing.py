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


def test_webhook_rejects_bad_signature(client, monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    resp = client.post(
        "/api/v1/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=bogus"},
    )
    assert resp.status_code == 401


def test_webhook_credits_on_completed_session(client, monkeypatch):
    import stripe as stripe_mod

    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")

    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_123",
                "payment_status": "paid",
                "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
            }
        },
    }
    monkeypatch.setattr(
        stripe_mod.Webhook, "construct_event", staticmethod(lambda p, s, sec: event)
    )

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
