"""Install a real TracerProvider for one test and restore the old one.

The SDK allows ``set_tracer_provider`` once per process, so tests reset its
private ``Once`` guard (the pattern the SDK's own tests use, and
tests/test_pipeline_traces.py)."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import opentelemetry.trace as _otel_trace_mod
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.util._once import Once

from marketer.observability.processor import MaskingSpanProcessor


@contextmanager
def installed(*processors: SpanProcessor) -> Iterator[TracerProvider]:
    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    for p in processors:
        provider.add_span_processor(p)
    old_once = _otel_trace_mod._TRACER_PROVIDER_SET_ONCE
    old_provider = _otel_trace_mod._TRACER_PROVIDER
    _otel_trace_mod._TRACER_PROVIDER_SET_ONCE = Once()
    trace.set_tracer_provider(provider)
    try:
        yield provider
    finally:
        provider.shutdown()
        _otel_trace_mod._TRACER_PROVIDER_SET_ONCE = old_once
        _otel_trace_mod._TRACER_PROVIDER = old_provider


@contextmanager
def masked_memory(*, ai_only: bool = False) -> Iterator[InMemorySpanExporter]:
    """Spans as they would leave the process: through the masking processor."""
    exporter = InMemorySpanExporter()
    with installed(MaskingSpanProcessor(SimpleSpanProcessor(exporter), ai_only=ai_only)):
        yield exporter


def all_text(spans) -> str:
    """Every attribute, event and status string of ``spans``, joined."""
    parts: list[str] = []
    for s in spans:
        parts.append(s.name)
        parts.extend(f"{k}={v}" for k, v in (s.attributes or {}).items())
        for e in s.events or ():
            parts.append(e.name)
            parts.extend(f"{k}={v}" for k, v in (e.attributes or {}).items())
        if s.status is not None and s.status.description:
            parts.append(s.status.description)
    return "\n".join(parts)
