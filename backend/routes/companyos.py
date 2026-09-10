"""Read-only OAuth projection for connected Company OS workspaces."""

from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from marketer.repos import creative_library, oauth as oauth_repo, users as users_repo
from marketer.services import oauth as oauth_service
from .oauth import _bearer_grant, _require_scope, _unauthorized

router = APIRouter()


async def require_companyos_reader(request: Request) -> str:
    token, grant = await _bearer_grant(request)
    _require_scope(token, "content:read")
    client = await oauth_repo.get_client(grant.client_id)
    user = await users_repo.get(grant.user_id)
    if not client or not client.is_active or not user or user.suspended_at:
        raise _unauthorized("invalid_token", "the connected account is unavailable")
    if grant.resource and grant.resource != oauth_service.resource_identifier():
        raise _unauthorized("invalid_token", "this token targets another resource")
    return grant.user_id


Reader = Annotated[str, Depends(require_companyos_reader)]


@router.get("/library")
async def library(
    user_id: Reader,
    response: Response,
    collection: str = Query("creatives", pattern="^(campaigns|creatives)$"),
    limit: int = Query(25, ge=1, le=50),
    cursor: str | None = Query(None, max_length=2048),
    kind: str | None = None,
    campaign_id: str | None = None,
    search: str = Query("", max_length=160),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await creative_library.list_items(
            user_id,
            collection,
            limit=limit,
            cursor=cursor,
            kind=kind,
            campaign_id=campaign_id,
            search=search,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/preview/{kind}/{creative_id}")
async def preview(kind: str, creative_id: UUID, user_id: Reader, response: Response):
    from marketer.services.creative_preview import thumbnail

    source = await creative_library.source(user_id, kind, creative_id)
    if source is None:
        raise HTTPException(404, "Creative not found")
    response.headers["Cache-Control"] = "no-store"
    return {"dataUrl": await thumbnail(kind, source["data"])}
