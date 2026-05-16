"""Coverage for the FastAPI job-detail routes.

Today this only exercises ``GET /api/v1/jobs/{job_id}/video`` — the
streaming endpoint added alongside the dashboard's job-detail page.
We monkeypatch ``jobs_repo.get`` so no asyncpg pool is needed.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.auth import AuthCtx
from backend.routes import jobs as jobs_route


async def test_get_job_video_404_when_no_rendered(monkeypatch):
    """Owned job exists but rendered.path is missing — 404, not 200."""
    job_id = uuid4()

    async def _get(_id, *, user_id):  # noqa: ARG001
        # Minimal Job-shaped stub: the route only inspects `.rendered`.
        class _StubJob:
            rendered = None

        return _StubJob()

    monkeypatch.setattr(jobs_route.jobs_repo, "get", _get)

    ctx = AuthCtx(user_id="user_x", email="")
    with pytest.raises(HTTPException) as ei:
        await jobs_route.get_job_video(job_id, ctx)
    assert ei.value.status_code == 404


async def test_get_job_video_404_when_job_missing(monkeypatch):
    """Job not owned (repo returns None) -> 404."""
    job_id = uuid4()

    async def _get(_id, *, user_id):  # noqa: ARG001
        return None

    monkeypatch.setattr(jobs_route.jobs_repo, "get", _get)

    ctx = AuthCtx(user_id="user_x", email="")
    with pytest.raises(HTTPException) as ei:
        await jobs_route.get_job_video(job_id, ctx)
    assert ei.value.status_code == 404
