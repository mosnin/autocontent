"""Unit tests for marketer.services.fal — the fal.ai client.

No network: every httpx call goes through a MockTransport (same pattern
as tests/test_grok_imagine.py). No real keys.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from marketer.services import fal as fal_svc


@pytest.fixture(autouse=True)
def _fal_key(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "fal_api_key", "fal-test-key")
    monkeypatch.setattr(settings, "fal_image_model", "fal-ai/flux/dev")
    monkeypatch.setattr(settings, "fal_video_model", "fal-ai/kling-video/v1.5/standard/image-to-video")


@pytest.fixture
def fast_polling(monkeypatch):
    monkeypatch.setattr(fal_svc, "POLL_INTERVAL_SEC", 0)

    async def _no_sleep(_):
        return None
    monkeypatch.setattr(fal_svc.asyncio, "sleep", _no_sleep)


@pytest.fixture
def patch_client(monkeypatch):
    def install(transport: httpx.MockTransport) -> None:
        def _factory():
            return httpx.AsyncClient(transport=transport, headers=fal_svc._headers())
        monkeypatch.setattr(fal_svc, "_client", _factory)
    return install


# ---------------------------------------------------------------------------
# StudioDisabled — fail-closed without a key
# ---------------------------------------------------------------------------

async def test_run_raises_studio_disabled_without_key(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "fal_api_key", "")
    with pytest.raises(fal_svc.StudioDisabled):
        await fal_svc.run("fal-ai/flux/dev", {"prompt": "x"})


async def test_submit_raises_studio_disabled_without_key(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "fal_api_key", "")
    with pytest.raises(fal_svc.StudioDisabled):
        await fal_svc.submit("fal-ai/flux/dev", {"prompt": "x"})


def test_require_enabled_raises_without_key(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "fal_api_key", "")
    with pytest.raises(fal_svc.StudioDisabled):
        fal_svc.require_enabled()


def test_require_enabled_ok_with_key():
    fal_svc.require_enabled()  # no raise


# ---------------------------------------------------------------------------
# Model registry / allowlist
# ---------------------------------------------------------------------------

def test_resolve_model_returns_default_when_none():
    assert fal_svc.resolve_model("image", None) == "fal-ai/flux/dev"


def test_resolve_model_accepts_allowed_override():
    assert fal_svc.resolve_model("image", "fal-ai/flux/schnell") == "fal-ai/flux/schnell"


def test_resolve_model_rejects_off_registry_id():
    with pytest.raises(fal_svc.ModelNotAllowed):
        fal_svc.resolve_model("image", "some-rando/totally-unvetted-model")


def test_resolve_model_rejects_model_from_a_different_kind():
    # A real, allowed model id — but for the wrong kind. Still rejected:
    # the allowlist is per-kind, not global.
    with pytest.raises(fal_svc.ModelNotAllowed):
        fal_svc.resolve_model("video", "fal-ai/flux/schnell")


def test_resolve_model_unknown_kind_raises_value_error():
    with pytest.raises(ValueError):
        fal_svc.resolve_model("not-a-real-kind", None)


# ---------------------------------------------------------------------------
# run() — synchronous call shape
# ---------------------------------------------------------------------------

async def test_run_posts_to_fal_run_and_returns_json(patch_client):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.read())
        return httpx.Response(200, json={"images": [{"url": "https://cdn.fal.ai/out.png"}]})

    patch_client(httpx.MockTransport(handler))
    result = await fal_svc.run("fal-ai/flux/dev", {"prompt": "a cat"})

    assert seen["url"] == "https://fal.run/fal-ai/flux/dev"
    assert seen["auth"] == "Key fal-test-key"
    assert seen["body"] == {"prompt": "a cat"}
    assert result == {"images": [{"url": "https://cdn.fal.ai/out.png"}]}


async def test_run_raises_fal_error_on_4xx(patch_client):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, text="bad prompt")

    patch_client(httpx.MockTransport(handler))
    with pytest.raises(fal_svc.FalError):
        await fal_svc.run("fal-ai/flux/dev", {"prompt": "x"})


# ---------------------------------------------------------------------------
# submit/poll — queue flow
# ---------------------------------------------------------------------------

async def test_run_queued_submits_polls_and_returns_result(patch_client, fast_polling):
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(f"{request.method} {request.url.path}")
        if request.url.path == "/fal-ai/kling-video/v1.5/standard/image-to-video":
            return httpx.Response(200, json={"request_id": "req_1"})
        if request.url.path.endswith("/status"):
            n = sum(1 for c in calls if c.endswith("/status"))
            state = "COMPLETED" if n >= 2 else "IN_PROGRESS"
            return httpx.Response(200, json={"status": state})
        # result fetch
        return httpx.Response(200, json={"video": {"url": "https://cdn.fal.ai/clip.mp4"}})

    patch_client(httpx.MockTransport(handler))
    result = await fal_svc.run_queued(
        "fal-ai/kling-video/v1.5/standard/image-to-video", {"image_url": "data:..."}
    )
    assert result == {"video": {"url": "https://cdn.fal.ai/clip.mp4"}}
    assert any(c.startswith("POST") for c in calls)
    assert sum(1 for c in calls if c.endswith("/status")) == 2


async def test_poll_raises_on_error_status(patch_client, fast_polling):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/status"):
            return httpx.Response(200, json={"status": "ERROR", "error": "boom"})
        return httpx.Response(200, json={})

    patch_client(httpx.MockTransport(handler))
    with pytest.raises(fal_svc.FalError):
        await fal_svc.poll("fal-ai/flux/dev", "req_1")


async def test_poll_times_out(patch_client, monkeypatch):
    monkeypatch.setattr(fal_svc, "POLL_INTERVAL_SEC", 0)

    async def _no_sleep(_):
        return None
    monkeypatch.setattr(fal_svc.asyncio, "sleep", _no_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "IN_PROGRESS"})

    patch_client(httpx.MockTransport(handler))
    with pytest.raises(fal_svc.FalError, match="timed out"):
        await fal_svc.poll("fal-ai/flux/dev", "req_1", timeout_sec=-1)


# ---------------------------------------------------------------------------
# extract_asset_url — tolerant response parsing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "result,expected",
    [
        ({"images": [{"url": "https://a/1.png"}]}, "https://a/1.png"),
        ({"image": {"url": "https://a/2.png"}}, "https://a/2.png"),
        ({"video": {"url": "https://a/3.mp4"}}, "https://a/3.mp4"),
        ({"audio": {"url": "https://a/4.mp3"}}, "https://a/4.mp3"),
        ({"image_url": "https://a/5.png"}, "https://a/5.png"),
        ({"url": "https://a/6.png"}, "https://a/6.png"),
    ],
)
def test_extract_asset_url_tolerant_shapes(result, expected):
    assert fal_svc.extract_asset_url(result) == expected


def test_extract_asset_url_raises_when_nothing_found():
    with pytest.raises(fal_svc.FalError):
        fal_svc.extract_asset_url({"unexpected": "shape"})


# ---------------------------------------------------------------------------
# download / to_data_uri
# ---------------------------------------------------------------------------

async def test_download_writes_bytes(tmp_path: Path, patch_client):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"PNGDATA")

    patch_client(httpx.MockTransport(handler))
    out = tmp_path / "sub" / "out.png"
    result = await fal_svc.download("https://cdn.fal.ai/out.png", out)
    assert result == out
    assert out.read_bytes() == b"PNGDATA"


def test_to_data_uri_encodes_as_base64(tmp_path: Path):
    p = tmp_path / "x.png"
    p.write_bytes(b"\x89PNG\r\n")
    uri = fal_svc.to_data_uri(p)
    assert uri.startswith("data:image/png;base64,")
