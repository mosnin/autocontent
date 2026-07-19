"""Centralised rate-limiting configuration (slowapi).

Keying strategy
---------------
Buckets are keyed on the *client IP*. Behind Modal's ingress the socket
peer is the proxy, so keying on the raw remote address collapses every
tenant into one shared bucket — we read ``X-Forwarded-For`` instead.

IMPORTANT: the trustworthy hop is the *last* one, not the first. A proxy
appends the real peer to whatever ``X-Forwarded-For`` the client already
sent, so the FIRST entry is fully attacker-controlled — reading it lets a
client forge a fresh limiter identity every request (defeating both the
default limiter and the auth-failure brute-force lockout). We count
``trusted_proxy_hops`` entries back from the end (default 1 = the single
Modal ingress hop) so the value can't be pre-set by the client.

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
    """Real client IP, resolved from the trusted (rightmost) X-Forwarded-For
    hop rather than the client-controlled first hop.

    ``trusted_proxy_hops`` (default 1) is how many proxies sit in front of
    the app appending to XFF; we take the entry that many positions from the
    end. Anything the client pre-sets sits to the left of that and is ignored.
    Falls back to the socket peer when no XFF is present.
    """
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        hops = [h.strip() for h in xff.split(",") if h.strip()]
        if hops:
            trusted = max(1, int(getattr(settings, "trusted_proxy_hops", 1)))
            # Index from the end; clamp to the leftmost real entry we have.
            idx = max(0, len(hops) - trusted)
            return hops[idx]
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
