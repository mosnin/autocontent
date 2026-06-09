"""End-to-end happy-path / failure / spend-cap tests for `pipeline.run_job`.

Every provider, every repo, and the orchestrator's agent stages are
monkeypatched with minimal async stubs — no asyncpg, no httpx, no
external network.

We assert on the captured stage-order list rather than parsing log
lines: cheaper, more direct, and unaffected by the global logging
configuration's handler state.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from autocontent import pipeline
from autocontent.agents.qa import QAReport
from autocontent.models import (
    Idea,
    Job,
    JobStatus,
    Niche,
    PostingWindow,
    Scene,
    Script,
    User,
)
from autocontent.repos.spend import SpendCapExceeded

USER_ID = "user_e2e"
NICHE_ID = UUID("00000000-0000-0000-0000-000000000abc")


def _make_niche(cap_usd: Decimal = Decimal("3.00")) -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="claymation econ",
        description="3-min explainer videos",
        target_audience="curious adults",
        hashtags=["econ"],
        visual_style="claymation, warm palette",
        voice="onyx",
        target_duration_sec=30,
        scene_count=2,
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=cap_usd,
    )


def _make_script() -> Script:
    return Script(
        idea=Idea(
            topic="t", angle="a", hook="hook", target_audience="x", why_it_works="y"
        ),
        scenes=[
            Scene(index=0, narration="hello", visual_prompt="vp0",
                  motion_prompt="mp0", duration_sec=5),
            Scene(index=1, narration="world", visual_prompt="vp1",
                  motion_prompt="mp1", duration_sec=5),
        ],
        total_duration_sec=10,
        cta=None,
    )


@pytest.fixture
def stage_log() -> list[str]:
    return []


@pytest.fixture
def stub_all(monkeypatch, tmp_path: Path, stage_log: list[str]):
    """Monkeypatch every external dependency `pipeline.run_job` reaches."""
    # --- DB layer ----------------------------------------------------------
    niche_holder = {"niche": _make_niche()}

    async def fake_niches_get(niche_id, *, user_id):
        return niche_holder["niche"]
    monkeypatch.setattr(pipeline.niches_repo, "get", fake_niches_get)

    saved: dict[UUID, Job] = {}

    async def fake_create(*, user_id, niche_id, platform):
        job = Job(
            id=uuid4(), user_id=user_id, niche_id=niche_id, platform=platform,
            status=JobStatus.queued,
        )
        saved[job.id] = job
        return job
    monkeypatch.setattr(pipeline.jobs_repo, "create", fake_create)

    async def fake_save_snapshot(job):
        saved[job.id] = job.model_copy(deep=True)
        # Record status transitions for the order assertion.
        stage_log.append(job.status.value)
    monkeypatch.setattr(pipeline.jobs_repo, "save_snapshot", fake_save_snapshot)

    async def fake_today_spend(*, user_id, niche_id):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_usd", fake_today_spend)

    async def fake_today_total_spend(*, user_id):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_total_usd", fake_today_total_spend)

    async def fake_assert_within_cap(*, user_id, niche_id, cap_usd):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap", fake_assert_within_cap)

    # Stub users_repo.get so default_context and _ensure_cap don't hit DB.
    import autocontent.repos.users as _users_repo
    from datetime import datetime, timezone

    async def fake_users_get(user_id: str):
        return User(
            id=user_id,
            email="test@test.com",
            global_daily_cap_usd=None,
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(_users_repo, "get", fake_users_get)

    # The default SpendContext.record calls spend_repo.record which needs
    # a DB pool — stub it out to a no-op so providers can log freely.
    async def fake_record(entry):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "record", fake_record)

    # --- Storage layout ----------------------------------------------------
    def fake_ensure_layout(job_path):
        root = tmp_path / job_path
        for sub in ("keyframes", "clips", "audio", "captions", "output"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        return root
    monkeypatch.setattr(pipeline, "ensure_layout", fake_ensure_layout)

    # --- Agents ------------------------------------------------------------
    async def fake_build_performance_context(*, niche_id, user_id, lookback_days=30):
        return ""
    monkeypatch.setattr(pipeline, "build_performance_context", fake_build_performance_context)

    async def fake_ideation(title, *, performance_context=""):
        return Idea(topic="t", angle="a", hook="hook",
                    target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    async def fake_scriptwriter(idea, *, scene_count, target_duration_sec):
        return _make_script()
    monkeypatch.setattr(pipeline, "run_scriptwriter", fake_scriptwriter)

    async def fake_visual_director(script, *, visual_style):
        return script
    monkeypatch.setattr(pipeline, "run_visual_director", fake_visual_director)

    async def fake_qa(script, transcript, dur, *, niche):
        return QAReport(passed=True, issues=[], suggested_action="publish")
    monkeypatch.setattr(pipeline, "run_qa", fake_qa)

    # --- Providers ---------------------------------------------------------
    async def fake_get_or_create(niche, *, quality, spend):
        ref = tmp_path / "character_sheets" / f"{niche.id}.png"
        ref.parent.mkdir(parents=True, exist_ok=True)
        ref.write_bytes(b"PNG")
        return ref
    monkeypatch.setattr(pipeline.character_sheet, "get_or_create", fake_get_or_create)

    async def fake_generate_keyframe(prompt, out_path, *, quality,
                                     reference_image_path=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"PNG")
        if spend is not None:
            await spend.log(provider="openai", sku="gpt-image-1",
                            units=Decimal(1), cost_usd=Decimal("0.04"))
        return out_path
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe",
                        fake_generate_keyframe)

    async def fake_animate(keyframe, motion_prompt, out_path, *, duration_sec,
                           resolution, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        if spend is not None:
            await spend.log(provider="xai", sku="grok-imagine-video",
                            units=Decimal(str(duration_sec)),
                            cost_usd=Decimal("0.25"))
        return out_path
    monkeypatch.setattr(pipeline.grok_imagine, "animate", fake_animate)

    async def fake_synthesize(text, out_path, *, voice, style_directions=None,
                              spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        if spend is not None:
            await spend.log(provider="openai", sku="gpt-4o-mini-tts",
                            units=Decimal("10"), cost_usd=Decimal("0.15"))
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_synthesize)

    async def fake_transcribe(audio_path, *, spend=None):
        if spend is not None:
            await spend.log(provider="openai", sku="whisper-1",
                            units=Decimal("10"), cost_usd=Decimal("0.06"))
        return [{"word": "hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level",
                        fake_transcribe)

    # Local music library so music.pick_track finds a track.
    music_lib = tmp_path / "assets" / "music"
    music_lib.mkdir(parents=True, exist_ok=True)
    (music_lib / "track.mp3").write_bytes(b"\x00")
    monkeypatch.setattr(pipeline.settings, "assets_dir", str(tmp_path / "assets"))

    # ffmpeg + subtitle are non-async — patch with no-op functions that
    # write a sentinel file so subsequent steps reading the path work.
    def fake_concat(clips, out_path, aspect=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "concat_clips", fake_concat)

    def fake_mix(video, vo, music_path, out_path, music_gain_db=-18.0):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "mix_audio", fake_mix)

    def fake_burn(video, ass, out_path):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "burn_subtitles", fake_burn)

    def fake_words_to_ass(words, out_path, style="tiktok-bold"):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text("[Script Info]\n")
        return out_path
    monkeypatch.setattr(pipeline.subtitle, "words_to_ass", fake_words_to_ass)

    async def fake_schedule_post(*, video_path, caption, hashtags, platform,
                                 scheduled_for, profile_key, user_id):
        return "post-id-xyz"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)

    return {"saved": saved, "niche_holder": niche_holder}


async def test_happy_path_runs_all_stages(stub_all, stage_log):
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status == JobStatus.done
    assert job.provider_post_id == "post-id-xyz"
    assert job.error is None
    assert job.script is not None
    assert len(job.clips) == 2
    assert job.audio is not None
    assert job.rendered is not None

    # Every expected stage transition should have been persisted in order.
    # `queued` is set by `jobs_repo.create` and not re-saved; the first
    # `save_snapshot` records `ideating`.
    expected_subseq = [
        JobStatus.ideating.value,
        JobStatus.scripting.value,
        JobStatus.generating_images.value,
        JobStatus.animating.value,
        JobStatus.voicing.value,
        JobStatus.editing.value,
        JobStatus.captioning.value,
        JobStatus.qa.value,
        JobStatus.scheduling.value,
        JobStatus.done.value,
    ]
    # Filter consecutive duplicates and assert the resulting sequence matches.
    deduped: list[str] = []
    for s in stage_log:
        if not deduped or deduped[-1] != s:
            deduped.append(s)
    assert deduped == expected_subseq


async def test_scriptwriter_failure_marks_job_failed(monkeypatch, stub_all):
    async def boom(*args, **kwargs):
        raise RuntimeError("scriptwriter exploded")
    monkeypatch.setattr(pipeline, "run_scriptwriter", boom)

    with pytest.raises(RuntimeError, match="scriptwriter exploded"):
        await pipeline.run_job(
            user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        )

    # The job snapshot taken right before the failing call should still
    # have been persisted; check the last saved state.
    saved = stub_all["saved"]
    final_state = next(iter(saved.values()))
    # Last persisted status before exception was `scripting`.
    assert final_state.status == JobStatus.scripting


async def test_spend_cap_overshoot_during_fan_out(monkeypatch, stub_all, stage_log):
    """A tiny cap so the first image spend exceeds it; the parallel
    fan-out should be aborted and the job marked failed."""
    stub_all["niche_holder"]["niche"] = _make_niche(cap_usd=Decimal("0.01"))

    # The pre-stage `_ensure_cap` check would also trip here; bypass it so
    # the test exercises the in-`log` race-safety guarantee specifically.
    async def fake_assert_within_cap(*, user_id, niche_id, cap_usd):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap",
                        fake_assert_within_cap)

    async def fake_today_spend(*, user_id, niche_id):
        # Any spend already pushes us over the $0.01 cap.
        return Decimal("0.04")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_usd", fake_today_spend)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status == JobStatus.failed
    assert job.error is not None
    assert "spend_cap" in job.error


async def test_qa_failure_marks_job_failed(monkeypatch, stub_all):
    async def fake_qa(script, transcript, dur, *, niche):
        return QAReport(
            passed=False, issues=["off-topic", "low energy"],
            suggested_action="regenerate_script",
        )
    monkeypatch.setattr(pipeline, "run_qa", fake_qa)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )
    assert job.status == JobStatus.failed
    assert "off-topic" in (job.error or "")
    assert job.provider_post_id is None


async def test_invalid_platform_raises(stub_all):
    with pytest.raises(ValueError, match="not enabled"):
        await pipeline.run_job(
            user_id=USER_ID, niche_id=NICHE_ID, platform="reels",
        )


async def test_unknown_niche_raises(monkeypatch, stub_all):
    async def none_get(niche_id, *, user_id):
        return None
    monkeypatch.setattr(pipeline.niches_repo, "get", none_get)
    with pytest.raises(ValueError, match="not found"):
        await pipeline.run_job(
            user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        )


# Sanity check: tells future-us that SpendCapExceeded import paths line up.
def test_spend_cap_exceeded_is_subclass_of_exception():
    assert issubclass(SpendCapExceeded, Exception)
