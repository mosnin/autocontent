"""Tests for GET /api/v1/jobs/{id}/metrics.

No DB or Ayrshare calls — jobs_repo and post_metrics_repo are monkeypatched.
Auth is bypassed via FastAPI dependency_overrides.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus, PostMetrics

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_USER_ID = "user_test"
_OTHER_USER_ID = "user_other"
_NICHE_ID = UUID("22222222-2222-2222-2222-222222222222")
_JOB_ID = UUID("33333333-3333-3333-3333-333333333333")
_NOW = datetime(2026, 6, 9, 11, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_job(user_id: str = _USER_ID) -> Job:
    return Job(
        id=_JOB_ID,
        user_id=user_id,
        niche_id=_NICHE_ID,
        platform="tiktok",
        status=JobStatus.done,
        created_at=_NOW,
        provider_post_id="ayr-post-1",
    )


def _make_metrics(views: int = 500, sampled_at: datetime = _NOW) -> PostMetrics:
    return PostMetrics(
        id=uuid4(),
        user_id=_USER_ID,
        job_id=_JOB_ID,
        provider_post_id="ayr-post-1",
        platform="tiktok",
        sampled_at=sampled_at,
        views=views,
        likes=20,
        comments=3,
        shares=5,
        saves=2,
        watch_time_sec=Decimal("1000.00"),
        avg_watch_time_sec=Decimal("4.00"),
        completion_rate=Decimal("0.40"),
        reach=450,
        impressions=600,
        raw={"id": "ayr-post-1"},
        created_at=_NOW,
    )


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch, user_id: str = _USER_ID) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=user_id, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Happy path: returns latest + history
# ---------------------------------------------------------------------------

def test_metrics_happy_path(monkeypatch):
    """Returns 200 with latest sample and full time-series history."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.post_metrics as pm_repo

    job = _make_job()
    latest_sample = _make_metrics(views=600)
    older_sample = _make_metrics(views=400)

    async def _get_job(job_id: UUID, *, user_id: str) -> Job | None:
        return job if job_id == _JOB_ID and user_id == _USER_ID else None

    async def _latest(job_id: UUID, *, user_id: str) -> PostMetrics | None:
        return latest_sample

    async def _list(job_id: UUID, *, user_id: str, limit: int = 30) -> list[PostMetrics]:
        return [latest_sample, older_sample]

    monkeypatch.setattr(jobs_repo, "get", _get_job)
    monkeypatch.setattr(pm_repo, "latest_for_job", _latest)
    monkeypatch.setattr(pm_repo, "list_for_job", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/metrics",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["latest"] is not None
    assert data["latest"]["views"] == 600
    assert len(data["history"]) == 2


# ---------------------------------------------------------------------------
# Empty: no samples yet → {"latest": null, "history": []}
# ---------------------------------------------------------------------------

def test_metrics_empty_when_never_sampled(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.post_metrics as pm_repo

    job = _make_job()

    async def _get_job(job_id: UUID, *, user_id: str) -> Job | None:
        return job if job_id == _JOB_ID and user_id == _USER_ID else None

    async def _latest(job_id: UUID, *, user_id: str) -> PostMetrics | None:
        return None

    async def _list(job_id: UUID, *, user_id: str, limit: int = 30) -> list[PostMetrics]:
        return []

    monkeypatch.setattr(jobs_repo, "get", _get_job)
    monkeypatch.setattr(pm_repo, "latest_for_job", _latest)
    monkeypatch.setattr(pm_repo, "list_for_job", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/metrics",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["latest"] is None
    assert data["history"] == []


# ---------------------------------------------------------------------------
# Other user's job → 404
# ---------------------------------------------------------------------------

def test_metrics_other_user_job_returns_404(monkeypatch):
    """A job owned by another user is invisible — the repo returns None."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    # Repo returns None because the user_id doesn't match
    async def _get_job(job_id: UUID, *, user_id: str) -> Job | None:
        return None

    monkeypatch.setattr(jobs_repo, "get", _get_job)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/metrics",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Missing job → 404
# ---------------------------------------------------------------------------

def test_metrics_missing_job_returns_404(monkeypatch):
    """Completely unknown job_id → 404."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _get_job(job_id: UUID, *, user_id: str) -> Job | None:
        return None

    monkeypatch.setattr(jobs_repo, "get", _get_job)

    client = _make_authed_client(monkeypatch)
    unknown_id = uuid4()
    resp = client.get(
        f"/api/v1/jobs/{unknown_id}/metrics",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 404
