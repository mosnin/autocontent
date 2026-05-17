"""Structured JSON logging for the pipeline.

Configures stdlib `logging` to emit one JSON document per line on stdout.
Modal captures stdout; ship to a real sink later by adding a handler.

Job-scoped context (`job_id`, `user_id`, `niche_id`) is propagated via
`contextvars` so any code called during `run_job` automatically gets the
right tags without threading the context through every function. Per-
record extras like `stage`, `provider`, `sku`, `latency_ms`, `cost_usd`
are passed through `extra=...` on the log call.

Sentry is initialised inside `configure()` when `AUTOCONTENT_SENTRY_DSN`
is set. The `LoggingIntegration` captures WARNING+ to Sentry breadcrumbs
and ERROR+ as Sentry events. All initialisation is idempotent.
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
_sentry_inited = False


def configure(level: int = logging.INFO) -> None:
    """Install the JSON handler on the root logger and (optionally) init Sentry.

    Fully idempotent: safe to call multiple times, from modal_app and FastAPI
    startup alike. Sentry is only initialised once even across repeated calls.
    """
    global _configured, _sentry_inited

    if not _configured:
        root = logging.getLogger()
        # Drop any existing handlers (test harnesses, basicConfig calls).
        for h in list(root.handlers):
            root.removeHandler(h)
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        root.addHandler(handler)
        root.setLevel(level)
        _configured = True

    if not _sentry_inited:
        from .config import settings  # deferred to avoid circular import at module load

        if settings.sentry_dsn:
            import sentry_sdk
            from sentry_sdk.integrations.logging import LoggingIntegration

            sentry_sdk.init(
                dsn=settings.sentry_dsn,
                environment=settings.sentry_environment,
                traces_sample_rate=settings.sentry_traces_sample_rate,
                integrations=[
                    LoggingIntegration(
                        level=logging.INFO,       # breadcrumb threshold
                        event_level=logging.ERROR,  # event threshold
                    )
                ],
            )
        _sentry_inited = True

        # OTEL is initialised after Sentry so both coexist independently.
        # When otel_exporter_otlp_endpoint is empty, init_tracing() is a no-op.
        from .services.otel import init_tracing  # deferred — mirrors Sentry pattern

        init_tracing()


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
