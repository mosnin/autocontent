"""Native production workspace. Every record lookup is owner-scoped."""

from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from marketer.models.production import ProductionCommand
from marketer.repos import creative_library, production
from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("")
async def inventory(
    collection: str = Query("creatives", pattern="^(campaigns|creatives)$"),
    limit: int = Query(25, ge=1, le=50),
    cursor: str | None = Query(None, max_length=2048),
    kind: str | None = None,
    campaign_id: str | None = None,
    search: str = Query("", max_length=160),
    ctx: AuthCtx = CurrentUser,
):
    try:
        return await creative_library.list_items(
            ctx.user_id,
            collection,
            limit=limit,
            cursor=cursor,
            kind=kind,
            campaign_id=campaign_id,
            search=search,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/{kind}/{creative_id}")
async def detail(kind: str, creative_id: UUID, ctx: AuthCtx = CurrentUser):
    result = await production.get(ctx.user_id, kind, creative_id)
    if result is None:
        raise HTTPException(404, "Creative not found")
    return result


@router.post("/{kind}/{creative_id}")
async def update(kind: str, creative_id: UUID, body: ProductionCommand, ctx: AuthCtx = CurrentUser):
    try:
        result = await production.apply(ctx.user_id, kind, creative_id, body)
    except production.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if result is None:
        raise HTTPException(404, "Creative not found")
    return result


@router.get("/{kind}/{creative_id}/preview")
async def preview(
    kind: str, creative_id: UUID, index: int = Query(0, ge=0, le=19), ctx: AuthCtx = CurrentUser
):
    from marketer.services.creative_preview import thumbnail
    from fastapi.responses import JSONResponse

    source = await creative_library.source(ctx.user_id, kind, creative_id)
    if source is None:
        raise HTTPException(404, "Creative not found")
    return JSONResponse(
        {"dataUrl": await thumbnail(kind, source["data"], index)},
        headers={"Cache-Control": "no-store"},
    )
