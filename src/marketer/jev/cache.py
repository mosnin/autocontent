"""In-process LRU for System One answers.

TypeSafe's speed claim is 70–500ms per fan-out. Repeating the same
state+questions (retries, resume, QA rewrite, nightly ticks) should be
~0ms, not another round trip. Output tokens are free; input is not, and
wall-clock is what the ICP feels.

Cache is process-local, TTL-bounded, and never stores errors. A miss
falls through to ``ask`` exactly as before.
"""
from __future__ import annotations

import hashlib
import json
import time
from collections import OrderedDict
from threading import Lock

from .primitives import Questions, State, SystemOneResult, questions_payload

MAX_ENTRIES = 256
TTL_SEC = 300.0

_lock = Lock()
_store: OrderedDict[str, tuple[float, SystemOneResult]] = OrderedDict()


def cache_key(state: State, questions: Questions, prefer: str) -> str:
    payload = {
        "state": state,
        "questions": questions_payload(questions),
        "prefer": prefer,
    }
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def get(key: str) -> SystemOneResult | None:
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit is None:
            return None
        stamped, result = hit
        if now - stamped > TTL_SEC:
            _store.pop(key, None)
            return None
        _store.move_to_end(key)
        return result.model_copy(deep=True)


def put(key: str, result: SystemOneResult) -> None:
    with _lock:
        _store[key] = (time.monotonic(), result.model_copy(deep=True))
        _store.move_to_end(key)
        while len(_store) > MAX_ENTRIES:
            _store.popitem(last=False)


def clear() -> None:
    with _lock:
        _store.clear()


def size() -> int:
    with _lock:
        return len(_store)
