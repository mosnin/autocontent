"""OTLP/HTTP span exporter for Braintrust (docs/observability/braintrust.md, Transport).

A plain OTLP protobuf POST, so no Braintrust SDK is needed:

    POST {BRAINTRUST_API_URL}/otel/v1/traces
    Authorization: Bearer {BRAINTRUST_API_KEY}
    x-bt-parent: project_id:{BRAINTRUST_PROJECT_ID}

One request per batch, one deadline, no retries (rule 2): a failed batch is
logged once per run of failures and dropped. A 200 can still reject spans
(``partialSuccess.rejectedSpans``); those are counted and logged.
"""
from __future__ import annotations

import logging
import threading
from collections.abc import Sequence
from typing import Any

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

log = logging.getLogger(__name__)

DEFAULT_API_URL = "https://api.braintrust.dev"
TRACES_PATH = "/otel/v1/traces"


def traces_endpoint(api_url: str) -> str:
    base = (api_url or DEFAULT_API_URL).strip().rstrip("/")
    if base.endswith(TRACES_PATH):
        return base
    if base.endswith("/otel"):
        return base + "/v1/traces"
    return base + TRACES_PATH


def headers(api_key: str, project_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "x-bt-parent": f"project_id:{project_id}",
        "Content-Type": "application/x-protobuf",
    }


class BraintrustSpanExporter(SpanExporter):
    """Never raises. ``session`` is injectable for tests (anything with a
    ``post(url, data=, headers=, timeout=)`` returning ``status_code`` and
    ``content``)."""

    def __init__(
        self,
        *,
        api_key: str,
        project_id: str,
        api_url: str = DEFAULT_API_URL,
        timeout_sec: float = 10.0,
        session: Any = None,
    ) -> None:
        self.endpoint = traces_endpoint(api_url)
        self._headers = headers(api_key, project_id)
        self._timeout = max(0.5, float(timeout_sec))
        self._session = session
        self._lock = threading.Lock()
        self._failing = False
        self._shutdown = False
        self.rejected_spans = 0
        self.failed_batches = 0

    def __repr__(self) -> str:  # never the key
        return f"BraintrustSpanExporter(endpoint={self.endpoint!r})"

    def _http(self) -> Any:
        if self._session is None:
            import requests  # noqa: PLC0415 — a dependency of the OTLP exporter

            self._session = requests.Session()
        return self._session

    def _fail(self, reason: str) -> SpanExportResult:
        with self._lock:
            self.failed_batches += 1
            first = not self._failing
            self._failing = True
        if first:
            # Once per run of failures; the next success re-arms it.
            log.warning("braintrust.export_failed", extra={"reason": reason[:200]})
        else:
            log.debug("braintrust.export_failed", extra={"reason": reason[:200]})
        return SpanExportResult.FAILURE

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        if self._shutdown or not spans:
            return SpanExportResult.SUCCESS if not spans else SpanExportResult.FAILURE
        try:
            from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans  # noqa: PLC0415

            body = encode_spans(spans).SerializeToString()
        except Exception as e:  # noqa: BLE001
            return self._fail(f"encode: {type(e).__name__}")
        try:
            resp = self._http().post(self.endpoint, data=body, headers=self._headers, timeout=self._timeout)
        except Exception as e:  # noqa: BLE001 — timeouts, DNS, TLS: drop the batch
            return self._fail(f"transport: {type(e).__name__}")
        status = int(getattr(resp, "status_code", 0) or 0)
        if not 200 <= status < 300:
            # The status only: an error body can echo what we sent.
            return self._fail(f"http {status}")
        rejected = _rejected_spans(getattr(resp, "content", b"") or b"")
        if rejected:
            with self._lock:
                self.rejected_spans += rejected
            log.warning("braintrust.spans_rejected", extra={"rejected": rejected, "sent": len(spans)})
        with self._lock:
            self._failing = False
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        self._shutdown = True

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


def _rejected_spans(content: bytes) -> int:
    """``partialSuccess.rejectedSpans`` from a protobuf (or JSON) response."""
    if not content:
        return 0
    try:
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (  # noqa: PLC0415
            ExportTraceServiceResponse,
        )

        msg = ExportTraceServiceResponse()
        msg.ParseFromString(content)
        return int(msg.partial_success.rejected_spans)
    except Exception:  # noqa: BLE001
        pass
    try:
        import json  # noqa: PLC0415

        data = json.loads(content)
        ps = data.get("partialSuccess") or data.get("partial_success") or {}
        return int(ps.get("rejectedSpans") or ps.get("rejected_spans") or 0)
    except Exception:  # noqa: BLE001
        return 0
