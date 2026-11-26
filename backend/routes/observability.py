"""The workspace's observability content setting (docs/observability/braintrust.md).

- ``GET /settings``: any member and the agent (``AUTHENTICATED`` in policy).
  The agent caches it for 60 seconds and treats an unreadable answer as
  ``metadata``, so a database error is a 503, never a guess.
- ``PUT /settings``: ``security:manage`` (policy) and a person: never the agent
  and never a personal access token (a credential that outlives a session
  must not widen what leaves for a subprocessor). Audited as
  ``observability.settings_changed``.

``content``: ``redacted`` (prompts and outputs exported after masking) or
``metadata`` (no prompt or output text at all: "Don't send AI content to our
observability provider").
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict

from marketer.observability import context as obs_context
from marketer.repos import observability as repo

from .. import audit
from ..auth import AuthCtx, CurrentUser

router = APIRouter()

Content = Literal["redacted", "metadata"]


class ObservabilitySettings(BaseModel):
    content: Content
    updated_at: datetime | None = None


class ObservabilitySettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: Content


def _unavailable() -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "the observability setting is temporarily unavailable")


def _require_person(ctx: AuthCtx) -> None:
    if getattr(ctx, "delegated", False) or ctx.actor_type != "user" or not ctx.actor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only a signed-in person can change this setting")


@router.get("/settings", response_model=ObservabilitySettings)
async def get_settings(ctx: AuthCtx = CurrentUser) -> ObservabilitySettings:
    try:
        s = await repo.get_setting(ctx.user_id)
    except Exception:  # noqa: BLE001 — no answer is a 503 (the agent reads it as metadata)
        raise _unavailable() from None
    content: Content = "metadata" if s.content == "metadata" else "redacted"
    return ObservabilitySettings(content=content, updated_at=s.updated_at)


@router.put("/settings", response_model=ObservabilitySettings)
async def put_settings(body: ObservabilitySettingsIn, ctx: AuthCtx = CurrentUser) -> ObservabilitySettings:
    _require_person(ctx)
    try:
        before = await repo.get_setting(ctx.user_id)
        s = await repo.set_setting(ctx.user_id, body.content)
    except Exception:  # noqa: BLE001
        raise _unavailable() from None
    # Take effect in this process at once, not after the 60 s cache.
    obs_context.remember(ctx.user_id, s.content)
    await audit.record(
        ctx,
        "observability.settings_changed",
        outcome="success",
        target_type="workspace",
        target_id=ctx.org_id or None,
        metadata={"content": s.content, "previous": before.content},
    )
    content: Content = "metadata" if s.content == "metadata" else "redacted"
    return ObservabilitySettings(content=content, updated_at=s.updated_at)
