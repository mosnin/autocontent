"""OpenTelemetry SDK initialisation.

Provides two public helpers that mirror the stdlib logging API:

    init_tracing()  — call once (e.g. from logging.configure()).
    get_tracer(name) — returns a Tracer (no-op if OTEL is disabled).

When `otel_exporter_otlp_endpoint` is empty the module is fully inert:
no TracerProvider is installed, all spans are no-ops, and none of the
optional instrumentation packages are imported.

Supported vendors (set endpoint + headers accordingly):
  Honeycomb:   endpoint=https://api.honeycomb.io/
               headers=x-honeycomb-team=<api-key>
  Axiom:       endpoint=https://api.axiom.co/
               headers=authorization=Bearer <token>,x-axiom-dataset=marketer
  Datadog:     endpoint=https://otlp.datadoghq.com/
               headers=DD-API-KEY=<key>
  Tempo:       endpoint=http://localhost:4318/  (no headers needed)
"""
from __future__ import annotations

import importlib.metadata
import logging

from opentelemetry import trace

log = logging.getLogger(__name__)

_otel_inited = False

# Module-level reference so the force_flush helper can reach it.
_provider: trace.TracerProvider | None = None


def _parse_headers(raw: str) -> dict[str, str]:
    """Parse comma-separated ``key=value`` pairs into a dict.

    Values may themselves contain ``=`` (e.g. base64 tokens):
        ``authorization=Bearer abc==,x-team=mykey``
    """
    headers: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if "=" not in pair:
            continue
        k, _, v = pair.partition("=")
        headers[k.strip()] = v.strip()
    return headers


def init_tracing() -> None:
    """Idempotent.

    If ``MARKETER_OTEL_EXPORTER_OTLP_ENDPOINT`` is set, configure the
    global ``TracerProvider`` with an ``OTLPSpanExporter`` pointed at it
    and activate FastAPI / httpx / asyncpg auto-instrumentations.

    Safe to call multiple times — subsequent calls are no-ops.
    """
    global _otel_inited, _provider

    if _otel_inited:
        return
    _otel_inited = True

    # Deferred import so the settings object (and its env-var parsing) is
    # only read after the main module has had a chance to initialise.
    from ..config import settings  # noqa: PLC0415

    endpoint = settings.otel_exporter_otlp_endpoint.strip()
    if not endpoint:
        log.debug("otel.disabled (MARKETER_OTEL_EXPORTER_OTLP_ENDPOINT not set)")
        return

    # ── Build resource ────────────────────────────────────────────────────
    from opentelemetry.sdk.resources import Resource  # noqa: PLC0415

    try:
        version = importlib.metadata.version("marketer-sh")
    except importlib.metadata.PackageNotFoundError:
        version = "dev"

    resource = Resource.create(
        {
            "service.name": settings.otel_service_name,
            "service.version": version,
        }
    )

    # ── Exporter + processor ──────────────────────────────────────────────
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # noqa: PLC0415
        OTLPSpanExporter,
    )
    from opentelemetry.sdk.trace import TracerProvider  # noqa: PLC0415
    from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: PLC0415
    from opentelemetry.sdk.trace.sampling import TraceIdRatioBased  # noqa: PLC0415

    headers = _parse_headers(settings.otel_exporter_otlp_headers)
    exporter = OTLPSpanExporter(endpoint=endpoint, headers=headers)

    sample_rate = max(0.0, min(1.0, settings.otel_traces_sample_rate))
    sampler = TraceIdRatioBased(sample_rate) if sample_rate < 1.0 else None

    provider_kwargs: dict = {"resource": resource}
    if sampler is not None:
        provider_kwargs["sampler"] = sampler

    provider = TracerProvider(**provider_kwargs)
    # Default schedule_delay_millis=5000; export_timeout_millis=30000.
    # Both are fine for pipeline workloads. We keep defaults and let
    # force_flush() in the Modal exit hook drain the buffer.
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _provider = provider

    # ── Auto-instrumentations (best-effort) ───────────────────────────────
    _try_instrument_fastapi()
    _try_instrument_httpx()
    _try_instrument_asyncpg()

    log.info(
        "otel.initialised",
        extra={"endpoint": endpoint, "service": settings.otel_service_name},
    )


def _try_instrument_fastapi() -> None:
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # noqa: PLC0415

        # instrument() without an app argument installs middleware globally
        # so it applies to any app created afterwards. Per-app wiring is
        # done in create_app() after routes are registered.
        FastAPIInstrumentor().instrument()
        log.debug("otel.fastapi_instrumented")
    except ImportError:
        log.debug("otel.fastapi_instrumentation_unavailable")


def _try_instrument_httpx() -> None:
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor  # noqa: PLC0415

        HTTPXClientInstrumentor().instrument()
        log.debug("otel.httpx_instrumented")
    except ImportError:
        log.debug("otel.httpx_instrumentation_unavailable")


def _try_instrument_asyncpg() -> None:
    try:
        from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor  # noqa: PLC0415

        AsyncPGInstrumentor().instrument()
        log.debug("otel.asyncpg_instrumented")
    except ImportError:
        log.debug("otel.asyncpg_instrumentation_unavailable")


def get_tracer(name: str) -> trace.Tracer:
    """Return a Tracer for *name*.

    If ``init_tracing()`` was called with an endpoint configured, this
    returns a real tracer bound to the global provider.  Otherwise it
    returns the SDK's built-in no-op tracer — callers need not check.
    """
    return trace.get_tracer(name)


def force_flush(timeout_ms: int = 5000) -> None:
    """Best-effort flush of the BatchSpanProcessor buffer.

    Call this from Modal's ``@modal.exit`` hook (or any graceful-shutdown
    handler) so the last pipeline spans are exported before the process
    exits.  No-op when OTEL is disabled.
    """
    global _provider
    if _provider is None:
        return
    try:
        _provider.force_flush(timeout_millis=timeout_ms)
    except Exception as exc:  # pragma: no cover — safety net
        log.warning("otel.force_flush_failed", extra={"error": str(exc)})
