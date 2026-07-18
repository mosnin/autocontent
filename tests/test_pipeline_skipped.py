"""Tests for the skipped-job path in pipeline.run_job.

When niche_lock yields False (another job for the same niche is already
running), run_job must:
  - create a job row (so operators / users can see the skip),
  - set status = skipped,
  - persist the snapshot,
  - return the job without doing any provider work.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from decimal import Decimal
from typing import AsyncIterator
from uuid import UUID, uuid4

import pytest

from marketer import pipeline
from marketer.models import Job, JobStatus, Niche, PostingWindow

USER_ID = "user_skip_test"
NICHE_ID = UUID("00000000-0000-0000-0000-000000000077")


def _make_niche() -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="skip test niche",
        description="test",
        target_audience="test",
        hashtags=[],
        visual_style="flat",
        voice="onyx",
        target_duration_sec=30,
        scene_count=2,
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )


@pytest.fixture
def stub_db(monkeypatch):
    """Stub repos so no live DB is required."""
    async def fake_get(niche_id, *, user_id):
        return _make_niche()
    monkeypatch.setattr(pipeline.niches_repo, "get", fake_get)

    saved: dict[UUID, Job] = {}

    async def fake_create(*, user_id, niche_id, platform):
        j = Job(
            id=uuid4(), user_id=user_id, niche_id=niche_id, platform=platform,
            status=JobStatus.queued,
        )
        saved[j.id] = j
        return j
    monkeypatch.setattr(pipeline.jobs_repo, "create", fake_create)

    async def fake_save_snapshot(job):
        saved[job.id] = job.model_copy(deep=True)
    monkeypatch.setattr(pipeline.jobs_repo, "save_snapshot", fake_save_snapshot)

    return saved


@pytest.fixture
def niche_lock_false(monkeypatch):
    """Patch niche_lock to always yield False (niche already running)."""

    @asynccontextmanager
    async def _locked_false(niche_id) -> AsyncIterator[bool]:
        yield False

    monkeypatch.setattr(pipeline, "niche_lock", _locked_false)


async def test_skipped_job_has_correct_status(stub_db, niche_lock_false):
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok"
    )
    assert job.status == JobStatus.skipped


async def test_skipped_job_has_error_message(stub_db, niche_lock_false):
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok"
    )
    assert job.error is not None
    assert "niche" in job.error.lower()


async def test_skipped_job_is_persisted(stub_db, niche_lock_false):
    """The skipped job must be saved to the DB so it's visible in the queue UI."""
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok"
    )
    assert job.id in stub_db
    assert stub_db[job.id].status == JobStatus.skipped


async def test_skipped_job_does_no_provider_work(stub_db, niche_lock_false, monkeypatch):
    """No provider (ideation, images, tts…) should be called on a skipped job."""
    called: list[str] = []

    async def fail_ideation(*a, **kw):
        called.append("ideation")
        raise AssertionError("should not be called")
    monkeypatch.setattr(pipeline, "run_ideation", fail_ideation)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok"
    )
    assert job.status == JobStatus.skipped
    assert called == []


async def test_lock_acquired_job_proceeds(stub_db, monkeypatch, tmp_path, passing_render_qa):
    """When niche_lock yields True the job runs normally (smoke check)."""

    @asynccontextmanager
    async def _locked_true(niche_id) -> AsyncIterator[bool]:
        yield True

    monkeypatch.setattr(pipeline, "niche_lock", _locked_true)

    @asynccontextmanager
    async def _user_noop(user_id, *, max_parallel) -> AsyncIterator[None]:
        yield

    monkeypatch.setattr(pipeline, "user_lock", _user_noop)

    # Minimal stubs so the pipeline body doesn't hit real providers.
    from decimal import Decimal
    from marketer.agents.qa import QAReport
    from marketer.models import (
        Clip, Idea, Script, Scene,
    )

    async def fake_assert_cap(*, user_id, niche_id, cap_usd):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap", fake_assert_cap)

    async def fake_today_spend(*, user_id, niche_id):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_usd", fake_today_spend)

    async def fake_today_total_spend(*, user_id):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_total_usd", fake_today_total_spend)

    async def fake_record(entry):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "record", fake_record)

    # Stub users_repo.get so default_context and _ensure_cap don't hit DB.
    import marketer.repos.users as _users_repo
    from datetime import datetime, timezone
    from marketer.models import User

    async def fake_users_get(user_id: str):
        return User(
            id=user_id,
            email="test@test.com",
            global_daily_cap_usd=None,
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(_users_repo, "get", fake_users_get)

    def fake_layout(path):
        root = tmp_path / path
        for sub in ("keyframes", "clips", "audio", "captions", "output"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        return root
    monkeypatch.setattr(pipeline, "ensure_layout", fake_layout)

    async def fake_build_performance_context(*, niche_id, user_id, lookback_days=30):
        return ""
    monkeypatch.setattr(pipeline, "build_performance_context", fake_build_performance_context)

    async def fake_ideation(title, *, performance_context="", spend=None):
        return Idea(topic="t", angle="a", hook="h",
                    target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    def _script():
        return Script(
            idea=Idea(topic="t", angle="a", hook="h",
                      target_audience="x", why_it_works="y"),
            scenes=[
                Scene(index=0, narration="hi", visual_prompt="vp0",
                      motion_prompt="mp0", duration_sec=5),
            ],
            total_duration_sec=5,
        )

    async def fake_scriptwriter(*a, **kw):
        return _script()
    monkeypatch.setattr(pipeline, "run_scriptwriter", fake_scriptwriter)

    async def fake_vd(script, *, visual_style, spend=None):
        return script
    monkeypatch.setattr(pipeline, "run_visual_director", fake_vd)

    async def fake_qa(script, transcript, dur, *, niche, spend=None):
        return QAReport(passed=True, issues=[], suggested_action="publish")
    monkeypatch.setattr(pipeline, "run_qa", fake_qa)

    async def fake_sheet(niche, *, quality, spend):
        ref = tmp_path / "sheet.png"
        ref.write_bytes(b"PNG")
        return ref
    monkeypatch.setattr(pipeline.character_sheet, "get_or_create", fake_sheet)

    async def fake_keyframe(prompt, out_path, *, quality,
                            reference_image_path=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"PNG")
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe", fake_keyframe)

    async def fake_animate(kf, mp, out, *, duration_sec, resolution, spend=None):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"MP4")
        return Clip(scene_index=0, keyframe_path=str(kf),
                    video_path=str(out), duration_sec=duration_sec)
    monkeypatch.setattr(pipeline.grok_imagine, "animate", fake_animate)

    async def fake_tts(text, out_path, *, voice, style_directions=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_tts)

    async def fake_whisper(audio_path, *, spend=None):
        return [{"word": "hi", "start": 0.0, "end": 0.5}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level", fake_whisper)

    monkeypatch.setattr(pipeline.settings, "assets_dir", str(tmp_path / "assets"))
    music_dir = tmp_path / "assets" / "music"
    music_dir.mkdir(parents=True, exist_ok=True)
    (music_dir / "track.mp3").write_bytes(b"\x00")

    def fake_concat(clips, out, aspect=None):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"MP4")
    monkeypatch.setattr(pipeline.ffmpeg, "concat_clips", fake_concat)

    def fake_mix(video, vo, music, out, music_gain_db=-18.0):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"MP4")
    monkeypatch.setattr(pipeline.ffmpeg, "mix_audio", fake_mix)

    def fake_burn(video, ass, out):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"MP4")
    monkeypatch.setattr(pipeline.ffmpeg, "burn_subtitles", fake_burn)

    def fake_words_to_ass(words, out, style="tiktok-bold"):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("[Script Info]\n")
    monkeypatch.setattr(pipeline.subtitle, "words_to_ass", fake_words_to_ass)

    async def fake_schedule(*, video_path, caption, hashtags, platform,
                            scheduled_for, profile_key, user_id):
        return "post-skip-test"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok"
    )
    assert job.status == JobStatus.done
