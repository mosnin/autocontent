"""Verify that scene fan-out respects the configured concurrency limit.

Uses 8 fake scenes and limit=3 to confirm max simultaneous
_generate_scene_assets calls never exceeds the semaphore bound.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

from marketer import pipeline
from marketer.agents.qa import QAReport
from marketer.models import (
    Clip,
    Idea,
    Job,
    JobStatus,
    Niche,
    PostingWindow,
    Scene,
    Script,
    User,
)

USER_ID = "user_fanout"
NICHE_ID = UUID("00000000-0000-0000-0000-000000000099")
FANOUT_LIMIT = 3
NUM_SCENES = 8


def _make_niche() -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="fanout test",
        description="test",
        target_audience="test",
        hashtags=[],
        visual_style="flat",
        voice="onyx",
        target_duration_sec=40,
        scene_count=NUM_SCENES,
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("100.00"),
    )


def _make_script() -> Script:
    scenes = [
        Scene(
            index=i,
            narration=f"narration {i}",
            visual_prompt=f"vp{i}",
            motion_prompt=f"mp{i}",
            duration_sec=5,
        )
        for i in range(NUM_SCENES)
    ]
    return Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"),
        scenes=scenes,
        total_duration_sec=NUM_SCENES * 5,
        cta=None,
    )


async def test_fanout_respects_concurrency_limit(monkeypatch, tmp_path: Path, passing_render_qa):
    """Max concurrent _generate_scene_assets calls must not exceed FANOUT_LIMIT."""
    peak = {"concurrent": 0, "max_concurrent": 0}

    # Override settings.scene_fanout_limit for this test.
    monkeypatch.setattr(pipeline.settings, "scene_fanout_limit", FANOUT_LIMIT)

    # Patch the real _generate_scene_assets with a probe that records concurrency.
    async def probed_generate(scene, root, *, niche, reference_image, spend):
        peak["concurrent"] += 1
        if peak["concurrent"] > peak["max_concurrent"]:
            peak["max_concurrent"] = peak["concurrent"]
        # Yield to the event loop so other tasks can acquire the semaphore.
        await asyncio.sleep(0)
        peak["concurrent"] -= 1
        keyframe = root / "keyframes" / f"scene_{scene.index}.png"
        keyframe.parent.mkdir(parents=True, exist_ok=True)
        keyframe.write_bytes(b"PNG")
        clip_path = root / "clips" / f"scene_{scene.index}.mp4"
        clip_path.parent.mkdir(parents=True, exist_ok=True)
        clip_path.write_bytes(b"MP4")
        return Clip(
            scene_index=scene.index,
            keyframe_path=str(keyframe),
            video_path=str(clip_path),
            duration_sec=5.0,
        )

    monkeypatch.setattr(pipeline, "_generate_scene_assets", probed_generate)

    # Stub out all the pipeline dependencies so we only run the fan-out stage.
    async def fake_niches_get(niche_id, *, user_id):
        return _make_niche()
    monkeypatch.setattr(pipeline.niches_repo, "get", fake_niches_get)

    async def fake_create(*, user_id, niche_id, platform):
        return Job(
            id=uuid4(), user_id=user_id, niche_id=niche_id, platform=platform,
            status=JobStatus.queued,
        )
    monkeypatch.setattr(pipeline.jobs_repo, "create", fake_create)

    async def fake_save_snapshot(job):
        pass
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

    async def fake_synthesize(text, out_path, *, voice, style_directions=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_synthesize)

    async def fake_transcribe(audio_path, *, spend=None):
        return [{"word": "hi", "start": 0.0, "end": 0.5}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level", fake_transcribe)

    music_lib = tmp_path / "assets" / "music"
    music_lib.mkdir(parents=True, exist_ok=True)
    (music_lib / "track.mp3").write_bytes(b"\x00")
    monkeypatch.setattr(pipeline.settings, "assets_dir", str(tmp_path / "assets"))

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
        return "post-id-fanout"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status == JobStatus.done
    assert len(job.clips) == NUM_SCENES
    assert peak["max_concurrent"] <= FANOUT_LIMIT, (
        f"Expected max concurrency ≤ {FANOUT_LIMIT}, got {peak['max_concurrent']}"
    )
    # Also confirm we actually did run some tasks concurrently (test validity).
    assert peak["max_concurrent"] > 1 or NUM_SCENES == 1, (
        "Expected some concurrency in the fan-out — check asyncio.sleep probe"
    )
