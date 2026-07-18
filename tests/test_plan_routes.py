"""Route-level tests for the plan-first flow:
  POST /api/v1/jobs            (plan_only=true)
  GET  /api/v1/jobs/{id}/plan
  PUT  /api/v1/jobs/{id}/plan
  POST /api/v1/jobs/{id}/render

Same shape as tests/test_jobs_route.py and tests/test_revision_jobs.py:
FastAPI TestClient, jobs_repo monkeypatched, no DB, no network. Modal is
stubbed with a fake module so no real Modal client is imported.
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from marketer.models import Idea, Job, JobStatus, Scene, Script

_USER_ID = "user_test"
_NICHE_ID = UUID("22222222-2222-2222-2222-222222222222")
_JOB_ID = UUID("33333333-3333-3333-3333-333333333333")


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


def _stub_modal(monkeypatch):
    """Fake `modal` module; returns a list of (func_name, spawn_args)."""
    spawned: list[tuple[str, tuple]] = []

    class _FakeFunction:
        def __init__(self, func: str):
            self._func = func

        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction(func)

        def spawn(self, *args, **kwargs):
            spawned.append((self._func, args))

    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    return spawned


def _script(n_scenes: int = 2) -> Script:
    return Script(
        idea=Idea(topic="t", angle="a", hook="hook", target_audience="x", why_it_works="y"),
        scenes=[
            Scene(index=i, narration=f"n{i}", visual_prompt=f"vp{i}",
                  motion_prompt=f"mp{i}", duration_sec=5)
            for i in range(n_scenes)
        ],
        total_duration_sec=5.0 * n_scenes,
    )


def _planned_job(*, n_scenes: int = 2, status: JobStatus = JobStatus.planned) -> Job:
    return Job(
        id=_JOB_ID, user_id=_USER_ID, niche_id=_NICHE_ID, platform="tiktok",
        status=status, created_at=datetime.now(timezone.utc),
        script=_script(n_scenes),
    )


# ---------------------------------------------------------------------------
# POST /jobs — plan_only routes to run_plan
# ---------------------------------------------------------------------------

def test_enqueue_plan_only_spawns_run_plan(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from types import SimpleNamespace

    job = Job(id=_JOB_ID, user_id=_USER_ID, niche_id=_NICHE_ID, platform="tiktok",
              status=JobStatus.queued, created_at=datetime.now(timezone.utc))

    async def _create(*, user_id, niche_id, platform):
        return job
    monkeypatch.setattr(jobs_repo, "create", _create)

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, platforms=["tiktok", "reels", "shorts"])
    monkeypatch.setattr(niches_repo, "get", _niche_get)

    spawned = _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok", "plan_only": True},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 202
    assert spawned == [("run_plan", (_USER_ID, str(_NICHE_ID), "tiktok", str(_JOB_ID)))]


def test_enqueue_without_plan_only_spawns_run_pipeline(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from types import SimpleNamespace

    job = Job(id=_JOB_ID, user_id=_USER_ID, niche_id=_NICHE_ID, platform="tiktok",
              status=JobStatus.queued, created_at=datetime.now(timezone.utc))

    async def _create(*, user_id, niche_id, platform):
        return job
    monkeypatch.setattr(jobs_repo, "create", _create)

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, platforms=["tiktok"])
    monkeypatch.setattr(niches_repo, "get", _niche_get)

    spawned = _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/jobs",
        json={"niche_id": str(_NICHE_ID), "platform": "tiktok"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 202
    assert spawned == [("run_pipeline", (_USER_ID, str(_NICHE_ID), "tiktok", str(_JOB_ID)))]


# ---------------------------------------------------------------------------
# GET /jobs/{id}/plan
# ---------------------------------------------------------------------------

def test_get_plan_returns_storyboard(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from types import SimpleNamespace

    job = _planned_job()

    async def _get(job_id, *, user_id):
        return job if (job_id == _JOB_ID and user_id == _USER_ID) else None
    monkeypatch.setattr(jobs_repo, "get", _get)

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(voice="onyx")
    monkeypatch.setattr(niches_repo, "get", _niche_get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/plan", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["job_id"] == str(_JOB_ID)
    assert body["status"] == "planned"
    assert body["voice"] == "onyx"
    assert len(body["scenes"]) == 2
    assert body["scenes"][0]["narration"] == "n0"
    assert body["scenes"][0]["visual_prompt"] == "vp0"


def test_get_plan_404_when_job_not_found(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _get(job_id, *, user_id):
        return None
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/plan", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 404


def test_get_plan_409_when_no_script(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _planned_job()
    job.script = None

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/jobs/{_JOB_ID}/plan", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# PUT /jobs/{id}/plan — validated edits
# ---------------------------------------------------------------------------

def _edit_body(n_scenes: int = 2, *, prefix: str = "EDITED") -> dict:
    return {
        "scenes": [
            {
                "index": i,
                "narration": f"{prefix}-n{i}",
                "visual_prompt": f"{prefix}-vp{i}",
                "motion_prompt": f"{prefix}-mp{i}",
            }
            for i in range(n_scenes)
        ]
    }


def test_put_plan_happy_path_persists_edits(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import marketer.repos.niches as niches_repo
    from types import SimpleNamespace

    job = _planned_job()

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    saved: list[Job] = []

    async def _save_snapshot(j):
        saved.append(j.model_copy(deep=True))
    monkeypatch.setattr(jobs_repo, "save_snapshot", _save_snapshot)

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(voice="nova")
    monkeypatch.setattr(niches_repo, "get", _niche_get)

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/jobs/{_JOB_ID}/plan",
        json=_edit_body(),
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["scenes"][0]["narration"] == "EDITED-n0"
    assert body["scenes"][0]["visual_prompt"] == "EDITED-vp0"
    assert body["scenes"][1]["motion_prompt"] == "EDITED-mp1"
    # duration_sec / index are preserved from the original scene, not editable.
    assert body["scenes"][0]["duration_sec"] == 5.0

    assert len(saved) == 1
    assert saved[0].script.scenes[0].narration == "EDITED-n0"


def test_put_plan_rejects_scene_count_change(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _planned_job(n_scenes=2)

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/jobs/{_JOB_ID}/plan",
        json=_edit_body(n_scenes=3),
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_put_plan_rejects_empty_narration(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _planned_job()

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    body = _edit_body()
    body["scenes"][0]["narration"] = "   "  # whitespace-only

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/jobs/{_JOB_ID}/plan",
        json=body,
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_put_plan_rejects_overlong_visual_prompt(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _planned_job()

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    body = _edit_body()
    body["scenes"][0]["visual_prompt"] = "x" * 3000

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/jobs/{_JOB_ID}/plan",
        json=body,
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_put_plan_rejects_when_not_planned(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _planned_job(status=JobStatus.done)

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/jobs/{_JOB_ID}/plan",
        json=_edit_body(),
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 409


def test_put_plan_404_when_job_not_found(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _get(job_id, *, user_id):
        return None
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/jobs/{_JOB_ID}/plan",
        json=_edit_body(),
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /jobs/{id}/render
# ---------------------------------------------------------------------------

def test_render_202_and_spawns_render_from_plan(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    claimed = _planned_job(status=JobStatus.queued)  # post-claim status

    async def _claim(job_id, *, user_id):
        return claimed if (job_id == _JOB_ID and user_id == _USER_ID) else None
    monkeypatch.setattr(jobs_repo, "claim_for_render", _claim)

    spawned = _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/render", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 202
    assert resp.json()["id"] == str(_JOB_ID)
    assert spawned == [("render_from_plan", (_USER_ID, str(_JOB_ID)))]


def test_render_409_when_not_planned(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _claim(job_id, *, user_id):
        return None
    monkeypatch.setattr(jobs_repo, "claim_for_render", _claim)

    existing = _planned_job(status=JobStatus.done)

    async def _get(job_id, *, user_id):
        return existing
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/render", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 409
    assert "not planned" in resp.json()["detail"]


def test_render_404_when_job_not_found(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _claim(job_id, *, user_id):
        return None
    monkeypatch.setattr(jobs_repo, "claim_for_render", _claim)

    async def _get(job_id, *, user_id):
        return None
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/render", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 404


def test_render_without_auth_returns_401(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post(f"/api/v1/jobs/{_JOB_ID}/render")
    assert resp.status_code == 401
