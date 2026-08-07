"""Submit / reconcile orchestration for standalone UGC renders.

The whole point of this module is the ORDER of operations, which the
source gets wrong in two places:

  1. Validate everything the user supplied — model id, aspect ratio,
     duration, resolution, mode, image count, image URLs, `@imageN`
     references — BEFORE any spend check and before any provider call.
     The source validates only the model id server-side and trusts the
     client for the rest, so a hand-rolled request happily pays for a
     render the provider will reject.
  2. Meter through `SpendContext`: `ensure_can_spend` before submitting
     (so niche caps, the global daily cap, and prepaid credit can refuse
     it) and `log` only once the provider has ACCEPTED the job. The source
     decrements its credit counter after the fetch too, but with no cap
     model and no ledger; here the ledger is the single source of truth
     and there is no second currency.

Completion is asynchronous. MUAPI calls `POST /api/v1/ugc/webhook` with
the finished result; `apply_webhook` reconciles it against the row.
`reconcile` is the polling fallback for deliveries that never arrive,
which is what the source's creations-detail route does inline.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any
from uuid import UUID

from ..logging import get_logger
from ..repos import ugc_renders as renders_repo
from ..services import muapi
from ..services.spend_context import SpendContext, default_context
from ..services.ssrf import check_public_url
from .catalog import UgcModel, UgcValidationError, require_model, validate_params
from .pricing import render_cost
from .prompts import assemble_prompt, render_mode_for

log = get_logger(__name__)

__all__ = [
    "UgcValidationError",
    "apply_webhook",
    "build_spend",
    "reconcile",
    "retry_render",
    "submit_render",
    "validate_image_urls",
]


async def validate_image_urls(image_urls: list[str] | None) -> list[str]:
    """Bound the count and SSRF-check every reference image URL.

    These URLs are handed to a third party that will fetch them, so an
    unchecked value turns our submit into a confused-deputy request
    against internal infrastructure. Same guard the outbound webhook
    registration uses; `check_public_url` does DNS, so it runs off-loop.
    """
    from ..config import settings

    urls = [u.strip() for u in (image_urls or []) if u and u.strip()]
    limit = settings.ugc_max_reference_images
    if len(urls) > limit:
        raise UgcValidationError(
            f"{len(urls)} reference images supplied, over the {limit}-image limit"
        )
    for url in urls:
        ok, reason = await asyncio.to_thread(check_public_url, url)
        if not ok:
            raise UgcValidationError(f"reference image url rejected ({reason}): {url}")
    return urls


async def build_spend(user_id: str, niche_id: UUID | None) -> SpendContext:
    """Canonical SpendContext for a UGC render.

    A render attributed to a niche inherits that niche's daily cap; an
    unattributed one (the common case — a one-off client ad) is still
    subject to the user's global daily cap and prepaid credit balance,
    both of which `default_context` wires up.
    """
    cap_usd = None
    if niche_id is not None:
        from ..repos import niches as niches_repo

        niche = await niches_repo.get(niche_id, user_id=user_id)
        if niche is not None:
            cap_usd = niche.daily_spend_cap_usd
    return await default_context(
        user_id=user_id, niche_id=niche_id, job_id=None, cap_usd=cap_usd,
    )


def _params_from_row(row: dict) -> dict[str, Any]:
    """Re-derive the on-the-wire settings dict from a persisted render.

    Runs through `validate_params` rather than reading the columns
    straight, so a retry of a row written before a catalog change is
    rejected instead of re-submitting parameters the model no longer
    accepts.
    """
    return validate_params(
        row["model_id"],
        aspect_ratio=row.get("aspect_ratio") or None,
        duration=row.get("duration_sec") or None,
        resolution=row.get("resolution") or None,
        mode=row.get("mode") or None,
    )


async def _dispatch(
    row: dict,
    *,
    model: UgcModel,
    params: dict[str, Any],
    prompt: str,
    image_urls: list[str],
    cost: Decimal,
    spend: SpendContext,
) -> dict:
    """Submit an already-persisted queued render and meter it."""
    render_id = row["id"]
    user_id = row["user_id"]
    try:
        request_id = await muapi.submit(
            endpoint=model.endpoint,
            prompt=prompt,
            image_urls=image_urls,
            params=params,
        )
    except Exception as exc:
        await renders_repo.fail_by_id(render_id, user_id=user_id, error=str(exc)[:500])
        raise

    updated = await renders_repo.attach_request(
        render_id, user_id=user_id, provider_request_id=request_id
    )

    # Metered only now: the provider has accepted (and will bill) the job.
    try:
        await spend.log(
            provider=muapi.PROVIDER,
            sku=model.id,
            units=Decimal(str(params["duration"])),
            cost_usd=cost,
        )
    except Exception as exc:  # noqa: BLE001
        # The debit landed; only a post-log cap/credit trip can land here.
        # The render is already paid for at the provider, so surfacing this
        # as a failed request would be a lie — record it and move on.
        log.warning(
            "ugc.spend_log_tripped_cap",
            extra={"provider": muapi.PROVIDER, "sku": model.id, "error": str(exc)},
        )

    return updated or {**row, "provider_request_id": request_id, "status": "running"}


async def submit_render(
    *,
    user_id: str,
    model_id: str,
    prompt: str,
    aspect_ratio: str | None = None,
    duration: int | None = None,
    resolution: str | None = None,
    mode: str | None = None,
    image_urls: list[str] | None = None,
    niche_id: UUID | None = None,
    spend: SpendContext | None = None,
) -> dict:
    """Validate, meter, submit. Returns the persisted render row."""
    muapi.require_enabled()

    model = require_model(model_id)
    params = validate_params(
        model_id,
        aspect_ratio=aspect_ratio,
        duration=duration,
        resolution=resolution,
        mode=mode,
    )
    urls = await validate_image_urls(image_urls)
    final_prompt = assemble_prompt(prompt, image_count=len(urls))
    cost = render_cost(
        model, duration=params["duration"], resolution=params.get("resolution", "")
    )

    ctx = spend or await build_spend(user_id, niche_id)
    # Pre-flight: refuses against niche cap, global daily cap, and prepaid
    # credit before a single provider call is made.
    await ctx.ensure_can_spend(cost)

    row = await renders_repo.create(
        user_id=user_id,
        model_id=model.id,
        prompt=final_prompt,
        render_mode=render_mode_for(len(urls)),
        aspect_ratio=params["aspect_ratio"],
        resolution=params.get("resolution", ""),
        mode=params.get("mode", ""),
        duration_sec=int(params["duration"]),
        image_urls=urls,
        niche_id=niche_id,
        est_cost_usd=cost,
    )
    return await _dispatch(
        row,
        model=model,
        params=params,
        prompt=final_prompt,
        image_urls=urls,
        cost=cost,
        spend=ctx,
    )


async def retry_render(
    render_id: UUID, *, user_id: str, spend: SpendContext | None = None
) -> dict | None:
    """Re-submit a failed render. None when it wasn't claimable.

    The claim is the atomic failed -> queued transition in the repo, so a
    double-clicked retry submits (and pays for) exactly one new job.
    """
    muapi.require_enabled()

    row = await renders_repo.claim_for_retry(render_id, user_id=user_id)
    if row is None:
        return None

    try:
        model = require_model(row["model_id"])
        params = _params_from_row(row)
        urls = list(row.get("image_urls") or [])
        cost = render_cost(
            model, duration=params["duration"], resolution=params.get("resolution", "")
        )
    except Exception as exc:
        await renders_repo.fail_by_id(render_id, user_id=user_id, error=str(exc)[:500])
        raise

    ctx = spend or await build_spend(user_id, row.get("niche_id"))
    try:
        await ctx.ensure_can_spend(cost)
    except Exception:
        await renders_repo.fail_by_id(
            render_id, user_id=user_id, error="retry refused: spend limit reached"
        )
        raise

    return await _dispatch(
        row,
        model=model,
        params=params,
        prompt=row.get("prompt") or "",
        image_urls=urls,
        cost=cost,
        spend=ctx,
    )


async def _apply_result(request_id: str, payload: dict[str, Any]) -> dict | None:
    status, video_url, error = muapi.parse_result(payload)
    if status == muapi.STATUS_DONE:
        return await renders_repo.complete(request_id, video_url=video_url)
    if status == muapi.STATUS_FAILED:
        return await renders_repo.fail(request_id, error=error[:500] or "render failed")
    return await renders_repo.mark_running(request_id)


async def apply_webhook(payload: dict[str, Any]) -> dict:
    """Apply one provider completion callback.

    Returns a small report rather than raising: the caller answers the
    provider, and a non-2xx would only earn us a retry storm for payloads
    that will never become applicable (unknown id, already-terminal row).
    """
    request_id = muapi.extract_request_id(payload)
    if not request_id:
        return {"ok": False, "reason": "missing request id"}

    row = await renders_repo.get_by_request_id(request_id)
    if row is None:
        log.warning("ugc.webhook_unknown_request", extra={"provider": muapi.PROVIDER})
        return {"ok": True, "ignored": "unknown request id"}
    if row["status"] not in renders_repo.PENDING_STATUSES:
        # Duplicate or late delivery for a render that already settled.
        return {"ok": True, "ignored": f"render already {row['status']}"}

    updated = await _apply_result(request_id, payload)
    if updated is None:
        return {"ok": True, "ignored": "no applicable transition"}
    log.info(
        "ugc.webhook_applied",
        extra={"provider": muapi.PROVIDER, "sku": updated["model_id"]},
    )
    return {"ok": True, "render_id": str(updated["id"]), "status": updated["status"]}


async def reconcile(row: dict) -> dict:
    """Best-effort poll for a render whose webhook never arrived.

    Called from the detail route (the source does the same thing) so a
    misconfigured or dropped callback doesn't strand the UI on a spinner.
    Provider errors are swallowed: reconciliation is a convenience, and a
    flaky MUAPI must not turn a plain GET into a 500.
    """
    if row.get("status") not in renders_repo.PENDING_STATUSES:
        return row
    request_id = row.get("provider_request_id")
    if not request_id or not muapi.enabled():
        return row
    try:
        payload = await muapi.fetch_result(str(request_id))
        updated = await _apply_result(str(request_id), payload)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "ugc.reconcile_failed",
            extra={"provider": muapi.PROVIDER, "error": str(exc)},
        )
        return row
    return updated or row
