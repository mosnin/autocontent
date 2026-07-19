"""Pipeline resume/spend-correctness hardening (Team 3).

Covers:
  (a) resumed job with an existing generated music track does NOT re-bill
      music_gen.compose.
  (b) voice_provider='elevenlabs' with the key unconfigured fails fast,
      before any keyframe/render spend.
  (c) a pre-flight SpendCapExceeded from music_gen.compose falls back to
      the free library chain (pick_track) instead of failing the job.
  (d) avatar-mode resume regenerates a prior clip whose audio shape
      doesn't match the current mode instead of reusing it blindly.
  (e) check_render is called with enforce_duration=False in avatar mode
      (and True in the normal keyframe-animation path).

These tests deliberately stub `pipeline.video_qa.check_render` locally
(rather than relying on the shared `passing_render_qa` conftest fixture)
so each test can assert on the `enforce_duration` value it was called
with.
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
    AudioTrack,
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
from marketer.repos import spend as spend_repo
from marketer.services import video_qa

USER_ID = "user_resume_hardening"
NICHE_ID = UUID("00000000-0000-0000-0000-0000000000aa")
AVATAR_MODEL = "fal-ai/bytedance/omnihuman"


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


def _make_niche(**overrides) -> Niche:
    base = dict(
        id=NICHE_ID,
        user_id=USER_ID,
        title="resume hardening niche",
        description="desc",
        target_audience="aud",
        hashtags=["x"],
        visual_style="style",
        voice="nova",
        target_duration_sec=10,
        scene_count=2,
        posting_windows=[PostingWindow(hour=10, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )
    base.update(overrides)
    return Niche(**base)


@pytest.fixture
def stub_env(monkeypatch, tmp_path: Path):
    """Full pipeline stub, mirroring test_pipeline_lipsync.py's pattern.

    Every provider + repo the pipeline touches is stubbed; call counters
    live in `calls` so tests can assert on what actually ran. The niche
    returned by niches_repo.get is swappable per-test via `niche_box`.
    """
    calls: dict = {
        "compose": 0, "pick_track": 0, "animate": 0, "animate_avatar": 0,
        "generate_keyframe": 0, "tts": [], "check_render_kwargs": [],
    }
    niche_box: dict[str, Niche] = {"niche": _make_niche()}

    async def fake_niches_get(niche_id, *, user_id):
        return niche_box["niche"]
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
            id=user_id, email="test@test.com", global_daily_cap_usd=None,
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

    async def fake_ideation(title, *, performance_context="", niche_description="",
                            target_audience="", platform="", brand_voice="",
                            banned_words=None, recent_topics=None, brief=None, spend=None):
        return Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    async def fake_scriptwriter(idea, *, scene_count, target_duration_sec,
                                audience_context="", brief=None, script_model="", spend=None):
        return _make_script()
    monkeypatch.setattr(pipeline, "run_scriptwriter", fake_scriptwriter)

    async def fake_visual_director(script, *, visual_style, character_description="",
                                   brief=None, design_kit="", spend=None):
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
        calls["generate_keyframe"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"PNG")
        return out_path
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe", fake_generate_keyframe)

    async def fake_openai_tts(text, out_path, *, voice, style_directions=None, spend=None):
        calls["tts"].append(text)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_openai_tts)

    async def fake_grok_animate(keyframe, motion_prompt, out_path, *, duration_sec,
                                resolution=None, spend=None):
        calls["animate"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.grok_imagine, "animate", fake_grok_animate)

    from marketer.services import fal_video

    async def fake_fal_animate(keyframe, motion_prompt, out_path, *, model_id,
                               duration_sec, spend=None):
        calls["animate"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(fal_video, "animate", fake_fal_animate)

    async def fake_animate_avatar(keyframe, audio_path, out_path, *, model_id, spend=None):
        calls["animate_avatar"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4A")
        return out_path
    monkeypatch.setattr(fal_video, "animate_avatar", fake_animate_avatar)

    monkeypatch.setattr(pipeline.ffmpeg, "probe_duration", lambda p: 5.0)
    # Default: no clip carries embedded audio (i2v/motion mode). Tests that
    # need mixed audio shapes (the mode-mismatch resume test) override this.
    monkeypatch.setattr(pipeline.ffmpeg, "probe_has_audio", lambda p: False)

    async def fake_transcribe(audio_path, *, spend=None):
        return [{"word": "hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level", fake_transcribe)

    async def fake_pick_track(**kwargs):
        calls["pick_track"] += 1
        music_file = tmp_path / "assets" / "music" / "library_track.mp3"
        music_file.parent.mkdir(parents=True, exist_ok=True)
        music_file.write_bytes(b"MP3")
        return music_file
    monkeypatch.setattr(pipeline.music, "pick_track", fake_pick_track)

    async def fake_compose(*, mood, duration_sec, out_path, niche_title="", spend=None):
        calls["compose"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP3G")
        return out_path
    monkeypatch.setattr(pipeline.music_gen, "compose", fake_compose)
    monkeypatch.setattr(pipeline.music_gen, "enabled", lambda: True)

    def fake_concat(clips, out_path, aspect=None, *, keep_audio=False):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "concat_clips", fake_concat)

    def fake_extract_audio(video_path, out_path, *, sample_rate=24_000):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "extract_audio", fake_extract_audio)

    def fake_mix_music_over(video_path, music_path, out_path, music_gain_db=-18.0):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "mix_music_over", fake_mix_music_over)

    def fake_mix_audio(video, vo, music_path, out_path, music_gain_db=-18.0):
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

    def fake_check_render(final_path, *, voiceover_path, target_duration_sec,
                          max_upload_bytes=video_qa.MAX_UPLOAD_BYTES,
                          enforce_duration=True):
        calls["check_render_kwargs"].append({"enforce_duration": enforce_duration})
        return video_qa.RenderReport(
            passed=True, issues=[], final_path=str(final_path),
            duration_sec=float(target_duration_sec or 10), size_bytes=1024,
        )
    monkeypatch.setattr(pipeline.video_qa, "check_render", fake_check_render)

    async def fake_schedule_post(*, video_path, caption, hashtags, platform,
                                 scheduled_for, profile_key, user_id):
        return "post-id-resume-hardening"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)

    return {"calls": calls, "niche_box": niche_box, "saved": saved, "tmp_path": tmp_path}


def _seed_resumed_job(
    tmp_path: Path, *, script: Script, niche_video_provider_avatar: bool = False,
    clip_audio_map: dict[int, bool] | None = None,
    include_vo: bool = True, include_music: bool = False,
) -> tuple[UUID, Path, Job]:
    """Write a prior-attempt layout to disk and build the Job row that
    would be resumed against it (mirrors what a real failed attempt leaves
    behind: script.json, per-scene clips/keyframes, voiceover.wav, and
    optionally a generated music track)."""
    job_id = uuid4()
    root = tmp_path / USER_ID / str(job_id)
    for sub in ("keyframes", "clips", "audio", "captions", "output"):
        (root / sub).mkdir(parents=True, exist_ok=True)

    clip_audio_map = clip_audio_map or {}
    clips: list[Clip] = []
    for scene in script.scenes:
        kf = root / "keyframes" / f"scene_{scene.index}.png"
        kf.write_bytes(b"PNG")
        vid = root / "clips" / f"scene_{scene.index}.mp4"
        # Content is a marker byte string; the stubbed probe_has_audio in
        # each test decides what "has audio" means for these sentinel files.
        vid.write_bytes(b"MP4A" if clip_audio_map.get(scene.index) else b"MP4")
        clips.append(Clip(
            scene_index=scene.index, keyframe_path=str(kf), video_path=str(vid),
            duration_sec=5.0,
        ))

    audio = None
    if include_vo:
        vo_path = root / "audio" / "voiceover.wav"
        vo_path.write_bytes(b"WAV")
        music_path = None
        if include_music:
            music_path = root / "audio" / "music_generated.mp3"
            music_path.write_bytes(b"MP3G")
        audio = AudioTrack(
            voiceover_path=str(vo_path),
            music_path=str(music_path) if music_path else None,
        )

    job = Job(
        id=job_id, user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.failed, error="RuntimeError: transient failure",
        script=script, clips=clips, audio=audio,
    )
    return job_id, root, job


# ---------------------------------------------------------------------------
# (a) resumed job reuses an existing generated music track — no re-bill.
# ---------------------------------------------------------------------------

async def test_resume_reuses_generated_music_without_recompose(stub_env, monkeypatch):
    calls, niche_box, tmp_path = stub_env["calls"], stub_env["niche_box"], stub_env["tmp_path"]
    niche_box["niche"] = _make_niche(music_provider="generated")
    script = _make_script()

    job_id, root, job = _seed_resumed_job(
        tmp_path, script=script, include_vo=True, include_music=True,
    )

    async def fake_get(jid, *, user_id):
        return job
    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)

    result = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok", job_id=job_id,
    )

    assert result.status == JobStatus.done, f"{result.status}: {result.error}"
    assert calls["compose"] == 0, "resumed run must not re-bill music_gen.compose"
    assert calls["pick_track"] == 0, "the reused generated track must be used, not the library fallback"
    assert result.audio is not None
    assert result.audio.music_path == str(root / "audio" / "music_generated.mp3")
    # Per-scene clips and VO were also resumed — no re-spend there either.
    assert calls["animate"] == 0
    assert calls["generate_keyframe"] == 0
    assert calls["tts"] == []


# ---------------------------------------------------------------------------
# (b) elevenlabs misconfiguration fails fast, before any spend.
# ---------------------------------------------------------------------------

async def test_elevenlabs_misconfig_fails_before_any_spend(stub_env, monkeypatch):
    calls, niche_box = stub_env["calls"], stub_env["niche_box"]
    niche_box["niche"] = _make_niche(
        voice_provider="elevenlabs", elevenlabs_voice_id="voice-1",
    )
    monkeypatch.setattr(settings, "elevenlabs_api_key", "")

    result = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    assert result.status == JobStatus.failed
    assert result.error is not None and "elevenlabs" in result.error.lower()
    # No ideation/keyframe/render spend happened.
    assert calls["generate_keyframe"] == 0
    assert calls["animate"] == 0
    assert calls["tts"] == []
    assert result.script is None


# ---------------------------------------------------------------------------
# (c) music pre-flight SpendCapExceeded falls back to the library track.
# ---------------------------------------------------------------------------

async def test_music_preflight_cap_breach_falls_back_to_library(stub_env, monkeypatch):
    calls, niche_box = stub_env["calls"], stub_env["niche_box"]
    niche_box["niche"] = _make_niche(music_provider="generated")

    async def fake_compose_over_cap(*, mood, duration_sec, out_path, niche_title="", spend=None):
        # Mirrors music_gen.compose raising from ensure_can_spend BEFORE
        # _call_api — nothing has been spent yet at this call site.
        raise spend_repo.SpendCapExceeded("daily cap exceeded")
    monkeypatch.setattr(pipeline.music_gen, "compose", fake_compose_over_cap)

    result = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    assert result.status == JobStatus.done, f"{result.status}: {result.error}"
    assert calls["pick_track"] == 1
    assert result.audio is not None and result.audio.music_path is not None
    assert result.audio.music_path.endswith("library_track.mp3")


# ---------------------------------------------------------------------------
# (d) avatar-mode resume regenerates a clip whose audio shape mismatches.
# ---------------------------------------------------------------------------

async def test_avatar_resume_regenerates_mode_mismatched_clip(stub_env, monkeypatch):
    calls, niche_box, tmp_path = stub_env["calls"], stub_env["niche_box"], stub_env["tmp_path"]
    niche_box["niche"] = _make_niche(video_provider="fal", fal_model=AVATAR_MODEL)
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    script = _make_script()

    # Scene 0's clip matches avatar mode (embedded audio) -> reusable.
    # Scene 1's clip is a stale i2v-mode clip with no audio (as if the
    # niche's fal model was an i2v model on the failed attempt) -> must be
    # regenerated, not blindly reused (would otherwise crash
    # concat(keep_audio=True) or mux the wrong audio track).
    job_id, root, job = _seed_resumed_job(
        tmp_path, script=script,
        clip_audio_map={0: True, 1: False},
        include_vo=False,
    )

    def fake_probe_has_audio(path):
        return "scene_0" in str(path)
    monkeypatch.setattr(pipeline.ffmpeg, "probe_has_audio", fake_probe_has_audio)

    async def fake_get(jid, *, user_id):
        return job
    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)

    result = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok", job_id=job_id,
    )

    assert result.status == JobStatus.done, f"{result.status}: {result.error}"
    # Only scene 1 (the mismatched clip) was regenerated.
    assert calls["animate_avatar"] == 1
    assert calls["generate_keyframe"] == 1
    assert len(result.clips) == 2


# ---------------------------------------------------------------------------
# (e) check_render's enforce_duration follows avatar vs. normal mode.
# ---------------------------------------------------------------------------

async def test_check_render_skips_duration_gate_in_avatar_mode(stub_env, monkeypatch):
    calls, niche_box = stub_env["calls"], stub_env["niche_box"]
    niche_box["niche"] = _make_niche(video_provider="fal", fal_model=AVATAR_MODEL)
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")

    result = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    assert result.status == JobStatus.done, f"{result.status}: {result.error}"
    assert calls["check_render_kwargs"], "check_render was never called"
    assert calls["check_render_kwargs"][-1]["enforce_duration"] is False


async def test_check_render_enforces_duration_in_normal_mode(stub_env):
    calls = stub_env["calls"]

    result = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    assert result.status == JobStatus.done, f"{result.status}: {result.error}"
    assert calls["check_render_kwargs"], "check_render was never called"
    assert calls["check_render_kwargs"][-1]["enforce_duration"] is True
