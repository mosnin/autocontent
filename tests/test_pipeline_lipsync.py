"""Pipeline end-to-end: lip-synced UGC mode (fal avatar model).

The avatar path inverts the audio flow: narration is synthesized
per-scene FIRST and drives the avatar render (clips carry their own
voiceover), the assembled video keeps that audio, the standalone
voiceover.wav is extracted from it for captions/QA, and music is ducked
under the existing track instead of muxed with a separate VO.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from marketer import pipeline
from marketer.agents.qa import QAReport
from marketer.config import settings
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

USER_ID = "user_lipsync"
NICHE_ID = UUID("00000000-0000-0000-0000-000000000077")
AVATAR_MODEL = "fal-ai/bytedance/omnihuman"


def _make_niche() -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="talking founder",
        description="spokesperson clips",
        target_audience="startup people",
        hashtags=["saas"],
        visual_style="bright studio",
        voice="nova",
        target_duration_sec=20,
        scene_count=2,
        posting_windows=[PostingWindow(hour=10, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        video_provider="fal",
        fal_model=AVATAR_MODEL,
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
def stub_lipsync(monkeypatch, tmp_path: Path, passing_render_qa):
    """Full pipeline stub for the avatar branch. Records what ran."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    calls: dict = {"tts": [], "avatar": [], "extract": 0, "mix_music": 0,
                   "mix_audio": 0, "concat_keep_audio": None}

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

    async def fake_ideation(title, *, performance_context="", niche_description="", target_audience="", platform="", brand_voice="", banned_words=None, recent_topics=None, brief=None, spend=None):
        return Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    async def fake_scriptwriter(idea, *, scene_count, target_duration_sec, audience_context="", brief=None, script_model="", spend=None):
        return _make_script()
    monkeypatch.setattr(pipeline, "run_scriptwriter", fake_scriptwriter)

    async def fake_visual_director(script, *, visual_style, character_description="", brief=None, design_kit="", spend=None):
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

    # Per-scene VO synth (avatar mode calls this once per scene).
    async def fake_synthesize(text, out_path, *, voice, style_directions=None, spend=None):
        calls["tts"].append(text)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_synthesize)

    # The avatar renderer (lazily imported in the pipeline — patch the module).
    from marketer.services import fal_video

    async def fake_animate_avatar(keyframe, audio_path, out_path, *, model_id, spend=None):
        assert model_id == AVATAR_MODEL
        assert Path(audio_path).exists()
        calls["avatar"].append(str(audio_path))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4A")
        return out_path
    monkeypatch.setattr(fal_video, "animate_avatar", fake_animate_avatar)

    async def must_not_animate(*a, **k):
        raise AssertionError("plain animate() must not run in avatar mode")
    monkeypatch.setattr(fal_video, "animate", must_not_animate)

    monkeypatch.setattr(pipeline.ffmpeg, "probe_duration", lambda p: 5.0)

    async def fake_transcribe(audio_path, *, spend=None):
        return [{"word": "hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level", fake_transcribe)

    music_file = tmp_path / "assets" / "music" / "upbeat.mp3"

    async def fake_pick_track(**kwargs):
        music_file.parent.mkdir(parents=True, exist_ok=True)
        music_file.write_bytes(b"MP3")
        return music_file
    monkeypatch.setattr(pipeline.music, "pick_track", fake_pick_track)

    def fake_concat(clips, out_path, aspect=None, *, keep_audio=False):
        calls["concat_keep_audio"] = keep_audio
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "concat_clips", fake_concat)

    def fake_extract_audio(video_path, out_path, *, sample_rate=24_000):
        calls["extract"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "extract_audio", fake_extract_audio)

    def fake_mix_music_over(video_path, music_path, out_path, music_gain_db=-18.0):
        calls["mix_music"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "mix_music_over", fake_mix_music_over)

    def fake_mix_audio(video, vo, music_path, out_path, music_gain_db=-18.0):
        calls["mix_audio"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "mix_audio", fake_mix_audio)

    def fake_burn(video, ass, out_path):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "burn_subtitles", fake_burn)

    def fake_words_to_ass(words, out_path, caption_style=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text("[Script Info]\n")
        return out_path
    monkeypatch.setattr(pipeline.subtitle, "words_to_ass", fake_words_to_ass)

    async def fake_schedule_post(*, video_path, caption, hashtags, platform,
                                 scheduled_for, profile_key, user_id):
        return "post-id-lipsync"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)

    return calls


async def test_lipsync_pipeline_ends_done(stub_lipsync):
    job = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    assert job.status == JobStatus.done, f"got {job.status}: {job.error}"
    assert job.provider_post_id == "post-id-lipsync"


async def test_lipsync_synthesizes_per_scene_and_renders_avatars(stub_lipsync):
    await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    # One TTS call per scene, with the scene's own narration.
    assert stub_lipsync["tts"] == ["hello", "world"]
    assert len(stub_lipsync["avatar"]) == 2


async def test_lipsync_keeps_clip_audio_and_ducks_music(stub_lipsync):
    await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")
    assert stub_lipsync["concat_keep_audio"] is True
    # VO extracted from the assembled video for captions/QA...
    assert stub_lipsync["extract"] == 1
    # ...music ducked under the embedded audio; the VO-mux path never runs.
    assert stub_lipsync["mix_music"] == 1
    assert stub_lipsync["mix_audio"] == 0
