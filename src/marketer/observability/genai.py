"""GenAI spans around model calls (docs/observability/braintrust.md, Transport).

    async with model_span("chat", model="gpt-5.4-mini", provider="openai",
                          tenant_id=spend.user_id if spend else None) as call:
        call.prompt([{"role": "system", "content": system}, {"role": "user", "content": user}])
        resp = await client.chat.completions.create(...)
        call.completion(resp.choices[0].message.content)
        call.usage(resp.usage.prompt_tokens, resp.usage.completion_tokens)
        call.cost(cost_usd)

Attributes follow the OpenTelemetry GenAI conventions Braintrust maps
(``gen_ai.request.model``, ``gen_ai.usage.input_tokens`` /
``output_tokens``, ``gen_ai.prompt_json`` / ``gen_ai.completion_json``), so
Braintrust shows the span as an LLM call with input, output and token metrics.

Content is set only when the effective mode is ``redacted``; in ``metadata``
mode ``prompt()`` and ``completion()`` record nothing (the masking processor
also drops them on export). When tracing is off the span is a no-op and the
workspace setting is never read.
"""
from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any

from opentelemetry import trace

from . import context as obs_context
from .masking import METADATA, REDACTED
from .processor import CONTENT_MODE_ATTR

TRACER_NAME = "marketer.genai"
MAX_CONTENT_CHARS = 16_000


def _clip(text: str) -> str:
    return text if len(text) <= MAX_CONTENT_CHARS else text[:MAX_CONTENT_CHARS] + "…[truncated]"


def _messages(value: Any, default_role: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, str):
        return [{"role": default_role, "content": _clip(value)}]
    if isinstance(value, Mapping):
        value = [value]
    out: list[dict[str, Any]] = []
    for m in value:
        if not isinstance(m, Mapping):
            out.append({"role": default_role, "content": _clip(str(m))})
            continue
        content = m.get("content")
        if not isinstance(content, str):
            content = json.dumps(content, default=str)
        out.append({"role": str(m.get("role") or default_role), "content": _clip(content)})
    return out


class ModelCall:
    """Setters for one model span. Every method is a no-op when the span isn't
    recording, and never raises."""

    def __init__(self, span: trace.Span, mode: str) -> None:
        self.span = span
        self.mode = mode
        self.recording = span.is_recording()

    @property
    def content_allowed(self) -> bool:
        return self.recording and self.mode == REDACTED

    def set(self, key: str, value: Any) -> None:
        if not self.recording or value is None:
            return
        try:
            if isinstance(value, Decimal):
                value = float(value)
            elif not isinstance(value, (str, bool, int, float)):
                value = str(value)
            self.span.set_attribute(key, value)
        except Exception:  # noqa: BLE001
            pass

    def prompt(self, messages: Any) -> None:
        """A string (one user message) or OpenAI-style ``[{role, content}]``."""
        if not self.content_allowed:
            return
        try:
            self.span.set_attribute("gen_ai.prompt_json", json.dumps(_messages(messages, "user")))
        except Exception:  # noqa: BLE001
            pass

    def completion(self, output: Any) -> None:
        if not self.content_allowed or output is None:
            return
        try:
            self.span.set_attribute("gen_ai.completion_json", json.dumps(_messages(output, "assistant")))
        except Exception:  # noqa: BLE001
            pass

    def usage(self, input_tokens: int | None = None, output_tokens: int | None = None, total_tokens: int | None = None) -> None:
        if input_tokens is not None:
            self.set("gen_ai.usage.input_tokens", int(input_tokens))
        if output_tokens is not None:
            self.set("gen_ai.usage.output_tokens", int(output_tokens))
        if total_tokens is not None:
            self.set("gen_ai.usage.total_tokens", int(total_tokens))

    def cost(self, usd: Decimal | float | None) -> None:
        if usd is not None:
            self.set("marketer.cost_usd", float(usd))

    def response_model(self, model: str | None) -> None:
        if model:
            self.set("gen_ai.response.model", model)

    def score(self, name: str, value: float) -> None:
        """A Braintrust score on this span (0..1), e.g. ``decision_fallback``."""
        self.set(f"braintrust.scores.{name}", float(value))


@asynccontextmanager
async def model_span(
    operation: str,
    *,
    model: str,
    provider: str,
    tenant_id: str | None = None,
    name: str | None = None,
    attributes: Mapping[str, Any] | None = None,
) -> AsyncIterator[ModelCall]:
    """A span for one model call. Records the exception and an error status
    when the block raises, then re-raises."""
    tracer = trace.get_tracer(TRACER_NAME)
    start_attrs: dict[str, Any] = {
        "gen_ai.operation.name": operation,
        "gen_ai.provider.name": provider,
        "gen_ai.system": provider,
        "gen_ai.request.model": model or "unknown",
    }
    tenant = tenant_id or obs_context.current_identity().tenant_id
    if tenant:
        start_attrs["tenant_id"] = str(tenant)
    for k, v in (attributes or {}).items():
        if v is not None and isinstance(v, (str, bool, int, float)):
            start_attrs[k] = v
    with tracer.start_as_current_span(name or f"{operation} {model}", attributes=start_attrs, record_exception=False, set_status_on_exception=False) as span:
        mode = METADATA
        if span.is_recording():
            try:
                mode = await obs_context.content_mode_for(tenant)
            except Exception:  # noqa: BLE001
                mode = METADATA
            span.set_attribute(CONTENT_MODE_ATTR, mode)
        call = ModelCall(span, mode)
        t0 = time.monotonic()
        try:
            yield call
        except BaseException as exc:
            if call.recording:
                span.record_exception(exc)
                span.set_status(trace.StatusCode.ERROR, type(exc).__name__)
            raise
        finally:
            call.set("marketer.latency_ms", int((time.monotonic() - t0) * 1000))
