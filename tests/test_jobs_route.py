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

from autocontent.models import Job, JobStatus

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
    from autocontent.config import settings
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
    import autocontent.repos.jobs as jobs_repo

    async def _list(user_id: str, *, status=None, niche_id=None, limit: int = 50):
        return [_make_job()]

    monkeypatch.setattr(jobs_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/jobs", headers={"Authorization": "Bearer act_tok"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["status"] == "queued"


def test_list_jobs_with_status_filter(monkeypatch):
    """status_filter query param is forwarded to the repo."""
    _reset_limiter()
    import autocontent.repos.jobs as jobs_repo

    received_status: list = []

    async def _list(user_id: str, *, status=None, niche_id=None, limit: int = 50):
        received_status.append(status)
        return []

    monkeypatch.setattr(jobs_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/jobs?status_filter=done",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 200
    assert received_status[0] == JobStatus.done


def test_list_jobs_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
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
    import autocontent.repos.jobs as jobs_repo

    job = _make_job()

    async def _get(job_id: UUID, *, user_id: str) -> Job | None:
        if job_id == _JOB_ID and user_id == _USER_ID:
            return job
        return None

    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(f"/api/v1/jobs/{_JOB_ID}", headers={"Authorization": "Bearer act_tok"})
    assert resp.status_code == 200
    assert resp.json()["id"] == str(_JOB_ID)


def test_get_job_returns_404_for_other_user(monkeypatch):
    """Job owned by another user → 404."""
    _reset_limiter()
    import autocontent.repos.jobs as jobs_repo

    async def _get(job_id: UUID, *, user_id: str) -> Job | None:
        return None

    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(f"/api/v1/jobs/{_JOB_ID}", headers={"Authorization": "Bearer act_tok"})
    assert resp.status_code == 404


def test_get_job_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
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
    import autocontent.repos.jobs as jobs_repo

    job = _make_job(status=JobStatus.queued)

    async def _create(*, user_id: str, niche_id: UUID, platform: str) -> Job:
        return job

    monkeypatch.setattr(jobs_repo, "create", _create)

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
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"


def test_enqueue_job_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
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

def test_retry_failed_job_returns_202(monkeypatch):
    """Retry a failed job → 202 with queued status."""
    _reset_limiter()
    import autocontent.repos.jobs as jobs_repo

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
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"


def test_retry_non_failed_job_returns_409(monkeypatch):
    """Retry a job not in failed state → 409 Conflict."""
    _reset_limiter()
    import autocontent.repos.jobs as jobs_repo

    # Repo returns None when job is not in failed state.
    async def _reset(job_id: UUID, *, user_id: str) -> Job | None:
        return None

    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/retry",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 409


def test_retry_job_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
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
    import autocontent.repos.jobs as jobs_repo
    from autocontent.models import RenderedVideo

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
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("video/mp4")
