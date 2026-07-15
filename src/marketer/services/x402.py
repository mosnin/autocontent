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
    return (Decimal(int(atomic)) / _ATOMIC).quantize(Decimal("0.01"))


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

async def _facilitator_post(path: str, body: dict) -> dict:
    _require_enabled()
    import httpx  # lazy

    url = settings.x402_facilitator_url.rstrip("/") + path
    async with httpx.AsyncClient(timeout=20) as client:
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
    verify = await _facilitator_post("/verify", verify_body)
    if not verify.get("isValid", verify.get("valid", False)):
        return SettleResult(
            False, "", "", Decimal("0"),
            error=str(verify.get("invalidReason", "payment failed verification")),
        )

    settle = await _facilitator_post("/settle", verify_body)
    if not settle.get("success", False):
        return SettleResult(
            False, "", "", Decimal("0"),
            error=str(settle.get("errorReason", "settlement failed")),
        )
    settlement_id = str(
        settle.get("transaction") or settle.get("txHash") or settle.get("settlementId") or ""
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
