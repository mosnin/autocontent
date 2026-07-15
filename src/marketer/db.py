"""Async Postgres pool, shared by the FastAPI backend and the Modal pipeline.

Modal containers are short-lived but a single container may handle many
calls in its lifetime, so a small pool per container is the right shape.
"""
from __future__ import annotations

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not settings.database_url:
            raise RuntimeError("MARKETER_DATABASE_URL is not set")
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=1,
            max_size=5,
            command_timeout=30,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
