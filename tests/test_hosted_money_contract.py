"""Cycle-3 money-contract recertify.

These cases already existed (billing packs, webhook, spend_context) and
ran in the green cycle-2 pytest. This file is the focused, never-skipped
join so a future skip of one sibling cannot hide a credit/generate leak.

Do not enable billing in production from these tests.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from marketer.billing.packs import credit_usd_for_paid_session
from marketer.repos.spend import SpendCapExceeded
from marketer.services.spend_context import SpendContext


def test_webhook_credits_from_amount_total_only():
    session = {
        "amount_total": 2000,
        "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
    }
    assert credit_usd_for_paid_session(session) == Decimal("20.00")


def test_metadata_mismatch_credits_nothing():
    session = {
        "amount_total": 500,
        "metadata": {"user_id": "user_a", "credit_usd": "50.00"},
    }
    assert credit_usd_for_paid_session(session) is None


def test_unknown_or_missing_amount_credits_nothing():
    assert (
        credit_usd_for_paid_session(
            {"amount_total": 9999, "metadata": {"credit_usd": "5.00"}}
        )
        is None
    )
    assert credit_usd_for_paid_session({"metadata": {"credit_usd": "20.00"}}) is None


async def test_spend_refused_when_billing_off_and_unbilled_false(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def record(entry):
        return None

    ctx = SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=record
    )
    with pytest.raises(SpendCapExceeded):
        await ctx.ensure_can_spend(Decimal("0.01"))


def test_http_generate_refuses_without_creating_a_job(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.rate_limit import limiter
    from marketer.config import settings
    from marketer.models import Job, JobStatus
    from marketer.repos import jobs as jobs_repo

    limiter._storage.reset()
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    created: list[str] = []

    async def _create(*, user_id: str, niche_id, platform: str):
        created.append(user_id)
        return Job(
            id=uuid4(),
            user_id=user_id,
            niche_id=niche_id,
            platform=platform,
            status=JobStatus.queued,
        )

    monkeypatch.setattr(jobs_repo, "create", _create)

    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/jobs",
        json={
            "niche_id": str(UUID("22222222-2222-2222-2222-222222222222")),
            "platform": "tiktok",
        },
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
    assert created == []
