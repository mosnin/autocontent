"""Personal access token CRUD.

Tokens are long-lived bearer credentials so the CLI / MCP server / external
agents can hit the same API the web UI uses without holding a browser session.

A token acts with a workspace role chosen at creation, at most the creator's
own role (grant ceiling, docs/auth/permissions.json). It stops working when
its creator leaves the workspace (backend/auth.py). Creation and revocation
are written to the security audit log.

POST creates a new token and returns the plaintext ONCE. After that the
plaintext is unrecoverable (we only store sha256).

Person-only: the agent's service-token delegation is refused on every route
here. A token outlives the delegated call, so letting the agent mint one would
turn a capped, per-session delegation into a standing credential.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from marketer.models import PersonalAccessToken
from marketer.repos import tokens as tokens_repo

from .. import audit
from .. import permissions as perms
from ..auth import AuthCtx
from ..rate_limit import limiter
from ..security import CurrentPerson

router = APIRouter()


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)
    # Workspace role the token acts with. Defaults to the creator's role.
    role: str | None = Field(default=None, max_length=32)


class TokenCreateResponse(BaseModel):
    token: str  # plaintext — shown once
    info: PersonalAccessToken


@router.get("", response_model=list[PersonalAccessToken])
@limiter.limit("30/minute")
async def list_tokens(request: Request, ctx: AuthCtx = CurrentPerson) -> list[PersonalAccessToken]:
    return await tokens_repo.list_for_user(ctx.user_id)


@router.post("", response_model=TokenCreateResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def create_token(
    request: Request, body: TokenCreate, ctx: AuthCtx = CurrentPerson
) -> TokenCreateResponse:
    role = body.role or perms.primary_role(ctx.role)
    if not perms.can_grant(ctx.role, role):
        await audit.record(
            ctx, "api_token.create", outcome="denied",
            metadata={"requested_role": role[:32], "reason": "grant_ceiling"},
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "a token's role can be at most your own role",
        )
    expires_at = tokens_repo.compute_expires_at(body.expires_in_days)
    info, plaintext = await tokens_repo.create(
        user_id=ctx.user_id, name=body.name, expires_at=expires_at,
        role=role, created_by=ctx.actor_id or ctx.user_id,
    )
    await audit.record(
        ctx, "api_token.created", outcome="success",
        target_type="api_token", target_id=str(info.id),
        metadata={"role": role, "prefix": info.prefix, "name": body.name},
    )
    return TokenCreateResponse(token=plaintext, info=info)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: UUID, ctx: AuthCtx = CurrentPerson) -> None:
    ok = await tokens_repo.revoke(token_id, ctx.user_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "token not found or already revoked")
    await audit.record(
        ctx, "api_token.revoked", outcome="success",
        target_type="api_token", target_id=str(token_id),
    )
