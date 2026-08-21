"""Prepaid credit ledger for the hosted (Route A) product.

Balance lives on the users row; every movement is mirrored into
credit_transactions. The debit path is atomic — balance update and
transaction insert share one DB transaction, and the purchase path is
idempotent on the Stripe checkout session id.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import CreditTransaction


async def balance(user_id: str) -> Decimal:
    pool = await get_pool()
    row = await pool.fetchval(
        "select credit_balance_usd from users where id = $1", user_id
    )
    return Decimal(str(row)) if row is not None else Decimal("0")


async def credit_purchase(
    *,
    user_id: str,
    amount_usd: Decimal,
    checkout_session_id: str,
    description: str = "credit purchase",
) -> Decimal | None:
    """Apply a Stripe purchase. Returns the new balance, or None when this
    checkout session was already credited (webhook retry) — safe to 200."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            inserted = await conn.fetchrow(
                """
                insert into credit_transactions
                    (user_id, amount_usd, kind, reference, description)
                values ($1, $2, 'purchase', $3, $4)
                on conflict do nothing
                returning id
                """,
                user_id, amount_usd, checkout_session_id, description,
            )
            if inserted is None:
                return None
            new_balance = await conn.fetchval(
                """
                update users
                   set credit_balance_usd = credit_balance_usd + $1
                 where id = $2
                returning credit_balance_usd
                """,
                amount_usd, user_id,
            )
            if new_balance is None:
                # FK on credit_transactions.user_id should have failed the
                # insert already; this is a last-line guard so a missing
                # user can never look like a successful credit.
                raise RuntimeError(
                    f"credit_purchase: user {user_id!r} does not exist"
                )
    return Decimal(str(new_balance))


async def reverse_purchase(
    *,
    checkout_session_id: str,
    description: str = "checkout async payment failed",
) -> Decimal | None:
    """Reverse a prior credit for this Stripe checkout session. Returns the
    new balance, or None when no purchase existed or this session was already
    reversed — safe to 200 on webhook retry."""
    if not (checkout_session_id or "").strip():
        return None
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            purchase = await conn.fetchrow(
                """
                select user_id, amount_usd
                  from credit_transactions
                 where reference = $1 and kind = 'purchase'
                """,
                checkout_session_id,
            )
            if purchase is None:
                return None
            already = await conn.fetchval(
                """
                select id from credit_transactions
                 where reference = $1 and kind = 'refund'
                """,
                checkout_session_id,
            )
            if already is not None:
                return None
            user_id = purchase["user_id"]
            amount = Decimal(str(purchase["amount_usd"]))
            inserted = await conn.fetchrow(
                """
                insert into credit_transactions
                    (user_id, amount_usd, kind, reference, description)
                values ($1, $2, 'refund', $3, $4)
                on conflict (reference) where kind = 'refund' do nothing
                returning id
                """,
                user_id,
                -amount,
                checkout_session_id,
                description,
            )
            if inserted is None:
                return None
            new_balance = await conn.fetchval(
                """
                update users
                   set credit_balance_usd = credit_balance_usd - $1
                 where id = $2
                returning credit_balance_usd
                """,
                amount,
                user_id,
            )
    return Decimal(str(new_balance)) if new_balance is not None else None


async def debit(
    *,
    user_id: str,
    amount_usd: Decimal,
    job_id: UUID | None,
    description: str,
) -> Decimal:
    """Charge the balance for pipeline spend. Returns the new balance —
    which may go negative for the in-flight call that crossed zero; the
    pre-flight check blocks the next one."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                insert into credit_transactions
                    (user_id, amount_usd, kind, reference, description)
                values ($1, $2, 'debit', $3, $4)
                """,
                user_id, -amount_usd, str(job_id) if job_id else None, description,
            )
            new_balance = await conn.fetchval(
                """
                update users
                   set credit_balance_usd = credit_balance_usd - $1
                 where id = $2
                returning credit_balance_usd
                """,
                amount_usd, user_id,
            )
    return Decimal(str(new_balance))


async def transactions(
    user_id: str, *, limit: int = 50
) -> list[CreditTransaction]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from credit_transactions
         where user_id = $1
         order by created_at desc
         limit $2
        """,
        user_id, limit,
    )
    return [CreditTransaction(**dict(r)) for r in rows]
