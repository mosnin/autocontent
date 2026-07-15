"""Async Postgres pool, shared by the FastAPI backend and the Modal pipeline.

Modal containers are short-lived but a single container may handle many
calls in its lifetime, so a small pool per container is the right shape.

Managed-Postgres compatibility (Neon, Supabase pooler, RDS Proxy): the DSN a
provider's dashboard hands out is normalized before asyncpg sees it —
`channel_binding` is stripped (asyncpg rejects unknown DSN params; psycopg2 in
the migration runner handles it natively), and when the host is a pgbouncer
pooler (Neon's `-pooler` endpoints, Supabase's `pooler.` hosts) asyncpg's
prepared-statement cache is disabled, since transaction-mode pooling breaks
named prepared statements.
"""
from __future__ import annotations

from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None

# DSN query params asyncpg does not understand and safely ignores semantically
# (channel binding is negotiated by the driver; asyncpg's SCRAM does not take
# it as a DSN option).
_STRIP_PARAMS = frozenset({"channel_binding"})


def normalize_dsn(dsn: str) -> tuple[str, bool]:
    """Return (asyncpg-safe DSN, is_pgbouncer_pooler).

    Strips DSN query params asyncpg rejects and detects transaction-pooling
    hosts so the caller can disable the prepared-statement cache. Pure and
    conservative: anything unparseable is returned untouched.
    """
    try:
        parts = urlsplit(dsn)
        query = [
            (k, v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in _STRIP_PARAMS
        ]
        cleaned = urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
        )
        host = (parts.hostname or "").lower()
        pooled = "-pooler" in host or host.startswith("pooler.") or ".pooler." in host
        return cleaned, pooled
    except (ValueError, TypeError):
        return dsn, False


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not settings.database_url:
            raise RuntimeError("MARKETER_DATABASE_URL is not set")
        dsn, pooled = normalize_dsn(settings.database_url)
        kwargs: dict = {
            "min_size": 1,
            "max_size": 5,
            "command_timeout": 30,
        }
        if pooled:
            # pgbouncer transaction mode can't track named prepared statements
            # across backend connections — turn off asyncpg's cache.
            kwargs["statement_cache_size"] = 0
        _pool = await asyncpg.create_pool(dsn, **kwargs)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
