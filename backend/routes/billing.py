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
    credit_usd_for_paid_session,
    list_packs,
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
        success_url=f"{base}/settings/billing?purchase=success",
        cancel_url=f"{base}/settings/billing?purchase=cancelled",
    )
    return CheckoutResponse(url=session.url)


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
        meta = session.get("metadata") or {}
        user_id = meta.get("user_id")
        credit = credit_usd_for_paid_session(session)
        if user_id and credit is not None:
            await billing_repo.credit_purchase(
                user_id=user_id,
                amount_usd=credit,
                checkout_session_id=session["id"],
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
        logger.warning(
            "async payment failed for checkout session %s (user_id=%s)",
            session.get("id"), (session.get("metadata") or {}).get("user_id"),
        )

    return {"ok": True}
