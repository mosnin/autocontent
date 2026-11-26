"""Platform-admin management of invite and pilot codes (docs/billing/access-codes.md).

Marketer staff create, list and disable codes. The plain code is returned
once, by create, and never stored or logged. Every action is audited in the
admin audit log, like the rest of the admin API.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from marketer.repos import access_codes as codes_repo
from marketer.repos import admin_audit

from ..auth import AdminCtx, CurrentAdmin

router = APIRouter()


async def _audit(ctx: AdminCtx, action: str, *, target_id: str | None = None, metadata: dict | None = None) -> None:
    await admin_audit.record(
        actor_id=ctx.user_id,
        actor_email=ctx.email,
        action=action,
        target_type="access_code",
        target_id=target_id,
        ip=ctx.ip,
        user_agent=ctx.user_agent,
        metadata=metadata,
    )


class CreateCode(BaseModel):
    kind: codes_repo.Kind
    credit_usd: Decimal = Field(default=Decimal("0"), ge=0, le=1000, max_digits=10, decimal_places=2)
    trial_days: int | None = Field(default=None, ge=1, le=365)
    max_redemptions: int = Field(default=1, ge=1, le=100000)
    expires_in_days: int | None = Field(default=None, ge=1, le=730)
    note: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def _grants_something(self) -> CreateCode:
        if self.credit_usd <= 0 and self.trial_days is None:
            raise ValueError("a code must grant credit or a pilot window")
        return self


class CreatedCode(BaseModel):
    code: str  # shown once
    access_code: codes_repo.AccessCode


@router.get("", response_model=list[codes_repo.AccessCode])
async def list_codes(ctx: AdminCtx = CurrentAdmin) -> list[codes_repo.AccessCode]:
    rows = await codes_repo.list_codes()
    await _audit(ctx, "access_code.list", metadata={"count": len(rows)})
    return rows


@router.post("", response_model=CreatedCode, status_code=status.HTTP_201_CREATED)
async def create_code(body: CreateCode, ctx: AdminCtx = CurrentAdmin) -> CreatedCode:
    expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    plain, row = await codes_repo.create(
        kind=body.kind,
        credit_usd=body.credit_usd,
        trial_days=body.trial_days,
        max_redemptions=body.max_redemptions,
        expires_at=expires_at,
        note=body.note,
        created_by=ctx.user_id,
    )
    await _audit(
        ctx,
        "access_code.created",
        target_id=str(row.id),
        metadata={"kind": row.kind, "credit_usd": str(row.credit_usd), "trial_days": row.trial_days, "max_redemptions": row.max_redemptions},
    )
    return CreatedCode(code=plain, access_code=row)


@router.post("/{code_id}/disable", response_model=codes_repo.AccessCode)
async def disable_code(code_id: UUID, ctx: AdminCtx = CurrentAdmin) -> codes_repo.AccessCode:
    row = await codes_repo.disable(code_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "access code not found")
    await _audit(ctx, "access_code.disabled", target_id=str(code_id))
    return row
