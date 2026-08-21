"""Prepaid credit packs — single source of truth.

Checkout creates Stripe sessions from these amounts. The webhook credits
the user from ``amount_total`` (what Stripe charged), never from a
caller-supplied ``credit_usd`` that does not match a known pack. That
closes the case where a session's metadata is edited to grant more
credit than was paid.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, TypedDict


class Pack(TypedDict):
    key: str
    amount_cents: int
    credit_usd: Decimal
    name: str
    label: str
    blurb: str
    featured: bool


PACKS: dict[str, Pack] = {
    "starter": {
        "key": "starter",
        "amount_cents": 500,
        "credit_usd": Decimal("5.00"),
        "name": "Starter — $5 of pipeline credit",
        "label": "Starter",
        "blurb": "Try the machine",
        "featured": False,
    },
    "creator": {
        "key": "creator",
        "amount_cents": 2000,
        "credit_usd": Decimal("20.00"),
        "name": "Creator — $20 of pipeline credit",
        "label": "Creator",
        "blurb": "A daily channel",
        "featured": True,
    },
    "studio": {
        "key": "studio",
        "amount_cents": 5000,
        "credit_usd": Decimal("50.00"),
        "name": "Studio — $50 of pipeline credit",
        "label": "Studio",
        "blurb": "Several niches",
        "featured": False,
    },
}


def list_packs() -> list[Pack]:
    return list(PACKS.values())


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
    if cents < 0:
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
    known = {pack["credit_usd"] for pack in PACKS.values()}
    return value if value in known else None


def _session_currency_is_usd(session: dict[str, Any]) -> bool:
    """Checkout packs are USD-only. A matching cent amount in another
    currency must not grant dollar credit (2000 JPY is not $20)."""
    currency = session.get("currency")
    if currency is None:
        return False
    return str(currency).strip().lower() == "usd"


def stripe_livemode_matches_secret(livemode: object, secret_key: str) -> bool:
    """Test events must not credit a live key; live events must not credit a test key."""
    if not isinstance(livemode, bool):
        return False
    key = (secret_key or "").strip()
    if key.startswith("sk_live_"):
        return livemode is True
    if key.startswith("sk_test_"):
        return livemode is False
    return False


def _session_is_payment_mode(session: dict[str, Any]) -> bool:
    """Pack checkout is ``mode=payment``. Subscriptions and setup sessions
    must not grant prepaid generate credit even if ``amount_total`` matches."""
    return session.get("mode") == "payment"


def credit_usd_for_paid_session(session: dict[str, Any]) -> Decimal | None:
    """Fail-closed credit for a paid Stripe Checkout session.

    Prefers the amount Stripe collected. Metadata ``credit_usd`` is a
    consistency check, not an authority: a mismatch credits nothing so
    an operator can reconcile, rather than granting unearned balance.
    Currency must be USD — pack amounts are dollar cents.
    """
    if not _session_is_payment_mode(session):
        return None
    if not _session_currency_is_usd(session):
        return None
    amount = session.get("amount_total")
    from_amount = (
        credit_usd_for_amount_cents(amount) if amount is not None else None
    )
    if from_amount is None:
        # No recognised charge — do not fall back to metadata. A session
        # without amount_total, or with an unknown amount, is reconciled
        # by an operator rather than granted from an editable field.
        return None
    meta = (session.get("metadata") or {}).get("credit_usd")
    from_meta = credit_usd_for_known_balance(meta) if meta is not None else None
    if from_meta is not None and from_meta != from_amount:
        return None
    return from_amount
