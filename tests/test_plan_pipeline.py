"""Plan-first flow tests at the `pipeline.run_plan` / `render_from_plan`
level — the storyboard review stage before any render spend.

Reuses `tests/test_pipeline_e2e.py`'s `stub_all` fixture (and its
niche/script builders) rather than re-stubbing every provider: `run_plan`
and `render_from_plan` share `_run_ideation_and_script` /
`_run_render_stages` with `run_job`, so the exact same fakes apply.
"""
from __future__ import annotations

from uuid import UUID

from marketer import pipeline
from marketer.models import JobStatus

from tests.test_pipeline_e2e import (  # noqa: F401  (fixture reuse)
    NICHE_ID,
    USER_ID,
    _make_niche,
    _make_script,
    stage_log,
    stub_all,
)


async def test_plan_only_stops_at_planned_with_only_plan_stage_spend(stub_all, stage_log):  # noqa: F811
    """A plan-only run must go ideation -> scripting -> planned and never
    touch image/video/TTS generation, assembly, QA, or scheduling."""
    job = await pipeline.run_plan(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    assert job.status == JobStatus.planned
    assert job.error is None
    assert job.script is not None
    assert len(job.script.scenes) == 2
    # Nothing past scripting ran.
    assert job.clips == []
    assert job.audio is None
    assert job.rendered is None
    assert job.provider_post_id is None

    deduped: list[str] = []
    for s in stage_log:
        if not deduped or deduped[-1] != s:
            deduped.append(s)
    assert deduped == [
        JobStatus.ideating.value,
        JobStatus.scripting.value,
        JobStatus.planned.value,
    ]


async def test_plan_only_niche_lock_contention_skips(monkeypatch, stub_all):  # noqa: F811
    """Same "another container already has this niche" semantics as the
    full pipeline: skipped, not failed, no provider touched."""
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_niche_lock(niche_id):
        yield False

    monkeypatch.setattr(pipeline, "niche_lock", fake_niche_lock)

    job = await pipeline.run_plan(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    assert job.status == JobStatus.skipped
    assert job.script is None


async def test_plan_scriptwriter_failure_marks_job_failed(monkeypatch, stub_all):  # noqa: F811
    async def boom(*args, **kwargs):
        raise RuntimeError("scriptwriter exploded")
    monkeypatch.setattr(pipeline, "run_scriptwriter", boom)

    job = await pipeline.run_plan(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    assert job.status == JobStatus.failed
    assert "scriptwriter exploded" in (job.error or "")


async def test_render_from_plan_uses_edited_prompts(stub_all, monkeypatch):  # noqa: F811
    """After a storyboard edit, rendering must use the EDITED
    visual_prompt/narration — not whatever ideation/scriptwriting first
    produced. Asserted by spying on the (fake) image generator's prompt
    argument."""
    keyframe_calls: list[str] = []

    async def spy_generate_keyframe(prompt, out_path, *, quality,
                                     reference_image_path=None, spend=None):
        keyframe_calls.append(prompt)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"PNG")
        return out_path
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe", spy_generate_keyframe)

    plan_job = await pipeline.run_plan(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    assert plan_job.status == JobStatus.planned
    assert keyframe_calls == []  # plan stage never touches image generation

    edited_scenes = [
        s.model_copy(update={"visual_prompt": f"EDITED-PROMPT-{s.index}"})
        for s in plan_job.script.scenes
    ]
    plan_job.script = plan_job.script.model_copy(update={"scenes": edited_scenes})
    await pipeline.jobs_repo.save_snapshot(plan_job)

    rendered_job = await pipeline.render_from_plan(user_id=USER_ID, job_id=plan_job.id)

    assert rendered_job.status == JobStatus.done
    assert sorted(keyframe_calls) == ["EDITED-PROMPT-0", "EDITED-PROMPT-1"]
    # The original (pre-edit) prompts were never sent to the generator.
    assert "vp0" not in keyframe_calls
    assert "vp1" not in keyframe_calls


async def test_render_from_plan_meters_only_render_stages(stub_all, stage_log):  # noqa: F811
    """Resuming from `planned` must go straight into the render stages —
    ideation/scripting must not re-run (no double LLM spend)."""
    plan_job = await pipeline.run_plan(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    stage_log.clear()

    rendered_job = await pipeline.render_from_plan(user_id=USER_ID, job_id=plan_job.id)
    assert rendered_job.status == JobStatus.done

    deduped: list[str] = []
    for s in stage_log:
        if not deduped or deduped[-1] != s:
            deduped.append(s)
    assert JobStatus.ideating.value not in deduped
    assert JobStatus.scripting.value not in deduped
    assert deduped == [
        JobStatus.generating_images.value,
        JobStatus.animating.value,
        JobStatus.voicing.value,
        JobStatus.editing.value,
        JobStatus.captioning.value,
        JobStatus.qa.value,
        JobStatus.scheduling.value,
        JobStatus.done.value,
    ]


async def test_render_from_plan_rejects_non_planned_job(stub_all):  # noqa: F811
    plan_job = await pipeline.run_plan(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    plan_job.status = JobStatus.done
    await pipeline.jobs_repo.save_snapshot(plan_job)

    try:
        await pipeline.render_from_plan(user_id=USER_ID, job_id=plan_job.id)
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "not planned" in str(e)


async def test_render_from_plan_missing_job_raises(stub_all):  # noqa: F811
    try:
        await pipeline.render_from_plan(user_id=USER_ID, job_id=UUID(int=0))
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "not found" in str(e)
