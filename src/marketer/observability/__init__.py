"""Observability beyond logs: masked span export to Braintrust and any OTLP
endpoint, GenAI spans around model calls, and the workspace content setting.

Contract: docs/observability/braintrust.md. Wiring: services/otel.py.
"""
from __future__ import annotations

from .context import bind, content_mode_for, recall_guard, scope
from .genai import ModelCall, model_span
from .masking import METADATA, REDACTED, mask_attributes, mask_text, normalize_mode

__all__ = [
    "METADATA",
    "REDACTED",
    "ModelCall",
    "bind",
    "content_mode_for",
    "mask_attributes",
    "mask_text",
    "model_span",
    "normalize_mode",
    "recall_guard",
    "scope",
]
