"""MUAPI provider client contract. All HTTP is served by a MockTransport —
no network, no real MUAPI."""
from __future__ import annotations

import httpx
import pytest

from marketer.config import settings
from marketer.services import muapi


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "ugc_enabled", True)
    monkeypatch.setattr(settings, "muapi_api_key", "mu-test-key")
    monkeypatch.setattr(settings, "muapi_base_url", "https://api.muapi.ai/api/v1")
    monkeypatch.setattr(settings, "muapi_webhook_url", "https://app.example.com")
    monkeypatch.setattr(settings, "muapi_webhook_secret", "s3cret")
    return settings


def _mock_client(monkeypatch, handler):
    def _factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=settings.muapi_base_url.rstrip("/"),
            transport=httpx.MockTransport(handler),
            headers={"x-api-key": settings.muapi_api_key},
        )

    monkeypatch.setattr(muapi, "_client", _factory)


# --------------------------------------------------------------- config gating


def test_disabled_by_default():
    assert muapi.enabled() is False


def test_require_enabled_names_the_missing_switch(monkeypatch):
    monkeypatch.setattr(settings, "ugc_enabled", False)
    monkeypatch.setattr(settings, "muapi_api_key", "k")
    with pytest.raises(muapi.MuapiDisabled, match="MARKETER_UGC_ENABLED"):
        muapi.require_enabled()

    monkeypatch.setattr(settings, "ugc_enabled", True)
    monkeypatch.setattr(settings, "muapi_api_key", "")
    with pytest.raises(muapi.MuapiDisabled, match="MARKETER_MUAPI_API_KEY"):
        muapi.require_enabled()


async def test_submit_refuses_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "ugc_enabled", False)
    with pytest.raises(muapi.MuapiDisabled):
        await muapi.submit(endpoint="x", prompt="p", image_urls=[], params={})


# --------------------------------------------------------------- webhook url


def test_webhook_url_carries_the_secret(configured):
    assert (
        muapi.webhook_url()
        == "https://app.example.com/api/v1/ugc/webhook?token=s3cret"
    )


def test_webhook_url_is_empty_without_a_secret(configured, monkeypatch):
    # Publishing a tokenless callback URL buys nothing: the inbound route
    # refuses unsigned deliveries anyway.
    monkeypatch.setattr(settings, "muapi_webhook_secret", "")
    assert muapi.webhook_url() == ""


def test_webhook_url_is_empty_without_a_public_origin(configured, monkeypatch):
    monkeypatch.setattr(settings, "muapi_webhook_url", "")
    assert muapi.webhook_url() == ""


# --------------------------------------------------------------- payload shape


def test_payload_sends_both_image_url_and_images_list():
    body = muapi.build_payload(
        prompt="hi",
        image_urls=["https://a/1.png", "https://a/2.png"],
        params={"aspect_ratio": "9:16", "duration": 6},
        callback_url="https://app/cb?token=x",
    )
    assert body["image_url"] == "https://a/1.png"
    assert body["images_list"] == ["https://a/1.png", "https://a/2.png"]
    assert body["aspect_ratio"] == "9:16"
    assert body["webhook_url"] == "https://app/cb?token=x"


def test_payload_omits_image_fields_in_text_to_video():
    body = muapi.build_payload(prompt="hi", image_urls=[], params={"duration": 8})
    assert "image_url" not in body
    assert "images_list" not in body
    assert "webhook_url" not in body


# --------------------------------------------------------------- submit / poll


async def test_submit_posts_to_the_model_endpoint_and_returns_request_id(
    configured, monkeypatch
):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-api-key")
        seen["body"] = request.read().decode()
        return httpx.Response(200, json={"request_id": "req-42"})

    _mock_client(monkeypatch, handler)
    rid = await muapi.submit(
        endpoint="veo3.1-image-to-video",
        prompt="hello",
        image_urls=["https://cdn.example.com/a.png"],
        params={"aspect_ratio": "9:16", "duration": 8, "resolution": "720p"},
    )
    assert rid == "req-42"
    assert seen["url"] == "https://api.muapi.ai/api/v1/veo3.1-image-to-video"
    assert seen["key"] == "mu-test-key"
    assert "images_list" in seen["body"]
    assert "token=s3cret" in seen["body"]


async def test_submit_accepts_the_id_alias(configured, monkeypatch):
    _mock_client(monkeypatch, lambda r: httpx.Response(200, json={"id": "req-7"}))
    assert await muapi.submit(endpoint="e", prompt="p", image_urls=[], params={}) == "req-7"


async def test_submit_without_a_request_id_is_an_error(configured, monkeypatch):
    _mock_client(monkeypatch, lambda r: httpx.Response(200, json={"ok": True}))
    with pytest.raises(muapi.MuapiError, match="request id"):
        await muapi.submit(endpoint="e", prompt="p", image_urls=[], params={})


async def test_submit_does_not_retry_a_deterministic_4xx(configured, monkeypatch):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, json={"error": "bad params"})

    _mock_client(monkeypatch, handler)
    with pytest.raises(httpx.HTTPStatusError):
        await muapi.submit(endpoint="e", prompt="p", image_urls=[], params={})
    assert calls["n"] == 1


async def test_fetch_result_hits_the_prediction_result_path(configured, monkeypatch):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"status": "completed", "outputs": ["u"]})

    _mock_client(monkeypatch, handler)
    out = await muapi.fetch_result("req-9")
    assert out["status"] == "completed"
    assert seen["url"] == "https://api.muapi.ai/api/v1/predictions/req-9/result"


# --------------------------------------------------------------- result parsing


def test_parse_completed_result():
    assert muapi.parse_result(
        {"status": "completed", "outputs": ["https://cdn/v.mp4"]}
    ) == (muapi.STATUS_DONE, "https://cdn/v.mp4", "")


def test_parse_outputs_only_means_done():
    status, url, _ = muapi.parse_result({"outputs": ["https://cdn/v.mp4"]})
    assert (status, url) == (muapi.STATUS_DONE, "https://cdn/v.mp4")


def test_parse_object_shaped_outputs():
    status, url, _ = muapi.parse_result(
        {"status": "completed", "outputs": [{"url": "https://cdn/v.mp4"}]}
    )
    assert (status, url) == (muapi.STATUS_DONE, "https://cdn/v.mp4")


def test_non_empty_error_beats_a_completed_status():
    status, _, err = muapi.parse_result({"status": "completed", "error": "nsfw"})
    assert status == muapi.STATUS_FAILED
    assert err == "nsfw"


def test_completed_with_no_outputs_is_a_failure_not_a_null_video():
    # The source writes status=completed, url=null here and the UI shows a
    # permanently broken player.
    status, url, err = muapi.parse_result({"status": "completed", "outputs": []})
    assert status == muapi.STATUS_FAILED
    assert url == ""
    assert "no output" in err


def test_unknown_status_stays_running():
    assert muapi.parse_result({"status": "warming_up"})[0] == muapi.STATUS_RUNNING
    assert muapi.parse_result({})[0] == muapi.STATUS_RUNNING


def test_extract_request_id_accepts_both_keys():
    assert muapi.extract_request_id({"id": "a"}) == "a"
    assert muapi.extract_request_id({"request_id": "b"}) == "b"
    assert muapi.extract_request_id({}) == ""
