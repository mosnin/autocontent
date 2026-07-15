"""Tests for the performance context builder.

All external dependencies (post_metrics repo, jobs repo) are monkeypatched.
No DB, no network.
"""
from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from marketer.agents.performance_context import build_performance_context
from marketer.models import Idea, Job, JobStatus, Script, Scene


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NICHE_ID = UUID("00000000-0000-0000-0000-000000000aaa")
USER_ID = "user_perf_test"


def _make_job(job_id: UUID, hook: str, topic: str) -> Job:
    idea = Idea(
        topic=topic,
        angle="some angle",
        hook=hook,
        target_audience="curious adults",
        why_it_works="curiosity gap",
    )
    script = Script(
        idea=idea,
        scenes=[
            Scene(
                index=0,
                narration="hello",
                visual_prompt="vp",
                motion_prompt="mp",
                duration_sec=5,
            )
        ],
        total_duration_sec=5,
    )
    return Job(
        id=job_id,
        user_id=USER_ID,
        niche_id=NICHE_ID,
        platform="tiktok",
        status=JobStatus.done,
        script=script,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_renders_top_and_bottom_sections(monkeypatch):
    top_id = uuid4()
    bottom_id = uuid4()

    async def fake_top(niche_id, *, user_id, limit, days):
        return [(top_id, 23_400)]

    async def fake_bottom(niche_id, *, user_id, limit, days):
        return [(bottom_id, 800)]

    async def fake_jobs_get(job_id, *, user_id):
        if job_id == top_id:
            return _make_job(top_id, "The hidden cost of compound interest", "compound interest")
        if job_id == bottom_id:
            return _make_job(bottom_id, "Inflation basics 101", "inflation basics")
        return None

    import marketer.repos.post_metrics as _pm
    import marketer.repos.jobs as _jobs

    monkeypatch.setattr(_pm, "top_performers_for_niche", fake_top)
    monkeypatch.setattr(_pm, "bottom_performers_for_niche", fake_bottom)
    monkeypatch.setattr(_jobs, "get", fake_jobs_get)

    result = await build_performance_context(niche_id=NICHE_ID, user_id=USER_ID)

    assert "## What's working" in result
    assert "## What's flopped" in result
    assert "The hidden cost of compound interest" in result
    assert "compound interest" in result
    assert "23,400" in result
    assert "Inflation basics 101" in result
    assert "inflation basics" in result
    assert "800" in result


@pytest.mark.asyncio
async def test_cold_start_returns_empty_string(monkeypatch):
    async def fake_top(niche_id, *, user_id, limit, days):
        return []

    async def fake_bottom(niche_id, *, user_id, limit, days):
        return []

    import marketer.repos.post_metrics as _pm

    monkeypatch.setattr(_pm, "top_performers_for_niche", fake_top)
    monkeypatch.setattr(_pm, "bottom_performers_for_niche", fake_bottom)

    result = await build_performance_context(niche_id=NICHE_ID, user_id=USER_ID)

    assert result == ""


@pytest.mark.asyncio
async def test_missing_job_is_skipped_not_crashed(monkeypatch):
    """If jobs_repo.get returns None for a job_id, skip it silently."""
    ghost_id = uuid4()
    real_id = uuid4()

    async def fake_top(niche_id, *, user_id, limit, days):
        return [(ghost_id, 50_000), (real_id, 10_000)]

    async def fake_bottom(niche_id, *, user_id, limit, days):
        return []

    async def fake_jobs_get(job_id, *, user_id):
        if job_id == real_id:
            return _make_job(real_id, "You're saving wrong", "savings psychology")
        return None  # ghost_id → not found

    import marketer.repos.post_metrics as _pm
    import marketer.repos.jobs as _jobs

    monkeypatch.setattr(_pm, "top_performers_for_niche", fake_top)
    monkeypatch.setattr(_pm, "bottom_performers_for_niche", fake_bottom)
    monkeypatch.setattr(_jobs, "get", fake_jobs_get)

    result = await build_performance_context(niche_id=NICHE_ID, user_id=USER_ID)

    # ghost_id silently dropped; real job still appears
    assert "You're saving wrong" in result
    assert "savings psychology" in result
    assert "10,000" in result


@pytest.mark.asyncio
async def test_job_without_script_is_skipped(monkeypatch):
    """A job that failed before scripting has script=None; skip it."""
    no_script_id = uuid4()

    async def fake_top(niche_id, *, user_id, limit, days):
        return [(no_script_id, 99_999)]

    async def fake_bottom(niche_id, *, user_id, limit, days):
        return []

    async def fake_jobs_get(job_id, *, user_id):
        # Job exists but has no script (failed at ideation stage).
        return Job(
            id=job_id,
            user_id=USER_ID,
            niche_id=NICHE_ID,
            platform="tiktok",
            status=JobStatus.failed,
            script=None,
        )

    import marketer.repos.post_metrics as _pm
    import marketer.repos.jobs as _jobs

    monkeypatch.setattr(_pm, "top_performers_for_niche", fake_top)
    monkeypatch.setattr(_pm, "bottom_performers_for_niche", fake_bottom)
    monkeypatch.setattr(_jobs, "get", fake_jobs_get)

    result = await build_performance_context(niche_id=NICHE_ID, user_id=USER_ID)

    # No data after filtering → empty string
    assert result == ""


@pytest.mark.asyncio
async def test_section_ordering_and_numbering(monkeypatch):
    """Top section comes before bottom section; items are 1-indexed."""
    ids = [uuid4(), uuid4()]

    async def fake_top(niche_id, *, user_id, limit, days):
        return [(ids[0], 5_000), (ids[1], 3_000)]

    async def fake_bottom(niche_id, *, user_id, limit, days):
        return []

    async def fake_jobs_get(job_id, *, user_id):
        idx = ids.index(job_id)
        return _make_job(job_id, f"hook {idx}", f"topic {idx}")

    import marketer.repos.post_metrics as _pm
    import marketer.repos.jobs as _jobs

    monkeypatch.setattr(_pm, "top_performers_for_niche", fake_top)
    monkeypatch.setattr(_pm, "bottom_performers_for_niche", fake_bottom)
    monkeypatch.setattr(_jobs, "get", fake_jobs_get)

    result = await build_performance_context(niche_id=NICHE_ID, user_id=USER_ID)

    lines = result.splitlines()
    section_line = next(line for line in lines if "What's working" in line)
    item1 = next(line for line in lines if line.startswith("1."))
    item2 = next(line for line in lines if line.startswith("2."))

    assert lines.index(section_line) < lines.index(item1)
    assert lines.index(item1) < lines.index(item2)
    assert "hook 0" in item1
    assert "hook 1" in item2
