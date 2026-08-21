"""Prepaid credit packs — single source of truth.

Checkout creates Stripe sessions from these amounts. The webhook credits
from ``amount_total`` (what Stripe collected), never from a caller-supplied
``credit_usd`` that does not match a known pack.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, TypedDict


class Pack(TypedDict):
    key: str
    amount_cents: int
    credit_usd: Decimal
    name: str


PACKS: dict[str, Pack] = {
    "starter": {
        "key": "starter",
        "amount_cents": 500,
        "credit_usd": Decimal("5.00"),
        "name": "Starter — $5 of pipeline credit",
    },
    "creator": {
        "key": "creator",
        "amount_cents": 2000,
        "credit_usd": Decimal("20.00"),
        "name": "Creator — $20 of pipeline credit",
    },
    "studio": {
        "key": "studio",
        "amount_cents": 5000,
        "credit_usd": Decimal("50.00"),
        "name": "Studio — $50 of pipeline credit",
    },
}


def credit_usd_for_amount_cents(amount_cents: object) -> Decimal | None:
    """Map a Stripe ``amount_total`` (cents) to the matching pack credit."""
    if isinstance(amount_cents, bool):
        return None
    if isinstance(amount_cents, float):
        if not amount_cents.is_integer():
            return None
        amount_cents = int(amount_cents)
    try:
        cents = int(amount_cents)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if cents <= 0:
        return None
    for pack in PACKS.values():
        if pack["amount_cents"] == cents:
            return pack["credit_usd"]
    return None


def credit_usd_for_known_balance(amount: object) -> Decimal | None:
    """Accept metadata ``credit_usd`` only when it is an exact known pack."""
    try:
        value = Decimal(str(amount))
    except (InvalidOperation, ValueError):
        return None
    if not value.is_finite():
        return None
    known = {pack["credit_usd"] for pack in PACKS.values()}
    return value if value in known else None


def currency_is_usd(obj: dict[str, Any]) -> bool:
    currency = obj.get("currency")
    if currency is None:
        return False
    return str(currency).strip().lower() == "usd"


def stripe_livemode_matches_secret(livemode: object, secret_key: str) -> bool:
    """Test events must not credit a live key; live events must not credit a test key."""
    if not isinstance(livemode, bool):
        return False
    key = (secret_key or "").strip()
    if key.startswith(("sk_live_", "rk_live_")):
        return livemode is True
    if key.startswith(("sk_test_", "rk_test_")):
        return livemode is False
    return False


def object_livemode_matches(obj: dict[str, Any], event_livemode: object) -> bool:
    live = obj.get("livemode")
    return isinstance(live, bool) and live is event_livemode


def as_checkout_session_id(value: object) -> str | None:
    sid = str(value or "").strip()
    if not sid.startswith("cs_") or len(sid) <= 3:
        return None
    return sid


def ledger_purchase_reference(value: object) -> str | None:
    """Ids that may credit or reverse prepaid balance.

    Stripe Checkout is ``cs_…``. Agent x402 top-ups are ``x402:…``.
    PaymentIntent / Charge ids must never become ledger references.
    """
    sid = as_checkout_session_id(value)
    if sid:
        return sid
    raw = str(value or "").strip()
    if raw.startswith("x402:") and len(raw) > 5:
        return raw
    return None


def charge_is_fully_refunded(charge: dict[str, Any]) -> bool:
    """Partial refunds must not claw back a whole pack."""
    amount = charge.get("amount")
    refunded = charge.get("amount_refunded")
    if amount is None and refunded is None:
        return charge.get("refunded") is True
    if isinstance(amount, bool) or isinstance(refunded, bool):
        return False
    if isinstance(amount, float) and not amount.is_integer():
        return False
    if isinstance(refunded, float) and not refunded.is_integer():
        return False
    try:
        total = int(amount)  # type: ignore[arg-type]
        taken = int(refunded)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return total > 0 and taken >= total


def dispute_covers_full_charge(dispute: dict[str, Any], charge: dict[str, Any]) -> bool:
    """A partial dispute must not reverse a whole pack."""
    if not currency_is_usd(dispute) or not currency_is_usd(charge):
        return False
    raw_dispute = dispute.get("amount")
    raw_charge = charge.get("amount")
    if isinstance(raw_dispute, bool) or isinstance(raw_charge, bool):
        return False
    try:
        disputed = int(raw_dispute)  # type: ignore[arg-type]
        charged = int(raw_charge)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return charged > 0 and disputed >= charged


def credit_usd_for_paid_session(session: dict[str, Any]) -> Decimal | None:
    """Fail-closed credit for a paid Stripe Checkout session.

    Prefers the amount Stripe collected. Metadata ``credit_usd`` is a
    consistency check, not an authority.
    """
    if session.get("mode") != "payment":
        return None
    if not currency_is_usd(session):
        return None
    amount = session.get("amount_total")
    if amount is None:
        return None
    from_amount = credit_usd_for_amount_cents(amount)
    if from_amount is None:
        return None
    meta = (session.get("metadata") or {}).get("credit_usd")
    from_meta = credit_usd_for_known_balance(meta) if meta is not None else None
    if from_meta is not None and from_meta != from_amount:
        return None
    return from_amount
