"""Braintrust export from the backend (docs/observability/braintrust.md).

- off unless both BRAINTRUST_API_KEY and BRAINTRUST_PROJECT_ID are set, and
  coexisting with the generic OTLP endpoint when both are configured;
- the exporter posts OTLP protobuf to {url}/otel/v1/traces with the bearer key
  and x-bt-parent, one request per batch with a timeout, never raises, logs a
  failure once, counts partialSuccess.rejectedSpans;
- end to end: a model span leaves masked, without prompt text in metadata
  mode or for a workspace that turned AI content off.
No network: the HTTP session is a fake.
"""
from __future__ import annotations

import json
import logging

import pytest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)

from marketer.observability import context as obs_context
from marketer.observability.exporter import BraintrustSpanExporter, traces_endpoint
from marketer.observability.genai import model_span
from marketer.services import otel
from tests.otel_helpers import installed

FAKE_KEY = "bt-test-key-not-real"
PROJECT = "proj-test-0001"


class FakeResponse:
    def __init__(self, status_code=200, content=b""):
        self.status_code = status_code
        self.content = content


class FakeSession:
    def __init__(self, response=None, exc=None):
        self.calls: list[dict] = []
        self.response = response or FakeResponse()
        self.exc = exc

    def post(self, url, data=None, headers=None, timeout=None):
        self.calls.append({"url": url, "data": data, "headers": headers, "timeout": timeout})
        if self.exc:
            raise self.exc
        return self.response

    def spans(self) -> list:
        out = []
        for c in self.calls:
            req = ExportTraceServiceRequest()
            req.ParseFromString(c["data"])
            for rs in req.resource_spans:
                for ss in rs.scope_spans:
                    out.extend(ss.spans)
        return out


def _attrs(span) -> dict:
    out = {}
    for kv in span.attributes:
        v = kv.value
        out[kv.key] = v.string_value or v.int_value or v.double_value or v.bool_value
    return out


@pytest.fixture
def settings(monkeypatch):
    from marketer.config import settings as s

    monkeypatch.setattr(s, "braintrust_api_key", "")
    monkeypatch.setattr(s, "braintrust_project_id", "")
    monkeypatch.setattr(s, "braintrust_api_url", "https://api.braintrust.dev")
    monkeypatch.setattr(s, "braintrust_content", "redacted")
    monkeypatch.setattr(s, "otel_exporter_otlp_endpoint", "")
    obs_context.forget_cache()
    otel._otel_inited = False
    otel._provider = None
    yield s
    otel._otel_inited = False
    otel._provider = None
    obs_context.forget_cache()


# ---------------------------------------------------------------- off unless configured


@pytest.mark.parametrize("key,project", [("", ""), (FAKE_KEY, ""), ("", PROJECT), ("  ", PROJECT)])
def test_off_unless_key_and_project(settings, key, project, monkeypatch):
    settings.braintrust_api_key = key
    settings.braintrust_project_id = project
    built = []
    monkeypatch.setattr(otel, "build_braintrust_processor", lambda **kw: built.append(1))
    otel.init_tracing()
    assert not otel.braintrust_configured()
    assert otel._provider is None and built == []


def test_on_with_key_and_project_without_auto_instrumentation(settings, monkeypatch):
    settings.braintrust_api_key = FAKE_KEY
    settings.braintrust_project_id = PROJECT
    instrumented = []
    monkeypatch.setattr(otel, "_try_instrument_fastapi", lambda: instrumented.append("fastapi"))
    monkeypatch.setattr(otel, "_try_instrument_httpx", lambda: instrumented.append("httpx"))
    monkeypatch.setattr(otel, "_try_instrument_asyncpg", lambda: instrumented.append("asyncpg"))
    added = []
    monkeypatch.setattr("opentelemetry.trace.set_tracer_provider", lambda p: added.append(p))
    otel.init_tracing()
    assert otel._provider is not None and added == [otel._provider]
    procs = otel._provider._active_span_processor._span_processors
    assert len(procs) == 1 and procs[0]._ai_only is True
    assert instrumented == []


def test_coexists_with_the_otlp_endpoint(settings, monkeypatch):
    settings.braintrust_api_key = FAKE_KEY
    settings.braintrust_project_id = PROJECT
    settings.otel_exporter_otlp_endpoint = "http://localhost:4318/"
    for name in ("_try_instrument_fastapi", "_try_instrument_httpx", "_try_instrument_asyncpg"):
        monkeypatch.setattr(otel, name, lambda: None)
    monkeypatch.setattr("opentelemetry.trace.set_tracer_provider", lambda p: None)
    otel.init_tracing()
    procs = otel._provider._active_span_processor._span_processors
    # Generic endpoint: every span, masked. Braintrust: AI spans, masked.
    assert [p._ai_only for p in procs] == [False, True]


def test_a_broken_braintrust_setup_never_blocks_startup(settings, monkeypatch):
    settings.braintrust_api_key = FAKE_KEY
    settings.braintrust_project_id = PROJECT

    def boom(**kw):
        raise RuntimeError("no")

    monkeypatch.setattr(otel, "build_braintrust_processor", boom)
    monkeypatch.setattr("opentelemetry.trace.set_tracer_provider", lambda p: None)
    otel.init_tracing()  # must not raise


# ---------------------------------------------------------------- the exporter


@pytest.mark.parametrize(
    "url,want",
    [
        ("https://api.braintrust.dev", "https://api.braintrust.dev/otel/v1/traces"),
        ("https://api-eu.braintrust.dev/", "https://api-eu.braintrust.dev/otel/v1/traces"),
        ("https://bt.internal.example/otel", "https://bt.internal.example/otel/v1/traces"),
        ("", "https://api.braintrust.dev/otel/v1/traces"),
    ],
)
def test_endpoint(url, want):
    assert traces_endpoint(url) == want


def _one_span():
    from opentelemetry.sdk.trace import TracerProvider

    tp = TracerProvider()
    span = tp.get_tracer("t").start_span("chat m", attributes={"gen_ai.request.model": "m"})
    span.end()
    return span


def test_export_posts_protobuf_with_headers_and_timeout():
    session = FakeSession()
    exp = BraintrustSpanExporter(api_key=FAKE_KEY, project_id=PROJECT, api_url="https://api-eu.braintrust.dev", timeout_sec=7, session=session)
    from opentelemetry.sdk.trace.export import SpanExportResult

    assert exp.export([_one_span()]) == SpanExportResult.SUCCESS
    (call,) = session.calls
    assert call["url"] == "https://api-eu.braintrust.dev/otel/v1/traces"
    assert call["headers"]["Authorization"] == f"Bearer {FAKE_KEY}"
    assert call["headers"]["x-bt-parent"] == f"project_id:{PROJECT}"
    assert call["headers"]["Content-Type"] == "application/x-protobuf"
    assert call["timeout"] == 7
    assert [s.name for s in session.spans()] == ["chat m"]
    assert FAKE_KEY not in repr(exp)


def test_http_error_fails_once_logged_no_retry(caplog):
    session = FakeSession(FakeResponse(503, b"echo of the request"))
    exp = BraintrustSpanExporter(api_key=FAKE_KEY, project_id=PROJECT, session=session)
    from opentelemetry.sdk.trace.export import SpanExportResult

    with caplog.at_level(logging.WARNING, logger="marketer.observability.exporter"):
        assert exp.export([_one_span()]) == SpanExportResult.FAILURE
        assert exp.export([_one_span()]) == SpanExportResult.FAILURE
    assert len(session.calls) == 2  # one request per batch, no retries
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warnings) == 1
    assert "echo of the request" not in caplog.text


def test_transport_error_never_raises():
    session = FakeSession(exc=TimeoutError("slow"))
    exp = BraintrustSpanExporter(api_key=FAKE_KEY, project_id=PROJECT, session=session)
    from opentelemetry.sdk.trace.export import SpanExportResult

    assert exp.export([_one_span()]) == SpanExportResult.FAILURE
    assert exp.failed_batches == 1


def test_partial_success_rejections_are_counted(caplog):
    resp = ExportTraceServiceResponse()
    resp.partial_success.rejected_spans = 2
    session = FakeSession(FakeResponse(200, resp.SerializeToString()))
    exp = BraintrustSpanExporter(api_key=FAKE_KEY, project_id=PROJECT, session=session)
    with caplog.at_level(logging.WARNING, logger="marketer.observability.exporter"):
        exp.export([_one_span(), _one_span()])
    assert exp.rejected_spans == 2
    assert "braintrust.spans_rejected" in caplog.text


# ---------------------------------------------------------------- end to end


async def _model_call(tenant=None):
    async with model_span("chat", model="openai/gpt-test", provider="openrouter", tenant_id=tenant) as call:
        call.prompt([{"role": "system", "content": "be brief"}, {"role": "user", "content": "I'm jane.doe@example.com, password: not-a-real-pass-123"}])
        call.completion("Sure, jane.doe@example.com")
        call.usage(12, 4)
        call.cost(0.0021)


def _export(settings, coro_fn):
    import asyncio

    settings.braintrust_api_key = FAKE_KEY
    settings.braintrust_project_id = PROJECT
    session = FakeSession()
    processor = otel.build_braintrust_processor(session=session)
    with installed(processor) as provider:
        asyncio.run(coro_fn())
        provider.force_flush()
    return session


def test_model_span_reaches_braintrust_masked(settings):
    session = _export(settings, _model_call)
    (span,) = session.spans()
    a = _attrs(span)
    assert span.name == "chat openai/gpt-test"
    assert a["gen_ai.request.model"] == "openai/gpt-test"
    assert a["gen_ai.usage.input_tokens"] == 12 and a["gen_ai.usage.output_tokens"] == 4
    assert a["gen_ai.operation.name"] == "chat"
    prompt = json.loads(a["gen_ai.prompt_json"])
    assert prompt[0] == {"role": "system", "content": "be brief"}
    blob = session.calls[0]["data"]
    assert b"jane.doe@example.com" not in blob and b"not-a-real-pass-123" not in blob
    assert b"[EMAIL]" in blob


def test_metadata_mode_sends_no_text(settings):
    settings.braintrust_content = "metadata"
    session = _export(settings, _model_call)
    (span,) = session.spans()
    a = _attrs(span)
    assert "gen_ai.prompt_json" not in a and "gen_ai.completion_json" not in a
    assert a["gen_ai.usage.input_tokens"] == 12
    assert b"be brief" not in session.calls[0]["data"]


def test_workspace_setting_forces_metadata(settings, monkeypatch):
    from marketer.repos import observability as repo

    async def get_setting(tenant_id):
        return repo.Setting("metadata" if tenant_id == "quiet" else "redacted", None)

    monkeypatch.setattr(repo, "get_setting", get_setting)

    async def both():
        await _model_call("quiet")
        await _model_call("loud")

    session = _export(settings, both)
    by_tenant = {_attrs(s)["tenant_id"]: _attrs(s) for s in session.spans()}
    assert "gen_ai.prompt_json" not in by_tenant["quiet"]
    assert "gen_ai.prompt_json" in by_tenant["loud"]


def test_unreadable_workspace_setting_is_metadata(settings, monkeypatch):
    from marketer.repos import observability as repo

    async def get_setting(tenant_id):
        raise RuntimeError("db down")

    monkeypatch.setattr(repo, "get_setting", get_setting)
    session = _export(settings, lambda: _model_call("t1"))
    (span,) = session.spans()
    assert "gen_ai.prompt_json" not in _attrs(span)


def test_off_means_no_setting_lookup(settings, monkeypatch):
    """With tracing off the span is a no-op and the workspace is never read."""
    import asyncio

    from marketer.repos import observability as repo

    calls = []

    async def get_setting(tenant_id):
        calls.append(tenant_id)
        return repo.Setting("redacted", None)

    monkeypatch.setattr(repo, "get_setting", get_setting)
    asyncio.run(_model_call("t1"))
    assert calls == []
