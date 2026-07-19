"""Wave 5: ElevenLabs TTS, generative music, expanded fal registry,
lip-synced UGC avatars, image-post retry, template admin surface.

External calls mocked throughout.
"""
from __future__ import annotations

import wave
from decimal import Decimal
from pathlib import Path

import pytest

from marketer.config import settings
from marketer.services import elevenlabs_tts, fal_video, music_gen

# --------------------------------------------------------------------------- helpers


def _niche(**overrides):
    from decimal import Decimal as D
    from uuid import uuid4

    from marketer.models import Niche, PostingWindow

    base = dict(
        id=uuid4(),
        user_id="user_test",
        title="claymation econ",
        description="explainers",
        target_audience="curious adults",
        hashtags=["econ"],
        visual_style="claymation",
        voice="onyx",
        target_duration_sec=30,
        scene_count=2,
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=D("3.00"),
    )
    base.update(overrides)
    return Niche(**base)


def _write_wav(path: Path, seconds: float, rate: int = 24_000) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return path


# --------------------------------------------------------------------------- elevenlabs tts


def test_elevenlabs_disabled_without_key():
    assert not elevenlabs_tts.enabled()


async def test_elevenlabs_refuses_when_disabled(tmp_path: Path):
    with pytest.raises(elevenlabs_tts.ElevenLabsError, match="ELEVENLABS_API_KEY"):
        await elevenlabs_tts.synthesize("hello", tmp_path / "vo.wav")


def test_elevenlabs_cost_math():
    assert elevenlabs_tts.tts_cost(1000) == Decimal("0.1500")
    assert elevenlabs_tts.tts_cost(200) == Decimal("0.0300")


async def test_elevenlabs_synthesize_writes_wav_and_meters(
    tmp_path: Path, monkeypatch, fake_spend
):
    monkeypatch.setattr(settings, "elevenlabs_api_key", "el-test")
    captured: dict = {}

    async def fake_call(text, voice_id):
        captured["text"] = text
        captured["voice_id"] = voice_id
        return b"\x00\x00" * 24_000  # 1s of silence

    monkeypatch.setattr(elevenlabs_tts, "_call_api", fake_call)
    ctx, rec = fake_spend
    out = tmp_path / "vo.wav"
    text = "hello world, this is a premium voice"
    await elevenlabs_tts.synthesize(text, out, voice_id="voice123", spend=ctx)

    with wave.open(str(out), "rb") as w:
        assert w.getframerate() == 24_000
        assert w.getnchannels() == 1
        assert w.getnframes() == 24_000
    assert captured["voice_id"] == "voice123"
    assert len(rec.entries) == 1
    entry = rec.entries[0]
    assert entry.provider == "elevenlabs"
    assert entry.units == Decimal(len(text))
    assert entry.cost_usd == elevenlabs_tts.tts_cost(len(text))
    # No stray .part file left behind (atomic rename).
    assert not out.with_suffix(".wav.part").exists()


async def test_elevenlabs_default_voice_fallback(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "elevenlabs_api_key", "el-test")
    seen: dict = {}

    async def fake_call(text, voice_id):
        seen["voice_id"] = voice_id
        return b"\x00\x00" * 100

    monkeypatch.setattr(elevenlabs_tts, "_call_api", fake_call)
    await elevenlabs_tts.synthesize("hi", tmp_path / "vo.wav")
    assert seen["voice_id"] == settings.elevenlabs_default_voice_id


# --------------------------------------------------------------------------- music gen


def test_music_gen_disabled_without_key():
    assert not music_gen.enabled()


async def test_music_gen_refuses_when_disabled(tmp_path: Path):
    with pytest.raises(music_gen.MusicGenError):
        await music_gen.compose(
            mood="lofi", duration_sec=60, out_path=tmp_path / "m.mp3"
        )


def test_music_gen_cost_math():
    assert music_gen.music_cost(60) == Decimal("0.5000")
    assert music_gen.music_cost(30) == Decimal("0.2500")


def test_music_gen_prompt_is_instrumental():
    prompt = music_gen.build_prompt("dark synthwave", niche_title="AI news")
    assert "dark synthwave" in prompt
    assert "no vocals" in prompt
    empty = music_gen.build_prompt("", niche_title="AI news")
    assert "AI news" in empty


async def test_music_gen_compose_writes_and_meters(
    tmp_path: Path, monkeypatch, fake_spend
):
    monkeypatch.setattr(settings, "elevenlabs_api_key", "el-test")
    captured: dict = {}

    async def fake_call(prompt, length_ms):
        captured["prompt"] = prompt
        captured["length_ms"] = length_ms
        return b"MP3DATA"

    monkeypatch.setattr(music_gen, "_call_api", fake_call)
    ctx, rec = fake_spend
    out = tmp_path / "m.mp3"
    await music_gen.compose(
        mood="upbeat lofi", duration_sec=45, out_path=out,
        niche_title="econ", spend=ctx,
    )
    assert out.read_bytes() == b"MP3DATA"
    assert captured["length_ms"] == 45_000
    assert len(rec.entries) == 1
    assert rec.entries[0].provider == "elevenlabs"
    assert rec.entries[0].sku == "music"
    assert rec.entries[0].cost_usd == music_gen.music_cost(45)


async def test_music_gen_clamps_short_durations(tmp_path: Path, monkeypatch):
    """A 3s target still requests the API minimum (10s)."""
    monkeypatch.setattr(settings, "elevenlabs_api_key", "el-test")
    seen: dict = {}

    async def fake_call(prompt, length_ms):
        seen["length_ms"] = length_ms
        return b"X"

    monkeypatch.setattr(music_gen, "_call_api", fake_call)
    await music_gen.compose(mood="m", duration_sec=3, out_path=tmp_path / "m.mp3")
    assert seen["length_ms"] == music_gen.MIN_LENGTH_MS


# --------------------------------------------------------------------------- fal registry


def test_new_models_in_registry():
    ids = {m.id for m in fal_video.FAL_VIDEO_MODELS}
    assert "fal-ai/veo3/image-to-video" in ids
    assert "fal-ai/veo3/fast/image-to-video" in ids
    assert "fal-ai/sora-2/image-to-video" in ids
    assert "fal-ai/kling-video/v2.5-turbo/pro/image-to-video" in ids
    assert "fal-ai/pixverse/v5/image-to-video" in ids


def test_avatar_kind_marks_omnihuman_only():
    kinds = {m.id: m.kind for m in fal_video.FAL_VIDEO_MODELS}
    assert kinds["fal-ai/bytedance/omnihuman"] == "avatar"
    assert all(
        k == "i2v" for mid, k in kinds.items() if mid != "fal-ai/bytedance/omnihuman"
    )


def test_price_override_applies(monkeypatch):
    monkeypatch.setattr(
        settings, "fal_price_overrides",
        '{"fal-ai/veo3/image-to-video": "0.45"}',
    )
    m = fal_video.get_model("fal-ai/veo3/image-to-video")
    assert m.usd_per_second == Decimal("0.45")
    # The registry constant itself is never mutated.
    raw = next(
        x for x in fal_video.FAL_VIDEO_MODELS
        if x.id == "fal-ai/veo3/image-to-video"
    )
    assert raw.usd_per_second == Decimal("0.40")
    # list_models() carries the override too (what the UI shows).
    listed = {m.id: m for m in fal_video.list_models()}
    assert listed["fal-ai/veo3/image-to-video"].usd_per_second == Decimal("0.45")


def test_price_override_ignores_garbage(monkeypatch):
    monkeypatch.setattr(settings, "fal_price_overrides", "not-json{{")
    m = fal_video.get_model("fal-ai/veo3/image-to-video")
    assert m.usd_per_second == Decimal("0.40")
    monkeypatch.setattr(
        settings, "fal_price_overrides",
        '{"fal-ai/veo3/image-to-video": "zero"}',
    )
    assert fal_video.get_model(
        "fal-ai/veo3/image-to-video"
    ).usd_per_second == Decimal("0.40")


# --------------------------------------------------------------------------- avatar rendering


async def test_animate_avatar_refuses_non_avatar_model(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    vo = _write_wav(tmp_path / "vo.wav", 2.0)
    with pytest.raises(fal_video.FalVideoError, match="not an audio-driven"):
        await fal_video.animate_avatar(
            kf, vo, tmp_path / "out.mp4",
            model_id="fal-ai/veo3/image-to-video",
        )


async def test_animate_avatar_full_flow_mocked(tmp_path: Path, monkeypatch, fake_spend):
    """image+audio in -> lip-synced clip out, billed on rendered seconds."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    model_id = "fal-ai/bytedance/omnihuman"

    class _Resp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class _Stream:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def raise_for_status(self):
            return None

        async def aiter_bytes(self):
            yield b"AVATARMP4"

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            assert url.endswith(model_id)
            assert json["image_url"].startswith("data:image/png;base64,")
            assert json["audio_url"].startswith("data:audio/wav;base64,")
            assert "duration" not in json  # audio sets the length
            return _Resp({
                "status_url": "https://queue.fal.run/r1/status",
                "response_url": "https://queue.fal.run/r1/response",
            })

        async def get(self, url):
            if url.endswith("/status"):
                return _Resp({"status": "COMPLETED"})
            return _Resp({"video": {"url": "https://cdn.fal/a.mp4", "duration": 7.5}})

        def stream(self, method, url):
            return _Stream()

    monkeypatch.setattr(fal_video, "_client", lambda: _Client())

    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    vo = _write_wav(tmp_path / "vo.wav", 6.0)
    out = tmp_path / "out.mp4"
    ctx, rec = fake_spend

    result = await fal_video.animate_avatar(
        kf, vo, out, model_id=model_id, spend=ctx
    )
    assert result == out and out.read_bytes() == b"AVATARMP4"
    assert len(rec.entries) == 1
    entry = rec.entries[0]
    assert entry.provider == "fal"
    assert entry.sku == model_id
    assert entry.units == Decimal("7.5")  # provider-reported seconds win
    assert entry.cost_usd == fal_video.video_cost(
        fal_video.get_model(model_id), 7.5
    )


def test_avatar_model_id_helper():
    from marketer.pipeline import _avatar_model_id

    n = _niche(video_provider="fal", fal_model="fal-ai/bytedance/omnihuman")
    assert _avatar_model_id(n) == "fal-ai/bytedance/omnihuman"
    n2 = _niche(video_provider="fal", fal_model="fal-ai/sora-2/image-to-video")
    assert _avatar_model_id(n2) is None
    n3 = _niche(video_provider="grok", fal_model="")
    assert _avatar_model_id(n3) is None


# --------------------------------------------------------------------------- tts dispatch


async def test_synthesize_vo_dispatches_elevenlabs(tmp_path: Path, monkeypatch):
    from marketer import pipeline

    calls: dict = {}

    async def fake_el(text, out_path, *, voice_id="", spend=None):
        calls["el"] = {"text": text, "voice_id": voice_id}
        return out_path

    async def fake_openai(text, out_path, *, voice, style_directions=None, spend=None):
        calls["openai"] = True
        return out_path

    monkeypatch.setattr(pipeline.elevenlabs_tts, "synthesize", fake_el)
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_openai)

    n = _niche(voice_provider="elevenlabs", elevenlabs_voice_id="v99")
    await pipeline._synthesize_vo("hi there", tmp_path / "vo.wav", niche=n, spend=None)
    assert calls["el"]["voice_id"] == "v99"
    assert "openai" not in calls

    n2 = _niche(voice_provider="openai")
    await pipeline._synthesize_vo("hi", tmp_path / "vo2.wav", niche=n2, spend=None)
    assert calls.get("openai") is True


# --------------------------------------------------------------------------- ffmpeg helpers


def test_extract_audio_argv(monkeypatch):
    from marketer.services import ffmpeg

    calls: list[list[str]] = []
    monkeypatch.setattr(ffmpeg, "_ffmpeg", lambda args: calls.append(args))
    ffmpeg.extract_audio(Path("/v/in.mp4"), Path("/tmp/vo.wav"))
    argv = calls[0]
    assert "-vn" in argv and "pcm_s16le" in argv
    assert argv[argv.index("-ar") + 1] == "24000"


def test_mix_music_over_argv(monkeypatch):
    from marketer.services import ffmpeg

    calls: list[list[str]] = []
    monkeypatch.setattr(ffmpeg, "_ffmpeg", lambda args: calls.append(args))
    ffmpeg.mix_music_over(
        Path("/v/in.mp4"), Path("/m/track.mp3"), Path("/tmp/out.mp4"),
        music_gain_db=-20.0,
    )
    argv = calls[0]
    fc = argv[argv.index("-filter_complex") + 1]
    assert "volume=-20.0dB" in fc
    assert "sidechaincompress" in fc
    # Video is stream-copied; the mixed audio is mapped in.
    assert argv[argv.index("-c:v") + 1] == "copy"
    assert "[a]" in argv


# --------------------------------------------------------------------------- routes


def test_image_post_retry_route(monkeypatch):
    from uuid import uuid4

    from tests.test_audit_round2_fixes import _make_authed_client

    client = _make_authed_client(monkeypatch)
    from marketer.repos import image_posts as repo

    post_id = uuid4()
    claimed: dict = {}

    async def fake_claim(pid, *, user_id):
        claimed["pid"] = pid
        return True

    spawned: dict = {}

    class _Fn:
        def spawn(self, *a):
            spawned["args"] = a

    import modal

    monkeypatch.setattr(repo, "claim_for_retry", fake_claim)
    monkeypatch.setattr(modal.Function, "from_name", staticmethod(lambda app, name: _Fn()))

    resp = client.post(f"/api/v1/image-posts/{post_id}/retry")
    assert resp.status_code == 202
    assert claimed["pid"] == post_id
    assert spawned["args"][1] == str(post_id)


def test_image_post_retry_conflict_when_not_failed(monkeypatch):
    from uuid import uuid4

    from tests.test_audit_round2_fixes import _make_authed_client

    client = _make_authed_client(monkeypatch)
    from marketer.repos import image_posts as repo

    async def fake_claim(pid, *, user_id):
        return False

    async def fake_get(pid, *, user_id):
        return {"id": str(pid), "status": "generating"}

    monkeypatch.setattr(repo, "claim_for_retry", fake_claim)
    monkeypatch.setattr(repo, "get", fake_get)
    resp = client.post(f"/api/v1/image-posts/{uuid4()}/retry")
    assert resp.status_code == 409


def test_templates_admin_all_requires_admin(monkeypatch):
    from tests.test_audit_round2_fixes import _make_authed_client

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/templates/admin/all")
    # Non-admin: the require_admin dependency rejects before any DB access.
    assert resp.status_code in (401, 403)


def test_templates_admin_all_lists_drafts(monkeypatch):
    from tests.test_audit_round2_fixes import _make_admin_client

    client = _make_admin_client(monkeypatch)
    from marketer.repos import templates as templates_repo

    seen: dict = {}

    async def fake_list(*, published_only, kind=None):
        seen["published_only"] = published_only
        return []

    monkeypatch.setattr(templates_repo, "list_templates", fake_list)
    resp = client.get("/api/v1/templates/admin/all")
    assert resp.status_code == 200
    assert seen["published_only"] is False


def test_providers_audio_endpoint(monkeypatch):
    from tests.test_audit_round2_fixes import _make_authed_client

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/providers/audio")
    assert resp.status_code == 200
    body = resp.json()
    providers = {v["provider"]: v for v in body["voice_providers"]}
    assert providers["openai"]["available"] is True  # stubbed key in conftest
    assert providers["elevenlabs"]["available"] is False
    assert body["generated_music_available"] is False
