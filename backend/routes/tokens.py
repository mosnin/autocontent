"""Personal access token CRUD.

Tokens are long-lived bearer credentials so the CLI / MCP server / external
agents can hit the same API the web UI uses without holding a Clerk session.

POST creates a new token and returns the plaintext ONCE. After that the
plaintext is unrecoverable (we only store sha256).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from autocontent.models import PersonalAccessToken
from autocontent.repos import tokens as tokens_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class TokenCreateResponse(BaseModel):
    token: str  # plaintext — shown once
    info: PersonalAccessToken


@router.get("", response_model=list[PersonalAccessToken])
async def list_tokens(ctx: AuthCtx = CurrentUser) -> list[PersonalAccessToken]:
    return await tokens_repo.list_for_user(ctx.user_id)


@router.post("", response_model=TokenCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_token(body: TokenCreate, ctx: AuthCtx = CurrentUser) -> TokenCreateResponse:
    expires_at = tokens_repo.compute_expires_at(body.expires_in_days)
    info, plaintext = await tokens_repo.create(
        user_id=ctx.user_id, name=body.name, expires_at=expires_at
    )
    return TokenCreateResponse(token=plaintext, info=info)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    ok = await tokens_repo.revoke(token_id, ctx.user_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "token not found or already revoked")
