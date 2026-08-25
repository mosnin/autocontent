"""Media MCP tools: user-scoped, metered-by-the-API, validated before spend.

The tools are plain async functions taking a client factory, so every test
here drives them through a `MarketerClient` backed by an
`httpx.MockTransport` — no MCP client, no backend, no network.
"""
from __future__ import annotations

import json

import httpx
import pytest

from marketer.config import settings
from marketer.mcp_tools import media
from marketer.sdk import MarketerClient, MarketerError
from marketer.services.seedance import SeedanceDisabled, SeedanceValidationError

T2V = "seedance-2.5-text-to-video"
I2V = "seedance-2.5-image-to-video"


@pytest.fixture
def gateway_key(monkeypatch):
    """Seedance is available (shared MuAPI gateway credential)."""
    monkeypatch.setattr(settings, "muapi_api_key", "mu-key")
    return settings


def _factory(handler):
    """A client factory over a MockTransport, plus the recorded requests."""
    requests: list[httpx.Request] = []

    def _recording(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    def factory() -> MarketerClient:
        return MarketerClient(
            base_url="http://api.test",
            token="mkt_dummy12345678",
            transport=httpx.MockTransport(_recording),
        )

    return factory, requests


def _studio_models(models=None):
    return {
        "models": models
        if models is not None
        else [
            {
                "id": "grok-video",
                "name": "Grok Video",
                "aspect_ratios": ["9:16"],
                "duration": {"kind": "range", "min": 6, "max": 30, "default": 6},
                "cost_basis": {"unit": "usd_per_second", "by_resolution": {"480p": "0.05"}},
            }
        ],
        "max_reference_images": 7,
    }


def _catalog_handler(studio_status: int = 200, studio_body=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == media.UGC_MODELS_PATH:
            if studio_status != 200:
                return httpx.Response(studio_status, json={"detail": "the UGC studio is disabled"})
            return httpx.Response(200, json=studio_body or _studio_models())
        if request.url.path == media.VIDEO_MODELS_PATH:
            return httpx.Response(
                200,
                json=[
                    {
                        "provider": "fal",
                        "model_id": "fal-ai/kling-video/v2.1/standard/image-to-video",
                        "name": "Kling 2.1 Standard",
                        "usd_per_second": "0.05",
                        "available": True,
                    }
                ],
            )
        return httpx.Response(404, json={"detail": "not found"})

    return handler


# ----------------------------------------------------------------- catalogue


async def test_list_video_models_merges_studio_pipeline_and_seedance(gateway_key):
    factory, _ = _factory(_catalog_handler())

    payload = json.loads(await media.list_video_models(factory))

    assert [m["id"] for m in payload["generation_models"]] == ["grok-video"]
    assert payload["pipeline_renderers"][0]["provider"] == "fal"
    seedance_ids = {m["id"] for m in payload["seedance_models"]}
    assert T2V in seedance_ids and I2V in seedance_ids
    entry = next(m for m in payload["seedance_models"] if m["id"] == T2V)
    assert entry["available"] is True
    # The studio catalog doesn't expose the Seedance routes yet, so the
    # tool says so instead of letting an agent submit into a 400.
    assert entry["submittable"] is False
    assert entry["cost_basis"]["by_resolution"]["720p"] == "0.10"
    assert "dolly_in" in entry["camera_controls"]


async def test_seedance_marked_submittable_once_the_studio_exposes_it(gateway_key):
    factory, _ = _factory(_catalog_handler(studio_body=_studio_models([{"id": T2V}])))

    payload = json.loads(await media.list_video_models(factory))

    entry = next(m for m in payload["seedance_models"] if m["id"] == T2V)
    assert entry["submittable"] is True


async def test_unconfigured_seedance_is_reported_unavailable(monkeypatch):
    # House rule: an unconfigured provider is loudly unavailable, never a
    # silent omission that reads as "this model doesn't exist".
    monkeypatch.setattr(settings, "muapi_api_key", "")
    factory, _ = _factory(_catalog_handler())

    payload = json.loads(await media.list_video_models(factory))

    assert all(m["available"] is False for m in payload["seedance_models"])


async def test_disabled_studio_degrades_with_an_explicit_reason(gateway_key):
    factory, _ = _factory(_catalog_handler(studio_status=409))

    payload = json.loads(await media.list_video_models(factory))

    assert payload["generation_models"] == []
    assert "409" in payload["generation_models_unavailable"]
    assert "disabled" in payload["generation_models_unavailable"]
    # The rest of the catalog still answers.
    assert payload["pipeline_renderers"][0]["provider"] == "fal"


async def test_list_image_models_returns_a_pinned_rate_card():
    factory, requests = _factory(_catalog_handler())

    payload = json.loads(await media.list_image_models(factory))

    model = payload["image_models"][0]
    assert model["id"] == "gpt-image-1"
    assert model["cost_basis"]["unit"] == "usd_per_image"
    assert model["sizes"]
    assert requests == []  # read of a local pinned table, no API call


# ---------------------------------------------------------------- submission


def _submit_handler(status: int = 202, body=None):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status, json=body or {"id": "11111111-1111-1111-1111-111111111111", "status": "queued"}
        )

    return handler


async def test_submit_posts_to_the_metered_http_api(gateway_key):
    factory, requests = _factory(_submit_handler())

    out = json.loads(
        await media.submit_video_generation(
            factory, model_id=T2V, prompt="a boat", duration=6, resolution="480p"
        )
    )

    assert out["status"] == "queued"
    assert len(requests) == 1
    req = requests[0]
    # Metering, caps and prepaid credit live behind this endpoint; the tool
    # never calls a provider directly, so there is no unmetered spend path.
    assert req.method == "POST" and req.url.path == media.UGC_RENDERS_PATH
    assert req.headers["authorization"] == "Bearer mkt_dummy12345678"
    assert json.loads(req.content) == {
        "model_id": T2V,
        "prompt": "a boat",
        "image_urls": [],
        "duration": 6,
        "resolution": "480p",
    }


async def test_seedance_parameters_are_validated_before_any_spend(gateway_key):
    factory, requests = _factory(_submit_handler())

    with pytest.raises(SeedanceValidationError, match="aspect ratio"):
        await media.submit_video_generation(
            factory, model_id=T2V, prompt="a boat", aspect_ratio="5:4"
        )
    with pytest.raises(SeedanceValidationError, match="duration"):
        await media.submit_video_generation(factory, model_id=T2V, prompt="a boat", duration=99)
    with pytest.raises(SeedanceValidationError, match="resolution"):
        await media.submit_video_generation(
            factory, model_id=T2V, prompt="a boat", resolution="1080p"
        )
    with pytest.raises(SeedanceValidationError, match="unknown seedance model"):
        await media.submit_video_generation(factory, model_id="seedance-2.5-nope", prompt="x")

    assert requests == []


async def test_seedance_without_a_key_fails_loudly_not_silently(monkeypatch):
    monkeypatch.setattr(settings, "muapi_api_key", "")
    factory, requests = _factory(_submit_handler())

    with pytest.raises(SeedanceDisabled, match="MARKETER_SEEDANCE_API_KEY"):
        await media.submit_video_generation(factory, model_id=T2V, prompt="a boat")

    assert requests == []


async def test_camera_move_is_folded_into_the_prompt_for_seedance(gateway_key):
    factory, requests = _factory(_submit_handler())

    await media.submit_video_generation(
        factory, model_id=T2V, prompt="A red boat drifting", camera_move="orbit_left"
    )

    body = json.loads(requests[0].content)
    assert body["prompt"] == "A red boat drifting. camera orbits the subject to the left."
    assert "camera_move" not in body


async def test_camera_move_on_a_non_seedance_model_is_rejected(gateway_key):
    factory, requests = _factory(_submit_handler())

    with pytest.raises(ValueError, match="only supported by Seedance"):
        await media.submit_video_generation(
            factory, model_id="grok-video", prompt="hi", camera_move="orbit_left"
        )

    assert requests == []


async def test_non_seedance_models_are_left_to_the_api_validator(gateway_key):
    factory, requests = _factory(_submit_handler())

    await media.submit_video_generation(
        factory, model_id="grok-video", prompt="hi", mode="fun", niche_id="n-1"
    )

    body = json.loads(requests[0].content)
    assert body["mode"] == "fun" and body["niche_id"] == "n-1"


async def test_spend_cap_refusal_surfaces_as_an_error(gateway_key):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"detail": "niche daily cap reached"})

    factory, _ = _factory(handler)

    with pytest.raises(MarketerError) as exc:
        await media.submit_video_generation(factory, model_id=T2V, prompt="hi")
    assert exc.value.status_code == 402
    assert "cap" in exc.value.message


async def test_retry_posts_to_the_retry_endpoint(gateway_key):
    factory, requests = _factory(_submit_handler(body={"id": "r1", "status": "queued"}))

    await media.retry_video_generation(factory, "r1")

    assert requests[0].method == "POST"
    assert requests[0].url.path == f"{media.UGC_RENDERS_PATH}/r1/retry"


# -------------------------------------------------------------- status/assets


def _render_row(status: str, video_url: str = "", error: str = ""):
    return {
        "id": "r1",
        "model_id": T2V,
        "status": status,
        "video_url": video_url,
        "error": error,
    }


async def test_list_generations_bounds_the_limit_and_passes_the_filter():
    factory, requests = _factory(lambda request: httpx.Response(200, json=[]))

    await media.list_video_generations(factory, status="failed", limit=9999)

    assert requests[0].url.params["status_filter"] == "failed"
    assert requests[0].url.params["limit"] == "200"


async def test_get_generation_returns_the_row():
    factory, requests = _factory(
        lambda request: httpx.Response(200, json=_render_row("running"))
    )

    out = json.loads(await media.get_video_generation(factory, "r1"))

    assert out["status"] == "running"
    assert requests[0].url.path == f"{media.UGC_RENDERS_PATH}/r1"


async def test_asset_is_returned_only_when_it_is_actually_ready():
    factory, _ = _factory(
        lambda request: httpx.Response(
            200, json=_render_row("done", video_url="https://cdn/v.mp4")
        )
    )

    out = json.loads(await media.get_generation_asset(factory, "r1"))

    assert out == {
        "generation_id": "r1",
        "status": "done",
        "model_id": T2V,
        "ready": True,
        "video_url": "https://cdn/v.mp4",
    }


async def test_pending_asset_says_so_instead_of_returning_a_blank_url():
    factory, _ = _factory(lambda request: httpx.Response(200, json=_render_row("running")))

    out = json.loads(await media.get_generation_asset(factory, "r1"))

    assert out["ready"] is False
    assert "video_url" not in out
    assert "still rendering" in out["detail"]


async def test_failed_asset_reports_the_error():
    factory, _ = _factory(
        lambda request: httpx.Response(200, json=_render_row("failed", error="nsfw prompt"))
    )

    out = json.loads(await media.get_generation_asset(factory, "r1"))

    assert out["ready"] is False
    assert out["error"] == "nsfw prompt"


async def test_completed_row_without_a_url_is_not_reported_ready():
    factory, _ = _factory(lambda request: httpx.Response(200, json=_render_row("done")))

    out = json.loads(await media.get_generation_asset(factory, "r1"))

    assert out["ready"] is False


# ------------------------------------------------------------- registration


@pytest.fixture
def registered_server():
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("marketer-test")
    factory, _ = _factory(_catalog_handler())
    media.register(mcp, factory)
    return mcp


async def test_register_binds_every_media_tool(registered_server):
    names = {t.name for t in await registered_server.list_tools()}
    assert {
        "list_video_models",
        "list_image_models",
        "submit_video_generation",
        "list_video_generations",
        "get_video_generation",
        "get_generation_asset",
        "retry_video_generation",
    } <= names


async def test_spending_tools_warn_the_model_in_their_description(registered_server):
    tools = {t.name: t for t in await registered_server.list_tools()}
    for name in ("submit_video_generation", "retry_video_generation"):
        desc = (tools[name].description or "").lower()
        assert "expensive" in desc
        assert "confirm" in desc
    # Read-only tools must not be scary, or agents will avoid checking status.
    assert "expensive" not in (tools["get_generation_asset"].description or "").lower()


async def test_submit_tool_declares_its_parameters(registered_server):
    tool = {t.name: t for t in await registered_server.list_tools()}["submit_video_generation"]
    props = tool.inputSchema["properties"]
    assert {"model_id", "prompt", "aspect_ratio", "duration", "resolution", "camera_move"} <= set(
        props
    )
    assert tool.inputSchema["required"] == ["model_id", "prompt"]
