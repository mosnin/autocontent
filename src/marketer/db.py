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


_auth_pool: asyncpg.Pool | None = None


async def get_auth_pool() -> asyncpg.Pool:
    """Pool for reading Better Auth's ``auth`` schema (read-only by contract).

    ``MARKETER_AUTH_DATABASE_URL`` when set (a role with SELECT on ``auth``
    only), else the main pool. The backend never writes ``auth``."""
    global _auth_pool
    if not settings.auth_database_url:
        return await get_pool()
    if _auth_pool is None:
        _auth_pool = await asyncpg.create_pool(
            settings.auth_database_url,
            min_size=1,
            max_size=5,
            command_timeout=10,
        )
    return _auth_pool


async def close_pool() -> None:
    global _pool, _auth_pool
    if _pool is not None:
        await _pool.close()
        _pool = None
    if _auth_pool is not None:
        await _auth_pool.close()
        _auth_pool = None
