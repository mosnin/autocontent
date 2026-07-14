"""Centralised rate-limiting configuration (slowapi).

Keying strategy
---------------
When a bearer token is present we key on *that token* so per-PAT limits are
accurate even behind a CDN that shares a single egress IP.  When there is no
bearer (public endpoints, pre-auth failures) we fall back to the raw remote
address so anonymous clients are still throttled.

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


def _limit_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth:
        return auth  # key on the full "Bearer <token>" string
    return get_remote_address(request)


_limiter_kwargs: dict = {
    "key_func": _limit_key,
    "default_limits": ["600/minute"],
}

_redis_url = getattr(settings, "rate_limit_redis_url", "")
if _redis_url:
    _limiter_kwargs["storage_uri"] = _redis_url

limiter = Limiter(**_limiter_kwargs)
