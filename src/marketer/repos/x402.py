"""Audit trail of settled x402 agent payments. The actual credit balance is
moved by billing.credit_purchase (idempotent on the settlement id); this table
records the on-chain settlement for accounting + display."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool


class X402Payment(BaseModel):
    id: UUID
    user_id: str
    settlement_id: str
    payer: str
    amount_usd: Decimal
    network: str
    asset: str
    credited: bool
    created_at: datetime


_COLS = (
    "id, user_id, settlement_id, payer, amount_usd, network, asset, credited, "
    "created_at"
)


async def record(
    *,
    user_id: str,
    settlement_id: str,
    payer: str,
    amount_usd: Decimal,
    network: str,
    asset: str,
    credited: bool = True,
) -> bool:
    """Insert a settled payment. Idempotent on settlement_id — returns True if
    this is the first time we've seen it, False on a duplicate."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into x402_payments
            (user_id, settlement_id, payer, amount_usd, network, asset, credited)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (settlement_id) do nothing
        returning {_COLS}
        """,
        user_id, settlement_id, payer, amount_usd, network, asset, credited,
    )
    return row is not None


async def list_for_user(user_id: str, *, limit: int = 100) -> list[X402Payment]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_COLS} from x402_payments where user_id = $1 "
        "order by created_at desc limit $2",
        user_id, limit,
    )
    return [X402Payment(**dict(r)) for r in rows]
