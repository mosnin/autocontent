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

    async def fake_get(job_id, *, user_id):
        assert user_id == "user_a"
        return job

    from marketer.repos import jobs as jobs_repo
    monkeypatch.setattr(jobs_repo, "get", fake_get)

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
    assert spawned == [("user_a", str(job.id))]


def test_approve_conflicts_when_not_awaiting(client, monkeypatch):
    job = _job(status=JobStatus.done)

    async def fake_get(job_id, *, user_id):
        return job

    from marketer.repos import jobs as jobs_repo
    monkeypatch.setattr(jobs_repo, "get", fake_get)

    resp = client.post(
        f"/api/v1/jobs/{job.id}/approve",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_reject_marks_failed_without_posting(client, monkeypatch):
    job = _job()
    saved: list[Job] = []

    async def fake_get(job_id, *, user_id):
        return job

    async def fake_save(j):
        saved.append(j)

    from marketer.repos import jobs as jobs_repo
    monkeypatch.setattr(jobs_repo, "get", fake_get)
    monkeypatch.setattr(jobs_repo, "save_snapshot", fake_save)

    resp = client.post(
        f"/api/v1/jobs/{job.id}/reject",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert saved and saved[0].status == JobStatus.failed
    assert "rejected" in (saved[0].error or "")


async def test_schedule_approved_job_rejects_wrong_status(monkeypatch):
    from marketer import pipeline

    job = _job(status=JobStatus.done)

    async def fake_get(job_id, *, user_id):
        return job

    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)

    with pytest.raises(ValueError, match="not awaiting_approval"):
        await pipeline.schedule_approved_job(user_id="user_a", job_id=job.id)
