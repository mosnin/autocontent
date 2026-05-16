"""Structured JSON logging for the pipeline.

Configures stdlib `logging` to emit one JSON document per line on stdout.
Modal captures stdout; ship to a real sink later by adding a handler.

Job-scoped context (`job_id`, `user_id`, `niche_id`) is propagated via
`contextvars` so any code called during `run_job` automatically gets the
right tags without threading the context through every function. Per-
record extras like `stage`, `provider`, `sku`, `latency_ms`, `cost_usd`
are passed through `extra=...` on the log call.

Stdlib only — no structlog, no Sentry. Configure once at import time of
`pipeline`; idempotent so re-importing in tests doesn't double-log.
"""
from __future__ import annotations

import json
import logging
import sys
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

_job_ctx: ContextVar[dict[str, Any]] = ContextVar("_job_ctx", default={})

# Keys that are extracted from `LogRecord` and merged into the JSON line
# when the caller passes them via `logger.info(..., extra={...})`.
_EXTRA_FIELDS = ("stage", "provider", "sku", "latency_ms", "cost_usd")


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Includes job_id / user_id / niche_id
    from the surrounding `job_context(...)` if any."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        ctx = _job_ctx.get()
        for key in ("job_id", "user_id", "niche_id"):
            if key in ctx and ctx[key] is not None:
                payload[key] = str(ctx[key])
        for key in _EXTRA_FIELDS:
            val = getattr(record, key, None)
            if val is not None:
                # Decimal/UUID → str; everything else passes through json.dumps default.
                payload[key] = val if isinstance(val, (int, float, str, bool)) else str(val)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


_configured = False


def configure(level: int = logging.INFO) -> None:
    """Install the JSON handler on the root logger. Idempotent."""
    global _configured
    if _configured:
        return
    root = logging.getLogger()
    # Drop any existing handlers (test harnesses, basicConfig calls).
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)
    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Get a configured JSON logger. Configures on first call."""
    configure()
    return logging.getLogger(name)


@contextmanager
def job_context(
    *,
    job_id: Any = None,
    user_id: str | None = None,
    niche_id: Any = None,
) -> Iterator[None]:
    """Push job-scoped tags onto the logging contextvar for the block."""
    prev = _job_ctx.get()
    merged = {**prev}
    if job_id is not None:
        merged["job_id"] = job_id
    if user_id is not None:
        merged["user_id"] = user_id
    if niche_id is not None:
        merged["niche_id"] = niche_id
    token = _job_ctx.set(merged)
    try:
        yield
    finally:
        _job_ctx.reset(token)
