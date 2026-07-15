"""Outbound webhook management — register endpoints that receive signed
event notifications. Distinct from routes/webhooks.py (the inbound Ayrshare
receiver)."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from marketer.repos import webhooks_out
from marketer.repos.webhooks_out import VALID_EVENTS, WebhookEndpoint

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class WebhookCreate(BaseModel):
    url: str = Field(max_length=2000)
    events: list[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=200)

    @field_validator("url")
    @classmethod
    def _https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("url must be https://")
        return v

    @field_validator("events")
    @classmethod
    def _known(cls, v: list[str]) -> list[str]:
        bad = [e for e in v if e not in VALID_EVENTS]
        if bad:
            raise ValueError(f"unknown events: {bad}; valid: {sorted(VALID_EVENTS)}")
        return v


@router.get("", response_model=list[WebhookEndpoint])
async def list_endpoints(ctx: AuthCtx = CurrentUser) -> list[WebhookEndpoint]:
    return await webhooks_out.list_for_user(ctx.user_id)


@router.post("", response_model=WebhookEndpoint, status_code=status.HTTP_201_CREATED)
async def create_endpoint(body: WebhookCreate, ctx: AuthCtx = CurrentUser) -> WebhookEndpoint:
    """Register an endpoint. The signing secret is returned exactly once in
    this response (never again) — the client must store it to verify
    signatures."""
    return await webhooks_out.create(
        user_id=ctx.user_id, url=body.url, events=body.events, description=body.description
    )


class WebhookEnabledPatch(BaseModel):
    enabled: bool


@router.patch("/{endpoint_id}", response_model=WebhookEndpoint)
async def update_endpoint(
    endpoint_id: UUID, body: WebhookEnabledPatch, ctx: AuthCtx = CurrentUser
) -> WebhookEndpoint:
    """Pause or resume delivery. A disabled endpoint keeps its history and
    signing secret; re-enabling resumes with the same secret."""
    ep = await webhooks_out.set_enabled(
        endpoint_id, user_id=ctx.user_id, enabled=body.enabled
    )
    if ep is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "endpoint not found")
    return ep


@router.delete("/{endpoint_id}", status_code=204)
async def delete_endpoint(endpoint_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    ok = await webhooks_out.delete(endpoint_id, user_id=ctx.user_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "endpoint not found")


@router.post("/{endpoint_id}/test")
async def send_test(endpoint_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Send a signed `test.ping` event so the client can validate their
    receiver and signature verification before real events fire."""
    from datetime import datetime, timezone

    from marketer.services import webhook_delivery

    ep = await webhooks_out.get(endpoint_id, user_id=ctx.user_id)
    if ep is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "endpoint not found")
    # Fetch the secret via the deliverable helper (get() doesn't expose it).
    targets = await webhooks_out.deliverable_for_event(ctx.user_id, "test.ping")
    secret = next((s for (u, s) in targets if u == ep.url), None)
    if secret is None:
        # Endpoint is disabled or subscribed to a specific event set that
        # excludes test — deliver directly using its stored secret instead.
        raise HTTPException(status.HTTP_409_CONFLICT, "endpoint is disabled")
    ts = int(datetime.now(timezone.utc).timestamp())
    code = await webhook_delivery.deliver_one(
        ep.url, secret, event="test.ping",
        payload={"endpoint_id": str(ep.id), "message": "marketer.sh test event"},
        timestamp=ts,
    )
    await webhooks_out.record_delivery(ep.url, ctx.user_id, code)
    return {"delivered": True, "status_code": code}
