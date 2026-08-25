"""Seedance provider contract: config gating, metering order, job protocol.

All HTTP is served by an `httpx.MockTransport` — no network, no real
gateway. Style mirrors tests/test_muapi_client.py and
tests/test_fal_contracts.py.
"""
from __future__ import annotations

from decimal import Decimal

import httpx
import pytest

from marketer.config import settings
from marketer.services import provider_limits, seedance
from marketer.services.seedance import (
    SeedanceDisabled,
    SeedanceError,
    SeedanceValidationError,
)

T2V = "seedance-2.5-text-to-video"
I2V = "seedance-2.5-image-to-video"


@pytest.fixture
def cfg(monkeypatch):
    """Seam for the `seedance_*` settings the lead adds to config.py."""
    overrides: dict[str, object] = {}
    real = seedance._setting
    monkeypatch.setattr(
        seedance, "_setting", lambda name, default: overrides.get(name, real(name, default))
    )
    return overrides


@pytest.fixture
def configured(cfg, monkeypatch):
    cfg["seedance_api_key"] = "sd-test-key"
    cfg["seedance_base_url"] = "https://api.muapi.ai/api/v1"
    # SSRF checking does DNS; stub it so the suite stays offline. The
    # rejection path gets its own test below.
    monkeypatch.setattr(seedance, "check_public_url", lambda url: (True, ""))
    # Poll instantly — the protocol, not the wall clock, is under test.
    monkeypatch.setattr(seedance, "POLL_INTERVAL_SEC", 0)
    return cfg


def _mock_client(monkeypatch, handler):
    """Point the provider at a MockTransport-backed client."""
    requests: list[httpx.Request] = []

    def _recording(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    def _factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=seedance.base_url(),
            transport=httpx.MockTransport(_recording),
            headers={"x-api-key": seedance.api_key()},
        )

    monkeypatch.setattr(seedance, "_client", _factory)
    return requests


def _happy_handler(video_url: str = "https://cdn.example.com/out.mp4"):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        if request.url.path.endswith("/result"):
            return httpx.Response(
                200, json={"status": "completed", "outputs": [video_url]}
            )
        return httpx.Response(200, content=b"MP4DATA")

    return handler


class RecordingSpend:
    """Minimal SpendContext stand-in that records call ORDER.

    The order is the contract: `ensure_can_spend` must run before any paid
    provider call, `log` only after the gateway accepted the job.
    """

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def ensure_can_spend(self, estimated_usd: Decimal) -> None:
        self.calls.append(("ensure", estimated_usd))

    async def log(self, *, provider: str, sku: str, units: Decimal, cost_usd: Decimal) -> None:
        self.calls.append(("log", provider, sku, units, cost_usd))


# --------------------------------------------------------------- config gating


def test_disabled_without_any_key(cfg, monkeypatch):
    cfg["seedance_api_key"] = ""
    monkeypatch.setattr(settings, "muapi_api_key", "")
    assert seedance.enabled() is False
    with pytest.raises(SeedanceDisabled, match="MARKETER_SEEDANCE_API_KEY"):
        seedance.require_enabled()


def test_falls_back_to_the_shared_gateway_credential(cfg, monkeypatch):
    # Seedance is served by the same MuAPI gateway account as the UGC
    # studio: one vendor, one credential. This is a credential lookup, not
    # a provider fallback.
    cfg["seedance_api_key"] = ""
    monkeypatch.setattr(settings, "muapi_api_key", "mu-key")
    assert seedance.enabled() is True
    assert seedance.api_key() == "mu-key"


async def test_render_refuses_cleanly_when_unconfigured(cfg, monkeypatch):
    cfg["seedance_api_key"] = ""
    monkeypatch.setattr(settings, "muapi_api_key", "")
    requests = _mock_client(monkeypatch, _happy_handler())
    spend = RecordingSpend()

    with pytest.raises(SeedanceDisabled):
        await seedance.render(model_id=T2V, prompt="hi", spend=spend)

    # Loud and clean: nothing was called, nothing was metered.
    assert requests == []
    assert spend.calls == []


# ------------------------------------------------------------ validation first


async def test_bad_parameter_never_reaches_the_provider(configured, monkeypatch):
    requests = _mock_client(monkeypatch, _happy_handler())
    spend = RecordingSpend()

    with pytest.raises(SeedanceValidationError):
        await seedance.render(model_id=T2V, prompt="hi", duration=99, spend=spend)

    assert requests == []
    assert spend.calls == []


async def test_unknown_model_never_reaches_the_provider(configured, monkeypatch):
    requests = _mock_client(monkeypatch, _happy_handler())
    with pytest.raises(SeedanceValidationError):
        await seedance.render(model_id="seedance-9000", prompt="hi")
    assert requests == []


async def test_non_public_reference_url_is_refused_before_spending(configured, monkeypatch):
    monkeypatch.setattr(seedance, "check_public_url", lambda url: (False, "private ip"))
    requests = _mock_client(monkeypatch, _happy_handler())
    spend = RecordingSpend()

    with pytest.raises(SeedanceValidationError, match="private ip"):
        await seedance.render(
            model_id=I2V, prompt="hi", image_urls=["https://internal/a.jpg"], spend=spend
        )

    assert requests == []
    assert spend.calls == []


# ------------------------------------------------------------------ wire shape


async def test_submit_targets_the_720p_route_with_the_validated_body(configured, monkeypatch):
    requests = _mock_client(monkeypatch, _happy_handler())

    await seedance.render(model_id=T2V, prompt="a boat", duration=6, seed=7)

    post = requests[0]
    assert post.method == "POST"
    assert post.url.path.endswith("/seedance-2.5-text-to-video")
    body = __import__("json").loads(post.content)
    assert body == {"prompt": "a boat", "aspect_ratio": "9:16", "duration": 6, "seed": 7}


async def test_480p_selects_the_cheaper_allowlisted_route(configured, monkeypatch):
    requests = _mock_client(monkeypatch, _happy_handler())

    result = await seedance.render(model_id=T2V, prompt="a boat", resolution="480p", duration=4)

    assert requests[0].url.path.endswith("/seedance-2.5-text-to-video-480p")
    assert result.resolution == "480p"
    assert result.cost_usd == Decimal("0.2000")


async def test_image_to_video_sends_both_url_shapes(configured, monkeypatch):
    requests = _mock_client(monkeypatch, _happy_handler())

    await seedance.image_to_video("https://cdn.example.com/a.jpg", "animate it")

    body = __import__("json").loads(requests[0].content)
    assert body["image_url"] == "https://cdn.example.com/a.jpg"
    assert body["images_list"] == ["https://cdn.example.com/a.jpg"]


async def test_submit_without_a_request_id_is_an_error(configured, monkeypatch):
    _mock_client(monkeypatch, lambda request: httpx.Response(200, json={"ok": True}))
    with pytest.raises(SeedanceError, match="request id"):
        await seedance.render(model_id=T2V, prompt="hi")


# -------------------------------------------------------------------- metering


async def test_metering_order_is_check_then_submit_then_log(configured, monkeypatch):
    order: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            order.append("submit")
            return httpx.Response(200, json={"request_id": "req-1"})
        if request.url.path.endswith("/result"):
            return httpx.Response(
                200, json={"status": "completed", "outputs": ["https://cdn/o.mp4"]}
            )
        return httpx.Response(200, content=b"MP4DATA")

    _mock_client(monkeypatch, handler)

    class _Spend(RecordingSpend):
        async def ensure_can_spend(self, estimated_usd):
            order.append("ensure")
            await super().ensure_can_spend(estimated_usd)

        async def log(self, **kwargs):
            order.append("log")
            await super().log(**kwargs)

    spend = _Spend()
    await seedance.render(model_id=T2V, prompt="hi", duration=5, spend=spend)

    assert order == ["ensure", "submit", "log"]


async def test_ledger_row_carries_the_pinned_cost(configured, monkeypatch, fake_spend):
    _mock_client(monkeypatch, _happy_handler())
    ctx, recorder = fake_spend

    await seedance.render(model_id=T2V, prompt="hi", duration=8, spend=ctx)

    assert len(recorder.entries) == 1
    entry = recorder.entries[0]
    assert entry.provider == "seedance"
    assert entry.sku == T2V
    assert entry.units == Decimal("8")
    # 8s at the pinned $0.10/s 720p rate.
    assert entry.cost_usd == Decimal("0.8000")


async def test_omni_route_is_priced_above_the_plain_routes(configured, monkeypatch, fake_spend):
    _mock_client(monkeypatch, _happy_handler())
    ctx, recorder = fake_spend

    await seedance.render(
        model_id="seedance-2.5-omni-reference",
        prompt="hi",
        duration=4,
        image_urls=["https://cdn.example.com/a.jpg"],
        spend=ctx,
    )

    assert recorder.entries[0].cost_usd == Decimal("0.6000")


async def test_cap_breach_refuses_before_any_provider_call(configured, monkeypatch):
    from marketer.repos.spend import SpendCapExceeded

    requests = _mock_client(monkeypatch, _happy_handler())

    class _Broke(RecordingSpend):
        async def ensure_can_spend(self, estimated_usd):
            raise SpendCapExceeded("daily cap reached", scope="niche")

    with pytest.raises(SpendCapExceeded):
        await seedance.render(model_id=T2V, prompt="hi", spend=_Broke())

    assert requests == []


async def test_post_log_cap_trip_does_not_fail_an_accepted_render(
    configured, monkeypatch, caplog
):
    """The gateway already billed the job, so a cap tripping on the way out
    is recorded, not raised — same call the UGC studio makes."""
    from marketer.repos.spend import SpendCapExceeded

    _mock_client(monkeypatch, _happy_handler())

    class _TripsOnLog(RecordingSpend):
        async def log(self, **kwargs):
            raise SpendCapExceeded("hit cap during job", scope="niche", after_spend=True)

    with caplog.at_level("WARNING"):
        result = await seedance.render(model_id=T2V, prompt="hi", spend=_TripsOnLog())

    assert result.status == "done"
    assert any("spend_log_tripped_cap" in r.message for r in caplog.records)


# ---------------------------------------------------------------- job protocol


async def test_completed_render_downloads_to_out_path(configured, monkeypatch, tmp_path):
    _mock_client(monkeypatch, _happy_handler())
    out = tmp_path / "clip.mp4"

    result = await seedance.text_to_video("a boat", out, duration=5)

    assert result.status == "done"
    assert result.path == out
    assert out.read_bytes() == b"MP4DATA"
    assert result.video_url == "https://cdn.example.com/out.mp4"


async def test_failed_render_raises_and_writes_nothing(configured, monkeypatch, tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        return httpx.Response(200, json={"status": "failed", "error": "nsfw prompt"})

    _mock_client(monkeypatch, handler)
    out = tmp_path / "clip.mp4"

    with pytest.raises(SeedanceError, match="nsfw prompt"):
        await seedance.text_to_video("a boat", out)

    assert not out.exists()


async def test_completed_with_no_output_is_a_failure(configured, monkeypatch):
    # A "completed" render with no video is not a done render with a null
    # URL; treating it as success would strand a broken asset downstream.
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        return httpx.Response(200, json={"status": "completed", "outputs": []})

    _mock_client(monkeypatch, handler)
    with pytest.raises(SeedanceError):
        await seedance.render(model_id=T2V, prompt="hi")


async def test_still_running_after_the_deadline_hands_the_job_back(configured, monkeypatch):
    # The spend is real and already logged, so a poll timeout must not be
    # reported as a failure — the caller can poll fetch_result later.
    monkeypatch.setattr(seedance, "POLL_TIMEOUT_SEC", 0)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        return httpx.Response(200, json={"status": "processing"})

    _mock_client(monkeypatch, handler)
    spend = RecordingSpend()

    result = await seedance.render(model_id=T2V, prompt="hi", spend=spend)

    assert result.status == "running"
    assert result.request_id == "req-1"
    assert [c[0] for c in spend.calls] == ["ensure", "log"]


async def test_wait_false_returns_as_soon_as_the_job_is_accepted(configured, monkeypatch):
    polls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-9"})
        polls.append(str(request.url))
        return httpx.Response(200, json={"status": "processing"})

    _mock_client(monkeypatch, handler)

    result = await seedance.render(model_id=T2V, prompt="hi", wait=False)

    assert (result.request_id, result.status) == ("req-9", "running")
    assert polls == []


async def test_fetch_result_reads_the_prediction_document(configured, monkeypatch):
    requests = _mock_client(
        monkeypatch,
        lambda request: httpx.Response(200, json={"status": "processing"}),
    )
    assert await seedance.fetch_result("req-1") == {"status": "processing"}
    assert requests[0].url.path.endswith("/predictions/req-1/result")


# ------------------------------------------------------------- backpressure


async def test_render_holds_one_provider_slot(configured, monkeypatch):
    acquired: list[str] = []
    real_slot = provider_limits.slot

    def _slot(provider: str):
        acquired.append(provider)
        return real_slot(provider)

    monkeypatch.setattr(seedance.provider_limits, "slot", _slot)
    _mock_client(monkeypatch, _happy_handler())

    await seedance.render(model_id=T2V, prompt="hi")

    # Exactly one, for this provider: the gate is not reentrant, so the
    # module must never nest it (and call sites must not wrap it again).
    assert acquired == ["seedance"]


# --------------------------------------------------------------- retry policy


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.muapi.ai/api/v1/x")
    return httpx.HTTPStatusError("boom", request=request, response=httpx.Response(code, request=request))


@pytest.mark.parametrize("code", [429, 500, 502, 503])
def test_transient_statuses_are_retryable(code):
    assert seedance._is_retryable(_status_error(code)) is True


@pytest.mark.parametrize("code", [400, 401, 402, 403, 422])
def test_deterministic_4xx_is_not_retryable(code):
    assert seedance._is_retryable(_status_error(code)) is False


def test_transport_errors_are_retryable():
    assert seedance._is_retryable(httpx.ConnectTimeout("timed out")) is True


def test_unrelated_exceptions_are_not_retryable():
    assert seedance._is_retryable(ValueError("nope")) is False
