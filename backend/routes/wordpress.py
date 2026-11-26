"""The workspace's WordPress connection (docs/seo-articles.md).

GET    /api/v1/integrations/wordpress   integration:read        the connection, never the password
PUT    /api/v1/integrations/wordpress   integration:connect     verify, then save (password sealed)
DELETE /api/v1/integrations/wordpress   integration:disconnect

Saving always verifies first: the site must be a public https address
(SSRF guard), the credentials must work, and the user's role is reported
(``can_publish``). The application password is sealed with the server's
integration key and no response ever contains it.
"""
from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.articles.publishing import SECRET_PURPOSE
from marketer.repos import wordpress as wordpress_repo
from marketer.services import secret_box
from marketer.services.wordpress import WordPressClient, WordPressRefused, WordPressSite, normalize_site_url

from .. import audit
from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

router = APIRouter()


class ConnectionOut(BaseModel):
    connected: bool
    site_url: str | None = None
    username: str | None = None
    seo_plugin: str | None = None
    status: str | None = None
    last_error: str = ""
    has_password: bool = False
    can_publish: bool | None = None
    secrets_configured: bool = True


def _out(conn: wordpress_repo.WordPressConnection | None, *, can_publish: bool | None = None) -> ConnectionOut:
    if conn is None:
        return ConnectionOut(connected=False, secrets_configured=secret_box.available())
    return ConnectionOut(
        connected=True, site_url=conn.site_url, username=conn.username, seo_plugin=conn.seo_plugin,
        status=conn.status, last_error=conn.last_error, has_password=True, can_publish=can_publish,
        secrets_configured=secret_box.available(),
    )


@router.get("/wordpress", response_model=ConnectionOut)
async def get_wordpress(ctx: AuthCtx = CurrentUser) -> ConnectionOut:
    return _out(await wordpress_repo.get(ctx.user_id))


class ConnectBody(BaseModel):
    site_url: str = Field(min_length=8, max_length=300)
    username: str = Field(min_length=1, max_length=120)
    app_password: str = Field(min_length=8, max_length=200, repr=False)
    seo_plugin: Literal["yoast", "rankmath", "none"] = "yoast"


@router.put("/wordpress", response_model=ConnectionOut, dependencies=[user_rate_limit("integrations.wordpress", "10/minute")])
async def connect_wordpress(body: ConnectBody, ctx: AuthCtx = CurrentUser) -> ConnectionOut:
    if not secret_box.available():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "integration secrets aren't configured on this server")
    try:
        site_url = normalize_site_url(body.site_url)
        client = WordPressClient(
            WordPressSite(site_url=site_url, username=body.username.strip(), app_password=body.app_password, seo_plugin=body.seo_plugin)
        )
        info = await client.verify()
    except WordPressRefused as exc:
        await audit.record(ctx, "integration.connected", outcome="failure", target_type="wordpress", metadata={"reason": exc.message[:200]})
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.message) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The site didn't answer. Check the address and try again.") from exc
    sealed = secret_box.seal(body.app_password.replace(" ", ""), purpose=SECRET_PURPOSE, tenant_id=ctx.user_id)
    conn = await wordpress_repo.upsert(
        user_id=ctx.user_id, site_url=site_url, username=body.username.strip(), password_sealed=sealed,
        seo_plugin=body.seo_plugin, created_by=ctx.actor_id or ctx.user_id,
    )
    await audit.record(
        ctx, "integration.connected", outcome="success", target_type="wordpress", target_id=str(conn.id),
        metadata={"site_url": site_url, "seo_plugin": body.seo_plugin, "can_publish": info["can_publish"]},
    )
    return _out(conn, can_publish=info["can_publish"])


@router.delete("/wordpress", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_wordpress(ctx: AuthCtx = CurrentUser) -> None:
    removed = await wordpress_repo.delete(ctx.user_id)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no WordPress site connected")
    await audit.record(ctx, "integration.disconnected", outcome="success", target_type="wordpress")
