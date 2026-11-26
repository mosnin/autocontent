"""Invite and pilot access codes (docs/billing/access-codes.md).

A code is generated here, shown to the platform admin once, and stored only
as a sha256 of its normalized form. Redeeming is one transaction: lock the
code row, check it, insert the (code, workspace) redemption (unique, so a
retry can never grant twice), bump the count and, when the code carries
credit, move the balance and write a ``grant`` row in the credit ledger.
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool

Kind = Literal["invite", "pilot"]

# Crockford base32: no I, L, O or U, so a code read aloud or retyped survives.
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_PREFIX: dict[str, str] = {"invite": "INV", "pilot": "PLT"}
_CONFUSABLE = str.maketrans({"O": "0", "I": "1", "L": "1"})
# 12 random characters: 60 bits. Enough that the hash needs no secret pepper:
# guessing is bounded by the redeem rate limit, not by the hash.
_RANDOM_CHARS = 12


def normalize(code: str) -> str:
    """Uppercase, without spaces or dashes, with confusable letters folded."""
    return "".join(ch for ch in code.upper() if ch.isalnum()).translate(_CONFUSABLE)


def code_hash(code: str) -> str:
    return hashlib.sha256(normalize(code).encode("utf-8")).hexdigest()


def generate(kind: Kind) -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(_RANDOM_CHARS))
    return f"{_PREFIX[kind]}-{body[0:4]}-{body[4:8]}-{body[8:12]}"


class AccessCode(BaseModel):
    id: UUID
    code_hint: str
    kind: Kind
    credit_usd: Decimal
    trial_days: int | None
    max_redemptions: int
    redemption_count: int
    expires_at: datetime | None
    disabled_at: datetime | None
    note: str
    created_by: str
    created_at: datetime


class Redemption(BaseModel):
    kind: Kind
    credit_usd: Decimal
    trial_days: int | None = None
    access_until: datetime | None
    redeemed_at: datetime


RedeemError = Literal["code_unknown", "code_expired", "code_used_up", "code_already_redeemed"]


@dataclass
class RedeemFailed(Exception):
    reason: RedeemError
    kind: str | None = None


async def create(
    *,
    kind: Kind,
    credit_usd: Decimal,
    trial_days: int | None,
    max_redemptions: int,
    expires_at: datetime | None,
    note: str,
    created_by: str,
) -> tuple[str, AccessCode]:
    """Create a code. Returns (the plain code, the stored row). The plain code
    is never stored or logged: this return value is the only copy."""
    pool = await get_pool()
    for _ in range(5):
        plain = generate(kind)
        row = await pool.fetchrow(
            """
            insert into access_codes
                (code_hash, code_hint, kind, credit_usd, trial_days, max_redemptions, expires_at, note, created_by)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            on conflict (code_hash) do nothing
            returning *
            """,
            code_hash(plain), normalize(plain)[-4:], kind, credit_usd, trial_days,
            max_redemptions, expires_at, note, created_by,
        )
        if row is not None:
            return plain, _code(row)
    raise RuntimeError("could not generate a unique access code")


async def list_codes(*, limit: int = 200) -> list[AccessCode]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from access_codes order by created_at desc limit $1", limit
    )
    return [_code(r) for r in rows]


async def disable(code_id: UUID) -> AccessCode | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update access_codes set disabled_at = coalesce(disabled_at, now())
         where id = $1
        returning *
        """,
        code_id,
    )
    return _code(row) if row else None


async def redemption_for(tenant_id: str) -> Redemption | None:
    """The workspace's most recent redemption, if any."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select r.kind, r.credit_usd, c.trial_days, r.access_until, r.redeemed_at
          from access_code_redemptions r join access_codes c on c.id = r.code_id
         where r.tenant_id = $1
         order by r.redeemed_at desc
         limit 1
        """,
        tenant_id,
    )
    return Redemption(**dict(row)) if row else None


async def has_purchased(tenant_id: str) -> bool:
    pool = await get_pool()
    return bool(
        await pool.fetchval(
            "select exists(select 1 from credit_transactions where user_id = $1 and kind = 'purchase')",
            tenant_id,
        )
    )


async def redeem(*, code: str, tenant_id: str, actor_id: str) -> Redemption:
    """Redeem ``code`` for the workspace. Raises ``RedeemFailed``."""
    digest = code_hash(code)
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "select * from access_codes where code_hash = $1 for update", digest
        )
        if row is None:
            raise RedeemFailed("code_unknown")
        now = datetime.now(UTC)
        kind = row["kind"]
        if await conn.fetchval(
            "select exists(select 1 from access_code_redemptions where code_id = $1 and tenant_id = $2)",
            row["id"], tenant_id,
        ):
            raise RedeemFailed("code_already_redeemed", kind)
        if row["disabled_at"] is not None or (row["expires_at"] is not None and row["expires_at"] <= now):
            raise RedeemFailed("code_expired", kind)
        if row["redemption_count"] >= row["max_redemptions"]:
            raise RedeemFailed("code_used_up", kind)
        credit = Decimal(str(row["credit_usd"]))
        access_until = now + timedelta(days=row["trial_days"]) if row["trial_days"] else None
        inserted = await conn.fetchrow(
            """
            insert into access_code_redemptions (code_id, tenant_id, actor_id, kind, credit_usd, access_until)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (code_id, tenant_id) do nothing
            returning redeemed_at
            """,
            row["id"], tenant_id, actor_id, kind, credit, access_until,
        )
        if inserted is None:  # a concurrent request for the same workspace won
            raise RedeemFailed("code_already_redeemed", kind)
        await conn.execute(
            "update access_codes set redemption_count = redemption_count + 1 where id = $1",
            row["id"],
        )
        if credit > 0:
            await conn.execute(
                """
                insert into credit_transactions (user_id, amount_usd, kind, reference, description)
                values ($1, $2, 'grant', $3, $4)
                """,
                tenant_id, credit, f"access-code:{row['id']}:{tenant_id}", f"{kind} code",
            )
            await conn.execute(
                "update users set credit_balance_usd = credit_balance_usd + $1 where id = $2",
                credit, tenant_id,
            )
    return Redemption(
        kind=kind,
        credit_usd=credit,
        trial_days=row["trial_days"],
        access_until=access_until,
        redeemed_at=inserted["redeemed_at"],
    )


def _code(row) -> AccessCode:
    return AccessCode(**{k: row[k] for k in AccessCode.model_fields})
