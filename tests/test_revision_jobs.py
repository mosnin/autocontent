"""Route-level tests for scene reroll / revoice — POST /jobs/{id}/scenes/{i}/reroll
and POST /jobs/{id}/revoice.

Same shape as tests/test_jobs_route.py. Modal is stubbed out so no real
Modal client is imported.
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.models import (
    AudioTrack,
    Clip,
    Idea,
    Job,
    JobStatus,
    RenderedVideo,
    Scene,
    Script,
)

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
    spawned: list = []

    class _FakeFunction:
        @staticmethod
        def from_name(app: str, func: str):
            return _FakeFunction()

        def spawn(self, *args, **kwargs):
            spawned.append(args)

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


def _full_job(tmp_path, *, n_scenes: int = 2) -> Job:
    """A `done` job with every artifact actually present on disk — the
    happy path for revision eligibility."""
    final = tmp_path / "final.mp4"
    final.write_bytes(b"MP4")
    vo = tmp_path / "vo.wav"
    vo.write_bytes(b"WAV")
    clips = []
    for i in range(n_scenes):
        clip_path = tmp_path / f"scene_{i}.mp4"
        clip_path.write_bytes(b"MP4")
        clips.append(Clip(scene_index=i, keyframe_path=str(tmp_path / f"kf_{i}.png"),
                           video_path=str(clip_path), duration_sec=5.0))
    return Job(
        id=_JOB_ID, user_id=_USER_ID, niche_id=_NICHE_ID, platform="tiktok",
        status=JobStatus.done, created_at=datetime.now(timezone.utc),
        script=_script(n_scenes), clips=clips,
        audio=AudioTrack(voiceover_path=str(vo)),
        rendered=RenderedVideo(path=str(final), duration_sec=10.0),
    )


# ---------------------------------------------------------------------------
# reroll — happy path
# ---------------------------------------------------------------------------

def test_reroll_scene_202_and_spawns_run_revision(monkeypatch, tmp_path):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _full_job(tmp_path)

    async def _get(job_id, *, user_id):
        return job if (job_id == _JOB_ID and user_id == _USER_ID) else None
    monkeypatch.setattr(jobs_repo, "get", _get)

    revision = Job(
        id=uuid4(), user_id=_USER_ID, niche_id=_NICHE_ID, platform="tiktok",
        status=JobStatus.queued, created_at=datetime.now(timezone.utc),
        revision_of=job.id, revision_mode="reroll",
        revision_scene_index=1, revision_direction="make it darker",
    )
    create_calls: list = []

    async def _create_revision(*, original, mode, scene_index=None, direction=None, voice=None):
        create_calls.append(
            {"original": original.id, "mode": mode, "scene_index": scene_index,
             "direction": direction, "voice": voice}
        )
        return revision
    monkeypatch.setattr(jobs_repo, "create_revision", _create_revision)

    spawned = _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/scenes/1/reroll",
        json={"direction": "make it darker"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["id"] == str(revision.id)
    assert body["revision_mode"] == "reroll"

    # create_revision was called with the right mode/scene/direction.
    assert create_calls == [
        {"original": job.id, "mode": "reroll", "scene_index": 1,
         "direction": "make it darker", "voice": None}
    ]
    # run_revision was spawned with (user_id, original_job_id, revision_job_id).
    assert spawned == [(_USER_ID, str(_JOB_ID), str(revision.id))]


def test_reroll_scene_index_out_of_range_422(monkeypatch, tmp_path):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _full_job(tmp_path, n_scenes=2)

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/scenes/99/reroll",
        json={"direction": "darker"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_reroll_missing_script_409(monkeypatch, tmp_path):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _full_job(tmp_path)
    job.script = None

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/scenes/0/reroll",
        json={"direction": "darker"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 409


def test_reroll_missing_assets_returns_409_with_clear_detail(monkeypatch, tmp_path):
    """The rendered file, voiceover, or a clip missing on disk (retention
    GC already reclaimed it) must 409 with a message pointing at retry —
    never enqueue a revision that's doomed to fail partway through."""
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _full_job(tmp_path)
    # Simulate GC: the final render file no longer exists on the volume.
    import os
    os.remove(job.rendered.path)

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    create_calls: list = []

    async def _create_revision(**kwargs):
        create_calls.append(kwargs)
        raise AssertionError("must not enqueue a revision when assets are missing")
    monkeypatch.setattr(jobs_repo, "create_revision", _create_revision)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/scenes/0/reroll",
        json={"direction": "darker"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 409
    assert "retry" in resp.json()["detail"]
    assert create_calls == []


def test_reroll_job_not_found_404(monkeypatch):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    async def _get(job_id, *, user_id):
        return None
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/scenes/0/reroll",
        json={"direction": "darker"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# revoice
# ---------------------------------------------------------------------------

def test_revoice_202_and_spawns_run_revision(monkeypatch, tmp_path):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo

    job = _full_job(tmp_path)

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    revision = Job(
        id=uuid4(), user_id=_USER_ID, niche_id=_NICHE_ID, platform="tiktok",
        status=JobStatus.queued, created_at=datetime.now(timezone.utc),
        revision_of=job.id, revision_mode="revoice", revision_voice="nova",
    )
    create_calls: list = []

    async def _create_revision(*, original, mode, scene_index=None, direction=None, voice=None):
        create_calls.append({"mode": mode, "voice": voice})
        return revision
    monkeypatch.setattr(jobs_repo, "create_revision", _create_revision)

    spawned = _stub_modal(monkeypatch)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/revoice",
        json={"voice": "nova"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 202
    assert resp.json()["revision_mode"] == "revoice"
    assert create_calls == [{"mode": "revoice", "voice": "nova"}]
    assert spawned == [(_USER_ID, str(_JOB_ID), str(revision.id))]


def test_revoice_missing_assets_409(monkeypatch, tmp_path):
    _reset_limiter()
    import marketer.repos.jobs as jobs_repo
    import os

    job = _full_job(tmp_path)
    os.remove(job.audio.voiceover_path)

    async def _get(job_id, *, user_id):
        return job
    monkeypatch.setattr(jobs_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/revoice",
        json={"voice": "nova"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 409


def test_revoice_empty_voice_rejected_422(monkeypatch, tmp_path):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/revoice",
        json={"voice": ""},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_reroll_without_auth_returns_401(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post(
        f"/api/v1/jobs/{_JOB_ID}/scenes/0/reroll", json={"direction": "darker"}
    )
    assert resp.status_code == 401
