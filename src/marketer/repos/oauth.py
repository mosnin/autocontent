"""Persistence for the OAuth 2.1 authorization server (migration 0041).

Every credential is stored as sha256 hex, never in plaintext, so this module
takes and returns hashes for codes, tokens and client secrets. Minting and
hashing live in ``marketer.services.oauth``.

Two operations here are deliberately written as single atomic statements
rather than read-then-write, because both are the difference between
detecting theft and racing it:

* ``consume_authorization_code`` stamps ``consumed_at`` in the same statement
  that claims the code. Two concurrent exchanges cannot both win, so the
  loser is reported as a replay.
* ``rotate_refresh_token`` stamps ``rotated_at`` the same way. A refresh
  token can be spent exactly once even if the legitimate client and a thief
  present it at the same instant.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from ..db import get_pool

TokenKind = Literal["access", "refresh"]


# ---------------------------------------------------------------------------
# Row models
# ---------------------------------------------------------------------------


class OAuthClient(BaseModel):
    client_id: str
    name: str
    redirect_uris: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    client_secret_hash: str | None = None
    resources: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    disabled_at: datetime | None = None

    @property
    def is_confidential(self) -> bool:
        return bool(self.client_secret_hash)

    @property
    def is_active(self) -> bool:
        return self.disabled_at is None


class AuthorizationRequest(BaseModel):
    """A validated authorization request awaiting the human's decision."""

    id: UUID
    user_id: str
    client_id: str
    redirect_uri: str
    scopes: list[str] = Field(default_factory=list)
    state: str = ""
    code_challenge: str
    code_challenge_method: str
    resource: str = ""
    expires_at: datetime
    consumed_at: datetime | None = None
    created_at: datetime | None = None


class Grant(BaseModel):
    id: UUID
    user_id: str
    client_id: str
    scopes: list[str] = Field(default_factory=list)
    resource: str = ""
    redirect_uri: str = ""
    revoked_at: datetime | None = None
    revoked_reason: str = ""
    created_at: datetime | None = None

    @property
    def is_live(self) -> bool:
        return self.revoked_at is None


class AuthorizationCode(BaseModel):
    code_hash: str
    grant_id: UUID
    code_challenge: str
    code_challenge_method: str
    redirect_uri: str
    resource: str = ""
    expires_at: datetime
    consumed_at: datetime | None = None


class CodeConsumption(BaseModel):
    """Outcome of presenting an authorization code.

    ``unknown``  the code was never issued (or its grant is long gone)
    ``consumed`` this call claimed it; the caller may proceed
    ``replayed`` it had already been claimed: a security event
    """

    status: Literal["unknown", "consumed", "replayed"]
    code: AuthorizationCode | None = None


class Token(BaseModel):
    id: UUID
    grant_id: UUID
    kind: TokenKind
    scopes: list[str] = Field(default_factory=list)
    expires_at: datetime
    rotated_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime | None = None


_CLIENT_COLS = (
    "client_id, name, redirect_uris, scopes, client_secret_hash, resources, "
    "created_at, updated_at, disabled_at"
)
_REQUEST_COLS = (
    "id, user_id, client_id, redirect_uri, scopes, state, code_challenge, "
    "code_challenge_method, resource, expires_at, consumed_at, created_at"
)
_GRANT_COLS = (
    "id, user_id, client_id, scopes, resource, redirect_uri, revoked_at, "
    "revoked_reason, created_at"
)
_CODE_COLS = (
    "code_hash, grant_id, code_challenge, code_challenge_method, redirect_uri, "
    "resource, expires_at, consumed_at"
)
_TOKEN_COLS = "id, grant_id, kind, scopes, expires_at, rotated_at, revoked_at, created_at"


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


async def get_client(client_id: str) -> OAuthClient | None:
    if not client_id:
        return None
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_CLIENT_COLS} from oauth_clients where client_id = $1", client_id
    )
    return OAuthClient(**dict(row)) if row else None


async def list_clients() -> list[OAuthClient]:
    pool = await get_pool()
    rows = await pool.fetch(f"select {_CLIENT_COLS} from oauth_clients order by created_at")
    return [OAuthClient(**dict(r)) for r in rows]


async def create_client(
    *,
    client_id: str,
    name: str,
    redirect_uris: list[str],
    scopes: list[str],
    client_secret_hash: str | None = None,
    resources: list[str] | None = None,
) -> OAuthClient:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into oauth_clients
            (client_id, name, redirect_uris, scopes, client_secret_hash, resources)
        values ($1, $2, $3, $4, $5, $6)
        returning {_CLIENT_COLS}
        """,
        client_id,
        name,
        redirect_uris,
        scopes,
        client_secret_hash,
        resources or [],
    )
    return OAuthClient(**dict(row))


async def disable_client(client_id: str) -> bool:
    """Turn a client off without losing the audit trail of what it was."""
    pool = await get_pool()
    result = await pool.execute(
        "update oauth_clients set disabled_at = now() where client_id = $1 and disabled_at is null",
        client_id,
    )
    return _rows_affected(result) > 0


# ---------------------------------------------------------------------------
# Pending consent decisions
# ---------------------------------------------------------------------------


async def create_authorization_request(
    *,
    user_id: str,
    client_id: str,
    redirect_uri: str,
    scopes: list[str],
    state: str,
    code_challenge: str,
    code_challenge_method: str,
    resource: str,
    expires_at: datetime,
) -> AuthorizationRequest:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into oauth_authorization_requests
            (user_id, client_id, redirect_uri, scopes, state, code_challenge,
             code_challenge_method, resource, expires_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning {_REQUEST_COLS}
        """,
        user_id,
        client_id,
        redirect_uri,
        scopes,
        state,
        code_challenge,
        code_challenge_method,
        resource,
        expires_at,
    )
    return AuthorizationRequest(**dict(row))


async def consume_authorization_request(
    request_id: UUID, user_id: str
) -> AuthorizationRequest | None:
    """Claim a pending request for the signed-in user, once.

    Bound to ``user_id`` so a submitted form can only ever act on a request
    the same person started, and single use so an approval cannot be
    resubmitted.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update oauth_authorization_requests
           set consumed_at = now()
         where id = $1
           and user_id = $2
           and consumed_at is null
           and expires_at > now()
        returning {_REQUEST_COLS}
        """,
        request_id,
        user_id,
    )
    return AuthorizationRequest(**dict(row)) if row else None


# ---------------------------------------------------------------------------
# Grants
# ---------------------------------------------------------------------------


async def create_grant(
    *,
    user_id: str,
    client_id: str,
    scopes: list[str],
    resource: str,
    redirect_uri: str,
) -> Grant:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into oauth_grants (user_id, client_id, scopes, resource, redirect_uri)
        values ($1, $2, $3, $4, $5)
        returning {_GRANT_COLS}
        """,
        user_id,
        client_id,
        scopes,
        resource,
        redirect_uri,
    )
    return Grant(**dict(row))


async def get_grant(grant_id: UUID) -> Grant | None:
    pool = await get_pool()
    row = await pool.fetchrow(f"select {_GRANT_COLS} from oauth_grants where id = $1", grant_id)
    return Grant(**dict(row)) if row else None


async def revoke_grant(grant_id: UUID, reason: str) -> None:
    """Kill a whole family: the grant, every token, every unspent code."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
            update oauth_grants
               set revoked_at = coalesce(revoked_at, now()), revoked_reason = $2
             where id = $1
            """,
            grant_id,
            reason,
        )
        await conn.execute(
            "update oauth_tokens set revoked_at = now() where grant_id = $1 and revoked_at is null",
            grant_id,
        )
        await conn.execute(
            """
            update oauth_authorization_codes
               set consumed_at = now()
             where grant_id = $1 and consumed_at is null
            """,
            grant_id,
        )


# ---------------------------------------------------------------------------
# Authorization codes
# ---------------------------------------------------------------------------


async def create_authorization_code(
    *,
    code_hash: str,
    grant_id: UUID,
    code_challenge: str,
    code_challenge_method: str,
    redirect_uri: str,
    resource: str,
    expires_at: datetime,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into oauth_authorization_codes
            (code_hash, grant_id, code_challenge, code_challenge_method,
             redirect_uri, resource, expires_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        """,
        code_hash,
        grant_id,
        code_challenge,
        code_challenge_method,
        redirect_uri,
        resource,
        expires_at,
    )


async def consume_authorization_code(code_hash: str) -> CodeConsumption:
    """Claim a code exactly once and say which of the three things happened."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update oauth_authorization_codes
           set consumed_at = now()
         where code_hash = $1 and consumed_at is null
        returning {_CODE_COLS}
        """,
        code_hash,
    )
    if row is not None:
        return CodeConsumption(status="consumed", code=AuthorizationCode(**dict(row)))

    existing = await pool.fetchrow(
        f"select {_CODE_COLS} from oauth_authorization_codes where code_hash = $1", code_hash
    )
    if existing is None:
        return CodeConsumption(status="unknown")
    return CodeConsumption(status="replayed", code=AuthorizationCode(**dict(existing)))


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


async def create_token(
    *,
    grant_id: UUID,
    kind: TokenKind,
    token_hash: str,
    scopes: list[str],
    expires_at: datetime,
) -> Token:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into oauth_tokens (grant_id, kind, token_hash, scopes, expires_at)
        values ($1, $2, $3, $4, $5)
        returning {_TOKEN_COLS}
        """,
        grant_id,
        kind,
        token_hash,
        scopes,
        expires_at,
    )
    return Token(**dict(row))


async def get_token_by_hash(token_hash: str) -> Token | None:
    if not token_hash:
        return None
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_TOKEN_COLS} from oauth_tokens where token_hash = $1", token_hash
    )
    return Token(**dict(row)) if row else None


async def rotate_refresh_token(token_id: UUID) -> bool:
    """Spend a refresh token. False means it was already spent or revoked."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update oauth_tokens
           set rotated_at = now(), revoked_at = coalesce(revoked_at, now())
         where id = $1 and kind = 'refresh' and rotated_at is null and revoked_at is null
        returning id
        """,
        token_id,
    )
    return row is not None


async def revoke_tokens_for_grant(grant_id: UUID, kind: TokenKind | None = None) -> int:
    pool = await get_pool()
    if kind is None:
        result = await pool.execute(
            "update oauth_tokens set revoked_at = now() where grant_id = $1 and revoked_at is null",
            grant_id,
        )
    else:
        result = await pool.execute(
            """
            update oauth_tokens
               set revoked_at = now()
             where grant_id = $1 and kind = $2 and revoked_at is null
            """,
            grant_id,
            kind,
        )
    return _rows_affected(result)


def _rows_affected(result: str) -> int:
    """asyncpg returns command tags like "UPDATE 3"."""
    try:
        return int(result.rsplit(" ", 1)[-1])
    except (AttributeError, ValueError):
        return 0
