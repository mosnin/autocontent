from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from autocontent.services import grok_imagine


PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
    b"\xc0\xc0\xc0\x00\x00\x00\x05\x00\x01]\xcc\xdb\xd1\x00\x00\x00\x00IEND\xaeB`\x82"
)
VIDEO_BYTES = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
VIDEO_URL = "https://vidgen.x.ai/jobs/req_test/video.mp4"


def _make_handler(*, poll_sequence: list[str], record: dict) -> httpx.MockTransport:
    """Build a transport that simulates submit -> N polls -> download."""
    polls: list[str] = list(poll_sequence)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/videos/generations"):
            record["submit"] = request
            return httpx.Response(200, json={"request_id": "req_test"})
        if request.method == "GET" and request.url.path.endswith("/videos/req_test"):
            status = polls.pop(0)
            if status == "done":
                return httpx.Response(200, json={
                    "status": "done",
                    "video": {"url": VIDEO_URL, "duration": 5},
                })
            if status in ("failed", "expired"):
                return httpx.Response(200, json={"status": status, "error": "boom"})
            return httpx.Response(200, json={"status": status})
        if request.method == "GET" and str(request.url) == VIDEO_URL:
            return httpx.Response(200, content=VIDEO_BYTES)
        return httpx.Response(404, json={"error": f"unhandled {request.method} {request.url}"})

    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def _patch_xai_key(monkeypatch):
    from autocontent.config import settings
    monkeypatch.setattr(settings, "xai_api_key", "xai-test")


@pytest.fixture
def fast_polling(monkeypatch):
    """Skip real sleeps + start polling immediately."""
    monkeypatch.setattr(grok_imagine, "POLL_INTERVAL_SEC", 0)

    async def _no_sleep(_):
        return None
    monkeypatch.setattr(grok_imagine.asyncio, "sleep", _no_sleep)


@pytest.fixture
def patch_client(monkeypatch):
    """Replace `_client()` so `animate` uses an injected MockTransport."""
    holder: dict = {}

    def install(transport: httpx.MockTransport) -> dict:
        def _factory():
            return httpx.AsyncClient(
                base_url=grok_imagine.BASE_URL,
                transport=transport,
                headers={"Authorization": "Bearer xai-test"},
            )
        monkeypatch.setattr(grok_imagine, "_client", _factory)
        return holder

    return install


async def test_animate_submits_polls_downloads_and_logs_spend(
    tmp_path: Path, fake_spend, fast_polling, patch_client
):
    ctx, rec = fake_spend
    keyframe = tmp_path / "kf.png"
    keyframe.write_bytes(PNG)
    out = tmp_path / "clip.mp4"

    record: dict = {}
    transport = _make_handler(
        poll_sequence=["pending", "pending", "done"], record=record
    )
    patch_client(transport)

    result = await grok_imagine.animate(
        keyframe, "a slow zoom on the duck", out,
        duration_sec=5.0, aspect_ratio="9:16", spend=ctx,
    )

    assert result == out
    assert out.read_bytes() == VIDEO_BYTES

    import json
    submit_body = json.loads(record["submit"].read())
    assert submit_body["model"] == "grok-imagine-video"
    assert submit_body["duration"] == 5
    assert submit_body["aspect_ratio"] == "9:16"
    assert submit_body["resolution"] == "480p"
    assert submit_body["image"].startswith("data:image/png;base64,")

    assert len(rec.entries) == 1
    entry = rec.entries[0]
    assert entry.sku == "grok-imagine-video"
    # 5 sec × $0.050/sec
    assert entry.cost_usd == Decimal("0.2500")


async def test_animate_clamps_duration(tmp_path, fake_spend, fast_polling, patch_client):
    ctx, _ = fake_spend
    keyframe = tmp_path / "kf.png"
    keyframe.write_bytes(PNG)
    out = tmp_path / "clip.mp4"
    record: dict = {}
    patch_client(_make_handler(poll_sequence=["done"], record=record))

    await grok_imagine.animate(
        keyframe, "x", out, duration_sec=99.0, spend=ctx,
    )
    import json
    assert json.loads(record["submit"].read())["duration"] == 15


async def test_animate_raises_on_failed_status(tmp_path, fake_spend, fast_polling, patch_client):
    ctx, _ = fake_spend
    keyframe = tmp_path / "kf.png"
    keyframe.write_bytes(PNG)
    record: dict = {}
    patch_client(_make_handler(poll_sequence=["pending", "failed"], record=record))

    with pytest.raises(grok_imagine.GrokImagineError) as excinfo:
        await grok_imagine.animate(
            keyframe, "x", tmp_path / "out.mp4", duration_sec=5.0, spend=ctx,
        )
    assert "failed" in str(excinfo.value)


async def test_animate_no_spend_when_ctx_omitted(
    tmp_path, fast_polling, patch_client
):
    keyframe = tmp_path / "kf.png"
    keyframe.write_bytes(PNG)
    out = tmp_path / "clip.mp4"
    patch_client(_make_handler(poll_sequence=["done"], record={}))

    await grok_imagine.animate(keyframe, "x", out, duration_sec=5.0)
    assert out.exists()
