"""Coverage for the FastAPI job routes.

We don't run the full Modal app in CI, so we exercise the route handlers
directly with a stubbed AuthCtx and a monkeypatched jobs_repo. That's
enough to lock in the 404 contracts on /jobs/{id}/video without standing
up Postgres or the artifacts volume.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from autocontent.models import Job, RenderedVideo


def _make_job(*, user_id: str = "user_abc", rendered: RenderedVideo | None = None) -> Job:
    return Job(
        id=uuid4(),
        user_id=user_id,
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        platform="tiktok",
        created_at=datetime.now(timezone.utc),
        rendered=rendered,
    )


async def test_video_missing_job_404(monkeypatch):
    from backend.auth import AuthCtx
    from backend.routes import jobs as jobs_route
    from autocontent.repos import jobs as jobs_repo

    async def _get(_id, user_id):
        return None

    monkeypatch.setattr(jobs_repo, "get", _get)
    ctx = AuthCtx(user_id="user_abc", email="")

    with pytest.raises(HTTPException) as ei:
        await jobs_route.get_job_video(uuid4(), ctx=ctx)
    assert ei.value.status_code == 404


async def test_video_no_rendered_404(monkeypatch):
    """Job exists but never produced a render."""
    from backend.auth import AuthCtx
    from backend.routes import jobs as jobs_route
    from autocontent.repos import jobs as jobs_repo

    job = _make_job(rendered=None)

    async def _get(_id, user_id):
        return job

    monkeypatch.setattr(jobs_repo, "get", _get)
    ctx = AuthCtx(user_id="user_abc", email="")

    with pytest.raises(HTTPException) as ei:
        await jobs_route.get_job_video(job.id, ctx=ctx)
    assert ei.value.status_code == 404


async def test_video_path_missing_on_disk_404(monkeypatch):
    """Render record claims a path, but the file is gone (volume eviction)."""
    from backend.auth import AuthCtx
    from backend.routes import jobs as jobs_route
    from autocontent.repos import jobs as jobs_repo

    job = _make_job(
        rendered=RenderedVideo(path="/nonexistent/path/render.mp4", duration_sec=42.0),
    )

    async def _get(_id, user_id):
        return job

    monkeypatch.setattr(jobs_repo, "get", _get)
    ctx = AuthCtx(user_id="user_abc", email="")

    with pytest.raises(HTTPException) as ei:
        await jobs_route.get_job_video(job.id, ctx=ctx)
    assert ei.value.status_code == 404
