"""Native read-only MCP plus the existing account OAuth server.

Deployed separately from generation workers, against the existing account database.
"""

from __future__ import annotations

import json
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from marketer.db import get_pool
from marketer.repos import oauth as oauth_repo, users as users_repo
from marketer.services import oauth as protocol
from .rate_limit import limiter
from .routes import oauth
from .native_request_security import NativeRequestSecurity

READ_SCOPES = ["openid", "profile", "email", "offline_access", "content:read"]
TOOLS = {
    "marketer_account": ("Read the connected account identity.", "openid"),
    "marketer_list_niches": ("Read up to 50 niches in the connected account.", "content:read"),
    "marketer_list_articles": (
        "Read up to 50 recent articles in the connected account.",
        "content:read",
    ),
    "marketer_list_jobs": ("Read up to 50 recent jobs in the connected account.", "content:read"),
}


def registration_metadata(body: object) -> tuple[str, list[str], list[str]]:
    if not isinstance(body, dict):
        raise ValueError("invalid_client_metadata")
    if body.get("token_endpoint_auth_method", "none") != "none":
        raise ValueError("invalid_client_metadata")
    callbacks = body.get("redirect_uris")
    if not isinstance(callbacks, list) or not 1 <= len(callbacks) <= 4:
        raise ValueError("invalid_redirect_uri")
    for raw in callbacks:
        if not isinstance(raw, str) or len(raw) > 2048:
            raise ValueError("invalid_redirect_uri")
        uri = urlsplit(raw)
        if (
            uri.scheme != "http"
            or uri.hostname not in ("127.0.0.1", "::1")
            or not uri.port
            or uri.username
            or uri.password
            or uri.query
            or uri.fragment
        ):
            raise ValueError("invalid_redirect_uri")
    for key, allowed in (
        ("grant_types", ["authorization_code", "refresh_token"]),
        ("response_types", ["code"]),
    ):
        value = body.get(key)
        if value is not None and (
            not isinstance(value, list) or not value or any(item not in allowed for item in value)
        ):
            raise ValueError("invalid_client_metadata")
    raw_scope = body.get("scope")
    scopes = (
        READ_SCOPES[:]
        if raw_scope is None
        else raw_scope.split()
        if isinstance(raw_scope, str)
        else []
    )
    if not scopes or any(scope not in READ_SCOPES for scope in scopes):
        raise ValueError("invalid_client_metadata")
    name = body.get("client_name", "Native MCP client")
    name = name.strip()[:120] if isinstance(name, str) else "Native MCP client"
    return name or "Native MCP client", callbacks, scopes


async def native_principal(request: Request):
    token, grant = await oauth._bearer_grant(request)
    if grant.resource != protocol.resource_identifier():
        raise oauth._unauthorized("invalid_token", "wrong resource audience")
    client = await oauth_repo.get_client(grant.client_id)
    if client is None or not client.is_active:
        raise oauth._unauthorized("invalid_token", "client disabled")
    user = await users_repo.get(grant.user_id)
    if user is None or user.suspended_at is not None:
        raise oauth._unauthorized("invalid_token", "account unavailable")
    return token, grant, user


def create_app() -> FastAPI:
    app = FastAPI(title="Marketer native connector", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(NativeRequestSecurity)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_exception_handler(oauth.OAuthProblem, oauth.oauth_problem_handler)

    @app.get("/.well-known/oauth-authorization-server")
    async def metadata():
        result = protocol.authorization_server_metadata()
        result["registration_endpoint"] = protocol.endpoint("/oauth/register")
        result["scopes_supported"] = READ_SCOPES
        return result

    @app.post("/oauth/register")
    @limiter.limit("10/minute")
    async def register(request: Request):
        try:
            raw = await request.body()
            if len(raw) > 8192 or "application/json" not in request.headers.get("content-type", ""):
                raise ValueError("invalid_client_metadata")
            name, callbacks, scopes = registration_metadata(json.loads(raw))
        except (ValueError, TypeError):
            return JSONResponse({"error": "invalid_client_metadata"}, status_code=400)
        pool = await get_pool()
        client_id = protocol.new_client_id()
        # Transactional global cap also bounds registration across cold starts.
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(813921)")
            count = await conn.fetchval(
                "SELECT count(*) FROM oauth_clients WHERE created_at > now() - interval '1 minute'"
            )
            if count >= 50:
                return JSONResponse({"error": "rate_limit_exceeded"}, status_code=429)
            await conn.execute(
                "INSERT INTO oauth_clients(client_id,name,redirect_uris,scopes,resources) VALUES($1,$2,$3,$4,$5)",
                client_id,
                name,
                callbacks,
                scopes,
                [protocol.resource_identifier()],
            )
        return JSONResponse(
            {
                "client_id": client_id,
                "client_name": name,
                "redirect_uris": callbacks,
                "scope": " ".join(scopes),
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
            },
            status_code=201,
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/mcp")
    @limiter.limit("120/minute")
    async def mcp(request: Request):
        token, grant, user = await native_principal(request)
        try:
            rpc = await request.json()
            if not isinstance(rpc, dict) or rpc.get("jsonrpc") != "2.0":
                raise ValueError()
        except (ValueError, TypeError):
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": "Invalid JSON-RPC request"},
                },
                status_code=400,
            )
        rpc_id, method = rpc.get("id"), rpc.get("method")

        def result(value):
            return JSONResponse(jsonable_encoder({"jsonrpc": "2.0", "id": rpc_id, "result": value}))

        if isinstance(method, str) and method.startswith("notifications/") and "id" not in rpc:
            return Response(status_code=202)
        if method == "initialize":
            return result(
                {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "marketer", "version": "0.1.0"},
                }
            )
        if method == "ping":
            return result({})
        if method == "tools/list":
            return result(
                {
                    "tools": [
                        {
                            "name": name,
                            "description": description,
                            "inputSchema": {
                                "type": "object",
                                "properties": {},
                                "additionalProperties": False,
                            },
                            "annotations": {
                                "readOnlyHint": True,
                                "destructiveHint": False,
                                "idempotentHint": True,
                                "openWorldHint": False,
                            },
                        }
                        for name, (description, scope) in TOOLS.items()
                        if scope in token.scopes
                    ]
                }
            )
        if method == "tools/call":
            params = rpc.get("params") or {}
            name = params.get("name") if isinstance(params, dict) else None
            if not isinstance(name, str) or name not in TOOLS or params.get("arguments", {}) != {}:
                return JSONResponse(
                    {
                        "jsonrpc": "2.0",
                        "id": rpc_id,
                        "error": {"code": -32602, "message": "Unknown tool or arguments"},
                    }
                )
            oauth._require_scope(token, TOOLS[name][1])
            if name == "marketer_account":
                data = {"user_id": user.id}
                if "email" in token.scopes:
                    data["email"] = user.email
            else:
                queries = {
                    "marketer_list_niches": "SELECT id,title,description,created_at FROM niches WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
                    "marketer_list_articles": "SELECT id,title,status,topic,created_at FROM articles WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
                    "marketer_list_jobs": "SELECT id,niche_id,status,created_at FROM jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
                }
                pool = await get_pool()
                rows = await pool.fetch(queries[name], grant.user_id)
                data = {
                    "items": [dict(row) for row in rows],
                    "limit": 50,
                    "may_have_more": len(rows) == 50,
                }
            return result(
                {"content": [{"type": "text", "text": json.dumps(jsonable_encoder(data))}]}
            )
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {"code": -32601, "message": "Method not found"},
            }
        )

    # Preserve the existing tested PKCE, consent, refresh rotation and revocation.
    app.include_router(oauth.router)
    return app
