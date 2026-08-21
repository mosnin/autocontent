"""Shared hosted-product money gates.

HTTP routes raise 402 via ``backend.hosted_safety.refuse_unbilled_generate``.
Cron / Modal spawn paths cannot raise HTTPException — they call
``unbilled_generate_blocked`` and skip before a job row or GPU/LLM call.
"""
from __future__ import annotations

from ..config import settings


def unbilled_generate_blocked() -> bool:
    """True when this deploy must not start paid work without Stripe.

    Default ``allow_unbilled_usage`` is True so existing self-hosted
    deploys keep working. Public launch sets it False.
    """
    return not settings.billing_enabled and not settings.allow_unbilled_usage


def raise_if_unbilled() -> None:
    """Worker-side twin of the HTTP 402. Call before a niche lookup or
    provider touch so ``modal run`` / leftover queued jobs cannot spend
    after the HTTP edge already refused."""
    if unbilled_generate_blocked():
        from ..repos.spend import SpendCapExceeded

        raise SpendCapExceeded(
            "cannot spend: billing is required on this deployment "
            "(MARKETER_ALLOW_UNBILLED_USAGE=false).",
            scope="credits",
        )
