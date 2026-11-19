"""Recall configuration, read from the environment at use time.

The names match docs/memory/supermemory.md ("Keys and endpoints") and the
Worker's, so one value is set the same way on both sides:

- ``SUPERMEMORY_API_KEY``      bearer key (never reaches the web app or a log).
- ``MEMORY_NAMESPACE_SECRET``  32+ random bytes, the same value as the Worker's.
- ``SUPERMEMORY_BASE_URL``     optional; defaults to the hosted API.

Read on every call (not at import) so tests and a rotated secret need no restart.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

DEFAULT_BASE_URL = "https://api.supermemory.ai"
MIN_SECRET_BYTES = 32


@dataclass(frozen=True)
class RecallConfig:
    api_key: str
    namespace_secret: str
    base_url: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key) and len(self.namespace_secret.encode()) >= MIN_SECRET_BYTES and safe_base_url(self.base_url)


def safe_base_url(url: str) -> bool:
    """https always; http only for loopback (a local ``supermemory local``)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.username or parts.password or not parts.hostname:
        return False
    if parts.scheme == "https":
        return True
    return parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1", "::1"}


def load() -> RecallConfig:
    return RecallConfig(
        api_key=os.environ.get("SUPERMEMORY_API_KEY", "").strip(),
        namespace_secret=os.environ.get("MEMORY_NAMESPACE_SECRET", "").strip(),
        base_url=(os.environ.get("SUPERMEMORY_BASE_URL", "").strip() or DEFAULT_BASE_URL).rstrip("/"),
    )
