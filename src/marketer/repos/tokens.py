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

# Scope vocabulary — deliberately coarse (three tiers, no per-resource
# scopes yet). See db/migrations/0026_pat_scopes.sql for the rationale.
VALID_SCOPES: frozenset[str] = frozenset({"read", "write", "admin"})
DEFAULT_SCOPES: list[str] = ["read", "write"]


def validate_scopes(scopes: list[str] | None) -> list[str]:
    """Validate a requested scope list against the vocabulary.

    ``None`` (not specified by the caller) yields the default read+write
    grant, matching the backward-compat default baked into the migration.
    An explicit empty list or any unrecognised scope is rejected — callers
    must ask for real capabilities, not a silently-empty grant.

    Returns the normalized (deduped, sorted) scope list. Raises
    ``ValueError`` on any unknown or empty input so the caller (a route)
    can turn it into a 400.
    """
    if scopes is None:
        return list(DEFAULT_SCOPES)
    normalized = sorted(set(scopes))
    if not normalized:
        raise ValueError("scopes must not be empty")
    unknown = [s for s in normalized if s not in VALID_SCOPES]
    if unknown:
        raise ValueError(
            f"unknown scope(s): {', '.join(unknown)} — valid scopes are "
            f"{', '.join(sorted(VALID_SCOPES))}"
        )
    return normalized


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
    # Defense in depth: fail closed (no scopes) rather than assume full
    # access if a row somehow lacks the column value (e.g. a stale fixture).
    scopes = d.get("scopes")
    return PersonalAccessToken(
        id=d["id"],
        user_id=d["user_id"],
        name=d["name"],
        prefix=d["prefix"],
        last_used_at=d.get("last_used_at"),
        created_at=d["created_at"],
        expires_at=d.get("expires_at"),
        scopes=list(scopes) if scopes is not None else [],
    )


async def create(
    user_id: str,
    name: str,
    expires_at: datetime | None = None,
    scopes: list[str] | None = None,
) -> tuple[PersonalAccessToken, str]:
    """Create a new PAT. Returns ``(pat_row, plaintext_token)``.

    The plaintext is generated server-side and is the ONLY time the caller
    will ever see it — surface it to the user once, then forget it.

    ``scopes`` is validated against the vocabulary (see ``validate_scopes``);
    omitting it grants the backward-compat default of read+write. Raises
    ``ValueError`` for an invalid scope request.
    """
    scope_list = validate_scopes(scopes)
    plaintext = generate_plaintext()
    token_hash = hash_token(plaintext)
    prefix = display_prefix(plaintext)

    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into personal_access_tokens
            (user_id, name, token_hash, prefix, expires_at, scopes)
        values ($1, $2, $3, $4, $5, $6)
        returning id, user_id, name, prefix, last_used_at, created_at,
                  expires_at, scopes
        """,
        user_id,
        name,
        token_hash,
        prefix,
        expires_at,
        scope_list,
    )
    return _row_to_pat(row), plaintext


async def list_for_user(user_id: str) -> list[PersonalAccessToken]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, user_id, name, prefix, last_used_at, created_at,
               expires_at, scopes
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

    Scopes are always read fresh from this row — never trust a scope claim
    from anywhere else (e.g. client input), since this is the sole source
    of truth checked on every request.
    """
    if not plaintext.startswith(TOKEN_PREFIX):
        return None
    token_hash = hash_token(plaintext)
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select id, user_id, name, prefix, last_used_at, created_at,
               expires_at, revoked_at, scopes
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
