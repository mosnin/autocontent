"""A fake Supermemory v5 server for tests (no real key, no network).

    fake = FakeSupermemory()
    client = SupermemoryClient(cfg, transport=fake.transport())

It keeps documents and memories per namespace (one memory per added text),
answers the v5 routes Marketer uses, records every request, and can be told to
fail (``fail_next``) to test retries, the breaker and the purge queue.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote

import httpx

from marketer.recall.config import RecallConfig
from marketer.services.supermemory import Breaker

TEST_SECRET = "test-only-namespace-secret-0123456789abcdef"
TEST_KEY = "sm_test_" + "k" * 24


def fake_config(base_url: str = "https://sm.test") -> RecallConfig:
    return RecallConfig(api_key=TEST_KEY, namespace_secret=TEST_SECRET, base_url=base_url)


def set_env(monkeypatch, base_url: str = "https://sm.test") -> None:
    monkeypatch.setenv("SUPERMEMORY_API_KEY", TEST_KEY)
    monkeypatch.setenv("MEMORY_NAMESPACE_SECRET", TEST_SECRET)
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", base_url)


@dataclass
class Namespace:
    docs: dict[str, dict[str, Any]] = field(default_factory=dict)
    memories: dict[str, dict[str, Any]] = field(default_factory=dict)


_WORD = re.compile(r"[a-z0-9]{3,}")


def _words(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


class FakeSupermemory:
    def __init__(self) -> None:
        self.ns: dict[str, Namespace] = {}
        self.requests: list[dict[str, Any]] = []
        self.fail_queue: list[int | str] = []  # status codes, or "timeout"
        self._seq = 0

    # ----------------------------------------------------------------- helpers

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def fail_next(self, *statuses: int | str) -> None:
        self.fail_queue.extend(statuses)

    def seed(self, namespace: str, text: str, *, doc_id: str | None = None) -> str:
        n = self.ns.setdefault(namespace, Namespace())
        self._seq += 1
        mid = f"mem_{self._seq}"
        did = doc_id or f"doc_{self._seq}"
        n.docs[did] = {"content": text, "metadata": {}}
        n.memories[mid] = {"memory": text, "doc": did, "forgotten": False}
        return mid

    def texts(self, namespace: str) -> list[str]:
        n = self.ns.get(namespace)
        return [m["memory"] for m in n.memories.values() if not m["forgotten"]] if n else []

    def paths(self) -> list[str]:
        return [f"{r['method']} {r['path']}" for r in self.requests]

    # ----------------------------------------------------------------- server

    def _handle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        path = request.url.path
        self.requests.append({"method": request.method, "path": path, "headers": dict(request.headers), "body": body, "params": dict(request.url.params)})
        if self.fail_queue:
            f = self.fail_queue.pop(0)
            if f == "timeout":
                raise httpx.ReadTimeout("fake timeout", request=request)
            return httpx.Response(int(f), json={"error": "injected"})
        if request.headers.get("authorization") != f"Bearer {TEST_KEY}":
            return httpx.Response(401, json={"error": "bad key"})
        m = re.match(r"^/ns/([^/]+)(/.*)?$", path)
        if not m:
            return httpx.Response(404, json={"error": "no route"})
        name, rest = unquote(m.group(1)), m.group(2) or ""
        n = self.ns.get(name)
        method = request.method
        if method == "DELETE" and rest == "":
            if n is None:
                return httpx.Response(404, json={"error": "Namespace not found"})
            del self.ns[name]
            return httpx.Response(200, json={"status": "deleted", "namespace": name, "deletedDocumentsCount": len(n.docs), "deletedMemoriesCount": len(n.memories)})
        if method == "POST" and rest == "/document":
            n = self.ns.setdefault(name, Namespace())
            did = body.get("id") or f"doc_{self._seq + 1}"
            doc = n.docs.setdefault(did, {"content": "", "metadata": body.get("metadata") or {}})
            doc["content"] = (doc["content"] + "\n" + body["content"]).strip()
            doc["metadata"] = body.get("metadata") or {}
            doc["dreaming"] = body.get("dreaming")
            self._seq += 1
            n.memories[f"mem_{self._seq}"] = {"memory": body["content"], "doc": did, "forgotten": False}
            return httpx.Response(200, json={"id": did, "status": "queued"})
        if n is None:
            return httpx.Response(404, json={"error": "Namespace not found"})
        if method == "DELETE" and rest == "/document":
            count = 0
            for did in body["ids"]:
                if n.docs.pop(did, None) is not None:
                    count += 1
                    for mid in [k for k, v in n.memories.items() if v["doc"] == did]:
                        del n.memories[mid]
            return httpx.Response(200, json={"count": count, "errors": []})
        if method == "POST" and rest == "/search":
            q = _words(body["query"])
            results = []
            for mid, mem in n.memories.items():
                if mem["forgotten"]:
                    continue
                overlap = len(q & _words(mem["memory"]))
                if overlap:
                    results.append({"id": mid, "memory": mem["memory"], "similarity": min(1.0, 0.5 + 0.1 * overlap), "metadata": {}})
            results.sort(key=lambda r: -r["similarity"])
            return httpx.Response(200, json={"results": results[: body.get("limit", 10)], "searchTime": 1})
        if method == "POST" and rest == "/profile":
            return httpx.Response(200, json={"profile": {"static": [{"id": k, "memory": v["memory"]} for k, v in list(n.memories.items())[:3] if not v["forgotten"]], "dynamic": []}})
        if method == "POST" and rest == "/list/memories":
            live = [{"id": k, "memory": v["memory"], "metadata": {}, "isForgotten": False, "system": {"updatedAt": "2026-11-01T00:00:00Z"}} for k, v in n.memories.items() if not v["forgotten"]]
            live.reverse()
            page, limit = int(request.url.params.get("page", 1)), int(request.url.params.get("limit", 10))
            chunk = live[(page - 1) * limit : page * limit]
            return httpx.Response(200, json={"documents": [], "chunks": [], "memories": chunk, "pagination": {"currentPage": page, "limit": limit, "totalItems": len(live), "totalPages": max(1, -(-len(live) // limit))}})
        if method == "DELETE" and rest == "/memories":
            matches, errors = [], []
            for mid in body["ids"]:
                mem = n.memories.get(mid)
                if mem is None or mem["forgotten"]:
                    errors.append({"id": mid, "error": "Memory not found"})
                else:
                    mem["forgotten"] = True
                    matches.append({"id": mid, "memory": mem["memory"]})
            return httpx.Response(200, json={"count": len(matches), "matches": matches, "errors": errors})
        if method == "DELETE" and rest == "/memories/semantic":
            q = _words(body["query"])
            matches = [{"id": k, "memory": v["memory"]} for k, v in n.memories.items() if not v["forgotten"] and q & _words(v["memory"])]
            if not body.get("dryRun"):
                for mm in matches:
                    n.memories[mm["id"]]["forgotten"] = True
            return httpx.Response(200, json={"count": len(matches), "matches": matches, "errors": []})
        return httpx.Response(404, json={"error": "no route"})


def fresh_breaker() -> Breaker:
    return Breaker()
