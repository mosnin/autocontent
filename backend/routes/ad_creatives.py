"""Ad Creative Studio: a public domain in, a Gallery of on-brand ads out.

- POST /api/v1/ad-creatives                                enqueue an Ad Run
- GET  /api/v1/ad-creatives                                 list runs
- GET  /api/v1/ad-creatives/{run_id}                        run + its Ad Slots
- GET  /api/v1/ad-creatives/{run_id}/slots/{id}/image       stream the PNG
- POST /api/v1/ad-creatives/{run_id}/slots/{id}/retry       re-render one slot

Every route is user_id-scoped. The feature is config-gated twice — the
`ad_creative_enabled` flag and a Context.dev key — and both are checked
before any row is written, so a deployment without them answers 409
("not configured") rather than accepting work it can never do. That
mirrors how the Ads product surfaces `AdsDisabled`.
"""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.adcreative.directions import direction_label
from marketer.adcreative.domains import normalize_domain
from marketer.adcreative.models import image_model_name
from marketer.adcreative.planner import is_configured
from marketer.adcreative.policy import AD_RUN_LIMITS
from marketer.repos import ad_creatives as runs_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

MODAL_APP = "marketer-sh"
RUN_FUNCTION = "run_ad_creative_run"
RETRY_FUNCTION = "retry_ad_creative_slot"


class AdRunCreate(BaseModel):
    domain: str = Field(min_length=1, max_length=AD_RUN_LIMITS.domain)
    # Optional: files the run's spend under a niche's daily cap.
    niche_id: UUID | None = None


def _require_configured() -> None:
    if not is_configured():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "ad creative studio is not enabled on this deployment",
        )


def _slot_view(slot: dict) -> dict:
    """The Gallery's view of one Ad Slot. Labels and display names are
    resolved here rather than stored, so a catalog rename shows up on
    existing runs instead of freezing at generation time."""
    return {
        "id": str(slot["id"]),
        "position": slot["position"],
        "direction_key": slot["direction_key"],
        "direction_label": direction_label(slot["direction_key"]),
        "image_model_id": slot["image_model_id"],
        "image_model_name": image_model_name(slot["image_model_id"]),
        "subject_kind": slot["subject_kind"],
        "product_name": slot.get("product_name") or "",
        "headline": slot.get("headline") or "",
        "subheadline": slot.get("subheadline") or "",
        "status": slot["status"],
        "error": slot.get("error"),
    }


@router.get("")
async def list_ad_runs(
    limit: int = Query(default=50, ge=1, le=200), ctx: AuthCtx = CurrentUser
) -> list[dict]:
    return await runs_repo.list_runs(ctx.user_id, limit=limit)


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_ad_run(body: AdRunCreate, ctx: AuthCtx = CurrentUser) -> dict:
    """Create the run row and spawn planning + rendering in the background.

    The domain is canonicalized here so a bad input is a 422 the user can
    fix, not a run that fails minutes later — and so the stored domain is
    never a URL, an IP, or an internal hostname.
    """
    _require_configured()
    domain = normalize_domain(body.domain)
    if domain is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "enter a public website domain, e.g. stripe.com",
        )
    if body.niche_id is not None:
        from marketer.repos import niches as niches_repo

        if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "niche not found")

    run = await runs_repo.create_run(
        user_id=ctx.user_id, domain=domain, niche_id=body.niche_id
    )
    import modal

    fn = modal.Function.from_name(MODAL_APP, RUN_FUNCTION)
    fn.spawn(ctx.user_id, str(run["id"]))
    return run


@router.get("/{run_id}")
async def get_ad_run(run_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    run = await runs_repo.get_run(run_id, user_id=ctx.user_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    slots = await runs_repo.list_slots(run_id, user_id=ctx.user_id)
    return {"run": run, "slots": [_slot_view(s) for s in slots]}


@router.get("/{run_id}/slots/{slot_id}/image")
async def get_slot_image(
    run_id: UUID, slot_id: UUID, ctx: AuthCtx = CurrentUser
) -> FileResponse:
    """Stream one Rendered Ad. Ownership-scoped like every other media
    endpoint; 404 when the slot is missing/foreign, has not rendered, or
    the file is no longer on the volume."""
    slot = await runs_repo.get_slot(slot_id, user_id=ctx.user_id)
    if slot is None or slot["run_id"] != run_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    path = slot.get("image_path")
    if not path or not os.path.exists(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no rendered ad")
    return FileResponse(path, media_type="image/png")


@router.post("/{run_id}/slots/{slot_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_slot(run_id: UUID, slot_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Re-render one failed Ad Slot against the run's stored plan.

    The failed -> queued claim is atomic, so a double-clicked retry
    spawns exactly one render.
    """
    _require_configured()
    slot = await runs_repo.get_slot(slot_id, user_id=ctx.user_id)
    if slot is None or slot["run_id"] != run_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not await runs_repo.claim_slot_for_retry(slot_id, user_id=ctx.user_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"slot is {slot['status']}, not failed",
        )
    import modal

    fn = modal.Function.from_name(MODAL_APP, RETRY_FUNCTION)
    fn.spawn(ctx.user_id, str(run_id), str(slot_id))
    return {"status": "queued"}
