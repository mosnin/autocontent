"""Outbound webhook delivery: HMAC-signed event POSTs to user endpoints.

Fail-open by contract — a webhook failure must NEVER break a pipeline run.
Every event is signed so receivers can verify authenticity:

    signature = hex(hmac_sha256(secret, f"{timestamp}.{body}"))
    header    X-Marketer-Signature: t=<ts>,v1=<signature>
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging

import httpx

from ..logging import get_logger
from ..repos import webhooks_out
from . import ssrf

log = get_logger(__name__)

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def sign(secret: str, timestamp: int, body: str) -> str:
    msg = f"{timestamp}.{body}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


async def deliver_one(url: str, secret: str, *, event: str, payload: dict, timestamp: int) -> int | None:
    """POST one signed event. Returns the HTTP status, or None on transport
    error. Never raises."""
    # Re-check the destination at delivery time too: a URL that resolved to a
    # public IP at registration can be re-pointed at an internal address
    # afterwards (DNS rebinding). Never POST a signed payload to a private host.
    ok, reason, address = await asyncio.to_thread(ssrf.resolve_public_url, url)
    if not ok or address is None:
        log.warning("webhook delivery blocked (ssrf)", extra={"url": url, "reason": reason})
        return None
    # Connect to the address we just vetted. TLS still names (and verifies)
    # the endpoint's hostname.
    target, host_header, server_name = ssrf.pinned_target(url, address)

    body = json.dumps({"event": event, "data": payload}, separators=(",", ":"))
    signature = sign(secret, timestamp, body)
    headers = {
        "host": host_header,
        "content-type": "application/json",
        "user-agent": "marketer.sh-webhooks/1",
        "x-marketer-event": event,
        "x-marketer-signature": f"t={timestamp},v1={signature}",
    }
    try:
        # One attempt, no redirects: a 3xx to an internal address would walk
        # around the check above, and a webhook is a side-effecting send that
        # the receiver may already have processed when we time out.
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            resp = await client.post(
                target, content=body, headers=headers,
                extensions={"sni_hostname": server_name},
            )
            return resp.status_code
    except httpx.HTTPError as exc:
        log.warning("webhook delivery failed", extra={"url": url, "error": type(exc).__name__})
        return None


async def emit(user_id: str, event: str, payload: dict, *, timestamp: int) -> int:
    """Fan out one event to every enabled, subscribed endpoint of the user.
    Returns the number of endpoints delivered to (regardless of status).
    Fully fail-open: any error is swallowed so the caller's pipeline is
    never affected."""
    try:
        targets = await webhooks_out.deliverable_for_event(user_id, event)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("webhook lookup failed for %s", user_id)
        return 0

    delivered = 0
    for url, secret in targets:
        try:
            status = await deliver_one(
                url, secret, event=event, payload=payload, timestamp=timestamp
            )
        except Exception:  # noqa: BLE001 — one endpoint must never break the rest
            logging.getLogger(__name__).warning("webhook deliver_one raised for %s", url)
            status = None
        delivered += 1
        try:
            await webhooks_out.record_delivery(url, user_id, status)
        except Exception:  # noqa: BLE001 — bookkeeping must never break delivery
            pass
    return delivered
