"""A thin, typed Supermemory v5 REST client (httpx), over only the calls Marketer uses.

Why not the ``supermemory`` Python SDK: we need five endpoints, explicit
per-call timeouts, a breaker, and exact control over retries (none on
deletes, at most one on an ``add`` with a stable id). A 40-line client is
easier to audit than a generated SDK and adds no dependency.

Rules (docs/memory/supermemory.md):

- Every call takes a :class:`marketer.recall.namespace.Scope`. A plain string is
  refused, so a namespace from a request, body or model output can never
  reach this module. This is the ONLY module that builds a ``/ns/`` path
  (``tests/test_recall_guard.py``).
- Auth is ``Authorization: Bearer`` only. Redirects are never followed.
- Timeouts: reads 4 s, writes 8 s, namespace delete 20 s.
- Retries: none, except ``add`` with a caller-supplied stable ``id`` (one
  retry on a network error, timeout or 5xx). Deletes are never retried here;
  the purge queue retries them on its own schedule.
- Breaker: after 5 consecutive failures (5xx, timeout, network) calls fail
  fast for 30 s, then one call probes.
- The key never appears in an exception, a log line or a repr.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import quote

import httpx

from marketer.recall import config as recall_config
from marketer.recall.namespace import Scope

log = logging.getLogger(__name__)

READ_TIMEOUT_SEC = 4.0
WRITE_TIMEOUT_SEC = 8.0
NAMESPACE_DELETE_TIMEOUT_SEC = 20.0
MAX_CONTENT_CHARS = 60_000
_DOC_ID_MAX = 255


class SupermemoryError(Exception):
    """A failed call. ``status`` is the HTTP status (0 for network/timeout/
    breaker). ``kind`` is a short code; the message never carries the key or
    content."""

    def __init__(self, kind: str, status: int = 0, detail: str = "") -> None:
        super().__init__(f"supermemory {kind} ({status})" + (f": {detail[:200]}" if detail else ""))
        self.kind = kind
        self.status = status

    @property
    def not_found(self) -> bool:
        return self.status == 404

    @property
    def transient(self) -> bool:
        return self.status == 0 or self.status >= 500 or self.status in (409, 429)


class NotConfigured(SupermemoryError):
    def __init__(self) -> None:
        super().__init__("not_configured")


class Breaker:
    """Per-process circuit breaker for the Supermemory origin."""

    def __init__(self, threshold: int = 5, cooldown_sec: float = 30.0, now=time.monotonic) -> None:
        self.threshold = threshold
        self.cooldown = cooldown_sec
        self.now = now
        self.failures = 0
        self.opened_at: float | None = None
        self.probing = False

    def admit(self) -> bool:
        if self.opened_at is None:
            return True
        if self.now() - self.opened_at < self.cooldown or self.probing:
            return False
        self.probing = True
        return True

    def success(self) -> None:
        self.failures = 0
        self.opened_at = None
        self.probing = False

    def failure(self) -> None:
        if self.probing:
            self.probing = False
            self.opened_at = self.now()
            return
        self.failures += 1
        if self.opened_at is None and self.failures >= self.threshold:
            self.opened_at = self.now()

    def neutral(self) -> None:
        self.probing = False


_breaker = Breaker()


def _require_scope(scope: object) -> Scope:
    if not isinstance(scope, Scope):
        raise TypeError("supermemory: a Scope from marketer.recall.namespace is required, never a string")
    return scope


@dataclass(frozen=True)
class MemoryItem:
    id: str
    memory: str
    updated_at: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class SearchHit:
    id: str
    text: str
    score: float
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class ForgetResult:
    count: int
    matches: list[MemoryItem]
    errors: int


@dataclass(frozen=True)
class NamespaceDeleted:
    documents: int
    memories: int
    existed: bool


class SupermemoryClient:
    """One client per call site. ``transport`` lets tests pass a fake server
    (``httpx.MockTransport``); production passes nothing."""

    def __init__(
        self,
        cfg: recall_config.RecallConfig | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        breaker: Breaker | None = None,
    ) -> None:
        self.cfg = cfg or recall_config.load()
        self._transport = transport
        self._breaker = breaker or _breaker

    def __repr__(self) -> str:  # never the key
        return f"SupermemoryClient(base_url={self.cfg.base_url!r})"

    @property
    def configured(self) -> bool:
        return self.cfg.configured

    # ----------------------------------------------------------------- core

    def _path(self, scope: Scope, suffix: str) -> str:
        s = _require_scope(scope)
        return f"/ns/{quote(s.namespace, safe='')}{suffix}"

    async def _send(
        self,
        method: Literal["GET", "POST", "PATCH", "DELETE"],
        path: str,
        *,
        body: Any = None,
        params: dict[str, Any] | None = None,
        timeout: float,
        retries: int = 0,
    ) -> Any:
        if not self.configured:
            raise NotConfigured()
        attempt = 0
        while True:
            if not self._breaker.admit():
                raise SupermemoryError("circuit_open")
            try:
                async with httpx.AsyncClient(
                    base_url=self.cfg.base_url,
                    timeout=httpx.Timeout(timeout),
                    follow_redirects=False,
                    transport=self._transport,
                ) as client:
                    resp = await client.request(
                        method,
                        path,
                        json=body if body is not None else None,
                        params=params,
                        headers={"authorization": f"Bearer {self.cfg.api_key}", "accept": "application/json"},
                    )
            except (httpx.TimeoutException, httpx.TransportError, asyncio.TimeoutError) as e:
                self._breaker.failure()
                if attempt < retries:
                    attempt += 1
                    continue
                raise SupermemoryError("network", 0, type(e).__name__) from None
            if resp.status_code >= 500:
                self._breaker.failure()
                if attempt < retries:
                    attempt += 1
                    continue
                raise SupermemoryError("server", resp.status_code)
            if 300 <= resp.status_code < 400:
                self._breaker.neutral()
                raise SupermemoryError("redirect_refused", resp.status_code)
            if resp.status_code >= 400:
                self._breaker.neutral()
                raise SupermemoryError("rejected", resp.status_code, _error_text(resp))
            self._breaker.success()
            if not resp.content:
                return {}
            try:
                return resp.json()
            except ValueError:
                raise SupermemoryError("bad_response", resp.status_code) from None

    # ----------------------------------------------------------------- writes

    async def add(
        self,
        scope: Scope,
        *,
        content: str,
        doc_id: str,
        metadata: dict[str, Any] | None = None,
        dreaming: Literal["dynamic", "instant"] = "dynamic",
    ) -> str:
        """Add or append to the document ``doc_id`` (stable, so one retry is safe)."""
        if not doc_id or len(doc_id) > _DOC_ID_MAX:
            raise ValueError("doc_id must be 1..255 chars")
        body = {"content": content[:MAX_CONTENT_CHARS], "id": doc_id, "metadata": metadata or {}, "dreaming": dreaming}
        data = await self._send("POST", self._path(scope, "/document"), body=body, timeout=WRITE_TIMEOUT_SEC, retries=1)
        return str(data.get("status", ""))

    async def delete_documents(self, scope: Scope, ids: list[str]) -> int:
        """Delete documents by id. Never retried. Returns how many were deleted."""
        if not ids:
            return 0
        data = await self._send("DELETE", self._path(scope, "/document"), body={"ids": ids[:100]}, timeout=WRITE_TIMEOUT_SEC)
        return int(data.get("count", 0))

    async def forget(self, scope: Scope, ids: list[str]) -> ForgetResult:
        """Forget exact memories. Never retried."""
        data = await self._send("DELETE", self._path(scope, "/memories"), body={"ids": ids[:500]}, timeout=WRITE_TIMEOUT_SEC)
        return _forget_result(data)

    async def forget_preview(self, scope: Scope, query: str) -> ForgetResult:
        """Semantic forget with ``dryRun: true``: what would be forgotten. Changes nothing."""
        data = await self._send(
            "DELETE", self._path(scope, "/memories/semantic"), body={"query": query[:2000], "dryRun": True}, timeout=READ_TIMEOUT_SEC
        )
        return _forget_result(data)

    async def delete_namespace(self, scope: Scope) -> NamespaceDeleted:
        """Delete the whole namespace. A 404 means it never existed (or is already
        gone): success for an idempotent purge. Never retried here."""
        try:
            data = await self._send("DELETE", self._path(scope, ""), timeout=NAMESPACE_DELETE_TIMEOUT_SEC)
        except SupermemoryError as e:
            if e.not_found:
                return NamespaceDeleted(0, 0, existed=False)
            raise
        if data.get("status") not in (None, "deleted"):
            raise SupermemoryError("unexpected_status", 200, str(data.get("status")))
        return NamespaceDeleted(int(data.get("deletedDocumentsCount", 0)), int(data.get("deletedMemoriesCount", 0)), existed=True)

    # ----------------------------------------------------------------- reads

    async def search(self, scope: Scope, query: str, *, limit: int = 6, threshold: float = 0.45) -> list[SearchHit]:
        body = {"query": query[:2000], "searchMode": "memories", "limit": max(1, min(limit, 100)), "threshold": threshold}
        try:
            data = await self._send("POST", self._path(scope, "/search"), body=body, timeout=READ_TIMEOUT_SEC)
        except SupermemoryError as e:
            if e.not_found:  # nothing written there yet
                return []
            raise
        hits: list[SearchHit] = []
        for r in data.get("results") or []:
            text = r.get("memory") or r.get("chunk") or ""
            if isinstance(text, str) and text and isinstance(r.get("id"), str):
                hits.append(SearchHit(id=r["id"], text=text, score=float(r.get("similarity") or 0), metadata=r.get("metadata") or None))
        return hits

    async def list_memories(self, scope: Scope, *, page: int = 1, limit: int = 50) -> tuple[list[MemoryItem], int]:
        """One page of the namespace's memories, newest first, and the total."""
        params = {"page": max(1, page), "limit": max(1, min(limit, 100)), "sort": "updatedAt", "order": "desc"}
        try:
            data = await self._send("POST", self._path(scope, "/list/memories"), body={}, params=params, timeout=READ_TIMEOUT_SEC)
        except SupermemoryError as e:
            if e.not_found:  # a namespace nobody wrote yet
                return [], 0
            raise
        items = [
            MemoryItem(id=m["id"], memory=m.get("memory") or "", updated_at=(m.get("system") or {}).get("updatedAt"), metadata=m.get("metadata") or None)
            for m in data.get("memories") or []
            if isinstance(m, dict) and isinstance(m.get("id"), str) and not m.get("isForgotten")
        ]
        total = int((data.get("pagination") or {}).get("totalItems") or len(items))
        return items, total


def _forget_result(data: dict[str, Any]) -> ForgetResult:
    matches = [MemoryItem(id=m["id"], memory=m.get("memory") or "") for m in data.get("matches") or [] if isinstance(m, dict) and isinstance(m.get("id"), str)]
    return ForgetResult(count=int(data.get("count", len(matches))), matches=matches, errors=len(data.get("errors") or []))


def _error_text(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except ValueError:
        return ""
    err = data.get("error") if isinstance(data, dict) else None
    return err if isinstance(err, str) else ""


def reset_breaker() -> None:
    """Tests only."""
    _breaker.success()
