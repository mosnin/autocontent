"""UGC studio: script + reference images -> one vertical spokesperson ad.

  GET    /api/v1/ugc/models              — catalog + per-model capabilities
  POST   /api/v1/ugc/renders             — 202, submit a render
  GET    /api/v1/ugc/renders             — the caller's renders, newest first
  GET    /api/v1/ugc/renders/{id}        — one render (reconciled on read)
  POST   /api/v1/ugc/renders/{id}/retry  — 202, atomic failed -> queued
  DELETE /api/v1/ugc/renders/{id}        — 204
  POST   /api/v1/ugc/webhook             — provider completion callback

Everything except the webhook is scoped to `AuthCtx = CurrentUser`. The
webhook is NOT user-authenticated — the caller is MUAPI — so it is gated
on the shared secret instead; see `ugc_webhook` below.

Fail-closed: with `MARKETER_UGC_ENABLED` false or `MARKETER_MUAPI_API_KEY`
unset, every user-facing route answers 409 with a clear reason. No import
of the provider client is conditional and nothing here can 500 on missing
config.
"""
from __future__ import annotations

import hmac
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from marketer.config import settings
from marketer.repos import niches as niches_repo
from marketer.repos import ugc_renders as renders_repo
from marketer.services import muapi, seedance
from marketer.ugc import catalog, pricing, render
from marketer.ugc.prompts import UgcPromptError

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class UgcRenderCreate(BaseModel):
    model_id: str
    prompt: str = ""
    aspect_ratio: str | None = None
    duration: int | None = Field(default=None, ge=1, le=60)
    resolution: str | None = None
    mode: str | None = None
    # Seedance-only camera direction token (e.g. "dolly_in"); the adapter
    # folds it into the prompt prose. Rejected for models that declare no
    # camera controls rather than being silently dropped.
    camera_move: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    niche_id: UUID | None = None


def _require_enabled() -> None:
    try:
        muapi.require_enabled()
    except muapi.MuapiDisabled as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc


def _model_json(model: catalog.UgcModel) -> dict:
    """One catalog entry, shaped for the UI's adaptive parameter controls."""
    return {
        "id": model.id,
        "name": model.name,
        "description": model.description,
        "provider": model.provider,
        "aspect_ratios": list(model.aspect_ratios),
        "default_aspect_ratio": model.default_aspect_ratio,
        "duration": model.duration_spec(),
        "resolutions": list(model.resolutions),
        "default_resolution": model.default_resolution,
        "modes": list(model.modes),
        "default_mode": model.default_mode,
        "camera_controls": list(model.camera_controls),
        # Reference-media arity. `max_images: null` means the model
        # declares no bound of its own and only `max_reference_images`
        # (below) applies; a 0 is a real zero. `max_videos`/`max_audios`
        # are declared capabilities of the route — this endpoint carries
        # image references only, so they read as 0-in-practice today.
        "reference_media": {
            "min_images": model.min_images,
            "max_images": model.max_images,
            "max_videos": model.max_videos,
            "max_audios": model.max_audios,
            "character_reference": model.supports_character_reference,
        },
        "cost_basis": pricing.cost_basis(model),
    }


@router.get("/models")
async def list_ugc_models(ctx: AuthCtx = CurrentUser) -> dict:
    _require_enabled()
    return {
        "models": [_model_json(m) for m in catalog.list_models()],
        "max_reference_images": settings.ugc_max_reference_images,
    }


@router.get("/renders")
async def list_renders(
    status_filter: str | None = None, limit: int = 50, ctx: AuthCtx = CurrentUser
) -> list[dict]:
    _require_enabled()
    return await renders_repo.list_for_user(
        ctx.user_id, status=status_filter, limit=min(max(limit, 1), 200)
    )


@router.post("/renders", status_code=status.HTTP_202_ACCEPTED)
async def create_render(body: UgcRenderCreate, ctx: AuthCtx = CurrentUser) -> dict:
    _require_enabled()

    if (
        body.niche_id is not None
        and await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    try:
        return await render.submit_render(
            user_id=ctx.user_id,
            model_id=body.model_id,
            prompt=body.prompt,
            aspect_ratio=body.aspect_ratio,
            duration=body.duration,
            resolution=body.resolution,
            mode=body.mode,
            camera_move=body.camera_move,
            image_urls=body.image_urls,
            niche_id=body.niche_id,
        )
    except (catalog.UgcValidationError, UgcPromptError) as exc:
        # Everything the user could have got wrong lands here, before any
        # provider call and before any spend. The Seedance adapter's own
        # validation errors are re-raised as UgcValidationError at the
        # seam, so both providers answer through this one branch.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except (muapi.MuapiDisabled, seedance.SeedanceDisabled) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        from marketer.repos.spend import SpendCapExceeded

        if isinstance(exc, SpendCapExceeded):
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED, detail=str(exc)
            ) from exc
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="render submit failed"
        ) from exc


@router.get("/renders/{render_id}")
async def get_render(render_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    _require_enabled()
    row = await renders_repo.get(render_id, user_id=ctx.user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # Reconciliation fallback for a webhook that never arrived. Best
    # effort — never turns a read into an error.
    return await render.reconcile(row)


@router.post("/renders/{render_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_render(render_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    _require_enabled()
    try:
        row = await render.retry_render(render_id, user_id=ctx.user_id)
    except (catalog.UgcValidationError, UgcPromptError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except (muapi.MuapiDisabled, seedance.SeedanceDisabled) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        from marketer.repos.spend import SpendCapExceeded

        if isinstance(exc, SpendCapExceeded):
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED, detail=str(exc)
            ) from exc
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="render submit failed"
        ) from exc

    if row is None:
        existing = await renders_repo.get(render_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"render is {existing['status']}, not failed",
        )
    return row


@router.delete("/renders/{render_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_render(render_id: UUID, ctx: AuthCtx = CurrentUser) -> Response:
    _require_enabled()
    if not await renders_repo.delete(render_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _delivery_token(request: Request) -> str:
    """The secret MUAPI echoes back, from the query string or a header.

    `muapi.webhook_url()` publishes it as `?token=...` (MUAPI's callback
    takes a URL, not custom headers), but the header form is accepted too
    so the same endpoint works behind a proxy that strips query strings.
    """
    return (
        request.query_params.get("token")
        or request.headers.get("x-muapi-webhook-token")
        or ""
    )


@router.post("/webhook")
async def ugc_webhook(request: Request) -> Any:
    """MUAPI render-complete callback.

    NOT user-authenticated — the caller is the provider. The source's
    equivalent endpoint is entirely unauthenticated, which lets anyone who
    can guess a request id mark someone else's render complete and point
    its video URL at arbitrary content. We require the shared secret
    instead, compared in constant time, and refuse the whole endpoint when
    no secret is configured rather than falling open.

    Successful deliveries always answer 200 so the provider does not retry
    payloads that can never apply (unknown request id, already-terminal
    render); only auth and misconfiguration produce a non-2xx.
    """
    if not settings.muapi_webhook_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="webhook secret not configured",
        )
    supplied = _delivery_token(request)
    if not supplied or not hmac.compare_digest(supplied, settings.muapi_webhook_secret):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid webhook token")

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="body is not valid json"
        ) from None
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="body must be an object")

    result = await render.apply_webhook(payload)
    if not result.get("ok"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=result.get("reason", "bad payload")
        )
    return result
