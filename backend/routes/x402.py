"""x402 credit top-up: agents fund their own prepaid balance over HTTP 402.

Flow:
  POST /api/v1/x402/credits?amount_usd=10   (no X-PAYMENT)
    -> 402 with the payment requirements envelope in the body.
  POST /api/v1/x402/credits?amount_usd=10   (X-PAYMENT: <base64>)
    -> verify + settle via the facilitator, credit the caller's balance
       idempotently, and return 200 with an X-PAYMENT-RESPONSE header.

Auth: the caller is the authenticated user (typically an agent using a PAT);
the settled stablecoin payment funds THAT user's credit. Config-gated: 503 when
x402 is disabled, so it's inert by default.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException, Request, Response, status

from marketer.repos import billing
from marketer.repos import x402 as x402_repo
from marketer.services import x402
from marketer.services.x402 import X402Disabled, X402PaymentError

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

_RESOURCE = "/api/v1/x402/credits"


def _parse_amount(amount_usd: str) -> Decimal:
    try:
        value = Decimal(amount_usd)
    except (InvalidOperation, TypeError, ValueError) as e:
        raise HTTPException(422, "amount_usd must be a number") from e
    # Decimal("NaN") / Decimal("Infinity") parse fine but poison every
    # downstream comparison (a NaN ordering raises InvalidOperation). Reject
    # non-finite values here so they surface as a clean 422, not a 500.
    if not value.is_finite():
        raise HTTPException(422, "amount_usd must be a finite number")
    return value


@router.get("/config")
async def x402_config(ctx: AuthCtx = CurrentUser) -> dict:
    """Discover whether x402 top-ups are available and the accepted network/
    asset/bounds — so an agent can decide before attempting a payment."""
    from marketer.config import settings

    enabled = x402.is_enabled()
    return {
        "enabled": enabled,
        "network": settings.x402_network if enabled else None,
        "asset": settings.x402_asset if enabled else None,
        "pay_to": settings.x402_pay_to if enabled else None,
        "min_usd": settings.x402_min_topup_usd,
        "max_usd": settings.x402_max_topup_usd,
    }


@router.post("/credits")
async def buy_credits(
    request: Request,
    response: Response,
    amount_usd: str,
    ctx: AuthCtx = CurrentUser,
) -> dict:
    if not x402.is_enabled():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "x402 payments are not enabled"
        )

    amount = _parse_amount(amount_usd)
    try:
        amount = x402.clamp_topup(amount)
    except X402PaymentError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    try:
        requirements = x402.build_requirements(
            amount_usd=amount, resource=_RESOURCE,
            description=f"marketer.sh credit top-up (${amount})",
        )
    except X402Disabled as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e

    header = request.headers.get("x-payment", "")
    if not header.strip():
        # No payment yet — tell the client exactly what to pay.
        return _payment_required(response, requirements)

    try:
        payload = x402.decode_payment_header(header)
    except X402PaymentError:
        return _payment_required(response, requirements)

    try:
        result = await x402.verify_and_settle(
            payment_payload=payload, requirements=requirements
        )
    except X402Disabled as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e

    if not result.success or not result.settlement_id:
        # Payment didn't clear — 402 again with the reason.
        return _payment_required(response, requirements, reason=result.error)

    # Settled. Credit the user's prepaid balance idempotently on the settlement
    # id, and record the payment for the audit trail.
    from marketer.config import settings

    new_balance = await billing.credit_purchase(
        user_id=ctx.user_id, amount_usd=result.amount_usd,
        checkout_session_id=f"x402:{result.settlement_id}",
        description="x402 agent top-up",
    )
    # Audit record is best-effort: the credit above is the source of truth and
    # is idempotent. A failure here must not 500 the caller after we've already
    # credited them — log and move on.
    try:
        await x402_repo.record(
            user_id=ctx.user_id, settlement_id=result.settlement_id,
            payer=result.payer, amount_usd=result.amount_usd,
            network=settings.x402_network, asset=settings.x402_asset,
        )
    except Exception:  # noqa: BLE001 — never lose the credited response over an audit write
        import logging

        logging.getLogger(__name__).exception(
            "x402 payment credited but audit record failed; settlement=%s",
            result.settlement_id,
        )

    response.headers["X-PAYMENT-RESPONSE"] = x402.encode_payment_response(result)
    balance = new_balance if new_balance is not None else await billing.balance(ctx.user_id)
    return {
        "credited_usd": str(result.amount_usd),
        "balance_usd": str(balance),
        "settlement_id": result.settlement_id,
        "already_credited": new_balance is None,
    }


def _payment_required(
    response: Response, requirements: dict, *, reason: str = ""
) -> dict:
    response.status_code = status.HTTP_402_PAYMENT_REQUIRED
    body = dict(requirements)
    if reason:
        body["error"] = reason
    return body
