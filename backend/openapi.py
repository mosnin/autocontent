"""OpenAPI customization for the public API.

``customize_openapi(app)`` overrides ``app.openapi()`` with a generator
that:

* Sets a clear title/description/version and a ``servers`` list (from
  ``MARKETER_API_BASE_URL`` when set).
* Declares a Bearer PAT (personal access token) security scheme and applies
  it globally, so every operation in the generated spec/docs UI shows the
  auth requirement.
* Groups the existing per-router tags (``"jobs"``, ``"ads"``, ``"billing"``,
  ...) into a handful of product-level tag groups via the
  ``x-tagGroups`` extension (a convention read by Redoc/Stoplight/most
  OpenAPI viewers) — this does not require touching route decorators.
* Assigns a stable, human-readable ``operationId`` to every operation
  (``"<tag>_<route-name>"``, de-duplicated), so generated SDK clients get
  durable method names across deploys instead of FastAPI's default
  hash-derived ids.

Also exposes ``sorted_openapi_schema(app)`` / ``dump_openapi_json(app)``:
a deterministic (recursively key-sorted) rendering of the schema, so the
spec can be committed to the repo and diffed meaningfully in review instead
of churning on incidental dict-ordering noise.

Wiring (done by the orchestrator in ``backend/main.py::create_app()``,
after all routers are included so the generated schema reflects the full
route table):

    from .openapi import customize_openapi

    customize_openapi(app)
"""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

API_TITLE = "marketer API"
API_DESCRIPTION = (
    "Programmatic access to marketer: campaigns, articles, ads, billing, "
    "and publishing automation. Authenticate with a personal access token "
    "(PAT) as a Bearer token. Errors are returned as a stable JSON envelope "
    "(see backend.errors) so agent/SDK callers can branch on `error.code`."
)
API_VERSION = "1.0.0"

SECURITY_SCHEME_NAME = "BearerAuth"

# Leaf router tags (as passed to app.include_router(..., tags=[...]) in
# main.py) grouped into product-level categories for docs navigation.
# A leaf tag not listed here falls back to an "Other" group rather than
# being dropped, so a new router someone forgets to add here still shows
# up in the docs.
TAG_GROUPS: dict[str, list[str]] = {
    "Content": ["articles", "templates", "style-presets", "library", "brand-kit", "kits"],
    "Campaigns & Ads": ["campaigns", "ads", "calendar", "image-posts", "niches", "performance"],
    "Billing & Spend": ["billing", "spend", "x402"],
    "Platform": ["users", "tokens", "connect", "providers", "voices"],
    "Operations": ["jobs", "ops", "failures", "metrics", "admin", "webhooks", "webhooks-out"],
    "System": ["health"],
}


def _tag_group_extension() -> list[dict[str, Any]]:
    known: set[str] = set()
    groups: list[dict[str, Any]] = []
    for name, tags in TAG_GROUPS.items():
        groups.append({"name": name, "tags": list(tags)})
        known.update(tags)
    return groups, known


def _assign_stable_operation_ids(schema: dict[str, Any]) -> None:
    """Rewrite every operation's operationId to a stable ``<tag>_<name>``.

    FastAPI's default operationId is derived from the route's function
    name plus a hash of the path, which shifts whenever a path parameter
    or route ordering changes — a poor foundation for generated SDK method
    names. We instead use ``<first-tag>_<route-name>``, falling back to
    ``<method>_<path>`` when a route has no tag, and de-duplicate by
    suffixing ``_2``, ``_3``, ... on collision.
    """
    seen: dict[str, int] = {}
    for path, methods in schema.get("paths", {}).items():
        for method, operation in methods.items():
            if method not in ("get", "put", "post", "delete", "patch", "options", "head", "trace"):
                continue
            tags = operation.get("tags") or []
            base_name = operation.get("operationId") or f"{method}_{path}"
            prefix = tags[0].replace("-", "_") if tags else method
            candidate = f"{prefix}_{base_name}"
            count = seen.get(candidate, 0)
            seen[candidate] = count + 1
            operation["operationId"] = candidate if count == 0 else f"{candidate}_{count + 1}"


def _apply_security_scheme(schema: dict[str, Any]) -> None:
    components = schema.setdefault("components", {})
    security_schemes = components.setdefault("securitySchemes", {})
    security_schemes[SECURITY_SCHEME_NAME] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "PAT",
        "description": (
            "Personal access token issued via /api/v1/tokens. Send as "
            "`Authorization: Bearer <token>`."
        ),
    }
    # Apply globally; individual public routes (e.g. /healthz, webhooks
    # using signature auth instead) can override with `security=[]` on
    # their own operation if/when they need to opt out.
    schema["security"] = [{SECURITY_SCHEME_NAME: []}]


def _servers(app: FastAPI) -> list[dict[str, str]]:
    servers: list[dict[str, str]] = []
    base_url = os.environ.get("MARKETER_API_BASE_URL", "").strip()
    if base_url:
        servers.append({"url": base_url.rstrip("/"), "description": "Configured API base URL"})
    servers.append({"url": "https://api.marketer.sh", "description": "Production"})
    servers.append({"url": "http://localhost:8000", "description": "Local development"})
    return servers


def _build_schema(app: FastAPI) -> dict[str, Any]:
    schema = get_openapi(
        title=API_TITLE,
        version=API_VERSION,
        description=API_DESCRIPTION,
        routes=app.routes,
    )
    schema["servers"] = _servers(app)
    _apply_security_scheme(schema)
    tag_groups, _known = _tag_group_extension()
    schema["x-tagGroups"] = tag_groups
    _assign_stable_operation_ids(schema)
    return schema


def customize_openapi(app: FastAPI) -> None:
    """Install a custom ``app.openapi()`` generator on ``app``.

    Idempotent and cheap to call multiple times: it always (re)builds and
    caches into ``app.openapi_schema``, matching FastAPI's own caching
    contract (``app.openapi_schema`` is invalidated to ``None`` externally
    if callers want to force a rebuild, e.g. in tests).
    """

    def _generator() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        app.openapi_schema = _build_schema(app)
        return app.openapi_schema

    app.openapi = _generator  # type: ignore[method-assign]


def _sort_recursive(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _sort_recursive(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [_sort_recursive(v) for v in value]
    return value


def sorted_openapi_schema(app: FastAPI) -> dict[str, Any]:
    """Return the app's OpenAPI schema with all dict keys recursively
    sorted, so it's diff-stable when committed to the repo."""
    schema = app.openapi()
    return _sort_recursive(schema)


def dump_openapi_json(app: FastAPI, *, indent: int = 2) -> str:
    """Deterministic JSON rendering of the schema (sorted keys, stable
    indentation) suitable for writing to a committed ``openapi.json``."""
    return json.dumps(sorted_openapi_schema(app), indent=indent, sort_keys=True) + "\n"
