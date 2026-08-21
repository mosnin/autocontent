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
    known = {pack["credit_usd"] for pack in PACKS.values()}
    return value if value in known else None


def _currency_is_usd(obj: dict[str, Any]) -> bool:
    """Pack amounts are dollar cents. Missing / non-USD codes credit nothing."""
    currency = obj.get("currency")
    if currency is None:
        return False
    return str(currency).strip().lower() == "usd"


def _session_currency_is_usd(session: dict[str, Any]) -> bool:
    """Checkout packs are USD-only. A matching cent amount in another
    currency must not grant dollar credit (2000 JPY is not $20)."""
    return _currency_is_usd(session)


def charge_currency_is_usd(charge: dict[str, Any]) -> bool:
    """A full refund in JPY must not reverse a USD pack credit."""
    return _currency_is_usd(charge)


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


def object_livemode_agrees(obj: dict[str, Any], event_livemode: object) -> bool:
    """A Checkout/Charge ``livemode`` that contradicts the event must not
    credit or reverse. Missing is allowed so a stamp-only refund still
    resolves; the event already passed the secret-prefix check."""
    live = obj.get("livemode")
    if live is None:
        return True
    return isinstance(live, bool) and live is event_livemode


def object_livemode_matches(obj: dict[str, Any], event_livemode: object) -> bool:
    """Stripe Checkout/Charge objects always carry ``livemode``. Missing
    or a non-bool must not credit or reverse."""
    live = obj.get("livemode")
    return isinstance(live, bool) and live is event_livemode


def _session_is_payment_mode(session: dict[str, Any]) -> bool:
    """Pack checkout is ``mode=payment``. Subscriptions and setup sessions
    must not grant prepaid generate credit even if ``amount_total`` matches."""
    return session.get("mode") == "payment"


def as_checkout_session_id(value: object) -> str | None:
    """Checkout session ids are ``cs_…``. Anything else must not reverse."""
    sid = str(value or "").strip()
    if not sid.startswith("cs_") or len(sid) <= 3:
        return None
    return sid


def checkout_session_id_for_livemode(value: object, livemode: object) -> str | None:
    """Checkout ids must match the event's livemode.

    Live events credit/reverse only ``cs_live_…``. Test events must not
    touch a live session id even when the event already passed the
    secret-prefix livemode check.
    """
    sid = as_checkout_session_id(value)
    if not sid:
        return None
    if livemode is True:
        return sid if sid.startswith("cs_live_") else None
    if livemode is False:
        return None if sid.startswith("cs_live_") else sid
    return None


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


def checkout_session_id_from_refund_source(obj: dict[str, Any]) -> str | None:
    """Resolve the Checkout session id we credited, from a refund event object.

    Prefers an explicit metadata stamp so tests and operators can pin the
    session without a Stripe list call. Empty / missing / non-``cs_`` ids
    reverse nothing.
    """
    meta = obj.get("metadata") or {}
    stamped = as_checkout_session_id(meta.get("checkout_session_id"))
    if stamped:
        return stamped
    if obj.get("object") == "checkout.session":
        return as_checkout_session_id(obj.get("id"))
    return None


def charge_is_fully_refunded(charge: dict[str, Any]) -> bool:
    """Partial refunds must not claw back a whole pack."""
    if charge.get("refunded") is True:
        return True
    amount = charge.get("amount")
    refunded = charge.get("amount_refunded")
    try:
        total = int(amount)  # type: ignore[arg-type]
        taken = int(refunded)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return total > 0 and taken >= total


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
    # Never fall back to amount_subtotal — discounts can make subtotal differ
    # from what Stripe actually collected; only amount_total is authoritative.
    amount = session.get("amount_total")
    if amount is None:
        return None
    from_amount = credit_usd_for_amount_cents(amount)
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
