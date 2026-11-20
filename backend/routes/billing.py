"""Prepaid credit billing (hosted product, Route A).

Checkout uses inline price_data so no Stripe dashboard product setup is
required — the three packs are defined here. The webhook credits the
balance idempotently on checkout.session.completed (unique index on the
session id makes retries no-ops).
"""
from __future__ import annotations

import asyncio
import logging
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from marketer.config import settings
from marketer.models import CreditTransaction
from marketer.repos import billing as billing_repo

from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()

# amount_cents is what Stripe charges; credit_usd is what lands on the
# balance. 1:1 today — the margin is applied on the debit side.
PACKS: dict[str, dict] = {
    "starter": {"amount_cents": 500, "credit_usd": Decimal("5.00"), "name": "Starter — $5 of pipeline credit"},
    "creator": {"amount_cents": 2000, "credit_usd": Decimal("20.00"), "name": "Creator — $20 of pipeline credit"},
    "studio": {"amount_cents": 5000, "credit_usd": Decimal("50.00"), "name": "Studio — $50 of pipeline credit"},
}


_MAX_PACK_CREDIT = max(p["credit_usd"] for p in PACKS.values())


def _require_billing() -> None:
    if not settings.billing_enabled or not settings.stripe_secret_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="billing is not enabled on this deployment",
        )


class CheckoutRequest(BaseModel):
    pack: str = Field(min_length=1, max_length=40)


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


# Seconds. Stripe's library default is 80, which is longer than any caller
# waits; state it, and keep it short enough that a slow Stripe cannot hold a
# worker thread for over a minute.
STRIPE_TIMEOUT_SEC = 20.0


def _stripe():
    """The Stripe module with an explicit timeout on its HTTP client."""
    import stripe

    stripe.api_key = settings.stripe_secret_key
    if getattr(stripe, "default_http_client", None) is None:
        try:
            stripe.default_http_client = stripe.RequestsClient(timeout=STRIPE_TIMEOUT_SEC)
        except Exception:  # noqa: BLE001 — never fail checkout over client wiring
            logger.warning("could not install the Stripe HTTP client with a timeout", exc_info=True)
    return stripe


@router.post(
    "/checkout",
    response_model=CheckoutResponse,
    dependencies=[user_rate_limit("billing.checkout", "10/minute")],
)
async def create_checkout(
    body: CheckoutRequest, ctx: AuthCtx = CurrentUser
) -> CheckoutResponse:
    _require_billing()
    pack = PACKS.get(body.pack)
    if pack is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="unknown pack")

    stripe = _stripe()
    base = settings.app_url.rstrip("/") or "http://localhost:3000"
    # The Stripe client is synchronous: run it off the event loop so one slow
    # checkout does not stall every other request on this worker.
    try:
        session = await asyncio.to_thread(
            _create_checkout_session, stripe, pack, ctx.user_id, base
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — Stripe errors carry request ids and key hints
        logger.warning("stripe checkout failed", exc_info=True)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="could not start checkout; try again"
        ) from e
    return CheckoutResponse(url=session.url)


def _create_checkout_session(stripe, pack: dict, user_id: str, base: str):
    return stripe.checkout.Session.create(
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
            "user_id": user_id,
            "credit_usd": str(pack["credit_usd"]),
        },
        success_url=f"{base}/settings?purchase=success",
        cancel_url=f"{base}/settings?purchase=cancelled",
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
    except Exception as e:  # noqa: BLE001 — bad signature or malformed body
        # Don't tell an unauthenticated caller why verification failed.
        logger.warning("stripe webhook rejected: %s", type(e).__name__)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="invalid webhook"
        ) from e

    if event["type"] in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
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
        credit = meta.get("credit_usd")
        try:
            credit_amount = Decimal(credit) if credit else None
        except Exception:  # noqa: BLE001 — metadata we wrote; never 500 the webhook on it
            credit_amount = None
        if credit_amount is not None and not (
            credit_amount.is_finite() and Decimal(0) < credit_amount <= _MAX_PACK_CREDIT
        ):
            # We only ever write a pack's credit into the metadata. Anything
            # else was not written by this code: refuse to turn it into balance.
            logger.error(
                "paid checkout session %s carries credit_usd outside the pack range; "
                "credit NOT granted — reconcile manually", session.get("id"),
            )
            return {"ok": True}
        if user_id and credit_amount is not None:
            await billing_repo.credit_purchase(
                user_id=user_id,
                amount_usd=credit_amount,
                checkout_session_id=session["id"],
                description="credit pack purchase",
            )
        else:
            # A paid session we can't attribute is money taken with no
            # credit granted — this must never be silent.
            logger.error(
                "paid checkout session %s missing user_id/credit_usd metadata; "
                "credit NOT granted — reconcile manually",
                session.get("id"),
            )
    elif event["type"] == "checkout.session.async_payment_failed":
        session = event["data"]["object"]
        logger.warning(
            "async payment failed for checkout session %s (user_id=%s)",
            session.get("id"), (session.get("metadata") or {}).get("user_id"),
        )

    return {"ok": True}
