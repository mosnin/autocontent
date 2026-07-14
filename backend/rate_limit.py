"""Centralised rate-limiting configuration (slowapi).

Keying strategy
---------------
Buckets are keyed on the *client IP*, resolved from ``X-Forwarded-For``
(first hop) when present — behind Modal's ingress the socket peer is the
proxy, so keying on the raw remote address collapses every tenant into
one shared bucket.

We deliberately do NOT key on the bearer token: the Authorization header
is attacker-controlled input, and keying on it hands every client a
fresh bucket per rotated string — nullifying the limiter entirely.

Redis vs. in-process
--------------------
Set ``MARKETER_RATE_LIMIT_REDIS_URL`` to a Redis connection string to share
state across multiple instances (recommended for production).  When the var is
empty the limiter uses the default in-process MemoryStorage, which is safe for
single-instance deployments.
"""
from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from marketer.config import settings


def client_ip(request: Request) -> str:
    """Best-effort real client IP: first X-Forwarded-For hop, else peer."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return get_remote_address(request)


def _limit_key(request: Request) -> str:
    return client_ip(request)


_limiter_kwargs: dict = {
    "key_func": _limit_key,
    "default_limits": ["600/minute"],
}

_redis_url = getattr(settings, "rate_limit_redis_url", "")
if _redis_url:
    _limiter_kwargs["storage_uri"] = _redis_url

limiter = Limiter(**_limiter_kwargs)
