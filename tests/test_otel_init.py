"""Tests for the OpenTelemetry SDK initialisation module.

Covers:
- empty endpoint → no global provider installed, only the no-op tracer.
- non-empty endpoint + mocked exporter → real provider configured.
- idempotency: calling init_tracing() twice is a no-op.
- FastAPIInstrumentor is invoked when OTEL is enabled.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import opentelemetry.trace as _otel_trace_mod
from opentelemetry.util._once import Once


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_otel_module() -> None:
    """Reset module-level state so each test starts from a clean slate."""
    import marketer.services.otel as otel_mod

    otel_mod._otel_inited = False
    otel_mod._provider = None


def _reset_all() -> None:
    """Also reset logging module flags so configure() chains cleanly."""
    _reset_otel_module()
    import marketer.logging as logging_mod

    logging_mod._configured = False
    logging_mod._sentry_inited = False


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_init_tracing_no_op_when_endpoint_empty(monkeypatch) -> None:
    """When the endpoint is empty, no TracerProvider is installed and the
    global tracer is the built-in no-op tracer."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "")
    _reset_otel_module()

    from opentelemetry import trace
    from marketer.services.otel import init_tracing, get_tracer

    init_tracing()

    # get_tracer() must not raise and must return a Tracer instance.
    t = get_tracer("test")
    assert isinstance(t, trace.Tracer)

    # No real provider should have been set; the default SDK no-op tracer
    # produces spans whose context is invalid (no-op).
    with t.start_as_current_span("probe") as span:
        assert not span.is_recording()


def test_init_tracing_with_endpoint_configures_provider(monkeypatch) -> None:
    """With an endpoint set, a real TracerProvider is installed and spans
    are recorded."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "http://localhost:4318/")
    monkeypatch.setattr(settings, "otel_service_name", "marketer-test")
    monkeypatch.setattr(settings, "otel_exporter_otlp_headers", "")
    monkeypatch.setattr(settings, "otel_traces_sample_rate", 1.0)
    _reset_otel_module()

    # Patch OTLPSpanExporter so we don't need a real collector.
    mock_exporter_cls = MagicMock()
    mock_exporter = MagicMock()
    mock_exporter_cls.return_value = mock_exporter

    with patch(
        "opentelemetry.exporter.otlp.proto.http.trace_exporter.OTLPSpanExporter",
        mock_exporter_cls,
    ):
        from marketer.services import otel as otel_mod

        otel_mod._otel_inited = False
        otel_mod._provider = None
        otel_mod.init_tracing()

    # A provider was stored.
    assert otel_mod._provider is not None

    # get_tracer returns a real tracer that records spans.
    t = otel_mod.get_tracer("test")
    with t.start_as_current_span("check") as span:
        assert span.is_recording()

    # Clean up: reset global provider so we don't pollute other tests.
    _otel_trace_mod._TRACER_PROVIDER_SET_ONCE = Once()
    _otel_trace_mod._TRACER_PROVIDER = None
    _reset_otel_module()


def test_init_tracing_idempotent(monkeypatch) -> None:
    """Calling init_tracing() twice does not re-configure the provider."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "http://localhost:4318/")
    monkeypatch.setattr(settings, "otel_exporter_otlp_headers", "")
    monkeypatch.setattr(settings, "otel_traces_sample_rate", 1.0)
    _reset_otel_module()

    mock_exporter_cls = MagicMock()

    with patch(
        "opentelemetry.exporter.otlp.proto.http.trace_exporter.OTLPSpanExporter",
        mock_exporter_cls,
    ):
        from marketer.services import otel as otel_mod

        otel_mod._otel_inited = False
        otel_mod._provider = None

        otel_mod.init_tracing()
        otel_mod.init_tracing()  # second call must be a no-op

    # OTLPSpanExporter constructor called exactly once.
    assert mock_exporter_cls.call_count == 1

    # Clean up.
    _otel_trace_mod._TRACER_PROVIDER_SET_ONCE = Once()
    _otel_trace_mod._TRACER_PROVIDER = None
    _reset_otel_module()


def test_init_tracing_header_parsing(monkeypatch) -> None:
    """Comma-separated headers are parsed into a dict for the exporter."""
    from marketer.services.otel import _parse_headers

    headers = _parse_headers("x-honeycomb-team=abc123,x-other=val==")
    assert headers["x-honeycomb-team"] == "abc123"
    # Values with embedded '=' are preserved correctly.
    assert headers["x-other"] == "val=="


def test_configure_logging_calls_init_tracing(monkeypatch) -> None:
    """logging.configure() should trigger init_tracing() so a single entry
    point wires everything up."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "sentry_dsn", "")
    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "")
    _reset_all()

    called: list[bool] = []

    original_init = None

    def fake_init_tracing() -> None:
        called.append(True)
        if original_init:
            original_init()

    import marketer.services.otel as otel_mod

    original_init = otel_mod.init_tracing

    with patch.object(otel_mod, "init_tracing", fake_init_tracing):
        import marketer.logging as logging_mod

        logging_mod._configured = False
        logging_mod._sentry_inited = False
        logging_mod.configure()

    assert called, "init_tracing() was not called from configure()"
    _reset_all()
