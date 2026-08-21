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
        "mode": "payment",
        "amount_total": 2000,
        "currency": "usd",
        "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
    }
    assert credit_usd_for_paid_session(session) == Decimal("20.00")


def test_metadata_mismatch_credits_nothing():
    session = {
        "mode": "payment",
        "amount_total": 500,
        "currency": "usd",
        "metadata": {"user_id": "user_a", "credit_usd": "50.00"},
    }
    assert credit_usd_for_paid_session(session) is None


def test_unknown_or_missing_amount_credits_nothing():
    assert (
        credit_usd_for_paid_session(
            {
                "mode": "payment",
                "amount_total": 9999,
                "currency": "usd",
                "metadata": {"credit_usd": "5.00"},
            }
        )
        is None
    )
    assert credit_usd_for_paid_session({"metadata": {"credit_usd": "20.00"}}) is None


def test_non_usd_amount_total_credits_nothing():
    """2000 JPY matching a pack's cent amount must not grant $20."""
    session = {
        "mode": "payment",
        "amount_total": 2000,
        "currency": "jpy",
        "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
    }
    assert credit_usd_for_paid_session(session) is None
    assert credit_usd_for_paid_session(
        {"mode": "payment", "amount_total": 2000, "metadata": {"credit_usd": "20.00"}}
    ) is None
    # Metadata alone, even with a USD stamp, is not an authority.
    assert credit_usd_for_paid_session(
        {
            "mode": "payment",
            "currency": "usd",
            "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
        }
    ) is None
    assert credit_usd_for_paid_session(
        {
            "mode": "payment",
            "amount_total": "2000",
            "currency": "USD",
            "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
        }
    ) == Decimal("20.00")
    # usdc is not usd — do not treat a stablecoin code as dollar cents.
    assert credit_usd_for_paid_session(
        {
            "mode": "payment",
            "amount_total": 2000,
            "currency": "usdc",
            "metadata": {"user_id": "user_a", "credit_usd": "20.00"},
        }
    ) is None
    assert credit_usd_for_paid_session(
        {
            "mode": "payment",
            "amount_total": True,
            "currency": "usd",
            "metadata": {"credit_usd": "5.00"},
        }
    ) is None
    assert credit_usd_for_paid_session(
        {
            "mode": "payment",
            "amount_total": 2000.5,
            "currency": "usd",
            "metadata": {"credit_usd": "20.00"},
        }
    ) is None
    # Subscription / missing mode must not grant pack credit.
    assert credit_usd_for_paid_session(
        {
            "mode": "subscription",
            "amount_total": 2000,
            "currency": "usd",
            "metadata": {"credit_usd": "20.00"},
        }
    ) is None
    assert credit_usd_for_paid_session(
        {
            "amount_total": 2000,
            "currency": "usd",
            "metadata": {"credit_usd": "20.00"},
        }
    ) is None


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
    assert "reverse_purchase" in source
    assert "kind = 'refund'" in source
    refund_idx = (
        Path(__file__).resolve().parent.parent
        / "db/migrations/0040_credit_refund_idempotency.sql"
    ).read_text()
    assert "credit_tx_refund_ref_idx" in refund_idx
    assert "kind = 'refund'" in refund_idx


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
    ads = (
        repo / "web/app/(app)/ads/campaigns/[id]/CampaignDetailClient.tsx"
    ).read_text()
    assert "Email delivery is not configured" in shell
    assert "will not send mail" in form
    assert "emailConfigured" in shell
    assert "sent to your inbox" not in ads
    assert "Ads → Approvals" in ads
    assert "Activation needs approval" in ads
    assert "Campaign marked" in ads
    assert "Mark active" in ads
    campaigns = (
        repo / "web/app/(app)/ads/campaigns/CampaignsClient.tsx"
    ).read_text()
    overview = (repo / "web/app/(app)/ads/AdsOverviewShell.tsx").read_text()
    approvals = (
        repo / "web/app/(app)/ads/approvals/ApprovalsClient.tsx"
    ).read_text()
    assert "Marked active" in campaigns
    assert "Live on platform" in campaigns
    assert "live on platform" in overview
    assert "marked active" in overview
    assert "Connected accounts" in overview
    assert "Active accounts" not in overview
    assert "Approved — spend guard is applying it" in approvals
    billing = (repo / "src/marketer/repos/billing.py").read_text()
    assert "async def reverse_purchase" in billing
    webhook = (repo / "backend/routes/billing.py").read_text()
    assert "_checkout_session_id_for_refunded_charge" in webhook
    assert "Session.list" in webhook
    assert "PaymentIntent.modify" in webhook
    assert "checkout_session_id" in webhook
    detail = (
        repo / "web/app/(app)/ads/campaigns/[id]/CampaignDetailClient.tsx"
    ).read_text()
    assert "Mark active" in detail
    assert ">Activate<" not in detail
    email = (repo / "src/marketer/services/email.py").read_text()
    assert "Your video is scheduled" in email
    assert "queued to publish" in email
    assert "just went out" not in email
    assert "shipped a video" not in email
    dash = (repo / "web/app/(app)/dashboard/DashboardClient.tsx").read_text()
    assert "Videos scheduled" in dash
    assert "Videos published" not in dash


def test_inline_paid_http_routes_refuse_unbilled():
    """LLM/scrape/TTS routes that skip Modal still share the HTTP gate."""
    from pathlib import Path

    routes = Path(__file__).resolve().parent.parent / "backend" / "routes"
    for name in (
        "articles.py",
        "personas.py",
        "seo_audits.py",
        "voices.py",
        "niches.py",
    ):
        source = (routes / name).read_text()
        assert "refuse_unbilled_generate" in source, name


def test_cron_generate_paths_refuse_unbilled_before_spawn():
    """Campaign / nightly crons bypass HTTP — they must share the gate."""
    from pathlib import Path

    repo = Path(__file__).resolve().parent.parent
    modal = (repo / "modal_app.py").read_text()
    runner = (repo / "src/marketer/services/campaign_runner.py").read_text()
    assert "unbilled_generate_blocked" in runner
    assert modal.count("unbilled_generate_blocked") >= 2
    assert "skipped_unbilled" in modal


_MODAL_GENERATE_WORKERS = (
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
    "prewarm_voice_previews",
)


def test_modal_generate_workers_skip_unbilled_before_provider():
    """HTTP 402 is not enough — leftover Modal invokes must skip too."""
    import re
    from pathlib import Path

    source = (
        Path(__file__).resolve().parent.parent / "modal_app.py"
    ).read_text()
    missing: list[str] = []
    for name in _MODAL_GENERATE_WORKERS:
        match = re.search(
            rf"async def {name}\(.*?\n(?:.*\n){{0,16}}", source
        )
        if match is None or "_unbilled_skip" not in match.group(0):
            missing.append(name)
    assert not missing, f"generate workers missing unbilled skip: {missing}"


async def test_run_job_refuses_unbilled_before_niche_lookup(monkeypatch):
    from marketer.config import settings
    from marketer.pipeline import run_job
    from marketer.repos import niches as niches_repo
    from marketer.repos.spend import SpendCapExceeded

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def explode(*_a, **_k):
        raise AssertionError("run_job must not look up a niche after HTTP 402")

    monkeypatch.setattr(niches_repo, "get", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await run_job(
            user_id="user_a",
            niche_id=uuid4(),
            platform="tiktok",
        )


_PAID_PIPELINE_FILES = (
    "src/marketer/pipeline.py",
    "src/marketer/articles/pipeline.py",
    "src/marketer/drama/pipeline.py",
    "src/marketer/motion/pipeline.py",
    "src/marketer/services/image_posts.py",
    "src/marketer/headshots/pipeline.py",
    "src/marketer/design/executor.py",
    "src/marketer/research/trends.py",
    "src/marketer/services/compose.py",
    "src/marketer/services/template_remix.py",
    "src/marketer/adcreative/renderer.py",
    "src/marketer/ugc/render.py",
    "src/marketer/seoaudit/audit.py",
    "src/marketer/services/spend_context.py",
    "src/marketer/agents/metered.py",
    "src/marketer/services/openai_images.py",
    "src/marketer/services/openai_tts.py",
    "src/marketer/services/elevenlabs_tts.py",
    "src/marketer/services/fal_video.py",
    "src/marketer/services/grok_imagine.py",
    "src/marketer/services/music_gen.py",
    "src/marketer/services/openai_whisper.py",
    "src/marketer/services/seedance.py",
    "src/marketer/articles/llm.py",
    "src/marketer/adcreative/brief.py",
    "src/marketer/services/muapi.py",
    "src/marketer/services/context_dev.py",
    "src/marketer/articles/exa.py",
    "src/marketer/services/pixabay_music.py",
    "src/marketer/motion/stock.py",
    "src/marketer/adcreative/planner.py",
)


async def test_default_context_refuses_unbilled_before_user_lookup(monkeypatch):
    """In-process leftovers that skip named pipelines still hit default_context."""
    from marketer.config import settings
    from marketer.repos import users as users_repo
    from marketer.repos.spend import SpendCapExceeded
    from marketer.services.spend_context import default_context

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def explode(*_a, **_k):
        raise AssertionError("default_context must not load a user after HTTP 402")

    monkeypatch.setattr(users_repo, "get", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await default_context(user_id="user_a", niche_id=uuid4(), job_id=None)


def test_paid_pipeline_entries_raise_if_unbilled():
    """A queued worker that forgets the in-process gate can still spend
    after HTTP 402. Every paid entry must call raise_if_unbilled."""
    from pathlib import Path

    repo = Path(__file__).resolve().parent.parent
    missing = [
        rel
        for rel in _PAID_PIPELINE_FILES
        if "raise_if_unbilled" not in (repo / rel).read_text()
    ]
    assert not missing, f"paid pipelines missing raise_if_unbilled: {missing}"


async def test_run_drama_refuses_unbilled_before_lookup(monkeypatch):
    from marketer.config import settings
    from marketer.drama import pipeline as drama_pipeline
    from marketer.repos import dramas as dramas_repo
    from marketer.repos.spend import SpendCapExceeded

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def explode(*_a, **_k):
        raise AssertionError("run_drama must not load a row after HTTP 402")

    monkeypatch.setattr(dramas_repo, "get", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await drama_pipeline.run_drama(user_id="user_a", drama_id=uuid4())


async def test_research_trends_refuses_unbilled_before_exa(monkeypatch):
    """Direct research_trends leftover must not hit Exa after HTTP 402."""
    from marketer.config import settings
    from marketer.research import trends

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def explode(*_a, **_k):
        raise AssertionError("research_trends must not call Exa when unbilled")

    monkeypatch.setattr(trends, "gather_sources", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await trends.research_trends(
            type("N", (), {"title": "x", "description": "y"})()
        )


async def test_openai_tts_refuses_unbilled_when_spend_is_none(monkeypatch, tmp_path):
    """Provider leftover with spend=None must fail before the OpenAI call."""
    from marketer.config import settings
    from marketer.services import openai_tts

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def explode(*_a, **_k):
        raise AssertionError("openai_tts must not call the provider when unbilled")

    monkeypatch.setattr(openai_tts, "_call_api", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await openai_tts.synthesize("hello", tmp_path / "v.wav", spend=None)


def test_http_niche_draft_refuses_unbilled(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.rate_limit import limiter
    from marketer.agents import niche_draft as nd
    from marketer.config import settings

    limiter._storage.reset()
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def explode(*_a, **_k):
        raise AssertionError("draft_niche must not run after HTTP 402")

    monkeypatch.setattr(nd, "draft_niche", explode)
    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/niches/draft",
        json={"description": "claymation videos explaining economics for adults"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402


async def test_muapi_submit_refuses_unbilled_before_provider(monkeypatch):
    from marketer.config import settings
    from marketer.services import muapi

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    def explode(*_a, **_k):
        raise AssertionError("muapi.submit must not touch the gateway when unbilled")

    monkeypatch.setattr(muapi, "require_enabled", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await muapi.submit(endpoint="x", prompt="p", image_urls=[], params={})


async def test_plan_ad_run_refuses_unbilled_before_context_dev(monkeypatch):
    from marketer.adcreative import planner
    from marketer.config import settings
    from marketer.services import context_dev

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)
    monkeypatch.setattr(settings, "ad_creative_enabled", True)
    monkeypatch.setattr(settings, "context_dev_api_key", "ctx-test")

    async def explode(*_a, **_k):
        raise AssertionError("plan_ad_run must not call context.dev when unbilled")

    monkeypatch.setattr(context_dev, "retrieve_brand", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await planner.plan_ad_run("stripe.com")


async def test_exa_serp_refuses_unbilled_before_http(monkeypatch):
    from marketer.articles import exa
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)
    monkeypatch.setattr(settings, "exa_api_key", "exa-test")

    async def explode(*_a, **_k):
        raise AssertionError("exa.serp_pages must not POST when unbilled")

    monkeypatch.setattr(exa.httpx, "AsyncClient", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await exa.serp_pages("coffee")
