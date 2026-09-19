"""Approval mode: niches with approve_before_post park rendered jobs in
awaiting_approval, and the approve/reject endpoints drive the resume."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus, Niche, PostingWindow
from backend.auth import AuthCtx, require_user
from backend.main import create_app
from backend.rate_limit import limiter


def _niche(user_id: str = "user_a", *, approve: bool = True) -> Niche:
    return Niche(
        id=uuid4(),
        user_id=user_id,
        title="test niche",
        description="d",
        target_audience="t",
        visual_style="v",
        voice="onyx",
        target_duration_sec=60,
        scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        approve_before_post=approve,
    )


def _job(user_id: str = "user_a", status: JobStatus = JobStatus.awaiting_approval) -> Job:
    return Job(
        id=uuid4(),
        user_id=user_id,
        niche_id=uuid4(),
        platform="tiktok",
        status=status,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


@pytest.fixture()
def client(monkeypatch):
    limiter.reset()
    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    return TestClient(app)


def test_niche_schema_carries_approval_flag():
    assert _niche(approve=True).approve_before_post is True
    assert _niche(approve=False).approve_before_post is False
    # Default stays False so existing niches keep autonomous behavior.
    n = _niche()
    payload = n.model_dump()
    payload.pop("approve_before_post")
    assert Niche(**payload).approve_before_post is False


def test_awaiting_approval_is_a_job_status():
    assert JobStatus.awaiting_approval.value == "awaiting_approval"


def test_approve_spawns_finish_scheduling(client, monkeypatch):
    import sys
    import types

    job = _job()

    async def fake_claim(job_id, *, user_id):
        assert user_id == "user_a"
        return job

    from marketer.repos import jobs as jobs_repo
    monkeypatch.setattr(jobs_repo, "claim_for_scheduling", fake_claim)

    spawned: list[tuple] = []

    class _FakeFn:
        def spawn(self, *a):
            spawned.append(a)

    fake_modal = types.SimpleNamespace(
        Function=types.SimpleNamespace(from_name=lambda app, name: _FakeFn())
    )
    monkeypatch.setitem(sys.modules, "modal", fake_modal)

    resp = client.post(
        f"/api/v1/jobs/{job.id}/approve",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 202
    assert spawned == [("user_a", str(job.id), str(job.niche_id))]


def test_approve_conflicts_when_not_awaiting(client, monkeypatch):
    job = _job(status=JobStatus.done)

    async def fake_claim(job_id, *, user_id):
        return None  # not awaiting_approval → claim loses

    async def fake_get(job_id, *, user_id):
        return job

    from marketer.repos import jobs as jobs_repo
    monkeypatch.setattr(jobs_repo, "claim_for_scheduling", fake_claim)
    monkeypatch.setattr(jobs_repo, "get", fake_get)

    resp = client.post(
        f"/api/v1/jobs/{job.id}/approve",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_reject_marks_failed_without_posting(client, monkeypatch):
    # reject is now an atomic claim (claim_for_rejection); the concurrency
    # guarantee itself is covered in tests/integration/test_pg_reset_retry.py.
    job = _job()
    claimed: list = []

    async def fake_claim(job_id, *, user_id):
        claimed.append((job_id, user_id))
        j = job.model_copy(deep=True)
        j.status = JobStatus.failed
        j.error = "rejected by operator before posting"
        return j

    from marketer.repos import jobs as jobs_repo
    monkeypatch.setattr(jobs_repo, "claim_for_rejection", fake_claim)

    resp = client.post(
        f"/api/v1/jobs/{job.id}/reject",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert claimed and resp.json()["status"] == JobStatus.failed.value
    assert "rejected" in (resp.json().get("error") or "")


async def test_schedule_approved_job_rejects_wrong_status(monkeypatch):
    from marketer import pipeline

    job = _job(status=JobStatus.done)

    async def fake_get(job_id, *, user_id):
        return job

    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)

    with pytest.raises(ValueError, match="not awaiting_approval"):
        await pipeline.schedule_approved_job(user_id="user_a", job_id=job.id)


async def test_schedule_approved_job_mismatch_niche_fail_closes(monkeypatch):
    from uuid import uuid4

    from marketer import pipeline

    job = _job(status=JobStatus.scheduling)
    other = uuid4()

    async def fake_get(job_id, *, user_id):
        return job

    async def fake_niche(niche_id, *, user_id):
        return _niche()

    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)
    monkeypatch.setattr(pipeline.niches_repo, "get", fake_niche)

    with pytest.raises(ValueError, match="niche mismatch"):
        await pipeline.schedule_approved_job(
            user_id="user_a", job_id=job.id, niche_id=other
        )


async def test_schedule_stage_gathers_persist_and_user(monkeypatch, tmp_path):
    """Persist(scheduling) and users.get used to be sequential."""
    import asyncio

    from marketer import pipeline
    from marketer.jev.loops import LoopVerdict
    from marketer.models import Idea, RenderedVideo, Scene, Script, User

    video = tmp_path / "out.mp4"
    video.write_bytes(b"mp4")

    job = _job(status=JobStatus.awaiting_approval)
    job.script = Script(
        idea=Idea(
            topic="t", angle="a", hook="hook", target_audience="x", why_it_works="y"
        ),
        scenes=[
            Scene(
                index=0,
                narration="n",
                visual_prompt="v",
                motion_prompt="m",
                duration_sec=5,
            )
        ],
        total_duration_sec=5,
    )
    job.rendered = RenderedVideo(path=str(video), duration_sec=5)
    niche = _niche(approve=False)

    started = 0
    max_inflight = 0
    inflight = 0
    release = asyncio.Event()
    posted: dict[str, str | None] = {}

    async def slow_persist(j):
        nonlocal started, max_inflight, inflight
        if j.status != JobStatus.scheduling:
            return
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        n = started
        if n < 2:
            await release.wait()
        else:
            release.set()
        inflight -= 1

    async def slow_user(user_id):
        nonlocal started, max_inflight, inflight
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        n = started
        if n < 2:
            await release.wait()
        else:
            release.set()
        inflight -= 1
        return User(id=user_id, email="a@a", ayrshare_profile_key="pk-video")

    async def fake_gate(*_a, **_k):
        return LoopVerdict()

    async def fake_schedule_post(
        *,
        video_path,
        caption,
        hashtags,
        platform,
        scheduled_for,
        profile_key,
        user_id,
    ):
        posted["profile_key"] = profile_key
        return "post-1"

    async def fake_signal(*_a, **_k):
        return None

    monkeypatch.setattr(pipeline, "_persist", slow_persist)
    monkeypatch.setattr(pipeline.users_repo, "get", slow_user)
    monkeypatch.setattr("marketer.jev.loops.publish_gate", fake_gate)
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)
    monkeypatch.setattr(pipeline, "_signal_terminal", fake_signal)

    out = await pipeline._schedule_stage(job, niche, human_approved=True)
    assert out.status == JobStatus.done
    assert started == 2
    assert max_inflight == 2
    assert posted["profile_key"] == "pk-video"
