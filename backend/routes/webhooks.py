"""Ayrshare webhook receiver.

POST /api/v1/webhooks/ayrshare

Auth
----
Ayrshare signs each webhook delivery with an HMAC-SHA256 of the raw
request body, base-64 encoded, and sends it in one of:

  * ``x-ayrshare-signature``  (documented header name in Ayrshare docs)
  * ``x-webhook-signature``   (older / alias)

We accept either header so deployments aren't broken by Ayrshare quietly
renaming it. If neither is present we reject with 401.

The shared secret is ``MARKETER_AYRSHARE_WEBHOOK_SECRET``. If that env
var is unset we return 503 rather than silently accepting unsigned
webhooks.

Payload
-------
Ayrshare sends a JSON body with at least:

  {
    "id":       "<ayrshare-post-id>",   // == provider_post_id in our DB
    "status":   "success" | "errored" | "deleted" | ...,
    "platform": "tiktok" | "instagram" | ...,
    "errors":   []                      // populated when status == "errored"
  }

We use ``extra="allow"`` on the Pydantic model so unknown fields don't
cause 422s as Ayrshare evolves their payload shape.

Replay
------
Ayrshare's signature covers the body only (no timestamp), so a captured
delivery stays valid forever. Each delivery is therefore claimed by the hash
of its body in ``idempotency_keys`` (0024): the first one is applied, an
identical one inside the window is answered 200 and ignored. If processing
fails the claim is released so Ayrshare's retry is applied.

Idempotency
-----------
We always return 200 ``{"ok": true}`` on a successful parse + process.
Ayrshare retries any non-2xx; returning 200 for "job not found" avoids
endless retries for webhooks referring to deleted jobs.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from base64 import b64encode
from typing import Any

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel

from marketer.config import settings
from marketer.models import JobStatus
from marketer.repos import idempotency as idempotency_repo
from marketer.repos import jobs as jobs_repo

router = APIRouter()
log = logging.getLogger(__name__)

_OK = {"ok": True}
REPLAY_WINDOW_SECONDS = 30 * 24 * 60 * 60


class AyrshareWebhookPayload(BaseModel):
    """Lenient model for the Ayrshare post-lifecycle webhook body.

    Fields we actually use are typed explicitly; everything else is
    preserved via ``extra="allow"`` so forward-compatible extensions don't
    break ingestion.
    """

    model_config = {"extra": "allow"}

    id: str = ""           # Ayrshare post id == provider_post_id
    status: str = ""       # "success" | "errored" | "deleted"
    errors: list[Any] = []


def _verify_signature(body: bytes, sig_header: str | None, secret: str) -> bool:
    """Return True iff the HMAC-SHA256(secret, body) matches sig_header.

    Ayrshare encodes the digest as base-64. We compute our own and compare
    with ``hmac.compare_digest`` to prevent timing attacks.
    """
    if not sig_header:
        return False
    expected = b64encode(
        hmac.new(secret.encode(), body, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(expected, sig_header)


def _error_summary(errors: list[Any]) -> str:
    """Collapse Ayrshare's errors array into a short human-readable string."""
    parts: list[str] = []
    for e in errors:
        if isinstance(e, dict):
            parts.append(e.get("message") or e.get("error") or str(e))
        else:
            parts.append(str(e))
    return "; ".join(parts) if parts else "unknown error"


@router.post("/ayrshare")
async def ayrshare_webhook(request: Request) -> dict:
    # --- 1. Secret guard ---------------------------------------------------
    if not settings.ayrshare_webhook_secret:
        log.error("ayrshare_webhook.misconfigured: MARKETER_AYRSHARE_WEBHOOK_SECRET not set")
        return Response(
            content='{"detail":"webhook secret not configured"}',
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            media_type="application/json",
        )  # type: ignore[return-value]

    # --- 2. Signature check ------------------------------------------------
    body = await request.body()
    sig = (
        request.headers.get("x-ayrshare-signature")
        or request.headers.get("x-webhook-signature")
    )
    if not _verify_signature(body, sig, settings.ayrshare_webhook_secret):
        log.warning("ayrshare_webhook.bad_signature")
        return Response(
            content='{"detail":"invalid signature"}',
            status_code=status.HTTP_401_UNAUTHORIZED,
            media_type="application/json",
        )  # type: ignore[return-value]

    # --- 3. Parse body -----------------------------------------------------
    try:
        payload = AyrshareWebhookPayload.model_validate_json(body)
    except Exception as exc:
        log.warning("ayrshare_webhook.parse_error", exc_info=exc)
        # Return 200 so Ayrshare doesn't retry a malformed payload forever.
        return _OK

    post_id = payload.id
    event_status = payload.status.lower()
    if not post_id:
        # Without a post id the lookup below would match any job whose stored
        # provider_post_id is empty.
        log.warning("ayrshare_webhook.missing_post_id")
        return _OK

    # --- 3b. Replay guard ---------------------------------------------------
    claim_key = "webhook:ayrshare:" + hashlib.sha256(body).hexdigest()
    try:
        first = await idempotency_repo.claim(claim_key, ttl_seconds=REPLAY_WINDOW_SECONDS)
    except Exception:  # noqa: BLE001 — store down: ask Ayrshare to send it again
        log.error("ayrshare_webhook.replay_store_unavailable", exc_info=True)
        return Response(
            content='{"detail":"temporarily unavailable"}',
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            media_type="application/json",
        )  # type: ignore[return-value]
    if not first:
        log.info("ayrshare_webhook.duplicate_ignored", extra={"provider": "ayrshare"})
        return _OK
    try:
        return await _apply(post_id, event_status, payload)
    except Exception:
        # Not applied: free the claim so the provider's retry is not ignored.
        try:
            await idempotency_repo.release(claim_key)
        except Exception:  # noqa: BLE001
            log.warning("ayrshare_webhook.release_failed", exc_info=True)
        raise


async def _apply(post_id: str, event_status: str, payload: AyrshareWebhookPayload) -> dict:

    log.info(
        "ayrshare_webhook.received",
        extra={"provider": "ayrshare", "sku": event_status},
    )

    # --- 4. Look up the job ------------------------------------------------
    job = await jobs_repo.get_by_provider_post_id(post_id)
    if job is None:
        log.warning(
            "ayrshare_webhook.job_not_found",
            extra={"provider": "ayrshare", "sku": post_id},
        )
        return _OK  # idempotent — may be a deleted job

    # --- 5. Apply state transition -----------------------------------------
    if event_status == "success":
        job.status = JobStatus.done
        job.error = None
        await jobs_repo.save_snapshot(job)
        log.info("ayrshare_webhook.job_done", extra={"provider": "ayrshare"})

    elif event_status == "errored":
        summary = _error_summary(payload.errors)
        job.status = JobStatus.failed
        job.error = f"ayrshare: {summary}"
        await jobs_repo.save_snapshot(job)
        log.error(
            "ayrshare_webhook.job_failed",
            extra={"provider": "ayrshare", "sku": summary},
        )

    elif event_status == "deleted":
        log.info("ayrshare_webhook.post_deleted", extra={"provider": "ayrshare"})
        # Don't mutate the job — the post was deleted by the user in Ayrshare.

    else:
        log.info(
            "ayrshare_webhook.unknown_status",
            extra={"provider": "ayrshare", "sku": event_status},
        )

    return _OK
