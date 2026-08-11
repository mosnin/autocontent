"""Unit + pipeline-level tests for services.provider_fallback.

Unit tests exercise chain selection and the fallback loop directly
(chain contents, avatar-never-drops-to-i2v, cap-breach propagation,
spend metered under the actual provider). Pipeline-level tests mock a
primary provider to raise a persistent (non-transient) error and assert
the job still completes via the fallback provider.
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
from marketer.repos.spend import SpendCapExceeded
from marketer.services import (
    elevenlabs_tts,
    fal_video,
    grok_imagine,
    openai_tts,
    provider_fallback,
)

NICHE_ID = UUID("00000000-0000-0000-0000-0000000000f1")
AVATAR_MODEL = "fal-ai/bytedance/omnihuman"
CHEAP_FAL_MODEL_ID = "fal-ai/wan/v2.2-a14b/image-to-video"  # cheapest i2v in registry


class _FakeNiche:
    """Plain duck-typed stand-in for Niche that allows setting fields the
    real (pydantic, extra='ignore') model doesn't declare yet — used only
    to exercise the per-niche opt-out flag before the orchestrator adds
    the real column."""

    def __init__(self, niche: Niche, **overrides):
        for f in type(niche).model_fields:
            setattr(self, f, getattr(niche, f))
        for k, v in overrides.items():
            setattr(self, k, v)


def _make_niche(**overrides) -> Niche:
    base = dict(
        id=NICHE_ID,
        user_id="user_fallback",
        title="t",
        description="d",
        target_audience="a",
        hashtags=[],
        visual_style="v",
        voice="onyx",
        target_duration_sec=20,
        scene_count=1,
        posting_windows=[PostingWindow(hour=10, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )
    base.update(overrides)
    return Niche(**base)


# ---------------------------------------------------------------------------
# Chain selection
# ---------------------------------------------------------------------------


def test_i2v_chain_grok_primary_falls_back_to_cheapest_fal(monkeypatch):
    """Default niche (grok) falls back to the cheapest enabled fal model."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    niche = _make_niche(video_provider="grok")
    chain = provider_fallback.i2v_fallback_chain(niche)
    assert chain[0] == ("grok", None)
    assert chain[1][0] == "fal"
    assert chain[1][1] == CHEAP_FAL_MODEL_ID


def test_i2v_chain_grok_primary_no_fal_key_no_fallback(monkeypatch):
    """No fal key configured: grok primary has nothing to fall back to."""
    monkeypatch.setattr(settings, "fal_api_key", "")
    niche = _make_niche(video_provider="grok")
    chain = provider_fallback.i2v_fallback_chain(niche)
    assert chain == [("grok", None)]


def test_i2v_chain_fal_primary_falls_back_to_grok_when_xai_key_set(monkeypatch):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    monkeypatch.setattr(settings, "xai_api_key", "xai-test")
    niche = _make_niche(
        video_provider="fal",
        fal_model="fal-ai/kling-video/v2.1/pro/image-to-video",
    )
    chain = provider_fallback.i2v_fallback_chain(niche)
    assert chain[0] == ("fal", "fal-ai/kling-video/v2.1/pro/image-to-video")
    assert chain[1] == ("grok", None)


def test_i2v_chain_fal_primary_no_xai_key_falls_back_to_cheapest_other_fal(monkeypatch):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    monkeypatch.setattr(settings, "xai_api_key", "")
    niche = _make_niche(
        video_provider="fal",
        fal_model="fal-ai/kling-video/v2.1/pro/image-to-video",
    )
    chain = provider_fallback.i2v_fallback_chain(niche)
    assert chain[0] == ("fal", "fal-ai/kling-video/v2.1/pro/image-to-video")
    # Cheapest fal i2v model EXCLUDING the primary itself.
    assert chain[1] == ("fal", CHEAP_FAL_MODEL_ID)


def test_i2v_chain_fal_primary_is_already_cheapest_no_other_fal_no_xai(monkeypatch):
    """Primary IS the cheapest fal model and no xai key: no viable
    fallback target exists, chain has just the one entry."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    monkeypatch.setattr(settings, "xai_api_key", "")
    # Only one fal i2v model registered.
    from marketer.services import fal_video as fv

    only_model = fv.FalVideoModel(
        id="only/i2v", name="Only", tagline="t", usd_per_second=Decimal("0.05"),
    )
    monkeypatch.setattr(fv, "FAL_VIDEO_MODELS", [only_model])
    monkeypatch.setattr(fv, "_BY_ID", {only_model.id: only_model})
    niche = _make_niche(video_provider="fal", fal_model="only/i2v")
    chain = provider_fallback.i2v_fallback_chain(niche)
    assert chain == [("fal", "only/i2v")]


def test_avatar_chain_never_includes_i2v_model(monkeypatch):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    chain = provider_fallback.avatar_fallback_chain(AVATAR_MODEL)
    for model_id in chain:
        model = fal_video.get_model(model_id)
        assert model is not None
        assert model.kind == "avatar"


def test_avatar_chain_falls_back_to_other_enabled_avatar_model(monkeypatch):
    """A second avatar model in the registry IS offered as a fallback
    target, in registry order, excluding the primary."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    from marketer.services import fal_video as fv

    other_avatar = fv.FalVideoModel(
        id="fal-ai/other-avatar", name="Other Avatar", tagline="t",
        usd_per_second=Decimal("0.10"), kind="avatar",
    )
    models = list(fv.FAL_VIDEO_MODELS) + [other_avatar]
    monkeypatch.setattr(fv, "FAL_VIDEO_MODELS", models)
    monkeypatch.setattr(fv, "_BY_ID", {m.id: m for m in models})
    chain = provider_fallback.avatar_fallback_chain(AVATAR_MODEL)
    assert chain[0] == AVATAR_MODEL
    assert "fal-ai/other-avatar" in chain[1:]


def test_avatar_chain_no_other_avatar_model_single_entry(monkeypatch):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    chain = provider_fallback.avatar_fallback_chain(AVATAR_MODEL)
    assert chain == [AVATAR_MODEL]


def test_fallback_enabled_defaults_true_when_field_absent():
    niche = _make_niche()
    assert provider_fallback.fallback_enabled(niche) is True


def test_fallback_enabled_respects_niche_opt_out():
    fake_niche = _FakeNiche(_make_niche(), provider_fallback_enabled=False)
    assert provider_fallback.fallback_enabled(fake_niche) is False


# ---------------------------------------------------------------------------
# render_i2v_scene / render_avatar_scene / synthesize_vo_with_fallback
# ---------------------------------------------------------------------------


async def test_render_i2v_scene_falls_back_on_persistent_grok_failure(
    monkeypatch, tmp_path, fake_spend,
):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    spend, rec = fake_spend
    niche = _make_niche(video_provider="grok")

    async def failing_grok(*a, **k):
        raise grok_imagine.GrokImagineError("xai account suspended")
    monkeypatch.setattr(grok_imagine, "animate", failing_grok)

    fal_calls = []

    async def fake_fal_animate(keyframe, motion, out, *, model_id, duration_sec, spend=None):
        fal_calls.append(model_id)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"MP4")
        if spend is not None:
            await spend.log(provider="fal", sku=model_id, units=Decimal("5"),
                             cost_usd=Decimal("0.20"))
        return out
    monkeypatch.setattr(fal_video, "animate", fake_fal_animate)

    out_path = tmp_path / "clip.mp4"
    await provider_fallback.render_i2v_scene(
        tmp_path / "kf.png", "pan left", out_path,
        niche=niche, duration_sec=5.0, spend=spend,
    )
    assert fal_calls == [CHEAP_FAL_MODEL_ID]
    # Spend metered under the provider that actually rendered (fal), not grok.
    assert len(rec.entries) == 1
    assert rec.entries[0].provider == "fal"
    assert rec.entries[0].sku == CHEAP_FAL_MODEL_ID


async def test_render_i2v_scene_no_fallback_raises_when_disabled(
    monkeypatch, tmp_path, fake_spend,
):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    spend, _rec = fake_spend
    niche = _FakeNiche(_make_niche(video_provider="grok"), provider_fallback_enabled=False)

    async def failing_grok(*a, **k):
        raise grok_imagine.GrokImagineError("persistent failure")
    monkeypatch.setattr(grok_imagine, "animate", failing_grok)

    async def must_not_run(*a, **k):
        raise AssertionError("fal must not be called when fallback is disabled")
    monkeypatch.setattr(fal_video, "animate", must_not_run)

    with pytest.raises(grok_imagine.GrokImagineError):
        await provider_fallback.render_i2v_scene(
            tmp_path / "kf.png", "pan left", tmp_path / "clip.mp4",
            niche=niche, duration_sec=5.0, spend=spend,
        )


async def test_render_i2v_scene_all_providers_fail_raises_exhausted(
    monkeypatch, tmp_path, fake_spend,
):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    spend, _rec = fake_spend
    niche = _make_niche(video_provider="grok")

    async def failing_grok(*a, **k):
        raise grok_imagine.GrokImagineError("down")
    monkeypatch.setattr(grok_imagine, "animate", failing_grok)

    async def failing_fal(*a, **k):
        raise fal_video.FalVideoError("also down")
    monkeypatch.setattr(fal_video, "animate", failing_fal)

    with pytest.raises(provider_fallback.VideoFallbackExhausted):
        await provider_fallback.render_i2v_scene(
            tmp_path / "kf.png", "pan left", tmp_path / "clip.mp4",
            niche=niche, duration_sec=5.0, spend=spend,
        )


async def test_render_i2v_scene_spend_cap_exceeded_propagates_immediately(
    monkeypatch, tmp_path, fake_spend,
):
    """A cap breach on the primary attempt must propagate, never trigger
    a fallback to a different (still billable) provider."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    spend, _rec = fake_spend
    niche = _make_niche(video_provider="grok")

    async def capped_grok(*a, **k):
        raise SpendCapExceeded("niche cap hit", scope="niche")
    monkeypatch.setattr(grok_imagine, "animate", capped_grok)

    async def must_not_run(*a, **k):
        raise AssertionError("fal must not run after a spend cap breach")
    monkeypatch.setattr(fal_video, "animate", must_not_run)

    with pytest.raises(SpendCapExceeded):
        await provider_fallback.render_i2v_scene(
            tmp_path / "kf.png", "pan left", tmp_path / "clip.mp4",
            niche=niche, duration_sec=5.0, spend=spend,
        )


async def test_render_avatar_scene_never_falls_back_to_i2v(
    monkeypatch, tmp_path, fake_spend,
):
    """No alternate avatar model registered: a persistent avatar failure
    must raise AvatarFallbackUnavailable, and plain animate() must never
    be invoked as a substitute."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    spend, _rec = fake_spend
    niche = _make_niche(video_provider="fal", fal_model=AVATAR_MODEL)

    async def failing_avatar(*a, **k):
        raise fal_video.FalVideoError("omnihuman rejected content")
    monkeypatch.setattr(fal_video, "animate_avatar", failing_avatar)

    async def must_not_run(*a, **k):
        raise AssertionError("plain animate() must never substitute for avatar")
    monkeypatch.setattr(fal_video, "animate", must_not_run)

    with pytest.raises(provider_fallback.AvatarFallbackUnavailable):
        await provider_fallback.render_avatar_scene(
            tmp_path / "kf.png", tmp_path / "vo.wav", tmp_path / "clip.mp4",
            niche=niche, avatar_model_id=AVATAR_MODEL, spend=spend,
        )


async def test_render_avatar_scene_falls_back_to_other_avatar_model(
    monkeypatch, tmp_path, fake_spend,
):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    from marketer.services import fal_video as fv

    other_avatar = fv.FalVideoModel(
        id="fal-ai/other-avatar", name="Other Avatar", tagline="t",
        usd_per_second=Decimal("0.10"), kind="avatar",
    )
    models = list(fv.FAL_VIDEO_MODELS) + [other_avatar]
    monkeypatch.setattr(fv, "FAL_VIDEO_MODELS", models)
    monkeypatch.setattr(fv, "_BY_ID", {m.id: m for m in models})

    spend, rec = fake_spend
    niche = _make_niche(video_provider="fal", fal_model=AVATAR_MODEL)

    calls = []

    async def fake_animate_avatar(keyframe, audio, out, *, model_id, spend=None):
        calls.append(model_id)
        if model_id == AVATAR_MODEL:
            raise fv.FalVideoError("primary avatar model down")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"MP4")
        if spend is not None:
            await spend.log(provider="fal", sku=model_id, units=Decimal("5"),
                             cost_usd=Decimal("0.50"))
        return out
    monkeypatch.setattr(fv, "animate_avatar", fake_animate_avatar)

    out_path = tmp_path / "clip.mp4"
    await provider_fallback.render_avatar_scene(
        tmp_path / "kf.png", tmp_path / "vo.wav", out_path,
        niche=niche, avatar_model_id=AVATAR_MODEL, spend=spend,
    )
    assert calls == [AVATAR_MODEL, "fal-ai/other-avatar"]
    assert len(rec.entries) == 1
    assert rec.entries[0].sku == "fal-ai/other-avatar"


async def test_synthesize_vo_falls_back_elevenlabs_to_openai(
    monkeypatch, tmp_path, fake_spend,
):
    spend, rec = fake_spend
    niche = _make_niche(voice_provider="elevenlabs", elevenlabs_voice_id="v1")

    async def failing_el(text, out_path, *, voice_id="", spend=None):
        raise elevenlabs_tts.ElevenLabsError("elevenlabs key rotated")
    monkeypatch.setattr(elevenlabs_tts, "synthesize", failing_el)

    async def fake_openai(text, out_path, *, voice, style_directions=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        if spend is not None:
            await spend.log(provider="openai", sku="gpt-4o-mini-tts",
                             units=Decimal("1"), cost_usd=Decimal("0.01"))
        return out_path
    monkeypatch.setattr(openai_tts, "synthesize", fake_openai)

    out_path = tmp_path / "vo.wav"
    result = await provider_fallback.synthesize_vo_with_fallback(
        "hello world", out_path, niche=niche, spend=spend,
    )
    assert result == out_path
    assert out_path.exists()
    assert len(rec.entries) == 1
    assert rec.entries[0].provider == "openai"


async def test_synthesize_vo_openai_primary_has_no_further_fallback(
    monkeypatch, tmp_path, fake_spend,
):
    """A niche already on openai_tts (the stock/no-fallback-needed
    engine) that fails must raise directly — there is no third
    provider to try."""
    spend, _rec = fake_spend
    niche = _make_niche(voice_provider="openai")

    async def failing_openai(text, out_path, *, voice, style_directions=None, spend=None):
        raise RuntimeError("openai down")
    monkeypatch.setattr(openai_tts, "synthesize", failing_openai)

    with pytest.raises(provider_fallback.TTSFallbackExhausted):
        await provider_fallback.synthesize_vo_with_fallback(
            "hello", tmp_path / "vo.wav", niche=niche, spend=spend,
        )


async def test_synthesize_vo_cap_exceeded_propagates_not_falls_back(
    monkeypatch, tmp_path, fake_spend,
):
    spend, _rec = fake_spend
    niche = _make_niche(voice_provider="elevenlabs", elevenlabs_voice_id="v1")

    async def capped_el(text, out_path, *, voice_id="", spend=None):
        raise SpendCapExceeded("niche cap hit", scope="niche")
    monkeypatch.setattr(elevenlabs_tts, "synthesize", capped_el)

    async def must_not_run(text, out_path, *, voice, style_directions=None, spend=None):
        raise AssertionError("openai must not run after a spend cap breach")
    monkeypatch.setattr(openai_tts, "synthesize", must_not_run)

    with pytest.raises(SpendCapExceeded):
        await provider_fallback.synthesize_vo_with_fallback(
            "hello", tmp_path / "vo.wav", niche=niche, spend=spend,
        )


# ---------------------------------------------------------------------------
# Pipeline-level: primary provider raises a persistent error, fallback
# provider is invoked, the job still completes.
# ---------------------------------------------------------------------------


NICHE_PIPE_ID = UUID("00000000-0000-0000-0000-0000000000f2")
USER_ID = "user_fallback_pipe"


def _make_pipe_niche() -> Niche:
    return Niche(
        id=NICHE_PIPE_ID,
        user_id=USER_ID,
        title="fallback econ",
        description="videos",
        target_audience="adults",
        hashtags=["econ"],
        visual_style="minimal",
        voice="onyx",
        target_duration_sec=20,
        scene_count=1,
        posting_windows=[PostingWindow(hour=10, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        voice_provider="elevenlabs",
        elevenlabs_voice_id="v1",
    )


def _make_pipe_script() -> Script:
    return Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"),
        scenes=[
            Scene(index=0, narration="hello there", visual_prompt="vp0",
                  motion_prompt="mp0", duration_sec=5),
        ],
        total_duration_sec=5,
        cta=None,
    )


@pytest.fixture
def stub_pipeline_fallback(monkeypatch, tmp_path: Path, passing_render_qa):
    """Full pipeline stub where grok_imagine.animate (video) and
    elevenlabs_tts.synthesize (VO) both raise persistent errors — the job
    must still complete via the fallback providers (fal + openai_tts)."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    # Key IS configured (so the pre-flight "misconfigured elevenlabs"
    # fail-fast in _run_job_inner doesn't short-circuit before voicing) —
    # this models a persistent *runtime* failure (outage/content
    # rejection/rotated-but-present key), which is exactly the case
    # provider_fallback exists to absorb.
    monkeypatch.setattr(settings, "elevenlabs_api_key", "el-test")

    calls = {"grok": 0, "fal_video": [], "elevenlabs": 0, "openai_tts": 0}

    async def fake_niches_get(niche_id, *, user_id):
        return _make_pipe_niche()
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

    async def fake_ideation(title, *, performance_context="", niche_description="", target_audience="", platform="", brand_voice="", banned_words=None, recent_topics=None, brief=None, spend=None):
        return Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    async def fake_scriptwriter(idea, *, scene_count, target_duration_sec, audience_context="", brief=None, script_model="", spend=None):
        return _make_pipe_script()
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

    # PRIMARY video provider (grok, since niche.video_provider defaults to
    # "grok") raises a persistent error every time.
    async def failing_grok_animate(keyframe, motion_prompt, out_path, *,
                                   duration_sec, resolution, spend=None):
        calls["grok"] += 1
        raise pipeline.grok_imagine.GrokImagineError("xai account suspended")
    monkeypatch.setattr(pipeline.grok_imagine, "animate", failing_grok_animate)

    # FALLBACK video provider (fal) succeeds.
    from marketer.services import fal_video

    async def fake_fal_animate(keyframe, motion_prompt, out_path, *,
                               model_id, duration_sec, spend=None):
        calls["fal_video"].append(model_id)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        if spend is not None:
            await spend.log(provider="fal", sku=model_id, units=Decimal("5"),
                             cost_usd=Decimal("0.20"))
        return out_path
    monkeypatch.setattr(fal_video, "animate", fake_fal_animate)

    monkeypatch.setattr(pipeline.ffmpeg, "probe_duration", lambda p: 5.0)

    # PRIMARY TTS provider (elevenlabs) raises a persistent error.
    async def failing_elevenlabs(text, out_path, *, voice_id="", spend=None):
        calls["elevenlabs"] += 1
        raise pipeline.elevenlabs_tts.ElevenLabsError("elevenlabs key rotated")
    monkeypatch.setattr(pipeline.elevenlabs_tts, "synthesize", failing_elevenlabs)

    # FALLBACK TTS provider (openai_tts) succeeds.
    async def fake_openai_tts(text, out_path, *, voice, style_directions=None, spend=None):
        calls["openai_tts"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        if spend is not None:
            await spend.log(provider="openai", sku="gpt-4o-mini-tts",
                             units=Decimal("1"), cost_usd=Decimal("0.01"))
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_openai_tts)

    async def fake_transcribe(audio_path, *, spend=None):
        return [{"word": "hello", "start": 0.0, "end": 0.5}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level", fake_transcribe)

    async def fake_pick_track(**kwargs):
        return None
    monkeypatch.setattr(pipeline.music, "pick_track", fake_pick_track)
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

    def fake_words_to_ass(words, out_path, caption_style=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text("[Script Info]\n")
        return out_path
    monkeypatch.setattr(pipeline.subtitle, "words_to_ass", fake_words_to_ass)

    async def fake_schedule_post(*, video_path, caption, hashtags, platform,
                                 scheduled_for, profile_key, user_id):
        return "post-id-fallback"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)

    return calls


async def test_pipeline_completes_via_video_and_tts_fallback(stub_pipeline_fallback):
    job = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_PIPE_ID, platform="tiktok")
    assert job.status == JobStatus.done, f"got {job.status}: {job.error}"
    assert job.provider_post_id == "post-id-fallback"
    # Primary providers were tried (and failed) exactly once each...
    assert stub_pipeline_fallback["grok"] == 1
    assert stub_pipeline_fallback["elevenlabs"] == 1
    # ...and the fallback providers actually rendered the asset.
    assert stub_pipeline_fallback["fal_video"] == [CHEAP_FAL_MODEL_ID]
    assert stub_pipeline_fallback["openai_tts"] == 1


async def test_pipeline_fallback_clip_persists_like_any_other(stub_pipeline_fallback):
    """A scene that succeeded via fallback is a normal Clip — persisted
    and reusable by per-scene resume exactly like a primary-provider
    success."""
    job = await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_PIPE_ID, platform="tiktok")
    assert job.status == JobStatus.done
    assert len(job.clips) == 1
    clip = job.clips[0]
    assert clip.scene_index == 0
    assert Path(clip.video_path).exists()
    assert Path(clip.keyframe_path).exists()
