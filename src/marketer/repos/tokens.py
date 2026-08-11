"""Personal access tokens (long-lived API keys for CLI / MCP / agent use).

Plaintext format: ``mkt_<24-char-base32>`` (28 chars total). The DB only
stores the sha256 hex of the plaintext plus a short display prefix so the
operator can identify a token in lists without revealing it.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from ..db import get_pool
from ..models import PersonalAccessToken

TOKEN_PREFIX = "mkt_"
TOKEN_BODY_LEN = 24  # base32 chars after the prefix
DISPLAY_PREFIX_BODY_LEN = 4  # chars of the body kept in `prefix` for display


def generate_plaintext() -> str:
    """Return a new opaque token: ``mkt_`` + 24 random base32 chars."""
    # 15 bytes -> 24 base32 chars (no padding).
    raw = secrets.token_bytes(15)
    body = base64.b32encode(raw).decode("ascii").rstrip("=").lower()
    return f"{TOKEN_PREFIX}{body[:TOKEN_BODY_LEN]}"


def hash_token(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def display_prefix(plaintext: str) -> str:
    """Short, non-secret hint shown in token lists, e.g. ``mkt_a3f9``.

    Stores just enough of the body for the operator to recognise which
    token they're looking at, without leaking the secret.
    """
    if not plaintext.startswith(TOKEN_PREFIX):
        raise ValueError("plaintext must start with the canonical token prefix")
    body = plaintext[len(TOKEN_PREFIX):]
    return f"{TOKEN_PREFIX}{body[:DISPLAY_PREFIX_BODY_LEN]}"


def _row_to_pat(row) -> PersonalAccessToken:
    d = dict(row)
    return PersonalAccessToken(
        id=d["id"],
        user_id=d["user_id"],
        name=d["name"],
        prefix=d["prefix"],
        last_used_at=d.get("last_used_at"),
        created_at=d["created_at"],
        expires_at=d.get("expires_at"),
    )


async def create(
    user_id: str,
    name: str,
    expires_at: datetime | None = None,
) -> tuple[PersonalAccessToken, str]:
    """Create a new PAT. Returns ``(pat_row, plaintext_token)``.

    The plaintext is generated server-side and is the ONLY time the caller
    will ever see it — surface it to the user once, then forget it.
    """
    plaintext = generate_plaintext()
    token_hash = hash_token(plaintext)
    prefix = display_prefix(plaintext)

    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into personal_access_tokens
            (user_id, name, token_hash, prefix, expires_at)
        values ($1, $2, $3, $4, $5)
        returning id, user_id, name, prefix, last_used_at, created_at, expires_at
        """,
        user_id,
        name,
        token_hash,
        prefix,
        expires_at,
    )
    return _row_to_pat(row), plaintext


async def list_for_user(user_id: str) -> list[PersonalAccessToken]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, user_id, name, prefix, last_used_at, created_at, expires_at
          from personal_access_tokens
         where user_id = $1 and revoked_at is null
         order by created_at desc
        """,
        user_id,
    )
    return [_row_to_pat(r) for r in rows]


async def get_by_token(plaintext: str) -> PersonalAccessToken | None:
    """Look up a PAT by its plaintext. Bumps last_used_at on a hit.

    Returns ``None`` if the token is unknown, revoked, or expired.
    """
    if not plaintext.startswith(TOKEN_PREFIX):
        return None
    token_hash = hash_token(plaintext)
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select id, user_id, name, prefix, last_used_at, created_at,
               expires_at, revoked_at
          from personal_access_tokens
         where token_hash = $1
        """,
        token_hash,
    )
    if row is None:
        return None
    if row["revoked_at"] is not None:
        return None
    expires_at = row["expires_at"]
    if expires_at is not None and expires_at <= datetime.now(timezone.utc):
        return None

    # Synchronous bump — keeps "is this token active" observable without
    # background-task plumbing. One extra round-trip per authenticated call.
    await pool.execute(
        "update personal_access_tokens set last_used_at = now() where id = $1",
        row["id"],
    )
    return _row_to_pat(row)


async def revoke(token_id: UUID, user_id: str) -> bool:
    """Soft-delete a PAT. Returns True if a row was actually revoked."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update personal_access_tokens
           set revoked_at = now()
         where id = $1 and user_id = $2 and revoked_at is null
        """,
        token_id,
        user_id,
    )
    # asyncpg returns e.g. "UPDATE 1" or "UPDATE 0"
    try:
        return int(result.rsplit(" ", 1)[-1]) > 0
    except ValueError:
        return False


def compute_expires_at(expires_in_days: int | None) -> datetime | None:
    if expires_in_days is None:
        return None
    return datetime.now(timezone.utc) + timedelta(days=expires_in_days)
