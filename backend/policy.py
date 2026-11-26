"""Route permissions: one table, one enforcement point (docs/auth/README.md).

Every route FastAPI registers is classified here as one of

- ``"resource:action"``  the caller's effective permissions must contain it;
- ``InRoute(any_of)``     the caller needs at least one of ``any_of`` here, and
                          the route checks the exact permission itself once it
                          knows what the request does (``require_permission``),
                          e.g. deciding an inbox item needs ``content:approve``
                          or ``spend:approve`` depending on its kind;
- ``AUTHENTICATED``       any signed-in member of the workspace;
- ``PLATFORM_ADMIN``      Marketer staff (``require_admin``);
- ``PUBLIC``              no auth (health, signed inbound webhooks, docs).

``enforce_policy`` is mounted as an app-level dependency in ``create_app``; it
resolves auth through ``require_user``, which caches the context on the request,
so a route that also depends on ``CurrentUser`` never authenticates twice.
``tests/test_policy_coverage.py`` fails on any registered route missing from the
table and on any table entry that no longer matches a route. At runtime an
unclassified route is refused (fail closed).

The rationale for each choice is in docs/auth/backend.md.
"""
from __future__ import annotations

import inspect
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.routing import iter_route_contexts

from . import permissions as perms
from .auth import AuthCtx, require_admin, require_user

log = logging.getLogger(__name__)


class _Marker:
    def __init__(self, name: str) -> None:
        self.name = name

    def __repr__(self) -> str:
        return self.name


PUBLIC = _Marker("PUBLIC")
AUTHENTICATED = _Marker("AUTHENTICATED")
PLATFORM_ADMIN = _Marker("PLATFORM_ADMIN")


@dataclass(frozen=True)
class InRoute:
    """At least one of ``any_of`` here; the route checks the exact one."""

    any_of: tuple[str, ...]
    note: str = ""


Entry = Any  # str | InRoute | _Marker

V1 = "/api/v1"

POLICY: dict[tuple[str, str], Entry] = {
    # health and signed inbound webhooks
    ("GET", "/healthz"): PUBLIC,
    ("GET", "/healthz/deep"): PUBLIC,
    ("POST", f"{V1}/billing/webhook"): PUBLIC,  # Stripe signature
    ("POST", f"{V1}/webhooks/ayrshare"): PUBLIC,  # HMAC over the body
    # users (the tenant's settings and the account)
    ("GET", f"{V1}/users/me"): AUTHENTICATED,
    ("GET", f"{V1}/users/me/export"): "workspace:delete",
    ("DELETE", f"{V1}/users/me"): "workspace:delete",
    ("PATCH", f"{V1}/users/me"): InRoute(
        ("spend:set_limits", "workspace:update"),
        "global cap → spend:set_limits; email_notifications → workspace:update",
    ),
    # niches (playbooks)
    ("POST", f"{V1}/niches/draft"): "playbook:create",
    ("GET", f"{V1}/niches"): "playbook:read",
    ("POST", f"{V1}/niches"): "playbook:create",
    ("GET", f"{V1}/niches/{{niche_id}}"): "playbook:read",
    ("PUT", f"{V1}/niches/{{niche_id}}"): InRoute(
        ("playbook:update",),
        "plus spend:set_limits when the daily cap changes and content:approve when "
        "approve_before_post changes",
    ),
    ("DELETE", f"{V1}/niches/{{niche_id}}"): "playbook:delete",
    ("GET", f"{V1}/niches/{{niche_id}}/character-sheet"): "playbook:read",
    ("GET", f"{V1}/niches/{{niche_id}}/performance"): "analytics:read",
    # jobs (videos)
    ("GET", f"{V1}/jobs"): "content:read",
    ("GET", f"{V1}/jobs/{{job_id}}"): "content:read",
    ("POST", f"{V1}/jobs"): "content:create",
    ("GET", f"{V1}/jobs/{{job_id}}/video"): "content:read",
    ("GET", f"{V1}/jobs/{{job_id}}/metrics"): "analytics:read",
    ("POST", f"{V1}/jobs/{{job_id}}/approve"): "content:approve",
    ("POST", f"{V1}/jobs/{{job_id}}/reject"): "content:approve",
    ("POST", f"{V1}/jobs/{{job_id}}/retry"): "content:publish",
    # articles
    ("GET", f"{V1}/articles"): "content:read",
    ("GET", f"{V1}/articles/{{article_id}}"): "content:read",
    ("GET", f"{V1}/articles/{{article_id}}/markdown"): "content:read",
    ("POST", f"{V1}/articles"): "content:create",
    ("POST", f"{V1}/articles/{{article_id}}/social"): "content:create",
    ("GET", f"{V1}/articles/{{article_id}}/hero-image"): "content:read",
    ("POST", f"{V1}/articles/{{article_id}}/retry"): "content:create",
    # story videos (src/marketer/story; docs/story-video.md)
    ("GET", f"{V1}/stories"): "content:read",
    ("POST", f"{V1}/stories"): "content:create",
    ("GET", f"{V1}/stories/{{story_id}}"): "content:read",
    ("PUT", f"{V1}/stories/{{story_id}}/script"): "content:create",
    ("POST", f"{V1}/stories/{{story_id}}/script/revise"): "content:create",
    ("POST", f"{V1}/stories/{{story_id}}/storyboard"): "content:create",
    ("POST", f"{V1}/stories/{{story_id}}/shots/{{idx}}/regenerate"): "content:create",
    ("POST", f"{V1}/stories/{{story_id}}/render"): "content:create",
    ("POST", f"{V1}/stories/{{story_id}}/render/approve"): "spend:approve",
    ("POST", f"{V1}/stories/{{story_id}}/render/decline"): "content:create",
    ("POST", f"{V1}/stories/{{story_id}}/retry"): "content:create",
    ("GET", f"{V1}/stories/{{story_id}}/shots/{{idx}}/frame"): "content:read",
    ("GET", f"{V1}/stories/{{story_id}}/characters/{{idx}}/portrait"): "content:read",
    ("GET", f"{V1}/stories/{{story_id}}/video"): "content:read",
    # platform admin
    ("GET", f"{V1}/admin/overview"): PLATFORM_ADMIN,
    ("GET", f"{V1}/admin/users"): PLATFORM_ADMIN,
    ("GET", f"{V1}/admin/users/{{user_id}}"): PLATFORM_ADMIN,
    ("POST", f"{V1}/admin/users/{{user_id}}/suspension"): PLATFORM_ADMIN,
    ("POST", f"{V1}/admin/users/{{user_id}}/role"): PLATFORM_ADMIN,
    ("POST", f"{V1}/admin/users/{{user_id}}/credits"): PLATFORM_ADMIN,
    ("GET", f"{V1}/admin/flags"): PLATFORM_ADMIN,
    ("PUT", f"{V1}/admin/flags/{{key}}"): PLATFORM_ADMIN,
    ("GET", f"{V1}/admin/health"): PLATFORM_ADMIN,
    ("GET", f"{V1}/admin/audit-log"): PLATFORM_ADMIN,
    # ads
    ("GET", f"{V1}/ads/accounts"): "integration:read",
    ("POST", f"{V1}/ads/accounts/connect"): "integration:connect",
    ("POST", f"{V1}/ads/accounts/{{account_id}}/refresh"): "integration:connect",
    ("DELETE", f"{V1}/ads/accounts/{{account_id}}"): "integration:disconnect",
    ("PATCH", f"{V1}/ads/accounts/{{account_id}}/governance"): "spend:set_limits",
    ("GET", f"{V1}/ads/campaigns"): "campaign:read",
    ("POST", f"{V1}/ads/campaigns"): "campaign:create",
    ("POST", f"{V1}/ads/campaigns/{{campaign_id}}/budget"): "campaign:update",
    ("POST", f"{V1}/ads/campaigns/{{campaign_id}}/status"): InRoute(
        ("campaign:launch", "campaign:pause"),
        "active → campaign:launch; paused or ended → campaign:pause",
    ),
    ("GET", f"{V1}/ads/campaigns/{{campaign_id}}"): "campaign:read",
    ("GET", f"{V1}/ads/approvals"): "spend:read",
    ("POST", f"{V1}/ads/approvals/{{approval_id}}/decide"): "spend:approve",
    ("GET", f"{V1}/ads/actions"): "campaign:read",
    ("GET", f"{V1}/ads/overview"): "analytics:read",
    # calendar, brand kit
    ("GET", f"{V1}/calendar"): "content:read",
    ("GET", f"{V1}/brand-kit"): "brand:read",
    ("PUT", f"{V1}/brand-kit"): "brand:update",
    # outbound webhooks
    ("GET", f"{V1}/webhook-endpoints"): "webhook:read",
    ("POST", f"{V1}/webhook-endpoints"): "webhook:manage",
    ("PATCH", f"{V1}/webhook-endpoints/{{endpoint_id}}"): "webhook:manage",
    ("DELETE", f"{V1}/webhook-endpoints/{{endpoint_id}}"): "webhook:manage",
    ("POST", f"{V1}/webhook-endpoints/{{endpoint_id}}/test"): "webhook:manage",
    # spend
    ("GET", f"{V1}/spend/today"): "spend:read",
    ("GET", f"{V1}/spend/history"): "spend:read",
    # social connection
    ("POST", f"{V1}/connect/ayrshare"): "integration:connect",
    ("GET", f"{V1}/connect/ayrshare/status"): "integration:read",
    # personal access tokens
    ("GET", f"{V1}/tokens"): "api_token:read",
    ("POST", f"{V1}/tokens"): "api_token:create",
    ("DELETE", f"{V1}/tokens/{{token_id}}"): "api_token:revoke",
    # voices, billing, metrics, x402
    ("GET", f"{V1}/voices/{{voice}}/preview"): "playbook:read",
    ("GET", f"{V1}/billing/balance"): "billing:read",
    ("POST", f"{V1}/billing/checkout"): "billing:manage",
    ("GET", f"{V1}/metrics/summary"): "analytics:read",
    ("GET", f"{V1}/x402/config"): "billing:read",
    ("POST", f"{V1}/x402/credits"): "billing:manage",
    # media library
    ("GET", f"{V1}/library"): "content:read",
    ("GET", f"{V1}/library/compositions"): "content:read",
    ("POST", f"{V1}/library/compositions"): "content:create",
    ("GET", f"{V1}/library/compositions/{{composition_id}}"): "content:read",
    ("GET", f"{V1}/library/{{asset_id}}/media"): "content:read",
    ("GET", f"{V1}/style-presets"): "content:read",
    # kits (provider bundles a playbook uses)
    ("GET", f"{V1}/kits"): "playbook:read",
    ("POST", f"{V1}/kits"): "playbook:create",
    ("GET", f"{V1}/kits/{{kit_id}}"): "playbook:read",
    ("PUT", f"{V1}/kits/{{kit_id}}"): "playbook:update",
    ("DELETE", f"{V1}/kits/{{kit_id}}"): "playbook:delete",
    # content campaigns
    ("GET", f"{V1}/campaigns"): "campaign:read",
    ("POST", f"{V1}/campaigns"): "campaign:create",
    ("GET", f"{V1}/campaigns/{{campaign_id}}"): "campaign:read",
    ("POST", f"{V1}/campaigns/{{campaign_id}}/start"): "campaign:launch",
    ("POST", f"{V1}/campaigns/{{campaign_id}}/pause"): "campaign:pause",
    ("POST", f"{V1}/campaigns/{{campaign_id}}/items"): "campaign:update",
    ("PATCH", f"{V1}/campaigns/{{campaign_id}}/items/{{item_id}}"): "campaign:update",
    ("DELETE", f"{V1}/campaigns/{{campaign_id}}/items/{{item_id}}"): "campaign:update",
    # image posts (carousels)
    ("GET", f"{V1}/image-posts"): "content:read",
    ("POST", f"{V1}/image-posts"): "content:create",
    ("GET", f"{V1}/image-posts/{{image_post_id}}"): "content:read",
    ("POST", f"{V1}/image-posts/{{image_post_id}}/retry"): "content:publish",
    ("POST", f"{V1}/image-posts/{{image_post_id}}/approve"): "content:approve",
    ("POST", f"{V1}/image-posts/{{image_post_id}}/reject"): "content:approve",
    # templates (the catalog is curated by Marketer staff)
    ("GET", f"{V1}/templates"): "content:read",
    ("GET", f"{V1}/templates/admin/all"): PLATFORM_ADMIN,
    ("GET", f"{V1}/templates/{{template_id}}/reference"): "content:read",
    ("POST", f"{V1}/templates/{{template_id}}/remix"): "content:create",
    ("POST", f"{V1}/templates"): PLATFORM_ADMIN,
    ("PUT", f"{V1}/templates/{{template_id}}"): PLATFORM_ADMIN,
    ("DELETE", f"{V1}/templates/{{template_id}}"): PLATFORM_ADMIN,
    # provider catalogs
    ("GET", f"{V1}/providers/video-models"): "playbook:read",
    ("GET", f"{V1}/providers/audio"): "playbook:read",
    ("GET", f"{V1}/providers/script-models"): "playbook:read",
    # ops (platform)
    ("GET", f"{V1}/ops/metrics"): PLATFORM_ADMIN,
    ("GET", f"{V1}/ops/config-health"): PLATFORM_ADMIN,
    # failures inbox
    ("GET", f"{V1}/failures"): "content:read",
    ("POST", f"{V1}/failures/replay/{{kind}}/{{item_id}}"): "content:publish",
    # workspace (home, inbox, activity)
    ("GET", f"{V1}/workspace/overview"): "analytics:read",
    ("GET", f"{V1}/workspace/inbox"): "content:read",
    ("POST", f"{V1}/workspace/required-actions/{{action_id}}/resolve"): InRoute(
        ("content:publish", "spend:approve"),
        "an ads.* execution → spend:approve; anything else → content:publish",
    ),
    ("POST", f"{V1}/workspace/inbox/{{kind}}/{{ref_id}}/decide"): InRoute(
        ("content:approve", "spend:approve"),
        "video or carousel → content:approve; ad_change → spend:approve",
    ),
    ("GET", f"{V1}/workspace/activity"): "content:read",
    # decision log (written by the agent)
    ("POST", f"{V1}/decisions/log"): "agent:chat",
    ("POST", f"{V1}/decisions/{{decision_id}}/outcome"): "agent:chat",
    ("GET", f"{V1}/decisions"): "analytics:read",
    # memory
    ("GET", f"{V1}/memory/facts"): "memory:read",
    ("POST", f"{V1}/memory/facts"): InRoute(
        ("memory:confirm", "agent:chat"), "person → memory:confirm; agent → agent:chat"
    ),
    ("GET", f"{V1}/memory/facts/{{fact_id}}/history"): "memory:read",
    ("POST", f"{V1}/memory/facts/{{fact_id}}/confirm"): "memory:confirm",
    ("POST", f"{V1}/memory/facts/{{fact_id}}/correct"): "memory:confirm",
    ("POST", f"{V1}/memory/facts/{{fact_id}}/forget"): "memory:forget",
    ("POST", f"{V1}/memory/facts/merge"): InRoute(
        ("memory:confirm", "agent:chat"), "person → memory:confirm; agent → agent:chat"
    ),
    ("GET", f"{V1}/memory/learnings"): "memory:read",
    ("POST", f"{V1}/memory/learnings"): InRoute(
        ("memory:confirm", "agent:chat"), "person → memory:confirm; agent → agent:chat"
    ),
    ("POST", f"{V1}/memory/learnings/{{learning_id}}/status"): InRoute(
        ("memory:confirm", "agent:chat"), "person → memory:confirm; agent → agent:chat"
    ),
    ("GET", f"{V1}/memory/audit"): "memory:read",
    # recall (Supermemory, docs/memory/supermemory.md)
    ("GET", f"{V1}/memory/recall/settings"): AUTHENTICATED,  # every member sees whether recall is on
    ("PUT", f"{V1}/memory/recall/settings"): "security:manage",  # a subprocessor that receives text; also person-only
    ("GET", f"{V1}/memory/recall/session"): "agent:chat",  # the agent at session start; route refuses non-agents
    # Personal memory is the caller's own, whatever their role: the namespace
    # comes from the session's person, never from the request. Route refuses
    # the agent and personal access tokens.
    ("GET", f"{V1}/memory/personal"): AUTHENTICATED,
    ("POST", f"{V1}/memory/personal/forget/preview"): AUTHENTICATED,
    ("POST", f"{V1}/memory/personal/forget"): AUTHENTICATED,
    ("GET", f"{V1}/memory/personal/export"): AUTHENTICATED,
    ("GET", f"{V1}/memory/team"): "memory:read",
    ("POST", f"{V1}/memory/team/forget/preview"): "memory:forget",  # also person-only
    ("POST", f"{V1}/memory/team/forget"): "memory:forget",  # also person-only
    # security audit log
    ("GET", f"{V1}/audit-log"): "audit:read",
    # observability (docs/observability/braintrust.md)
    ("GET", f"{V1}/observability/settings"): AUTHENTICATED,  # every member and the agent
    ("PUT", f"{V1}/observability/settings"): "security:manage",  # what leaves for a subprocessor; also person-only
}

# Routes that are not FastAPI APIRoutes (Starlette routes FastAPI adds itself).
# They never pass through enforce_policy; listed so the coverage test sees
# every registered path. Open finding L8 (docs/security/backend-audit.md).
STATIC_ROUTES: dict[tuple[str, str], Entry] = {
    ("GET", "/openapi.json"): PUBLIC,
    ("GET", "/docs"): PUBLIC,
    ("GET", "/docs/oauth2-redirect"): PUBLIC,
    ("GET", "/redoc"): PUBLIC,
}

# Inngest serves its durable functions under this prefix when ads and Inngest
# are configured; Inngest signs every call with the signing key.
PUBLIC_PREFIXES: tuple[str, ...] = ("/api/inngest",)


def _validate_table() -> None:
    for key, entry in POLICY.items():
        if isinstance(entry, str):
            if not perms.is_permission(entry):
                raise ValueError(f"policy {key}: unknown permission {entry!r}")
        elif isinstance(entry, InRoute):
            if not entry.any_of or any(not perms.is_permission(p) for p in entry.any_of):
                raise ValueError(f"policy {key}: bad InRoute {entry!r}")
        elif entry not in (PUBLIC, AUTHENTICATED, PLATFORM_ADMIN):
            raise ValueError(f"policy {key}: bad entry {entry!r}")


_validate_table()


# --------------------------------------------------------------------------- lookup


def iter_routes(app: FastAPI) -> Iterator[tuple[str, str, Any]]:
    """(method, effective path, original route) for every registered route,
    HEAD excluded (Starlette adds it to every GET)."""
    for rc in iter_route_contexts(app.routes):
        methods = rc.methods or set()
        path = rc.path_format or rc.path or ""
        for method in sorted(methods):
            if method == "HEAD":
                continue
            yield method, path, rc.original_route


def entry_for(method: str, path: str) -> Entry | None:
    if (method, path) in POLICY:
        return POLICY[(method, path)]
    if (method, path) in STATIC_ROUTES:
        return STATIC_ROUTES[(method, path)]
    if any(path == p or path.startswith(p + "/") for p in PUBLIC_PREFIXES):
        return PUBLIC
    return None


def install(app: FastAPI) -> None:
    """Index the table by route object so the enforcement point can find a
    request's entry without re-deriving paths. Call after every router is
    included. Unclassified routes are logged here and refused at runtime."""
    index: dict[tuple[str, int], Entry] = {}
    missing: list[str] = []
    for method, path, route in iter_routes(app):
        entry = entry_for(method, path)
        if entry is None:
            missing.append(f"{method} {path}")
            continue
        key = (method, id(route))
        if key in index and index[key] != entry:
            raise RuntimeError(f"route object mounted twice with different policies: {method} {path}")
        index[key] = entry
    if missing:
        log.error("policy.unclassified_routes (refused at runtime): %s", ", ".join(missing))
    app.state.policy_index = index
    app.add_exception_handler(Forbidden, _forbidden_handler)


# --------------------------------------------------------------------------- deny


class Forbidden(HTTPException):
    """403 with the permission that was missing."""

    def __init__(self, permission: str) -> None:
        super().__init__(status.HTTP_403_FORBIDDEN, "forbidden")
        self.permission = permission


async def _forbidden_handler(_request: Request, exc: Exception) -> JSONResponse:
    permission = getattr(exc, "permission", "")
    return JSONResponse(
        {"detail": "forbidden", "permission": permission},
        status_code=status.HTTP_403_FORBIDDEN,
    )


async def deny(ctx: AuthCtx, permission: str, *, method: str = "", path: str = "") -> Forbidden:
    """Audit the denial (best effort) and return the exception to raise."""
    from . import audit

    await audit.record(
        ctx,
        "permission.denied",
        outcome="denied",
        target_type="route" if path else None,
        target_id=f"{method} {path}".strip() or None,
        metadata={"permission": permission, "role": ctx.role},
    )
    return Forbidden(permission)


async def require_permission(ctx: AuthCtx, permission: str, *, request: Request | None = None) -> None:
    """In-route check for ``InRoute`` entries (and for code that calls a route
    function directly). Raises 403 and audits when missing."""
    if not perms.is_permission(permission):
        raise ValueError(f"unknown permission {permission!r}")
    if permission in ctx.permissions:
        return
    method = getattr(request, "method", "") if request is not None else ""
    path = getattr(getattr(request, "url", None), "path", "") if request is not None else ""
    raise await deny(ctx, permission, method=method, path=path)


# --------------------------------------------------------------------------- enforcement


async def _call(request: Request, dep: Any) -> Any:
    """Run an auth dependency, honouring ``app.dependency_overrides`` exactly as
    FastAPI would for a declared dependency (tests override ``require_user``)."""
    app = request.scope.get("app")
    overrides = getattr(app, "dependency_overrides", None) or {}
    fn = overrides.get(dep, dep)
    if fn is dep:
        return await dep(request)
    params = inspect.signature(fn).parameters
    result = fn(request) if params else fn()
    if inspect.isawaitable(result):
        result = await result
    return result


def _entry_for_request(request: Request) -> Entry | None:
    route = request.scope.get("route")
    method = request.method.upper()
    if method == "HEAD":
        method = "GET"
    index = getattr(request.app.state, "policy_index", None)
    if index is not None and route is not None:
        hit = index.get((method, id(route)))
        if hit is not None:
            return hit
    return None


def _bind_observability(ctx: AuthCtx) -> None:
    """Opaque ids for every span this request starts (docs/observability/
    braintrust.md, rule 6): tenant, person, role. Never email, name or IP."""
    try:
        from marketer.observability import bind

        bind(
            tenant_id=ctx.user_id or None,
            actor_id=ctx.actor_id or None,
            role=ctx.role or None,
            agent="marketer-agent" if getattr(ctx, "delegated", False) else None,
        )
    except Exception:  # noqa: BLE001 — observability never changes an outcome
        log.debug("policy.observability_bind_failed", exc_info=True)


async def enforce_policy(request: Request) -> None:
    """The one enforcement point. Mounted app-wide in ``create_app``."""
    entry = _entry_for_request(request)
    if entry is PUBLIC:
        return
    if entry is PLATFORM_ADMIN:
        await _call(request, require_admin)
        return
    ctx: AuthCtx = await _call(request, require_user)
    _bind_observability(ctx)
    path = request.url.path
    if entry is None:
        # Not in the table: refuse (fail closed). The coverage test keeps
        # this from shipping.
        log.error("policy.unclassified %s %s", request.method, request.url.path)
        raise await deny(ctx, "unclassified", method=request.method, path=path)
    if entry is AUTHENTICATED:
        return
    if isinstance(entry, InRoute):
        if not any(p in ctx.permissions for p in entry.any_of):
            raise await deny(ctx, entry.any_of[0], method=request.method, path=path)
        return
    if entry not in ctx.permissions:
        raise await deny(ctx, entry, method=request.method, path=path)
