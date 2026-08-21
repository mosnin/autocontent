"""Hosted-product gates that must fail closed without owner secrets.

``refuse_unbilled_generate`` is the HTTP-edge twin of
``SpendContext.ensure_can_spend`` when billing is off and
``ALLOW_UNBILLED_USAGE`` is false: do not enqueue a Modal job that will
only fail after the operator's GPU/LLM keys have already been touched.
"""
from __future__ import annotations

from fastapi import HTTPException, status

from marketer.billing.gates import unbilled_generate_blocked


def refuse_unbilled_generate() -> None:
    if unbilled_generate_blocked():
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail="unbilled usage is disabled on this deployment",
        )
