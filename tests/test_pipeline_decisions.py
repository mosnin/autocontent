"""The video pipeline with decision points 4 and 9 wired in.

Reuses the e2e harness (every provider stubbed). Decisions off is covered by
the whole existing e2e suite; these tests prove the enforce paths: a held
hook stops the job before any visual spend, and a verify bounce fails QA.
"""
from __future__ import annotations

import pytest

from marketer import pipeline
from marketer.agents.qa import QAReport
from marketer.decisions import points
from marketer.models import JobStatus
from tests.test_pipeline_e2e import NICHE_ID, USER_ID, stage_log, stub_all  # noqa: F401


@pytest.fixture
def decisions_on(monkeypatch):
    calls = []

    async def gate(script, **kw):
        calls.append("hook")
        return script, gate.action

    gate.action = "proceed"

    async def verify(**kw):
        calls.append("verify")
        return verify.failures

    verify.failures = None
    monkeypatch.setattr(points, "gate_hook", gate)
    monkeypatch.setattr(points, "verify_video", verify)
    return gate, verify, calls


async def test_held_hook_fails_before_visual_spend(monkeypatch, stub_all, decisions_on):  # noqa: F811
    gate, _, calls = decisions_on
    gate.action = "hold"
    visual = []

    async def no_visual(*a, **k):
        visual.append(1)
        raise AssertionError("visual director must not run after a hold")

    monkeypatch.setattr(pipeline, "run_visual_director", no_visual)
    job = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    assert job.status == JobStatus.failed
    assert job.error.startswith("hook held for review")
    assert visual == [] and calls == ["hook"]


async def test_verify_bounce_fails_content_qa(monkeypatch, stub_all, decisions_on):  # noqa: F811
    _, verify, calls = decisions_on
    verify.failures = ["takeaway_match"]

    async def passing_qa(script, transcript, dur, *, niche, spend=None):
        return QAReport(passed=True, issues=[], suggested_action="publish")

    monkeypatch.setattr(pipeline, "run_qa", passing_qa)
    job = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    assert job.status == JobStatus.failed
    assert "verify failed: takeaway_match" in job.error
    assert job.provider_post_id is None
    assert "verify" in calls
