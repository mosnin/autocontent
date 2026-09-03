"""Route-level tests for /api/v1/jobs.

Extends coverage of the existing ``test_jobs_routes.py`` (which only tests
function-level 404 cases for the video endpoint). These tests go through the
FastAPI app via TestClient. No DB required — jobs_repo is monkeypatched.
Auth is bypassed via FastAPI dependency_overrides.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_USER_ID = "user_test"
_NICHE_ID = UUID("22222222-2222-2222-2222-222222222222")
_JOB_ID = UUID("33333333-3333-3333-3333-333333333333")


def _make_job(
    *,
    job_id: UUID | None = None,
    user_id: str = _USER_ID,
    status: JobStatus = JobStatus.queued,
) -> Job:
    return Job(
        id=job_id or _JOB_ID,
        user_id=user_id,
        niche_id=_NICHE_ID,
        platform="tiktok",
        status=status,
        created_at=datetime.now(timezone.utc),
    )


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# GET / — list jobs
# ---------------------------------------------------------------------------

def test_list_jobs_returns_200(monkeypatch):
    """GET /jobs returns 200 with list (possibly empty)."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _list(user_id: str, *, status=None, niche_id=None, limit: int = 50):
        return [_make_job()]

    monkeypatch.setattr(jobs_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/jobs", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["status"] == "queued"


def test_list_jobs_with_status_filter(monkeypatch):
    """status_filter query param is forwarded to the repo."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    received_status: list = []

    async def _list(user_id: str, *, status=None, niche_id=None, limit: int = 50):
        received_status.append(status)
        return []

    monkeypatch.setattr(jobs_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/jobs?status_filter=done",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    assert received_status[0] == JobStatus.done


def test_list_jobs_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/api/v1/jobs")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /{id} — single job
# ---------------------------------------------------------------------------

def test_get_job_returns_200_for_owned(monkeypatch):
    """Owned job → 200."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _make_job()

    async def _get(job_id: UUID, *, user_id: str) -> Job | None:
        if job_id == _JOB_ID and user_id == _USER_ID:
            return job
        return None

    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(f"/api/v1/jobs/{_JOB_ID}", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    assert resp.json()["id"] == str(_JOB_ID)


def test_get_job_returns_404_for_other_user(monkeypatch):
    """Job owned by another user → 404."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _get(job_id: UUID, *, user_id: str) -> Job | None:
        return None

    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(f"/api/v1/jobs/{_JOB_ID}", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 404


def test_get_job_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get(f"/api/v1/jobs/{_JOB_ID}")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST / — enqueue job
# ---------------------------------------------------------------------------

def test_enqueue_job_returns_202(monkeypatch):
    """Valid POST /jobs → 202 Accepted with queued job."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _make_job(status=JobStatus.queued)

    async def _create(*, user_id: str, niche_id: UUID, platform: str) -> Job:
        return job

    monkeypatch.setattr(jobs_repo, "create", _create)

    # Enqueue now verifies niche ownership before creating the row.
    import marketer.repos.niches as niches_repo
    from types import SimpleNamespace

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, platforms=["tiktok", "reels", "shorts"])

    monkeypatch.setattr(niches_repo, "get", _niche_get)

    # Stub out modal so we don't import the real thing.
    class _FakeFunction:
        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction()

        def spawn(self, *args, **kwargs):
            pass

    import sys
    import types
    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"


def test_enqueue_job_403_when_generate_flag_off(monkeypatch):
    """Admin generate kill-switch must 403 before a job row or Modal spawn."""
    _reset_limiter()
    from marketer.repos import feature_flags as flags_repo
    import marketer.repos.jobs as jobs_repo

    created: list[dict] = []
    spawned: list[tuple] = []

    async def _denied(key):
        assert key == "generate"
        return False

    async def _create(*, user_id: str, niche_id: UUID, platform: str) -> Job:
        created.append({"user_id": user_id, "niche_id": niche_id, "platform": platform})
        return _make_job()

    class _FakeFunction:
        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction()

        def spawn(self, *args, **kwargs):
            spawned.append(args)

    import sys
    import types

    monkeypatch.setattr(flags_repo, "allowed", _denied)
    monkeypatch.setattr(jobs_repo, "create", _create)
    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 403
    assert "generate" in resp.json()["detail"]
    assert created == []
    assert spawned == []


def test_enqueue_job_refuses_when_unbilled_usage_disabled(monkeypatch):
    """billing off + ALLOW_UNBILLED_USAGE=false must 402 before a row exists."""
    _reset_limiter()
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    import marketer.repos.jobs as jobs_repo

    created: list[dict] = []

    async def _create(*, user_id: str, niche_id: UUID, platform: str) -> Job:
        created.append({"user_id": user_id, "niche_id": niche_id, "platform": platform})
        return _make_job()

    monkeypatch.setattr(jobs_repo, "create", _create)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 402
    assert "unbilled" in resp.json()["detail"]
    assert created == []


def test_enqueue_job_rate_limited_after_twenty(monkeypatch):
    """21st generate in a minute is 429 — the public-abuse guard."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from types import SimpleNamespace

    async def _create(*, user_id: str, niche_id: UUID, platform: str) -> Job:
        return _make_job()

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, platforms=["tiktok", "reels", "shorts"])

    monkeypatch.setattr(jobs_repo, "create", _create)
    monkeypatch.setattr(niches_repo, "get", _niche_get)

    class _FakeFunction:
        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction()

        def spawn(self, *args, **kwargs):
            pass

    import sys
    import types

    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)

    client = _make_authed_client(monkeypatch)
    headers = {"Authorization": "Bearer mkt_tok"}
    body = {"niche_id": str(_NICHE_ID), "platform": "tiktok"}
    statuses = [
        client.post("/api/v1/jobs", json=body, headers=headers).status_code
        for _ in range(21)
    ]
    assert statuses[:20] == [202] * 20
    assert statuses[20] == 429


def test_enqueue_job_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /{id}/retry — retry a failed job
# ---------------------------------------------------------------------------

def test_retry_job_403_when_generate_flag_off(monkeypatch):
    _reset_limiter()
    from marketer.repos import feature_flags as flags_repo
    import marketer.repos.jobs as jobs_repo

    resets: list[UUID] = []

    async def _denied(key):
        return key != "generate"

    async def _reset(job_id: UUID, *, user_id: str) -> Job | None:
        resets.append(job_id)
        return _make_job()

    monkeypatch.setattr(flags_repo, "allowed", _denied)
    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/retry",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 403
    assert resets == []


def test_approve_job_403_when_publish_flag_off(monkeypatch):
    _reset_limiter()
    from marketer.repos import feature_flags as flags_repo
    import marketer.repos.jobs as jobs_repo

    claims: list[UUID] = []
    spawned: list[tuple] = []

    async def _denied(key):
        assert key == "publish"
        return False

    async def _claim(job_id: UUID, *, user_id: str) -> Job | None:
        claims.append(job_id)
        return _make_job(status=JobStatus.awaiting_approval)

    class _FakeFunction:
        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction()

        def spawn(self, *args, **kwargs):
            spawned.append(args)

    import sys
    import types

    monkeypatch.setattr(flags_repo, "allowed", _denied)
    monkeypatch.setattr(jobs_repo, "claim_for_scheduling", _claim)
    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/approve",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 403
    assert "publish" in resp.json()["detail"]
    assert claims == []
    assert spawned == []


def test_retry_failed_job_returns_202(monkeypatch):
    """Retry a failed job → 202 with queued status."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    retried_job = _make_job(status=JobStatus.queued)

    async def _reset(job_id: UUID, *, user_id: str) -> Job | None:
        return retried_job

    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)

    # Stub modal.
    class _FakeFunction:
        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction()

        def spawn(self, *args, **kwargs):
            pass

    import sys
    import types
    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/retry",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"


def test_retry_non_failed_job_returns_409(monkeypatch):
    """Retry a job not in failed state → 409 Conflict."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    # Repo returns None when job is not in failed state.
    async def _reset(job_id: UUID, *, user_id: str) -> Job | None:
        return None

    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/retry",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 409


def test_retry_job_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post(f"/api/v1/jobs/{_JOB_ID}/retry")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /{id}/video — happy path (file exists)
# ---------------------------------------------------------------------------

def test_get_job_video_streams_when_file_exists(monkeypatch, tmp_path):
    """When the rendered video file exists, streaming response is returned."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    from marketer.models import RenderedVideo

    video_file = tmp_path / "output.mp4"
    video_file.write_bytes(b"fake mp4 content")

    job = _make_job(status=JobStatus.done)
    job.rendered = RenderedVideo(path=str(video_file), duration_sec=10.0)

    async def _get(job_id: UUID, *, user_id: str) -> Job | None:
        if job_id == _JOB_ID and user_id == _USER_ID:
            return job
        return None

    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/video",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("video/mp4")


# ---------------------------------------------------------------------------
# POST / — prepaid-credit gate (hosted billing)
# ---------------------------------------------------------------------------

def _full_niche_stub(niche_id):
    """Niche stub with every field the run estimator reads."""
    from types import SimpleNamespace

    return SimpleNamespace(
        id=niche_id,
        platforms=["tiktok", "reels", "shorts"],
        scene_count=6,
        image_quality="medium",
        scene_max_duration_sec=5,
        target_duration_sec=60,
        video_provider="grok",
        fal_model="",
    )


def _stub_modal(monkeypatch):
    class _FakeFunction:
        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction()

        def spawn(self, *args, **kwargs):
            pass

    import sys
    import types

    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)


def test_enqueue_refused_402_when_credit_short(monkeypatch):
    """Billing on + balance below the estimated charge → 402 with a human
    message, and no job row is created (the audit's up-front refusal)."""
    _reset_limiter()
    from decimal import Decimal

    import marketer.repos.billing as billing_repo
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)

    async def _niche_get(niche_id, *, user_id):
        return _full_niche_stub(niche_id)

    monkeypatch.setattr(niches_repo, "get", _niche_get)

    async def _balance(user_id):
        return Decimal("0")

    monkeypatch.setattr(billing_repo, "balance", _balance)

    created = []

    async def _create(*, user_id, niche_id, platform):
        created.append(niche_id)
        return _make_job()

    monkeypatch.setattr(jobs_repo, "create", _create)
    _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 402
    detail = resp.json()["detail"]
    assert "Add credit" in detail
    assert "$0.00" in detail
    assert created == []  # refused before any row was inserted


def test_enqueue_allowed_when_credit_covers_estimate(monkeypatch):
    """Billing on + ample balance → 202 as before."""
    _reset_limiter()
    from decimal import Decimal

    import marketer.repos.billing as billing_repo
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)

    async def _niche_get(niche_id, *, user_id):
        return _full_niche_stub(niche_id)

    monkeypatch.setattr(niches_repo, "get", _niche_get)

    async def _balance(user_id):
        return Decimal("50")

    monkeypatch.setattr(billing_repo, "balance", _balance)

    async def _create(*, user_id, niche_id, platform):
        return _make_job()

    monkeypatch.setattr(jobs_repo, "create", _create)
    _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 202


def test_retry_refused_402_when_credit_short(monkeypatch):
    """Billing on + $0 balance → retry refused up front, job left failed."""
    _reset_limiter()
    from decimal import Decimal

    import marketer.repos.billing as billing_repo
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)

    failed_job = _make_job(status=JobStatus.failed)

    async def _get(job_id, *, user_id):
        return failed_job

    monkeypatch.setattr(jobs_repo, "get", _get)

    async def _niche_get(niche_id, *, user_id):
        return _full_niche_stub(niche_id)

    monkeypatch.setattr(niches_repo, "get", _niche_get)

    async def _balance(user_id):
        return Decimal("0")

    monkeypatch.setattr(billing_repo, "balance", _balance)

    reset_called = []

    async def _reset(job_id, *, user_id):
        reset_called.append(job_id)
        return _make_job(status=JobStatus.queued)

    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)
    _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/retry",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 402
    assert reset_called == []  # the job was not touched


def test_job_receipt_returns_metered_and_charged(monkeypatch):
    """Receipt = metered spend + charged credit (billing on)."""
    _reset_limiter()
    from decimal import Decimal
    from uuid import UUID as _UUID

    import marketer.repos.billing as billing_repo
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.spend as spend_repo
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)

    async def _get(job_id, *, user_id):
        return _make_job(status=JobStatus.done)

    monkeypatch.setattr(jobs_repo, "get", _get)

    async def _cost_by_job(job_ids, *, user_id):
        return {jid: Decimal("1.9620") for jid in job_ids}

    monkeypatch.setattr(spend_repo, "cost_by_job", _cost_by_job)

    async def _charged(user_id, job_id: _UUID):
        return Decimal("2.9430")

    monkeypatch.setattr(billing_repo, "charged_for_job", _charged)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/receipt",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["metered_usd"] == "1.9620"
    assert body["charged_usd"] == "2.9430"
    assert body["billing_enabled"] is True


def test_video_estimate_matches_gate_arithmetic(monkeypatch):
    """POST /niches/estimate returns the same number the enqueue gate uses."""
    _reset_limiter()
    from decimal import Decimal

    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "elevenlabs_api_key", "", raising=False)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/niches/estimate",
        json={
            "scene_count": 6,
            "image_quality": "medium",
            "scene_max_duration_sec": 5,
            "target_duration_sec": 60,
        },
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["billing_enabled"] is True
    # Cross-check against the gate's own arithmetic.
    from marketer.services.run_estimate import estimate_run_cost_usd

    est = estimate_run_cost_usd(_full_niche_stub(None))
    assert Decimal(body["estimated_usd"]) == est.quantize(Decimal("0.01"))
    assert Decimal(body["charge_usd"]) == (est * Decimal("1.5")).quantize(Decimal("0.01"))
