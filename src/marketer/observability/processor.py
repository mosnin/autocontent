"""The masking span processor: every span the backend exports passes through
here first (docs/observability/braintrust.md, rules 3 to 6).

``MaskingSpanProcessor(inner)`` wraps an exporting processor (a
``BatchSpanProcessor``). On start it stamps the opaque identity bound in this
context (``tenant_id``, ``actor_id``) and marks recall spans. On end it builds a
masked copy of the span (``masking.mask_attributes``, events, status) in the
effective content mode and hands only the copy to ``inner``. If masking
fails, the span is dropped, never exported unmasked.

With ``ai_only=True`` (the Braintrust side), only model and pipeline spans are
kept (like Braintrust's ``filter_ai_spans``): HTTP, database and framework
spans are dropped, and a kept span whose parent was dropped is re-parented
to its nearest kept ancestor, so traces stay whole.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

from opentelemetry.context import Context
from opentelemetry.sdk.trace import Event, ReadableSpan, Span, SpanProcessor
from opentelemetry.trace import SpanContext, Status

from . import context as obs_context
from .masking import METADATA, REDACTED, mask_attributes, mask_exception_attributes, mask_text, normalize_mode, is_content_event

log = logging.getLogger(__name__)

CONTENT_MODE_ATTR = "marketer.content_mode"
RECALL_ATTR = "marketer.recall"

# Span names (prefixes) that are AI work.
AI_SPAN_PREFIXES: tuple[str, ...] = (
    "gen_ai.",
    "llm.",
    "chat ",
    "pipeline.",
    "article.",
    "decision.",
    "recall.",
    "marketer.",
)
_MAX_TRACKED = 50_000


def is_ai_span(name: str, attributes: Any) -> bool:
    if name.startswith(AI_SPAN_PREFIXES):
        return True
    if attributes:
        try:
            return any(str(k).startswith("gen_ai.") for k in attributes)
        except Exception:  # noqa: BLE001
            return False
    return False


def effective_mode(attributes: Any) -> str:
    """Metadata wins: the deployment, the span's own stamp, or the tenant's
    last known workspace setting (a tenant never seen counts as metadata)."""
    if obs_context.global_mode() == METADATA:
        return METADATA
    attrs = attributes or {}
    if normalize_mode(attrs.get(CONTENT_MODE_ATTR, REDACTED)) == METADATA:
        return METADATA
    tenant = attrs.get("tenant_id")
    if tenant:
        cached = obs_context.cached_mode(str(tenant))
        if cached != REDACTED:
            return METADATA
    return REDACTED


def masked_copy(span: ReadableSpan, *, parent: SpanContext | None | bool = True) -> ReadableSpan:
    """A new ReadableSpan with masked attributes, events and status.
    ``parent=True`` keeps the original parent; anything else replaces it."""
    attrs = span.attributes or {}
    recall = bool(attrs.get(RECALL_ATTR)) or span.name.startswith("recall.")
    mode = effective_mode(attrs)
    new_attrs = mask_attributes(attrs, mode=mode, recall=recall)
    if recall:
        new_attrs[RECALL_ATTR] = True
    new_attrs[CONTENT_MODE_ATTR] = mode

    events: list[Event] = []
    for ev in span.events or ():
        if ev.name == "exception":
            events.append(Event("exception", mask_exception_attributes(ev.attributes, mode=mode, recall=recall), ev.timestamp))
            continue
        if (mode == METADATA or recall) and is_content_event(ev.name):
            continue
        if recall:
            events.append(Event(ev.name, mask_attributes(ev.attributes, mode=mode, recall=True), ev.timestamp))
            continue
        events.append(Event(ev.name, mask_attributes(ev.attributes, mode=mode), ev.timestamp))

    status = span.status
    if status is not None and status.description:
        desc = None if (mode == METADATA or recall) else mask_text(status.description)
        status = Status(status.status_code, desc)

    return ReadableSpan(
        name=span.name,
        context=span.context,
        parent=span.parent if parent is True else (parent or None),
        resource=span.resource,
        attributes=new_attrs,
        events=events,
        links=span.links,
        kind=span.kind,
        status=status,
        start_time=span.start_time,
        end_time=span.end_time,
        instrumentation_scope=span.instrumentation_scope,
    )


class MaskingSpanProcessor(SpanProcessor):
    def __init__(self, inner: SpanProcessor, *, ai_only: bool = False) -> None:
        self._inner = inner
        self._ai_only = ai_only
        # span_id -> (kept, anchor for its children, its own export parent).
        # A kept span anchors its children; a dropped one passes its anchor on.
        self._track: dict[int, tuple[bool, SpanContext | None, SpanContext | None]] = {}
        self._lock = threading.Lock()
        self._warned = False

    # -------------------------------------------------------------- start

    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        try:
            ident = obs_context.current_identity().attributes()
            current = span.attributes or {}
            for key, value in ident.items():
                if key not in current:
                    span.set_attribute(key, value)
            if obs_context.in_recall():
                span.set_attribute(RECALL_ATTR, True)
            if self._ai_only:
                self._decide(span)
        except Exception:  # noqa: BLE001 — observability never breaks a request
            self._warn_once("start")
        try:
            self._inner.on_start(span, parent_context=parent_context)
        except Exception:  # noqa: BLE001
            self._warn_once("inner_start")

    def _decide(self, span: Span) -> None:
        """Keep or drop, and the export parent, decided while the parent is
        still open (children start after their parents)."""
        kept = is_ai_span(span.name, span.attributes)
        parent = span.parent
        export_parent: SpanContext | None = None
        with self._lock:
            if parent is not None:
                hit = self._track.get(parent.span_id)
                if hit is not None:
                    export_parent = hit[1]
                elif parent.is_remote:
                    export_parent = parent  # a remote parent we can't see: keep the link
            if len(self._track) >= _MAX_TRACKED:
                self._track.clear()
            # (kept, anchor for children, this span's export parent)
            self._track[span.context.span_id] = (kept, span.context if kept else export_parent, export_parent)

    # -------------------------------------------------------------- end

    def on_end(self, span: ReadableSpan) -> None:
        try:
            parent: SpanContext | None | bool = True
            if self._ai_only:
                with self._lock:
                    hit = self._track.pop(span.context.span_id, None)
                if hit is None:
                    if not is_ai_span(span.name, span.attributes):
                        return
                else:
                    kept, _anchor, export_parent = hit
                    if not kept:
                        return
                    parent = export_parent
            copy = masked_copy(span, parent=parent)
        except Exception:  # noqa: BLE001 — drop rather than export unmasked
            self._warn_once("mask")
            return
        try:
            self._inner.on_end(copy)
        except Exception:  # noqa: BLE001
            self._warn_once("inner_end")

    def _warn_once(self, where: str) -> None:
        if not self._warned:
            self._warned = True
            log.warning("observability.processor_error", extra={"where": where}, exc_info=True)

    def shutdown(self) -> None:
        try:
            self._inner.shutdown()
        except Exception:  # noqa: BLE001
            self._warn_once("shutdown")

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        try:
            return self._inner.force_flush(timeout_millis)
        except Exception:  # noqa: BLE001
            return False
