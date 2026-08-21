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


# Modal functions that start paid generation. finish_*/publish_* reuse
# already-paid artifacts and are not in this set.
_GENERATE_SPAWN_NAMES = (
    "run_pipeline",
    "run_article_pipeline",
    "run_drama_pipeline",
    "run_motion_project",
    "run_image_post",
    "run_ad_creative_run",
    "retry_ad_creative_slot",
    "run_design_project",
    "run_headshot_batch",
    "run_trend_research",
    "render_composition",
    "run_template_remix",
)


def test_every_generate_spawn_route_refuses_unbilled_at_http_edge():
    """A new Modal generate route that forgets refuse_unbilled_generate
    must fail CI — dramas already shipped that hole once."""
    from pathlib import Path

    routes = Path(__file__).resolve().parent.parent / "backend" / "routes"
    missing: list[str] = []
    for path in sorted(routes.glob("*.py")):
        source = path.read_text()
        if "Function.from_name" not in source:
            continue
        if not any(name in source for name in _GENERATE_SPAWN_NAMES):
            continue
        if "refuse_unbilled_generate" not in source:
            missing.append(path.name)
    assert not missing, (
        "these routers spawn paid Modal work without the unbilled HTTP "
        f"gate: {missing}"
    )


def test_http_drama_generate_refuses_without_creating_a_row(monkeypatch):
    """Highest-cost leftover: dramas accepted 202 with unbilled usage off."""
    from fastapi.testclient import TestClient

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.rate_limit import limiter
    from marketer.config import settings
    from marketer.repos import dramas as dramas_repo

    limiter._storage.reset()
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    created: list[str] = []

    async def _create(**kwargs):
        created.append(kwargs.get("user_id", ""))
        raise AssertionError("drama row must not be created when unbilled is refused")

    monkeypatch.setattr(dramas_repo, "create", _create)

    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/dramas",
        json={
            "niche_id": str(UUID("22222222-2222-2222-2222-222222222222")),
            "idea": "a coffee heist in six shots",
        },
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
    assert created == []


def test_credit_purchase_sql_is_idempotent_on_session_id():
    """Never-skipped pin: webhook replay depends on this clause, not live Stripe."""
    from pathlib import Path

    source = (
        Path(__file__).resolve().parent.parent / "src/marketer/repos/billing.py"
    ).read_text()
    assert "on conflict do nothing" in source.lower()
    assert "checkout_session_id" in source


def test_security_headers_and_leaks_recertify(monkeypatch):
    """Healthz/webhook must keep class-name-only errors and baseline headers."""
    import sys
    import types

    from fastapi.testclient import TestClient

    from backend.main import create_app
    from marketer.config import settings

    monkeypatch.setattr(settings, "web_origin", "")
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_secret_value")

    fake_migrate = types.ModuleType("scripts.migrate")
    fake_migrate.status = lambda **_: {"applied": 3, "pending": 0}  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "scripts.migrate", fake_migrate)

    import backend.routes.healthz as healthz_mod

    async def _failing_get_pool():
        raise ConnectionRefusedError(
            "could not connect to postgres://user:supersecret@db/marketer"
        )

    monkeypatch.setattr(healthz_mod, "get_pool", _failing_get_pool)

    class _FakeResponse:
        status_code = 200

        def raise_for_status(self):
            pass

    class _FakeHTTPClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def head(self, url: str):
            return _FakeResponse()

    monkeypatch.setattr(healthz_mod.httpx, "AsyncClient", lambda **kw: _FakeHTTPClient())

    client = TestClient(create_app(), raise_server_exceptions=False)

    live = client.get("/healthz")
    assert live.status_code == 200
    assert live.json() == {"ok": True}
    assert live.headers["x-content-type-options"] == "nosniff"
    assert live.headers["x-frame-options"] == "DENY"
    assert live.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "whsec_secret_value" not in live.text

    deep = client.get("/healthz/deep")
    assert deep.status_code == 503
    assert deep.json()["checks"]["db"]["error"] == "ConnectionRefusedError"
    assert "supersecret" not in deep.text
    assert "postgres://" not in deep.text

    hook = client.post("/api/v1/billing/webhook", content=b"{}")
    assert hook.status_code == 401
    assert hook.json()["detail"] == "invalid webhook"
    assert "whsec_secret_value" not in hook.text
    assert "supersecret" not in hook.text


def test_settings_ui_does_not_claim_email_when_unconfigured():
    from pathlib import Path

    repo = Path(__file__).resolve().parent.parent
    shell = (repo / "web/app/(app)/settings/SettingsShell.tsx").read_text()
    form = (repo / "web/app/(app)/settings/NotificationsForm.tsx").read_text()
    assert "Email delivery is not configured" in shell
    assert "will not send mail" in form
    assert "emailConfigured" in shell
