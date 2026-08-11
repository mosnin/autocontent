"""Kits: user-level reusable skills (design / ad / writing).

- GET    /api/v1/kits?kind=design    — list (optionally by kind)
- POST   /api/v1/kits                — create
- GET    /api/v1/kits/{id}           — fetch
- PUT    /api/v1/kits/{id}           — partial update
- DELETE /api/v1/kits/{id}           — delete

Marking a kit default atomically un-defaults the previous one of that
kind. Kits are pure user data: nothing here can loosen the ads spend
guard — ad kits only steer what the optimizer *proposes*.
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.models import Kit
from marketer.repos import kits as kits_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class KitCreate(BaseModel):
    kind: Literal["design", "ad", "writing"]
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    content: str = Field(default="", max_length=kits_repo.MAX_CONTENT_CHARS)
    rules: dict = Field(default_factory=dict)
    is_default: bool = False


class KitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    content: str | None = Field(default=None, max_length=kits_repo.MAX_CONTENT_CHARS)
    rules: dict | None = None
    is_default: bool | None = None


@router.get("", response_model=list[Kit])
async def list_kits(
    kind: Literal["design", "ad", "writing"] | None = None,
    ctx: AuthCtx = CurrentUser,
) -> list[Kit]:
    return await kits_repo.list_for_user(ctx.user_id, kind=kind)


@router.post("", response_model=Kit, status_code=status.HTTP_201_CREATED)
async def create_kit(body: KitCreate, ctx: AuthCtx = CurrentUser) -> Kit:
    return await kits_repo.create(user_id=ctx.user_id, **body.model_dump())


@router.get("/{kit_id}", response_model=Kit)
async def get_kit(kit_id: UUID, ctx: AuthCtx = CurrentUser) -> Kit:
    kit = await kits_repo.get(kit_id, user_id=ctx.user_id)
    if kit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return kit


@router.put("/{kit_id}", response_model=Kit)
async def update_kit(
    kit_id: UUID, body: KitUpdate, ctx: AuthCtx = CurrentUser
) -> Kit:
    kit = await kits_repo.update(
        kit_id, user_id=ctx.user_id, **body.model_dump(exclude_unset=True)
    )
    if kit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return kit


@router.delete("/{kit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_kit(kit_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    if not await kits_repo.delete(kit_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
