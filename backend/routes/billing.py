"""Prepaid credit billing (hosted product, Route A).

Checkout uses inline price_data so no Stripe dashboard product setup is
required — the three packs are defined here. The webhook credits the
balance idempotently on checkout.session.completed (unique index on the
session id makes retries no-ops).
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from autocontent.config import settings
from autocontent.models import CreditTransaction
from autocontent.repos import billing as billing_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

# amount_cents is what Stripe charges; credit_usd is what lands on the
# balance. 1:1 today — the margin is applied on the debit side.
PACKS: dict[str, dict] = {
    "starter": {"amount_cents": 500, "credit_usd": Decimal("5.00"), "name": "Starter — $5 of pipeline credit"},
    "creator": {"amount_cents": 2000, "credit_usd": Decimal("20.00"), "name": "Creator — $20 of pipeline credit"},
    "studio": {"amount_cents": 5000, "credit_usd": Decimal("50.00"), "name": "Studio — $50 of pipeline credit"},
}


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
    except Exception as e:  # noqa: BLE001 — bad signature or malformed body
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail=f"invalid webhook: {e}"
        ) from e

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        meta = session.get("metadata") or {}
        user_id = meta.get("user_id")
        credit = meta.get("credit_usd")
        if user_id and credit:
            await billing_repo.credit_purchase(
                user_id=user_id,
                amount_usd=Decimal(credit),
                checkout_session_id=session["id"],
                description="credit pack purchase",
            )

    return {"ok": True}
