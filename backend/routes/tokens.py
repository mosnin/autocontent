"""Personal access token CRUD.

Tokens are long-lived bearer credentials so the CLI / MCP server / external
agents can hit the same API the web UI uses without holding a Clerk session.

POST creates a new token and returns the plaintext ONCE. After that the
plaintext is unrecoverable (we only store sha256).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from marketer.models import PersonalAccessToken
from marketer.repos import tokens as tokens_repo

from ..auth import AuthCtx, require_scope, token_or_ip_key
from ..rate_limit import limiter

router = APIRouter()


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)
    # Omit for the backward-compat default (read+write). Validated against
    # the vocabulary in marketer.repos.tokens.validate_scopes; an existing
    # token's scopes are never widened by a later call — this only affects
    # brand-new tokens.
    scopes: list[str] | None = Field(default=None)


class TokenCreateResponse(BaseModel):
    token: str  # plaintext — shown once
    info: PersonalAccessToken


@router.get("", response_model=list[PersonalAccessToken])
@limiter.limit("30/minute", key_func=token_or_ip_key)
async def list_tokens(
    request: Request, ctx: AuthCtx = require_scope("read")
) -> list[PersonalAccessToken]:
    return await tokens_repo.list_for_user(ctx.user_id)


@router.post("", response_model=TokenCreateResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute", key_func=token_or_ip_key)
async def create_token(
    request: Request, body: TokenCreate, ctx: AuthCtx = require_scope("write")
) -> TokenCreateResponse:
    expires_at = tokens_repo.compute_expires_at(body.expires_in_days)
    # Only pass `scopes` through when the caller actually specified one —
    # keeps the call shape identical to before scoping existed when the
    # field is omitted, so any code (or test double) still keying off the
    # pre-scopes `create(user_id, name, expires_at)` signature is unaffected.
    create_kwargs: dict = dict(user_id=ctx.user_id, name=body.name, expires_at=expires_at)
    if body.scopes is not None:
        create_kwargs["scopes"] = body.scopes
    try:
        info, plaintext = await tokens_repo.create(**create_kwargs)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return TokenCreateResponse(token=plaintext, info=info)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: UUID, ctx: AuthCtx = require_scope("write")) -> None:
    ok = await tokens_repo.revoke(token_id, ctx.user_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "token not found or already revoked")
