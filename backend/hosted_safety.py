"""HTTP-edge money gates for the hosted product."""
from __future__ import annotations

from fastapi import HTTPException, status

from marketer.billing.gates import has_spendable_credit


async def require_spendable_credit(user_id: str) -> None:
    """Refuse enqueue when billing is on and the prepaid balance is empty.

    Stops a $0 user from spawning a Modal container that would only fail
    after the first provider preflight.
    """
    if not await has_spendable_credit(user_id):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail="prepaid credit required — top up to continue",
        )
