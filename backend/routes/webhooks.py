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
from marketer.repos import jobs as jobs_repo

router = APIRouter()
log = logging.getLogger(__name__)

_OK = {"ok": True}


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


# ---------------------------------------------------------------------------
# Zernio
# ---------------------------------------------------------------------------
#
# POST /api/v1/webhooks/zernio
#
# One endpoint per team, not per profile, so this handler routes internally:
#   * post events      -> jobs, via provider_post_id
#   * account events   -> social_accounts, via accountId / profileId
#
# Signature: `X-Zernio-Signature` is the lowercase hex HMAC-SHA256 of the
# raw body keyed by the webhook secret (`X-Late-Signature` is a legacy
# alias Zernio still sends). Note the encoding differs from Ayrshare's
# base-64 — same algorithm, different wire format, so the two verifiers
# cannot be shared without silently accepting the wrong thing.
#
# Delivery is at-least-once, so every handler below is idempotent: post
# transitions are assignments rather than increments, and account writes
# go through an upsert keyed on the Zernio account id.


class ZernioWebhookPayload(BaseModel):
    """Lenient model for any Zernio event body."""

    model_config = {"extra": "allow"}

    id: str = ""                       # event id — dedupe key
    event: str = ""                    # "post.published" | "account.connected" | ...
    post: dict[str, Any] | None = None
    account: dict[str, Any] | None = None


def _verify_zernio_signature(body: bytes, sig_header: str | None, secret: str) -> bool:
    """Lowercase hex HMAC-SHA256 of the raw body, compared in constant time."""
    if not sig_header:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig_header.strip().lower())


async def _handle_post_event(event: str, post: dict[str, Any]) -> None:
    """Apply a post lifecycle event to the job that produced it."""
    post_id = str(post.get("_id") or post.get("postId") or "")
    if not post_id:
        return
    job = await jobs_repo.get_by_provider_post_id(post_id)
    if job is None:
        # A post we did not create, or a job since deleted. Not an error.
        log.info("zernio_webhook.job_not_found", extra={"provider": "zernio", "sku": post_id})
        return

    if event == "post.published":
        job.status = JobStatus.done
        job.error = None
        await jobs_repo.save_snapshot(job)
    elif event == "post.failed":
        errors = post.get("errors") or []
        job.status = JobStatus.failed
        job.error = f"zernio: {_error_summary(errors if isinstance(errors, list) else [errors])}"
        await jobs_repo.save_snapshot(job)
    else:
        log.info("zernio_webhook.post_event_ignored", extra={"provider": "zernio", "sku": event})


async def _handle_account_event(event: str, account: dict[str, Any]) -> None:
    """Keep our account map in step with Zernio's reality.

    `account.connected` is the ONLY moment Zernio hands us the
    accountId -> profileId mapping, so it is what binds an account to one
    of our users. A connection for a profile we do not recognise is
    ignored rather than guessed at — writing it under the wrong user is
    how one customer ends up publishing to another's socials.
    """
    from marketer.repos import social_accounts as accounts_repo
    from marketer.repos import users as users_repo
    from marketer.services.zernio import PLATFORM_MAP

    account_id = str(account.get("accountId") or account.get("_id") or "")
    if not account_id:
        return

    if event == "account.disconnected":
        updated = await accounts_repo.mark_disconnected(account_id)
        if updated is None:
            log.info(
                "zernio_webhook.account_unknown",
                extra={"provider": "zernio", "sku": account_id},
            )
        return

    if event != "account.connected":
        return

    profile_id = str(account.get("profileId") or "")
    to_internal = {v: k for k, v in PLATFORM_MAP.items()}
    platform = to_internal.get(str(account.get("platform") or ""))
    if not profile_id or platform is None:
        # A platform we cannot publish to is not one we track.
        log.info(
            "zernio_webhook.account_ignored",
            extra={"provider": "zernio", "sku": str(account.get("platform"))},
        )
        return

    user_id = await users_repo.id_by_zernio_profile(profile_id)
    if user_id is None:
        log.warning(
            "zernio_webhook.profile_unknown",
            extra={"provider": "zernio", "sku": profile_id},
        )
        return

    await accounts_repo.upsert(
        user_id=user_id,
        zernio_account_id=account_id,
        zernio_profile_id=profile_id,
        platform=platform,
        username=str(account.get("username") or ""),
        is_active=True,
    )


@router.post("/zernio")
async def zernio_webhook(request: Request) -> dict:
    if not settings.zernio_webhook_secret:
        log.error("zernio_webhook.misconfigured: MARKETER_ZERNIO_WEBHOOK_SECRET not set")
        return Response(
            content='{"detail":"webhook secret not configured"}',
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            media_type="application/json",
        )  # type: ignore[return-value]

    body = await request.body()
    sig = (
        request.headers.get("x-zernio-signature")
        or request.headers.get("x-late-signature")
    )
    if not _verify_zernio_signature(body, sig, settings.zernio_webhook_secret):
        log.warning("zernio_webhook.bad_signature")
        return Response(
            content='{"detail":"invalid signature"}',
            status_code=status.HTTP_401_UNAUTHORIZED,
            media_type="application/json",
        )  # type: ignore[return-value]

    try:
        payload = ZernioWebhookPayload.model_validate_json(body)
    except Exception as exc:
        log.warning("zernio_webhook.parse_error", exc_info=exc)
        return _OK  # 200 so a malformed payload isn't retried forever

    event = payload.event.lower()
    log.info("zernio_webhook.received", extra={"provider": "zernio", "sku": event})

    if event.startswith("post.") and payload.post:
        await _handle_post_event(event, payload.post)
    elif event.startswith("account.") and payload.account:
        await _handle_account_event(event, payload.account)
    else:
        log.info("zernio_webhook.unhandled", extra={"provider": "zernio", "sku": event})

    return _OK
