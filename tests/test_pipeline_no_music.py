"""Pipeline end-to-end test: pick_track returns None (no music).

Verifies that the pipeline finishes in `done` status and produces the
final mp4 even when no background music is available.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from marketer import pipeline
from marketer.agents.qa import QAReport
from marketer.models import (
    Idea,
    Job,
    JobStatus,
    Niche,
    PostingWindow,
    Scene,
    Script,
    User,
)

USER_ID = "user_no_music"
NICHE_ID = UUID("00000000-0000-0000-0000-000000000099")


def _make_niche() -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="silent econ",
        description="videos without music",
        target_audience="quiet adults",
        hashtags=["econ"],
        visual_style="minimal",
        voice="nova",
        target_duration_sec=30,
        scene_count=2,
        posting_windows=[PostingWindow(hour=10, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )


def _make_script() -> Script:
    return Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"),
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
def stub_no_music(monkeypatch, tmp_path: Path):
    """Full pipeline stub with music.pick_track returning None."""
    async def fake_niches_get(niche_id, *, user_id):
        return _make_niche()
    monkeypatch.setattr(pipeline.niches_repo, "get", fake_niches_get)

    saved: dict[UUID, Job] = {}

    async def fake_create(*, user_id, niche_id, platform):
        job = Job(id=uuid4(), user_id=user_id, niche_id=niche_id,
                  platform=platform, status=JobStatus.queued)
        saved[job.id] = job
        return job
    monkeypatch.setattr(pipeline.jobs_repo, "create", fake_create)

    async def fake_save_snapshot(job):
        saved[job.id] = job.model_copy(deep=True)
    monkeypatch.setattr(pipeline.jobs_repo, "save_snapshot", fake_save_snapshot)

    async def fake_assert_within_cap(*, user_id, niche_id, cap_usd):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap", fake_assert_within_cap)

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

    async def fake_users_get(user_id: str):
        return User(
            id=user_id,
            email="test@test.com",
            global_daily_cap_usd=None,
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(_users_repo, "get", fake_users_get)

    def fake_ensure_layout(job_path):
        root = tmp_path / job_path
        for sub in ("keyframes", "clips", "audio", "captions", "output"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        return root
    monkeypatch.setattr(pipeline, "ensure_layout", fake_ensure_layout)

    async def fake_build_performance_context(*, niche_id, user_id, lookback_days=30):
        return ""
    monkeypatch.setattr(pipeline, "build_performance_context", fake_build_performance_context)

    async def fake_ideation(title, *, performance_context="", spend=None):
        return Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    async def fake_scriptwriter(idea, *, scene_count, target_duration_sec, spend=None):
        return _make_script()
    monkeypatch.setattr(pipeline, "run_scriptwriter", fake_scriptwriter)

    async def fake_visual_director(script, *, visual_style, spend=None):
        return script
    monkeypatch.setattr(pipeline, "run_visual_director", fake_visual_director)

    async def fake_qa(script, transcript, dur, *, niche, spend=None):
        return QAReport(passed=True, issues=[], suggested_action="publish")
    monkeypatch.setattr(pipeline, "run_qa", fake_qa)

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
        return out_path
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe", fake_generate_keyframe)

    async def fake_animate(keyframe, motion_prompt, out_path, *, duration_sec,
                           resolution, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.grok_imagine, "animate", fake_animate)

    async def fake_synthesize(text, out_path, *, voice, style_directions=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_synthesize)

    async def fake_transcribe(audio_path, *, spend=None):
        return [{"word": "hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level", fake_transcribe)

    # KEY: music.pick_track returns None.
    async def fake_pick_track(**kwargs):
        return None
    monkeypatch.setattr(pipeline.music, "pick_track", fake_pick_track)

    # Provide empty assets_dir (no music files) to ensure the real pick_track
    # would also return None without the monkeypatch.
    monkeypatch.setattr(pipeline.settings, "assets_dir", str(tmp_path / "assets"))

    def fake_concat(clips, out_path, aspect=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "concat_clips", fake_concat)

    # mix_audio receives music_path=None — ensure the stub handles it.
    def fake_mix(video, vo, music_path, out_path, music_gain_db=-18.0):
        # music_path may be None; that's the point of this test.
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
        return "post-id-no-music"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)

    return {"saved": saved}


async def test_pipeline_with_no_music_ends_done(stub_no_music):
    """Pipeline completes successfully even when pick_track returns None."""
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status == JobStatus.done, f"expected done, got {job.status}: {job.error}"
    assert job.error is None


async def test_pipeline_with_no_music_renders_final_mp4(stub_no_music):
    """The final rendered video path is set even with no music."""
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.rendered is not None
    assert job.rendered.path.endswith("final.mp4")


async def test_pipeline_with_no_music_audio_track_has_none_music_path(stub_no_music):
    """When music is unavailable, job.audio.music_path is None."""
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.audio is not None
    assert job.audio.music_path is None


async def test_pipeline_with_no_music_not_failed(stub_no_music):
    """Absence of music is NOT a pipeline failure — job ends in done."""
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status != JobStatus.failed
    assert job.provider_post_id == "post-id-no-music"
