"""Contract-correctness tests for the fal video service.

External HTTP and ffmpeg calls are mocked — no real fal, no real
ffmpeg binary invoked. Style mirrors tests/test_providers_and_kits.py.
"""
from __future__ import annotations

import json
import logging
import wave
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from marketer.config import settings
from marketer.services import fal_video

KLING = fal_video.get_model("fal-ai/kling-video/v2.1/standard/image-to-video")
VEO3_FAST = fal_video.get_model("fal-ai/veo3/fast/image-to-video")
VEO3 = fal_video.get_model("fal-ai/veo3/image-to-video")
LUMA = fal_video.get_model("fal-ai/luma-dream-machine/ray-2")
SORA = fal_video.get_model("fal-ai/sora-2/image-to-video")
PIXVERSE = fal_video.get_model("fal-ai/pixverse/v5/image-to-video")
OMNIHUMAN = fal_video.get_model("fal-ai/bytedance/omnihuman")


def _make_wav(path: Path, seconds: float, rate: int = 24_000) -> None:
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * frames)


# --------------------------------------------------------------------------- duration formatting


def test_duration_format_bare_for_kling():
    assert fal_video.format_duration(KLING, 5) == "5"


def test_duration_format_bare_for_sora():
    assert fal_video.format_duration(SORA, 8) == "8"


def test_duration_format_bare_for_pixverse():
    assert fal_video.format_duration(PIXVERSE, 8) == "8"


def test_duration_format_suffixed_for_veo3_fast():
    assert fal_video.format_duration(VEO3_FAST, 8) == "8s"


def test_duration_format_suffixed_for_veo3():
    assert fal_video.format_duration(VEO3, 8) == "8s"


def test_duration_format_suffixed_for_luma_ray2():
    assert fal_video.format_duration(LUMA, 5) == "5s"
    assert fal_video.format_duration(LUMA, 9) == "9s"


def test_registry_duration_suffix_defaults_empty_for_untouched_models():
    for model in fal_video.FAL_VIDEO_MODELS:
        if model.id in {
            "fal-ai/veo3/fast/image-to-video",
            "fal-ai/veo3/image-to-video",
            "fal-ai/luma-dream-machine/ray-2",
        }:
            assert model.duration_suffix == "s"
        else:
            assert model.duration_suffix == ""


# --------------------------------------------------------------------------- input resize (sora only)


def test_sora_has_input_size_others_dont():
    assert SORA.input_size == (720, 1280)
    for model in fal_video.FAL_VIDEO_MODELS:
        if model.id != "fal-ai/sora-2/image-to-video":
            assert model.input_size is None


def test_resize_keyframe_invokes_ffmpeg_with_letterbox_filter(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(fal_video, "_run_ffmpeg", lambda cmd: calls.append(cmd))
    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")

    out = fal_video._resize_keyframe(kf, (720, 1280))

    assert len(calls) == 1
    cmd = calls[0]
    assert "-i" in cmd and str(kf) in cmd
    vf = cmd[cmd.index("-vf") + 1]
    assert "scale=720:1280" in vf
    assert "pad=720:1280" in vf
    assert out.name.endswith("720x1280.png")


async def _mocked_flow(monkeypatch, model, tmp_path, spend=None, extra_asserts=None):
    """Wire up a fake client for animate() and return the out path."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")

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
            yield b"MP4DATA"

    posted = {}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            posted["url"] = url
            posted["json"] = json
            if extra_asserts:
                extra_asserts(json)
            return _Resp({
                "request_id": "r1",
                "status_url": "https://queue.fal.run/r1/status",
                "response_url": "https://queue.fal.run/r1/response",
            })

        async def get(self, url):
            if url.endswith("/status"):
                return _Resp({"status": "COMPLETED"})
            return _Resp({"video": {"url": "https://cdn.fal/video.mp4"}})

        def stream(self, method, url):
            return _Stream()

    monkeypatch.setattr(fal_video, "_client", lambda: _Client())

    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    out = tmp_path / "out.mp4"
    await fal_video.animate(
        kf, "pan", out, model_id=model.id, duration_sec=model.allowed_durations[0],
        spend=spend,
    )
    return posted


async def test_animate_resizes_keyframe_for_sora(tmp_path, monkeypatch):
    resize_calls = []

    def _fake_resize(path, size):
        resized = path.with_name("resized.png")
        resized.write_bytes(b"RESIZEDPNG")
        resize_calls.append((path, size))
        return resized

    monkeypatch.setattr(fal_video, "_resize_keyframe", _fake_resize)

    posted = await _mocked_flow(monkeypatch, SORA, tmp_path)

    assert len(resize_calls) == 1
    assert resize_calls[0][1] == (720, 1280)
    # the resized image's bytes went into the body, not the original keyframe
    assert "RESIZEDPNG".encode().hex() not in posted["json"]["image_url"]  # base64, not hex
    import base64 as _b64
    assert _b64.b64encode(b"RESIZEDPNG").decode() in posted["json"]["image_url"]


async def test_animate_does_not_resize_for_kling(tmp_path, monkeypatch):
    resize_calls = []
    monkeypatch.setattr(
        fal_video, "_resize_keyframe",
        lambda path, size: resize_calls.append((path, size)) or path,
    )

    await _mocked_flow(monkeypatch, KLING, tmp_path)

    assert resize_calls == []


async def test_animate_sends_suffixed_duration_for_veo3(tmp_path, monkeypatch):
    posted = await _mocked_flow(monkeypatch, VEO3_FAST, tmp_path)
    assert posted["json"]["duration"] == "8s"


async def test_animate_sends_bare_duration_for_kling(tmp_path, monkeypatch):
    posted = await _mocked_flow(monkeypatch, KLING, tmp_path)
    assert posted["json"]["duration"] == "5"


# --------------------------------------------------------------------------- retry predicate


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://queue.fal.run/x")
    response = httpx.Response(code, request=request)
    return httpx.HTTPStatusError(f"{code}", request=request, response=response)


@pytest.mark.parametrize("code", [429, 500, 502, 503])
def test_retryable_status_codes(code):
    assert fal_video._is_retryable(_status_error(code)) is True


@pytest.mark.parametrize("code", [400, 401, 402, 403, 404, 422])
def test_non_retryable_4xx_status_codes(code):
    assert fal_video._is_retryable(_status_error(code)) is False


def test_transport_errors_are_retryable():
    assert fal_video._is_retryable(httpx.ConnectTimeout("boom")) is True
    assert fal_video._is_retryable(httpx.ReadTimeout("boom")) is True
    assert fal_video._is_retryable(httpx.ConnectError("boom")) is True


def test_non_httpx_exception_not_retryable():
    assert fal_video._is_retryable(ValueError("nope")) is False


async def test_submit_does_not_retry_422(monkeypatch):
    calls = {"n": 0}

    class _Client:
        async def post(self, url, json=None):
            calls["n"] += 1
            raise _status_error(422)

    with pytest.raises(httpx.HTTPStatusError):
        await fal_video._submit(_Client(), "fal-ai/x", {})
    assert calls["n"] == 1


async def test_submit_retries_on_429_then_succeeds(monkeypatch):
    calls = {"n": 0}

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status_url": "u", "response_url": "v"}

    class _Client:
        async def post(self, url, json=None):
            calls["n"] += 1
            if calls["n"] < 2:
                raise _status_error(429)
            return _Resp()

    out = await fal_video._submit(_Client(), "fal-ai/x", {})
    assert calls["n"] == 2
    assert out == {"status_url": "u", "response_url": "v"}


# --------------------------------------------------------------------------- avatar audio clamp


async def test_animate_avatar_raises_before_spend_when_audio_too_long(
    tmp_path, monkeypatch, fake_spend,
):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")

    def _boom_client():
        raise AssertionError("must not open an HTTP client before the audio-length check")

    monkeypatch.setattr(fal_video, "_client", _boom_client)

    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    audio = tmp_path / "vo.wav"
    _make_wav(audio, OMNIHUMAN.max_duration_sec + 5)

    ctx, rec = fake_spend
    with pytest.raises(fal_video.FalVideoError, match="cap"):
        await fal_video.animate_avatar(
            kf, audio, tmp_path / "out.mp4", model_id=OMNIHUMAN.id, spend=ctx,
        )
    assert rec.entries == []


async def test_animate_avatar_allows_audio_within_cap(tmp_path, monkeypatch, fake_spend):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")

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
            yield b"MP4DATA"

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            return _Resp({
                "request_id": "r1",
                "status_url": "https://queue.fal.run/r1/status",
                "response_url": "https://queue.fal.run/r1/response",
            })

        async def get(self, url):
            if url.endswith("/status"):
                return _Resp({"status": "COMPLETED"})
            return _Resp({"video": {"url": "https://cdn.fal/video.mp4"}})

        def stream(self, method, url):
            return _Stream()

    monkeypatch.setattr(fal_video, "_client", lambda: _Client())

    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    audio = tmp_path / "vo.wav"
    _make_wav(audio, 5.0)
    ctx, rec = fake_spend

    out = await fal_video.animate_avatar(
        kf, audio, tmp_path / "out.mp4", model_id=OMNIHUMAN.id, spend=ctx,
    )
    assert out.read_bytes() == b"MP4DATA"
    assert len(rec.entries) == 1


# --------------------------------------------------------------------------- oversized payload guard


def test_image_to_data_uri_rejects_oversized_file(tmp_path, monkeypatch):
    monkeypatch.setattr(fal_video, "MAX_DATA_URI_BYTES", 100)
    big = tmp_path / "big.png"
    big.write_bytes(b"x" * 1000)
    with pytest.raises(fal_video.FalVideoError, match="keyframe image"):
        fal_video._image_to_data_uri(big)


def test_audio_to_data_uri_rejects_oversized_file(tmp_path, monkeypatch):
    monkeypatch.setattr(fal_video, "MAX_DATA_URI_BYTES", 100)
    big = tmp_path / "big.wav"
    big.write_bytes(b"x" * 1000)
    with pytest.raises(fal_video.FalVideoError, match="voiceover audio"):
        fal_video._audio_to_data_uri(big)


# --------------------------------------------------------------------------- price override warnings


def test_price_overrides_logs_warning_on_bad_json(monkeypatch, caplog):
    monkeypatch.setattr(settings, "fal_price_overrides", "{not json")
    with caplog.at_level(logging.WARNING, logger="marketer.services.fal_video"):
        out = fal_video._price_overrides()
    assert out == {}
    assert any("not valid JSON" in r.message for r in caplog.records)


def test_price_overrides_logs_warning_on_bad_entry(monkeypatch, caplog):
    monkeypatch.setattr(
        settings, "fal_price_overrides",
        json.dumps({"fal-ai/veo3/image-to-video": "not-a-number"}),
    )
    with caplog.at_level(logging.WARNING, logger="marketer.services.fal_video"):
        out = fal_video._price_overrides()
    assert out == {}
    assert any("dropping unparseable price" in r.message for r in caplog.records)


def test_price_overrides_logs_warning_on_non_positive_entry(monkeypatch, caplog):
    monkeypatch.setattr(
        settings, "fal_price_overrides",
        json.dumps({"fal-ai/veo3/image-to-video": "-1"}),
    )
    with caplog.at_level(logging.WARNING, logger="marketer.services.fal_video"):
        out = fal_video._price_overrides()
    assert out == {}
    assert any("dropping non-positive price" in r.message for r in caplog.records)


def test_price_overrides_applies_valid_entry(monkeypatch):
    monkeypatch.setattr(
        settings, "fal_price_overrides",
        json.dumps({"fal-ai/veo3/image-to-video": "0.45"}),
    )
    model = fal_video.get_model("fal-ai/veo3/image-to-video")
    assert model.usd_per_second == Decimal("0.45")


def test_price_overrides_not_a_dict_logs_warning(monkeypatch, caplog):
    monkeypatch.setattr(settings, "fal_price_overrides", json.dumps(["a", "b"]))
    with caplog.at_level(logging.WARNING, logger="marketer.services.fal_video"):
        out = fal_video._price_overrides()
    assert out == {}
    assert any("expected a JSON object" in r.message for r in caplog.records)
