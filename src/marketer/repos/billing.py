"""Prepaid credit ledger for the hosted (Route A) product.

Balance lives on the users row; every movement is mirrored into
credit_transactions. The debit/reserve path is atomic — balance update
and transaction insert share one DB transaction. Purchases are
idempotent on the Stripe checkout session id (or x402 settlement id).
Refunds are idempotent on the same reference with kind='refund'.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from uuid import UUID

from ..billing.packs import ledger_purchase_reference
from ..db import get_pool
from ..models import CreditTransaction


def _positive_finite(amount: Decimal) -> Decimal | None:
    try:
        value = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not value.is_finite() or value <= 0:
        return None
    return value


async def balance(user_id: str) -> Decimal:
    pool = await get_pool()
    row = await pool.fetchval(
        "select credit_balance_usd from users where id = $1", user_id
    )
    return Decimal(str(row)) if row is not None else Decimal(0)


async def credit_purchase(
    *,
    user_id: str,
    amount_usd: Decimal,
    checkout_session_id: str,
    description: str = "credit purchase",
) -> Decimal | None:
    """Apply a Stripe / x402 purchase. Returns the new balance, or None when
    this reference was already credited (webhook retry) or the amount /
    reference is not a legal credit — safe to 200."""
    amount = _positive_finite(amount_usd)
    checkout_session_id = ledger_purchase_reference(checkout_session_id)
    if amount is None or not checkout_session_id:
        return None
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        inserted = await conn.fetchrow(
            """
                insert into credit_transactions
                    (user_id, amount_usd, kind, reference, description)
                values ($1, $2, 'purchase', $3, $4)
                on conflict do nothing
                returning id
                """,
            user_id, amount, checkout_session_id, description,
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
            amount, user_id,
        )
        if new_balance is None:
            raise RuntimeError(
                f"credit_purchase: user {user_id!r} does not exist"
            )
    return Decimal(str(new_balance))


async def reverse_purchase(
    *,
    checkout_session_id: str,
    description: str = "purchase reversed",
) -> Decimal | None:
    """Reverse a prior credit for this purchase reference. Returns the new
    balance, or None when no purchase existed or this session was already
    reversed — safe to 200 on webhook retry.

    The balance may go negative if the user already spent the pack. That is
    the clawback: they do not keep unearned generate credit after a refund
    or full dispute.
    """
    checkout_session_id = ledger_purchase_reference(checkout_session_id)
    if not checkout_session_id:
        return None
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
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
                on conflict do nothing
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


async def reserve(
    *,
    user_id: str,
    amount_usd: Decimal,
    job_id: UUID | None,
    description: str,
) -> Decimal | None:
    """Atomically hold ``amount_usd`` if the balance covers it.

    Returns the new balance, or None when the user is missing or the
    balance is too small. Concurrent preflights serialize on the user row
    so N fan-out tasks cannot each pass a snapshot read and then all
    spend.
    """
    amount = _positive_finite(amount_usd)
    if amount is None:
        return await balance(user_id)
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        new_balance = await conn.fetchval(
            """
                update users
                   set credit_balance_usd = credit_balance_usd - $1
                 where id = $2 and credit_balance_usd >= $1
                returning credit_balance_usd
                """,
            amount, user_id,
        )
        if new_balance is None:
            return None
        await conn.execute(
            """
                insert into credit_transactions
                    (user_id, amount_usd, kind, reference, description)
                values ($1, $2, 'debit', $3, $4)
                """,
            user_id, -amount, str(job_id) if job_id else None, description,
        )
    return Decimal(str(new_balance))


async def debit(
    *,
    user_id: str,
    amount_usd: Decimal,
    job_id: UUID | None,
    description: str,
) -> Decimal:
    """Charge the balance for pipeline spend that was not already reserved.

    May go negative for the in-flight call that crossed zero (actual cost
    exceeded the preflight reserve). Subsequent reserves still fail closed.
    """
    amount = _positive_finite(amount_usd)
    if amount is None:
        return await balance(user_id)
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
                select credit_balance_usd from users where id = $1 for update
                """,
            user_id,
        )
        await conn.execute(
            """
                insert into credit_transactions
                    (user_id, amount_usd, kind, reference, description)
                values ($1, $2, 'debit', $3, $4)
                """,
            user_id, -amount, str(job_id) if job_id else None, description,
        )
        new_balance = await conn.fetchval(
            """
                update users
                   set credit_balance_usd = credit_balance_usd - $1
                 where id = $2
                returning credit_balance_usd
                """,
            amount, user_id,
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
