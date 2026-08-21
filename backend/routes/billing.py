"""Prepaid credit billing (hosted product, Route A).

Checkout uses inline price_data so no Stripe dashboard product setup is
required — the three packs are defined in ``marketer.billing.packs``.
The webhook credits the balance from the amount Stripe actually charged
(idempotent on checkout session id). Metadata ``credit_usd`` is a
consistency check, not an authority.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from marketer.billing.packs import (
    PACKS,
    as_checkout_session_id,
    checkout_session_id_for_livemode,
    charge_currency_is_usd,
    charge_is_fully_refunded,
    checkout_session_id_from_refund_source,
    credit_usd_for_paid_session,
    list_packs,
    object_livemode_agrees,
    object_livemode_matches,
    stripe_livemode_matches_secret,
)
from marketer.config import settings
from marketer.models import CreditTransaction
from marketer.repos import billing as billing_repo

from ..auth import AuthCtx, CurrentUser
from ..rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_billing() -> None:
    if not settings.billing_enabled or not settings.stripe_secret_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="billing is not enabled on this deployment",
        )


class CheckoutRequest(BaseModel):
    pack: str


class CheckoutResponse(BaseModel):
    url: str


class PackResponse(BaseModel):
    key: str
    amount_cents: int
    credit_usd: Decimal
    label: str
    blurb: str
    featured: bool


class PacksResponse(BaseModel):
    billing_enabled: bool
    packs: list[PackResponse]


class BalanceResponse(BaseModel):
    balance_usd: Decimal
    billing_enabled: bool
    margin: float
    transactions: list[CreditTransaction]


@router.get("/balance", response_model=BalanceResponse)
async def get_balance(ctx: AuthCtx = CurrentUser) -> BalanceResponse:
    bal = (
        await billing_repo.balance(ctx.user_id)
        if settings.billing_enabled
        else Decimal("0")
    )
    txs = (
        await billing_repo.transactions(ctx.user_id, limit=50)
        if settings.billing_enabled
        else []
    )
    return BalanceResponse(
        balance_usd=bal,
        billing_enabled=settings.billing_enabled,
        margin=settings.billing_margin,
        transactions=txs,
    )


@router.get("/packs", response_model=PacksResponse)
async def get_packs(ctx: AuthCtx = CurrentUser) -> PacksResponse:
    """Catalog the UI and webhook both use. Auth required so pack
    amounts aren't a public enumeration surface; the marketing site
    keeps its own static copy, checked in tests against this list."""
    del ctx
    return PacksResponse(
        billing_enabled=settings.billing_enabled,
        packs=[
            PackResponse(
                key=pack["key"],
                amount_cents=pack["amount_cents"],
                credit_usd=pack["credit_usd"],
                label=pack["label"],
                blurb=pack["blurb"],
                featured=pack["featured"],
            )
            for pack in list_packs()
        ],
    )


@router.post("/checkout", response_model=CheckoutResponse)
@limiter.limit("10/minute")
async def create_checkout(
    request: Request, body: CheckoutRequest, ctx: AuthCtx = CurrentUser
) -> CheckoutResponse:
    _require_billing()
    pack = PACKS.get(body.pack)
    if pack is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="unknown pack")

    import stripe

    stripe.api_key = settings.stripe_secret_key
    base = settings.app_url.rstrip("/") or "http://localhost:3000"
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": pack["name"]},
                    "unit_amount": pack["amount_cents"],
                },
                "quantity": 1,
            }
        ],
        metadata={
            "user_id": ctx.user_id,
            "credit_usd": str(pack["credit_usd"]),
            "pack": pack["key"],
        },
        payment_intent_data={
            "metadata": {
                "user_id": ctx.user_id,
                "credit_usd": str(pack["credit_usd"]),
                "pack": pack["key"],
            }
        },
        success_url=f"{base}/settings/billing?purchase=success",
        cancel_url=f"{base}/settings/billing?purchase=cancelled",
    )
    _stamp_checkout_session_on_payment_intent(
        session, user_id=ctx.user_id, pack=pack
    )
    return CheckoutResponse(url=session.url)


def _payment_intent_id(obj: dict) -> str | None:
    pi = obj.get("payment_intent")
    if isinstance(pi, dict):
        pi = pi.get("id")
    if not pi:
        return None
    sid = str(pi).strip()
    return sid if sid.startswith("pi_") else None


def _stamp_checkout_session_on_payment_intent(
    session: object, *, user_id: str, pack: dict
) -> None:
    """Charge.refunded inherits PaymentIntent metadata. Session.create
    cannot stamp its own id, so write it back onto the PI."""
    import stripe

    session_id = as_checkout_session_id(
        getattr(session, "id", None)
        if not isinstance(session, dict)
        else session.get("id")
    )
    raw_pi = (
        getattr(session, "payment_intent", None)
        if not isinstance(session, dict)
        else session.get("payment_intent")
    )
    if isinstance(raw_pi, dict):
        raw_pi = raw_pi.get("id")
    payment_intent = str(raw_pi).strip() if raw_pi else ""
    if not session_id or not payment_intent.startswith("pi_"):
        return
    try:
        stripe.PaymentIntent.modify(
            payment_intent,
            metadata={
                "user_id": user_id,
                "credit_usd": str(pack["credit_usd"]),
                "pack": pack["key"],
                "checkout_session_id": session_id,
            },
        )
    except Exception:
        logger.warning(
            "could not stamp checkout_session_id on payment_intent %s",
            payment_intent,
            exc_info=True,
        )


def _checkout_session_id_from_retrieved_payment_intent(
    payment_intent: str,
) -> str | None:
    """Read the session id stamped onto the PI at checkout time."""
    import stripe

    stripe.api_key = settings.stripe_secret_key
    try:
        pi = stripe.PaymentIntent.retrieve(payment_intent)
    except Exception:
        logger.error(
            "could not retrieve payment_intent %s for refund",
            payment_intent,
            exc_info=True,
        )
        return None
    meta = pi.get("metadata") if isinstance(pi, dict) else getattr(pi, "metadata", None)
    if meta is None:
        return None
    stamped = meta.get("checkout_session_id") if isinstance(meta, dict) else getattr(
        meta, "checkout_session_id", None
    )
    return as_checkout_session_id(stamped)


def _checkout_session_id_from_session_list(
    payment_intent: str, *, livemode: object
) -> str | None:
    import stripe

    stripe.api_key = settings.stripe_secret_key
    try:
        listed = stripe.checkout.Session.list(payment_intent=payment_intent, limit=1)
    except Exception:
        logger.error(
            "could not list checkout sessions for payment_intent %s",
            payment_intent,
            exc_info=True,
        )
        return None
    data = listed.get("data") if isinstance(listed, dict) else getattr(listed, "data", None)
    if not isinstance(data, list) or not data:
        return None
    first = data[0]
    if not isinstance(first, dict):
        first = {
            "id": getattr(first, "id", None),
            "mode": getattr(first, "mode", None),
            "currency": getattr(first, "currency", None),
            "livemode": getattr(first, "livemode", None),
        }
    # Fail-closed: a listed session without mode=payment must not reverse
    # a pack. Stripe always sends mode; missing mode is not a payment.
    if first.get("mode") != "payment":
        return None
    # Pack amounts are USD cents. A listed JPY/EUR payment session must
    # not reverse a dollar credit even if the id is cs_….
    if not charge_currency_is_usd(first):
        return None
    if not object_livemode_agrees(first, livemode):
        return None
    return as_checkout_session_id(first.get("id"))


def _checkout_session_id_for_refunded_charge(
    charge: dict, *, livemode: object
) -> str | None:
    """Production ``charge.refunded`` events do not carry the Checkout
    session id. Prefer a stamp (charge metadata, then expanded PI
    metadata), then the retrieved PI, then Stripe's session list."""
    stamped = checkout_session_id_from_refund_source(charge)
    if stamped:
        return stamped
    pi = charge.get("payment_intent")
    if isinstance(pi, dict):
        from_pi = checkout_session_id_from_refund_source(pi)
        if from_pi:
            return from_pi
    payment_intent = _payment_intent_id(charge)
    if not payment_intent or not settings.stripe_secret_key:
        return None
    retrieved = _checkout_session_id_from_retrieved_payment_intent(payment_intent)
    if retrieved:
        return retrieved
    return _checkout_session_id_from_session_list(
        payment_intent, livemode=livemode
    )


@router.post("/webhook")
async def stripe_webhook(request: Request) -> dict:
    """Stripe event receiver — no bearer auth; signature-verified."""
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="stripe webhook secret not configured",
        )

    import stripe

    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload, signature, settings.stripe_webhook_secret
        )
    except Exception:
        # Do not echo Stripe/library internals to an unauthenticated caller.
        logger.info("stripe webhook rejected", exc_info=True)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="invalid webhook"
        ) from None

    if not stripe_livemode_matches_secret(
        event.get("livemode"), settings.stripe_secret_key
    ):
        logger.error(
            "stripe webhook livemode mismatch (event_id=%s livemode=%s); not crediting",
            event.get("id"),
            event.get("livemode"),
        )
        return {"ok": True}

    if event["type"] in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    ):
        session = event["data"]["object"]
        # `completed` fires before funds settle for delayed payment
        # methods (payment_status="unpaid"); crediting then would grant
        # balance for money that may never arrive. Those sessions credit
        # on the later `async_payment_succeeded` event instead.
        if session.get("payment_status") != "paid":
            logger.info(
                "checkout session %s not yet paid (payment_status=%s); awaiting settlement",
                session.get("id"), session.get("payment_status"),
            )
            return {"ok": True}
        if not object_livemode_matches(session, event.get("livemode")):
            logger.error(
                "paid checkout session %s livemode missing or contradicts event; "
                "not crediting",
                session.get("id"),
            )
            return {"ok": True}
        meta = session.get("metadata") or {}
        user_id = meta.get("user_id")
        credit = credit_usd_for_paid_session(session)
        session_id = checkout_session_id_for_livemode(
            session.get("id"), event.get("livemode")
        )
        if user_id and credit is not None and session_id:
            await billing_repo.credit_purchase(
                user_id=user_id,
                amount_usd=credit,
                checkout_session_id=session_id,
                description="credit pack purchase",
            )
        else:
            # A paid session we can't attribute or whose amount does not
            # match a known pack is money taken with no credit granted —
            # this must never be silent.
            logger.error(
                "paid checkout session %s not credited "
                "(user_id=%s amount_total=%s currency=%s metadata_credit=%s); "
                "reconcile manually",
                session.get("id"),
                user_id,
                session.get("amount_total"),
                session.get("currency"),
                meta.get("credit_usd"),
            )
    elif event["type"] == "checkout.session.async_payment_failed":
        session = event["data"]["object"]
        if not object_livemode_matches(session, event.get("livemode")):
            logger.warning(
                "async payment failed session %s livemode missing or contradicts event; "
                "not reversing",
                session.get("id"),
            )
            return {"ok": True}
        if session.get("currency") is not None and not charge_currency_is_usd(session):
            logger.warning(
                "async payment failed session %s not reversed (currency=%s)",
                session.get("id"),
                session.get("currency"),
            )
            return {"ok": True}
        session_id = checkout_session_id_for_livemode(
            session.get("id"), event.get("livemode")
        )
        user_id = (session.get("metadata") or {}).get("user_id")
        if not session_id:
            logger.warning(
                "async payment failed with no checkout session id (user_id=%s)",
                user_id,
            )
            return {"ok": True}
        reversed_balance = await billing_repo.reverse_purchase(
            checkout_session_id=session_id,
            description="async payment failed — purchase reversed",
        )
        if reversed_balance is not None:
            logger.warning(
                "reversed credit for async payment failure "
                "(session_id=%s user_id=%s new_balance=%s)",
                session_id,
                user_id,
                reversed_balance,
            )
        else:
            logger.warning(
                "async payment failed for checkout session %s (user_id=%s)",
                session_id,
                user_id,
            )
    elif event["type"] == "charge.refunded":
        charge = event["data"]["object"]
        if not charge_is_fully_refunded(charge):
            logger.warning(
                "partial charge refund %s not reversed (amount=%s refunded=%s); "
                "reconcile manually",
                charge.get("id"),
                charge.get("amount"),
                charge.get("amount_refunded"),
            )
            return {"ok": True}
        if not charge_currency_is_usd(charge):
            logger.error(
                "fully refunded charge %s not reversed (currency=%s); "
                "reconcile manually",
                charge.get("id"),
                charge.get("currency"),
            )
            return {"ok": True}
        if not object_livemode_agrees(charge, event.get("livemode")):
            logger.error(
                "fully refunded charge %s livemode contradicts event; "
                "reconcile manually",
                charge.get("id"),
            )
            return {"ok": True}
        session_id = checkout_session_id_for_livemode(
            _checkout_session_id_for_refunded_charge(
                charge, livemode=event.get("livemode")
            ),
            event.get("livemode"),
        )
        if not session_id:
            logger.error(
                "fully refunded charge %s has no checkout session "
                "(payment_intent=%s); reconcile manually",
                charge.get("id"),
                charge.get("payment_intent"),
            )
            return {"ok": True}
        reversed_balance = await billing_repo.reverse_purchase(
            checkout_session_id=session_id,
            description="stripe charge refunded — purchase reversed",
        )
        if reversed_balance is not None:
            logger.warning(
                "reversed credit for refunded charge "
                "(charge_id=%s session_id=%s new_balance=%s)",
                charge.get("id"),
                session_id,
                reversed_balance,
            )

    return {"ok": True}
