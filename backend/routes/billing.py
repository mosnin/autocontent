"""Prepaid credit billing (hosted product, Route A).

Checkout uses inline price_data so no Stripe dashboard product setup is
required — the three packs are defined in ``marketer.billing.packs``.
The webhook credits the balance from the amount Stripe actually charged
(idempotent on checkout session id). Metadata ``credit_usd`` is a
consistency check, not an authority. Full refunds and full disputes
reverse the matching purchase.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from marketer.billing.packs import (
    PACKS,
    as_checkout_session_id,
    charge_is_fully_refunded,
    credit_usd_for_paid_session,
    currency_is_usd,
    dispute_covers_full_charge,
    object_livemode_matches,
    stripe_livemode_matches_secret,
)
from marketer.config import settings
from marketer.models import CreditTransaction
from marketer.repos import billing as billing_repo

from ..auth import AuthCtx, CurrentUser

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
        else Decimal(0)
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


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    body: CheckoutRequest, ctx: AuthCtx = CurrentUser
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
    _stamp_checkout_session_on_payment_intent(session, user_id=ctx.user_id, pack=pack)
    return CheckoutResponse(url=session.url)


def _obj_get(obj: object, key: str) -> object:
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


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
    """``charge.refunded`` / disputes inherit PaymentIntent metadata.
    Session.create cannot stamp its own id, so write it back onto the PI."""
    import stripe

    session_id = as_checkout_session_id(_obj_get(session, "id"))
    raw_pi = _obj_get(session, "payment_intent")
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
        logger.exception(
            "could not stamp checkout_session_id on payment_intent %s",
            payment_intent,
        )


def _checkout_session_id_from_metadata(obj: dict) -> str | None:
    meta = obj.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    return as_checkout_session_id(meta.get("checkout_session_id"))


def _checkout_session_id_from_retrieved_payment_intent(payment_intent: str) -> str | None:
    import stripe

    stripe.api_key = settings.stripe_secret_key
    try:
        pi = stripe.PaymentIntent.retrieve(payment_intent)
    except Exception:
        logger.exception(
            "could not retrieve payment_intent %s for refund/dispute",
            payment_intent,
        )
        return None
    if not isinstance(pi, dict):
        pi = {"metadata": getattr(pi, "metadata", None)}
    return _checkout_session_id_from_metadata(pi)


def _checkout_session_id_from_session_list(payment_intent: str) -> str | None:
    import stripe

    stripe.api_key = settings.stripe_secret_key
    try:
        listed = stripe.checkout.Session.list(payment_intent=payment_intent, limit=1)
    except Exception:
        logger.exception(
            "could not list checkout sessions for payment_intent %s",
            payment_intent,
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
        }
    if first.get("mode") != "payment" or not currency_is_usd(first):
        return None
    return as_checkout_session_id(first.get("id"))


def _checkout_session_id_for_charge(charge: dict) -> str | None:
    stamped = _checkout_session_id_from_metadata(charge)
    if stamped:
        return stamped
    pi = charge.get("payment_intent")
    if isinstance(pi, dict):
        from_pi = _checkout_session_id_from_metadata(pi)
        if from_pi:
            return from_pi
    payment_intent = _payment_intent_id(charge)
    if not payment_intent or not settings.stripe_secret_key:
        return None
    retrieved = _checkout_session_id_from_retrieved_payment_intent(payment_intent)
    if retrieved:
        return retrieved
    return _checkout_session_id_from_session_list(payment_intent)


def _retrieve_charge(charge_id: str) -> dict | None:
    import stripe

    stripe.api_key = settings.stripe_secret_key
    try:
        charge = stripe.Charge.retrieve(charge_id)
    except Exception:
        logger.exception("could not retrieve charge %s for dispute", charge_id)
        return None
    if isinstance(charge, dict):
        return charge
    return {
        "id": getattr(charge, "id", None),
        "amount": getattr(charge, "amount", None),
        "currency": getattr(charge, "currency", None),
        "metadata": getattr(charge, "metadata", None),
        "payment_intent": getattr(charge, "payment_intent", None),
        "livemode": getattr(charge, "livemode", None),
    }


async def _reverse_session(
    session_id: str | None, *, description: str, context: str
) -> None:
    if not session_id:
        logger.error("%s has no checkout session; reconcile manually", context)
        return
    reversed_balance = await billing_repo.reverse_purchase(
        checkout_session_id=session_id, description=description
    )
    if reversed_balance is not None:
        logger.warning(
            "reversed credit (%s session_id=%s new_balance=%s)",
            context, session_id, reversed_balance,
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
        logger.info("stripe webhook rejected", exc_info=True)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="invalid webhook"
        ) from None

    if not stripe_livemode_matches_secret(
        event.get("livemode"), settings.stripe_secret_key
    ):
        logger.error(
            "stripe webhook livemode mismatch (event_id=%s livemode=%s); not applying",
            event.get("id"),
            event.get("livemode"),
        )
        return {"ok": True}

    event_type = event["type"]
    if event_type in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    ):
        await _credit_paid_session(event)
    elif event_type == "checkout.session.async_payment_failed":
        await _reverse_async_failure(event)
    elif event_type == "charge.refunded":
        await _reverse_refunded_charge(event)
    elif event_type == "charge.dispute.created":
        await _reverse_full_dispute(event)

    return {"ok": True}


async def _credit_paid_session(event: dict) -> None:
    session = event["data"]["object"]
    if session.get("payment_status") != "paid":
        logger.info(
            "checkout session %s not yet paid (payment_status=%s); awaiting settlement",
            session.get("id"), session.get("payment_status"),
        )
        return
    if not object_livemode_matches(session, event.get("livemode")):
        logger.error(
            "paid checkout session %s livemode missing or contradicts event; not crediting",
            session.get("id"),
        )
        return
    meta = session.get("metadata") or {}
    user_id = meta.get("user_id")
    credit = credit_usd_for_paid_session(session)
    session_id = as_checkout_session_id(session.get("id"))
    if user_id and credit is not None and session_id:
        await billing_repo.credit_purchase(
            user_id=user_id,
            amount_usd=credit,
            checkout_session_id=session_id,
            description="credit pack purchase",
        )
        return
    logger.error(
        "paid checkout session %s not credited "
        "(user_id=%s amount_total=%s currency=%s mode=%s metadata_credit=%s); "
        "reconcile manually",
        session.get("id"),
        user_id,
        session.get("amount_total"),
        session.get("currency"),
        session.get("mode"),
        meta.get("credit_usd"),
    )


async def _reverse_async_failure(event: dict) -> None:
    session = event["data"]["object"]
    if not object_livemode_matches(session, event.get("livemode")):
        logger.warning(
            "async payment failed session %s livemode missing or contradicts event",
            session.get("id"),
        )
        return
    if session.get("mode") != "payment" or session.get("payment_status") == "paid":
        logger.warning(
            "async payment failed session %s not reversed (mode=%s payment_status=%s)",
            session.get("id"), session.get("mode"), session.get("payment_status"),
        )
        return
    if not currency_is_usd(session):
        logger.warning(
            "async payment failed session %s not reversed (currency=%s)",
            session.get("id"), session.get("currency"),
        )
        return
    await _reverse_session(
        as_checkout_session_id(session.get("id")),
        description="async payment failed — purchase reversed",
        context=f"async_payment_failed {session.get('id')}",
    )


async def _reverse_refunded_charge(event: dict) -> None:
    charge = event["data"]["object"]
    if not charge_is_fully_refunded(charge):
        logger.warning(
            "partial charge refund %s not reversed (amount=%s refunded=%s); "
            "reconcile manually",
            charge.get("id"), charge.get("amount"), charge.get("amount_refunded"),
        )
        return
    if not currency_is_usd(charge):
        logger.error(
            "fully refunded charge %s not reversed (currency=%s); reconcile manually",
            charge.get("id"), charge.get("currency"),
        )
        return
    if not object_livemode_matches(charge, event.get("livemode")):
        logger.error(
            "fully refunded charge %s livemode missing or contradicts event",
            charge.get("id"),
        )
        return
    await _reverse_session(
        _checkout_session_id_for_charge(charge),
        description="stripe charge refunded — purchase reversed",
        context=f"charge.refunded {charge.get('id')}",
    )


async def _reverse_full_dispute(event: dict) -> None:
    """Full-amount disputes claw back the pack immediately.

    Partial disputes stay operator-reconcile: reversing a whole pack for a
    $1 dispute would take legitimate leftover credit.
    """
    dispute = event["data"]["object"]
    if not object_livemode_matches(dispute, event.get("livemode")):
        logger.error(
            "dispute %s livemode missing or contradicts event; not reversing",
            dispute.get("id"),
        )
        return
    raw_charge = dispute.get("charge")
    if isinstance(raw_charge, dict):
        charge = raw_charge
    else:
        charge_id = str(raw_charge or "").strip()
        if not charge_id.startswith("ch_") or not settings.stripe_secret_key:
            logger.error(
                "dispute %s has no charge id; reconcile manually", dispute.get("id")
            )
            return
        charge = _retrieve_charge(charge_id)
        if charge is None:
            return
    if not dispute_covers_full_charge(dispute, charge):
        logger.warning(
            "partial dispute %s not reversed (dispute_amount=%s charge_amount=%s); "
            "reconcile manually",
            dispute.get("id"), dispute.get("amount"), charge.get("amount"),
        )
        return
    await _reverse_session(
        _checkout_session_id_for_charge(charge),
        description="stripe charge disputed — purchase reversed",
        context=f"charge.dispute.created {dispute.get('id')}",
    )
