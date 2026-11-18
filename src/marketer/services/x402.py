"""x402 — HTTP 402 agent payments (Coinbase's protocol).

Flow: a client hits a paid endpoint; we reply 402 with an `accepts` envelope
describing the payment (scheme `exact`, network, USDC asset, payTo, amount). The
client (an agent's wallet) signs and retries with a base64 `X-PAYMENT` header;
we ask the facilitator to verify + settle it on-chain, then fulfill and return an
`X-PAYMENT-RESPONSE` header.

Discipline (same as Composio/Inngest): config-gated + lazy. Inert unless
`x402_enabled` AND a pay-to address + asset are set. Facilitator HTTP calls are
isolated behind two functions the tests monkeypatch, so no real settlement
happens in CI. Amounts are handled in USDC's 6-decimal atomic units.
"""
from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass
from decimal import Decimal

from ..config import settings

X402_VERSION = 1
# USDC and most facilitator-supported stablecoins use 6 decimals.
_ATOMIC = Decimal(10) ** 6


class X402Disabled(RuntimeError):
    """x402 is off or misconfigured. Surfaced as 503, never a 500."""


class X402PaymentError(RuntimeError):
    """A submitted payment was malformed or the facilitator rejected it.
    Surfaced as 402 so the client can correct and retry."""


class X402FacilitatorError(RuntimeError):
    """The facilitator could not be reached or answered with an error.

    ``stage`` says what that means for the payer's money:

    - ``verify``: nothing was submitted on-chain. Safe to try again.
    - ``settle``: the settlement request was sent and we do not know whether it
      landed (a timeout, a dropped connection, a 5xx). The payer may have been
      charged. Never retried automatically; surfaced as an unknown outcome."""

    def __init__(self, stage: str, cause: BaseException) -> None:
        super().__init__(f"x402 facilitator {stage} failed: {type(cause).__name__}")
        self.stage = stage
        self.cause = cause


# Explicit, per phase. Settlement waits for an on-chain confirmation, so its
# read timeout is longer than verify's; neither is retried.
_VERIFY_TIMEOUT_SEC = 15.0
_SETTLE_TIMEOUT_SEC = 45.0
_CONNECT_TIMEOUT_SEC = 5.0


@dataclass(frozen=True)
class SettleResult:
    success: bool
    settlement_id: str
    payer: str
    amount_usd: Decimal
    error: str = ""


def is_enabled() -> bool:
    return bool(
        settings.x402_enabled and settings.x402_pay_to and settings.x402_asset
    )


def _require_enabled() -> None:
    if not is_enabled():
        raise X402Disabled(
            "x402 is disabled — set MARKETER_X402_ENABLED=true with "
            "MARKETER_X402_PAY_TO and MARKETER_X402_ASSET."
        )


def to_atomic(amount_usd: Decimal) -> str:
    """USD → atomic units string (6-dp), rounded down to avoid over-charging."""
    return str(int((amount_usd * _ATOMIC).to_integral_value(rounding="ROUND_DOWN")))


def from_atomic(atomic: str | int) -> Decimal:
    # Round down, like to_atomic: never credit a fraction of a cent the payer
    # did not send.
    return (Decimal(int(atomic)) / _ATOMIC).quantize(Decimal("0.01"), rounding="ROUND_DOWN")


def clamp_topup(amount_usd: Decimal) -> Decimal:
    lo = Decimal(str(settings.x402_min_topup_usd))
    hi = Decimal(str(settings.x402_max_topup_usd))
    if amount_usd < lo or amount_usd > hi:
        raise X402PaymentError(
            f"top-up must be between ${lo} and ${hi} (got ${amount_usd})"
        )
    return amount_usd


def build_requirements(
    *, amount_usd: Decimal, resource: str, description: str
) -> dict:
    """The body of a 402 response: what payment we accept for `resource`."""
    _require_enabled()
    return {
        "x402Version": X402_VERSION,
        "accepts": [
            {
                "scheme": "exact",
                "network": settings.x402_network,
                "maxAmountRequired": to_atomic(amount_usd),
                "resource": resource,
                "description": description,
                "mimeType": "application/json",
                "payTo": settings.x402_pay_to,
                "maxTimeoutSeconds": 300,
                "asset": settings.x402_asset,
                "extra": {
                    "name": settings.x402_asset_name,
                    "version": settings.x402_asset_version,
                },
            }
        ],
    }


def decode_payment_header(header: str) -> dict:
    """Decode the base64 JSON `X-PAYMENT` header into a payment payload dict.
    Raises X402PaymentError on anything malformed."""
    if not header or not header.strip():
        raise X402PaymentError("missing X-PAYMENT header")
    try:
        raw = base64.b64decode(header.strip(), validate=True)
        payload = json.loads(raw)
    except (binascii.Error, ValueError) as e:
        raise X402PaymentError(f"malformed X-PAYMENT header: {e}") from e
    if not isinstance(payload, dict):
        raise X402PaymentError("X-PAYMENT payload must be an object")
    return payload


# --- facilitator HTTP (mocked in tests) --------------------------------------

async def _facilitator_post(path: str, body: dict, *, timeout_sec: float = _VERIFY_TIMEOUT_SEC) -> dict:
    """One POST to the facilitator. No retry: ``/settle`` moves money, and a
    second attempt after a lost answer is exactly the double send the rails
    exist to prevent."""
    _require_enabled()
    import httpx  # lazy

    url = settings.x402_facilitator_url.rstrip("/") + path
    timeout = httpx.Timeout(timeout_sec, connect=_CONNECT_TIMEOUT_SEC)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        resp = await client.post(url, json=body)
        resp.raise_for_status()
        return resp.json()


async def verify_and_settle(
    *, payment_payload: dict, requirements: dict
) -> SettleResult:
    """Verify the payment with the facilitator, then settle it on-chain. Returns
    a SettleResult; a failed verify/settle comes back with success=False rather
    than raising, so the route can answer 402 cleanly."""
    _require_enabled()
    accepts = requirements["accepts"][0]
    verify_body = {
        "x402Version": X402_VERSION,
        "paymentPayload": payment_payload,
        "paymentRequirements": accepts,
    }
    try:
        verify = await _facilitator_post("/verify", verify_body)
    except (X402Disabled, X402PaymentError):
        raise
    except Exception as e:  # noqa: BLE001 — transport, HTTP status or a non-JSON body
        raise X402FacilitatorError("verify", e) from e
    if not isinstance(verify, dict):
        raise X402FacilitatorError("verify", ValueError("non-object response"))
    if not verify.get("isValid", verify.get("valid", False)):
        return SettleResult(
            False, "", "", Decimal("0"),
            error=str(verify.get("invalidReason", "payment failed verification")),
        )

    try:
        settle = await _facilitator_post("/settle", verify_body, timeout_sec=_SETTLE_TIMEOUT_SEC)
    except (X402Disabled, X402PaymentError):
        raise
    except Exception as e:  # noqa: BLE001 — sent; the answer is what we lack
        import logging

        logging.getLogger(__name__).error(
            "x402 settle outcome unknown (%s); payer=%s amount=%s — check the "
            "facilitator before crediting or asking for another payment",
            type(e).__name__, verify.get("payer") or "?", accepts["maxAmountRequired"],
        )
        raise X402FacilitatorError("settle", e) from e
    if not isinstance(settle, dict):
        raise X402FacilitatorError("settle", ValueError("non-object response"))
    if not settle.get("success", False):
        return SettleResult(
            False, "", "", Decimal("0"),
            error=str(settle.get("errorReason", "settlement failed")),
        )
    settlement_id = str(
        settle.get("transaction") or settle.get("txHash") or settle.get("settlementId") or ""
    )
    if not settlement_id:
        # Facilitator claims success but gave us no id to key idempotency on —
        # we can't safely credit (no dedupe key), and the payer may have been
        # charged. Fail closed and log loudly so it can be reconciled by hand.
        import logging

        logging.getLogger(__name__).error(
            "x402 settle reported success with no settlement id; payer=%s "
            "amount=%s — manual reconciliation may be required",
            settle.get("payer") or verify.get("payer") or "?",
            accepts["maxAmountRequired"],
        )
        return SettleResult(
            False, "", "", Decimal("0"),
            error="settlement succeeded but returned no transaction id",
        )
    amount = from_atomic(accepts["maxAmountRequired"])
    payer = str(settle.get("payer") or verify.get("payer") or "")
    return SettleResult(True, settlement_id, payer, amount)


def encode_payment_response(result: SettleResult) -> str:
    """Base64 JSON for the `X-PAYMENT-RESPONSE` header confirming settlement."""
    body = {
        "success": result.success,
        "transaction": result.settlement_id,
        "network": settings.x402_network,
        "payer": result.payer,
    }
    return base64.b64encode(json.dumps(body).encode()).decode()
