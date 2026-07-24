"""Async Postgres pool, shared by the FastAPI backend and the Modal pipeline.

Modal containers are short-lived but a single container may handle many
calls in its lifetime, so a small pool per container is the right shape.

Pooled endpoints (PgBouncer)
----------------------------
Neon's `-pooler` host — like Supabase's transaction-mode pooler on 6543 —
runs PgBouncer in **transaction** mode, which does not support the
server-side prepared statements asyncpg uses by default. Left alone, that
surfaces as intermittent ``prepared statement "__asyncpg_stmt_N__" does
not exist`` under concurrency: a failure that only appears once two
requests share a server connection, so it passes every local test and
breaks in production.

`statement_cache_size=0` disables the prepared-statement cache, which is
what makes a transaction-mode pooler safe. The cost is re-parsing each
query — real but small next to a network round trip, and worth paying to
use a pooler at all. Modal fans out many short-lived containers, so the
pooler is the right endpoint for this workload: it keeps a burst of
containers from opening a connection each straight against Postgres.
"""
from __future__ import annotations

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


def _pooled_endpoint(url: str) -> bool:
    """True when the DSN points at a transaction-mode connection pooler.

    Covers Neon (`...-pooler.<region>.aws.neon.tech`) and Supabase's
    transaction pooler (port 6543). Supabase's session-mode pooler on
    5432 supports prepared statements and is deliberately not matched.
    """
    lowered = url.lower()
    return "-pooler." in lowered or ":6543" in lowered


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not settings.database_url:
            raise RuntimeError("MARKETER_DATABASE_URL is not set")
        kwargs: dict = {}
        if _pooled_endpoint(settings.database_url):
            kwargs["statement_cache_size"] = 0
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=1,
            max_size=5,
            command_timeout=30,
            **kwargs,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
