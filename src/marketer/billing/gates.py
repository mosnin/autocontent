"""Shared hosted-product money gates."""
from __future__ import annotations


async def has_spendable_credit(user_id: str) -> bool:
    """True when this user may start paid work.

    Self-hosted (billing off) always returns True. Hosted billing requires
    a strictly positive prepaid balance before enqueue / cron spawn.
    """
    from ..config import settings

    if not settings.billing_enabled:
        return True
    from ..repos import billing as billing_repo

    return await billing_repo.balance(user_id) > 0
