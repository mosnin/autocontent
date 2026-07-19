"""Anti-drift keystone: the single source of truth for "what the SDK and MCP
server must expose".

**Why this file exists.** The marketer SDK (``marketer.sdk.MarketerClient``)
and the marketer MCP server (``marketer.mcp_server``) are hand-written
wrappers around the REST API (``backend.main:create_app``). Nothing forces
them to stay in sync with the route table — that's exactly how they fell
behind in the first place. This module enumerates all three surfaces (REST
routes, SDK methods, MCP tools) and produces a diff. ``tests/test_api_parity.py``
turns that diff into a CI gate:

* every public route must be reachable through *both* an SDK method and an
  MCP tool, OR be listed explicitly in :data:`KNOWN_GAPS` with a reason;
* no SDK method / MCP tool may reference a route that no longer exists
  (dead client code);
* :data:`KNOWN_GAPS` may only shrink — an entry that is actually covered
  must be deleted, so parity work is forced to clean up after itself.

**How route enumeration works.** We ask FastAPI for its own OpenAPI schema
(``app.openapi()["paths"]``) rather than walking ``app.routes`` by hand.
Recent FastAPI versions (>=0.119) wrap included routers in an internal
``fastapi.routing._IncludedRouter`` object and resolve the effective
path/tags lazily through a private ``include_context``; earlier versions
spliced plain ``APIRoute`` objects straight into ``app.routes``. Both of
these are private implementation details that have already changed once
during this project and will change again. ``app.openapi()`` is the one
FastAPI surface that is guaranteed to reflect every included router,
mounted sub-router, and path/method/tag/operation-id correctly, regardless
of the internal route-storage representation — because it is what FastAPI
itself uses to build ``/openapi.json`` and the docs UI. Arbitrary
non-FastAPI ASGI mounts (e.g. the optional Inngest workflow server mounted
at ``/api/inngest`` in ``backend/main.py``) do not appear in the OpenAPI
schema at all; that's fine, they are explicitly not part of the public
HTTP+JSON product API this contract governs (see ``ALLOWLIST`` below).

**How SDK enumeration works.** We introspect ``MarketerClient`` with
``inspect`` for public (non-underscore) ``async def`` methods, excluding
lifecycle plumbing (``aclose``, ``__aenter__``, ``__aexit__``).

**How MCP enumeration works.** ``mcp_server.build_server()`` returns a
``FastMCP`` instance. FastMCP's public API exposes an async
``list_tools()`` / ``list_resources()`` on the low-level server, but since
this module must stay import-light and synchronous (it is imported by a
plain pytest module, not an async one), we instead read the tool/resource
registry FastMCP populates synchronously at decoration time:
``FastMCP._tool_manager._tools`` (dict of name -> Tool) and
``FastMCP._resource_manager._resources``. This is a private attribute, so
if a future FastMCP upgrade renames it, ``enumerate_mcp_tools`` raises a
clear ``AttributeError``-derived ``RuntimeError`` rather than silently
returning an empty set (which would make the parity test falsely green).
"""
from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI
    from mcp.server.fastmcp import FastMCP

RouteKey = tuple[str, str]  # (HTTP method, path) e.g. ("GET", "/api/v1/niches")


# --------------------------------------------------------------------------- #
# 1. Route enumeration
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Route:
    """One (method, path) operation on the public FastAPI app."""

    method: str
    path: str
    operation_id: str
    tags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def key(self) -> RouteKey:
        return (self.method, self.path)


# Infra / non-product endpoints that are intentionally excluded from the
# parity contract. Every exclusion must be listed here with a reason —
# nothing is silently skipped. ``/openapi.json``, ``/docs``, ``/redoc`` and
# ``/docs/oauth2-redirect`` are NOT listed because FastAPI does not include
# them in ``app.openapi()["paths"]`` in the first place (they describe the
# schema, they aren't part of it).
ALLOWLIST: dict[RouteKey, str] = {
    ("GET", "/healthz"): "infra liveness probe, not a product feature",
    ("GET", "/healthz/deep"): "infra readiness probe, not a product feature",
    ("POST", "/api/v1/billing/webhook"): (
        "inbound webhook FROM Stripe (signature-verified server callback), "
        "not something an SDK/MCP caller ever invokes"
    ),
    ("POST", "/api/v1/webhooks/ayrshare"): (
        "inbound webhook FROM the Ayrshare provider (signature-verified "
        "server callback), not something an SDK/MCP caller ever invokes"
    ),
}

_EXCLUDED_METHODS = {"HEAD", "OPTIONS", "TRACE"}


def _build_app() -> "FastAPI":
    from backend.main import create_app  # noqa: PLC0415 — deferred, heavy import

    return create_app()


def enumerate_routes(app: "FastAPI | None" = None) -> list[Route]:
    """Enumerate every (method, path) operation FastAPI knows about.

    Uses ``app.openapi()`` rather than walking ``app.routes`` — see the
    module docstring for why that's the robust choice across FastAPI
    versions and in the presence of mounted sub-apps.
    """
    if app is None:
        app = _build_app()

    schema = app.openapi()
    routes: list[Route] = []
    for path, operations in schema.get("paths", {}).items():
        for method, op in operations.items():
            upper = method.upper()
            if upper in _EXCLUDED_METHODS:
                continue
            routes.append(
                Route(
                    method=upper,
                    path=path,
                    operation_id=op.get("operationId", ""),
                    tags=tuple(op.get("tags") or ()),
                )
            )
    return sorted(routes, key=lambda r: r.key)


def public_routes(app: "FastAPI | None" = None) -> list[Route]:
    """``enumerate_routes`` with :data:`ALLOWLIST` entries removed."""
    return [r for r in enumerate_routes(app) if r.key not in ALLOWLIST]


# --------------------------------------------------------------------------- #
# 2. SDK enumeration
# --------------------------------------------------------------------------- #

# Lifecycle / plumbing methods on MarketerClient that are not API-call
# wrappers and must never be expected to map to a route.
_SDK_NON_API_METHODS = {"aclose"}


def enumerate_sdk_methods() -> list[str]:
    """Public async methods on ``MarketerClient`` (excluding dunders/lifecycle)."""
    from .sdk import MarketerClient  # noqa: PLC0415

    names = []
    for name, member in inspect.getmembers(MarketerClient, predicate=inspect.isfunction):
        if name.startswith("_"):
            continue
        if name in _SDK_NON_API_METHODS:
            continue
        if not inspect.iscoroutinefunction(member):
            continue
        names.append(name)
    return sorted(names)


# --------------------------------------------------------------------------- #
# 3. MCP enumeration
# --------------------------------------------------------------------------- #


def _build_mcp_server() -> "FastMCP":
    from .mcp_server import build_server  # noqa: PLC0415

    # Dummy creds: build_server() only stores them for later client
    # construction: it never connects at build time, so no network I/O
    # happens here.
    return build_server(base_url="http://sdk-parity-test.invalid", token="sdk-parity-test")


def enumerate_mcp_tools(server: "FastMCP | None" = None) -> list[str]:
    """Names of every ``@mcp.tool``-registered function.

    FastMCP has no synchronous public accessor for the tool registry (the
    real one, ``list_tools()``, is an async server method meant for the MCP
    wire protocol). We read the ``_tool_manager._tools`` mapping that
    ``@mcp.tool()`` populates at decoration time instead. This is a private
    attribute; if it disappears in a future ``mcp`` package upgrade we want
    a loud failure, not a silently-empty (falsely green) tool list.
    """
    if server is None:
        server = _build_mcp_server()
    try:
        tools = server._tool_manager._tools  # noqa: SLF001 — documented, deliberate
    except AttributeError as exc:  # pragma: no cover - guards against fastmcp upgrades
        raise RuntimeError(
            "FastMCP._tool_manager._tools is gone — the `mcp` package's internal "
            "tool registry layout changed. Update enumerate_mcp_tools() in "
            "src/marketer/api_coverage.py to match the new registry before "
            "trusting the parity contract again."
        ) from exc
    return sorted(tools.keys())


def enumerate_mcp_resources(server: "FastMCP | None" = None) -> list[str]:
    """URI templates of every ``@mcp.resource``-registered function."""
    if server is None:
        server = _build_mcp_server()
    try:
        resources = server._resource_manager._templates  # noqa: SLF001
    except AttributeError as exc:  # pragma: no cover - guards against fastmcp upgrades
        raise RuntimeError(
            "FastMCP._resource_manager._templates is gone — update "
            "enumerate_mcp_resources() in src/marketer/api_coverage.py."
        ) from exc
    return sorted(resources.keys())


# --------------------------------------------------------------------------- #
# 4. The contract: route -> {sdk_method, mcp_tool}
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Coverage:
    """What reaches a given route today."""

    sdk_method: str | None = None
    mcp_tool: str | None = None


# Every route this project considers *fully covered* today, and exactly how.
# A route only belongs here if BOTH an SDK method and an MCP tool reach it.
# When a later cycle adds the missing half of a KNOWN_GAPS entry, move it
# here (and delete it from KNOWN_GAPS).
COVERAGE_MANIFEST: dict[RouteKey, Coverage] = {
    ("GET", "/api/v1/niches"): Coverage("list_niches", "list_niches"),
    ("GET", "/api/v1/niches/{niche_id}"): Coverage("get_niche", "get_niche"),
    ("POST", "/api/v1/niches"): Coverage("create_niche", "create_niche"),
    ("DELETE", "/api/v1/niches/{niche_id}"): Coverage("archive_niche", "archive_niche"),
    ("GET", "/api/v1/jobs"): Coverage("list_jobs", "list_jobs"),
    ("GET", "/api/v1/jobs/{job_id}"): Coverage("get_job", "get_job"),
    ("POST", "/api/v1/jobs"): Coverage("enqueue_job", "enqueue_job"),
    ("POST", "/api/v1/jobs/{job_id}/retry"): Coverage("retry_job", "retry_job"),
    ("GET", "/api/v1/articles"): Coverage("list_articles", "list_articles"),
    ("GET", "/api/v1/articles/{article_id}"): Coverage("get_article", "get_article"),
    ("GET", "/api/v1/articles/{article_id}/markdown"): Coverage(
        "get_article_markdown", "get_article_markdown"
    ),
    ("POST", "/api/v1/articles"): Coverage("generate_article", "generate_article"),
    ("POST", "/api/v1/articles/{article_id}/retry"): Coverage("retry_article", "retry_article"),
    ("POST", "/api/v1/articles/{article_id}/social"): Coverage(
        "repurpose_article", "repurpose_article"
    ),
    ("GET", "/api/v1/calendar"): Coverage("calendar", "calendar"),
    ("GET", "/api/v1/brand-kit"): Coverage("get_brand_kit", "get_brand_kit"),
    ("PUT", "/api/v1/brand-kit"): Coverage("set_brand_kit", "set_brand_kit"),
    ("GET", "/api/v1/ads/accounts"): Coverage("list_ad_accounts", "list_ad_accounts"),
    ("POST", "/api/v1/ads/accounts/connect"): Coverage(
        "connect_ad_account", "connect_ad_account"
    ),
    ("GET", "/api/v1/ads/overview"): Coverage("ads_overview", "ads_overview"),
    ("GET", "/api/v1/ads/campaigns"): Coverage("list_ad_campaigns", "list_ad_campaigns"),
    ("GET", "/api/v1/ads/campaigns/{campaign_id}"): Coverage(
        "get_ad_campaign", "get_ad_campaign"
    ),
    ("POST", "/api/v1/ads/campaigns"): Coverage("create_ad_campaign", "create_ad_campaign"),
    ("POST", "/api/v1/ads/campaigns/{campaign_id}/budget"): Coverage(
        "change_ad_budget", "change_ad_budget"
    ),
    ("POST", "/api/v1/ads/campaigns/{campaign_id}/status"): Coverage(
        "change_ad_status", "change_ad_status"
    ),
    ("GET", "/api/v1/ads/approvals"): Coverage("list_ad_approvals", "list_ad_approvals"),
    ("POST", "/api/v1/ads/approvals/{approval_id}/decide"): Coverage(
        "decide_ad_approval", "decide_ad_approval"
    ),
    ("GET", "/api/v1/x402/config"): Coverage("x402_config", "x402_config"),
    ("POST", "/api/v1/x402/credits"): Coverage("x402_buy_credits", "x402_buy_credits"),
    ("GET", "/api/v1/spend/today"): Coverage("today_spend", "today_spend"),
    ("POST", "/api/v1/connect/ayrshare"): Coverage("connect_ayrshare", "connect_ayrshare"),
}

# Routes with *partial* coverage: an SDK method exists (or, in principle, an
# MCP tool exists) but the other half doesn't, so the route is NOT fully
# covered and must stay in KNOWN_GAPS below. Tracked separately from
# COVERAGE_MANIFEST (which is "fully covered, done") purely so
# unmapped_sdk_methods()/unmapped_mcp_tools() know these client methods are
# accounted for and don't flag them as forgotten/undocumented.
PARTIAL_COVERAGE: dict[RouteKey, Coverage] = {
    ("GET", "/api/v1/connect/ayrshare/status"): Coverage(sdk_method="ayrshare_status"),
    ("GET", "/api/v1/tokens"): Coverage(sdk_method="list_tokens"),
    ("POST", "/api/v1/tokens"): Coverage(sdk_method="create_token"),
    ("DELETE", "/api/v1/tokens/{token_id}"): Coverage(sdk_method="revoke_token"),
}

# --------------------------------------------------------------------------- #
# 5. Known gaps — the Phase-1/2/3 SDK+MCP parity worklist
# --------------------------------------------------------------------------- #
#
# Every public route NOT in COVERAGE_MANIFEST must be listed here with a
# short reason. `tests/test_api_parity.py` enforces:
#   * every public route is in COVERAGE_MANIFEST or KNOWN_GAPS (nothing
#     falls through the cracks silently);
#   * every KNOWN_GAPS entry is NOT actually covered (forces deletion here
#     the moment SDK+MCP catch up, instead of a stale "gap" masking real
#     coverage forever).
#
# Group headers below mirror backend/main.py's router prefixes so this
# reads as a per-feature-area worklist.

KNOWN_GAPS: dict[RouteKey, str] = {
    # ---- users: no SDK/MCP coverage at all ----------------------------------
    ("GET", "/api/v1/users/me"): "no SDK/MCP coverage yet",
    ("PATCH", "/api/v1/users/me"): "no SDK/MCP coverage yet",
    ("DELETE", "/api/v1/users/me"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/users/me/export"): "no SDK/MCP coverage yet",
    # ---- niches: partial (create/read/archive covered, update/draft/derived not) --
    ("POST", "/api/v1/niches/draft"): "no SDK/MCP coverage yet",
    ("PUT", "/api/v1/niches/{niche_id}"): "no SDK/MCP coverage yet (update_niche)",
    ("GET", "/api/v1/niches/{niche_id}/character-sheet"): "no SDK/MCP coverage yet",
    # ---- performance ----------------------------------------------------------
    ("GET", "/api/v1/niches/{niche_id}/performance"): "no SDK/MCP coverage yet",
    # ---- jobs: partial (list/get/enqueue/retry covered) ------------------------
    ("GET", "/api/v1/jobs/{job_id}/video"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/jobs/{job_id}/metrics"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/jobs/{job_id}/approve"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/jobs/{job_id}/reject"): "no SDK/MCP coverage yet",
    # ---- articles: partial (list/get/markdown/generate/retry/social covered) --
    ("GET", "/api/v1/articles/{article_id}/hero-image"): "no SDK/MCP coverage yet",
    # ---- admin: no SDK/MCP coverage at all -------------------------------------
    ("GET", "/api/v1/admin/overview"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/admin/users"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/admin/users/{user_id}"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/admin/users/{user_id}/suspension"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/admin/users/{user_id}/role"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/admin/users/{user_id}/credits"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/admin/flags"): "no SDK/MCP coverage yet",
    ("PUT", "/api/v1/admin/flags/{key}"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/admin/health"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/admin/audit-log"): "no SDK/MCP coverage yet",
    # ---- ads: partial (account list/connect, campaigns, budget/status, ------
    #          approvals, overview covered; account lifecycle + actions log not) --
    ("POST", "/api/v1/ads/accounts/{account_id}/refresh"): "no SDK/MCP coverage yet",
    ("DELETE", "/api/v1/ads/accounts/{account_id}"): "no SDK/MCP coverage yet",
    ("PATCH", "/api/v1/ads/accounts/{account_id}/governance"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/ads/actions"): "no SDK/MCP coverage yet",
    # ---- webhooks-out: no SDK/MCP coverage at all ------------------------------
    ("GET", "/api/v1/webhook-endpoints"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/webhook-endpoints"): "no SDK/MCP coverage yet",
    ("PATCH", "/api/v1/webhook-endpoints/{endpoint_id}"): "no SDK/MCP coverage yet",
    ("DELETE", "/api/v1/webhook-endpoints/{endpoint_id}"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/webhook-endpoints/{endpoint_id}/test"): "no SDK/MCP coverage yet",
    # ---- spend: partial (today covered; history not) ---------------------------
    ("GET", "/api/v1/spend/history"): "no SDK/MCP coverage yet",
    # ---- connect: partial — SDK has ayrshare_status(), MCP does not -----------
    ("GET", "/api/v1/connect/ayrshare/status"): (
        "SDK has ayrshare_status(); MCP tool not registered"
    ),
    # ---- tokens: SDK-only — MCP intentionally/accidentally omits all three ----
    ("GET", "/api/v1/tokens"): "SDK has list_tokens(); MCP tool not registered",
    ("POST", "/api/v1/tokens"): "SDK has create_token(); MCP tool not registered",
    ("DELETE", "/api/v1/tokens/{token_id}"): "SDK has revoke_token(); MCP tool not registered",
    # ---- voices: no SDK/MCP coverage at all ------------------------------------
    ("GET", "/api/v1/voices/{voice}/preview"): "no SDK/MCP coverage yet",
    # ---- billing: no SDK/MCP coverage at all (webhook itself is allowlisted) --
    ("GET", "/api/v1/billing/balance"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/billing/checkout"): "no SDK/MCP coverage yet",
    # ---- metrics ----------------------------------------------------------------
    ("GET", "/api/v1/metrics/summary"): "no SDK/MCP coverage yet",
    # ---- library: no SDK/MCP coverage at all ------------------------------------
    ("GET", "/api/v1/library"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/library/compositions"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/library/compositions"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/library/compositions/{composition_id}"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/library/{asset_id}/media"): "no SDK/MCP coverage yet",
    # ---- style-presets: no SDK/MCP coverage at all -----------------------------
    ("GET", "/api/v1/style-presets"): "no SDK/MCP coverage yet",
    # ---- kits: no SDK/MCP coverage at all ---------------------------------------
    ("GET", "/api/v1/kits"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/kits"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/kits/{kit_id}"): "no SDK/MCP coverage yet",
    ("PUT", "/api/v1/kits/{kit_id}"): "no SDK/MCP coverage yet",
    ("DELETE", "/api/v1/kits/{kit_id}"): "no SDK/MCP coverage yet",
    # ---- campaigns: no SDK/MCP coverage at all -----------------------------------
    ("GET", "/api/v1/campaigns"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/campaigns"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/campaigns/{campaign_id}"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/campaigns/{campaign_id}/start"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/campaigns/{campaign_id}/pause"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/campaigns/{campaign_id}/items"): "no SDK/MCP coverage yet",
    ("PATCH", "/api/v1/campaigns/{campaign_id}/items/{item_id}"): "no SDK/MCP coverage yet",
    ("DELETE", "/api/v1/campaigns/{campaign_id}/items/{item_id}"): "no SDK/MCP coverage yet",
    # ---- image-posts: no SDK/MCP coverage at all ---------------------------------
    ("GET", "/api/v1/image-posts"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/image-posts"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/image-posts/{image_post_id}"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/image-posts/{image_post_id}/retry"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/image-posts/{image_post_id}/approve"): "no SDK/MCP coverage yet",
    # ---- templates: no SDK/MCP coverage at all -----------------------------------
    ("GET", "/api/v1/templates"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/templates"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/templates/admin/all"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/templates/{template_id}/reference"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/templates/{template_id}/remix"): "no SDK/MCP coverage yet",
    ("PUT", "/api/v1/templates/{template_id}"): "no SDK/MCP coverage yet",
    ("DELETE", "/api/v1/templates/{template_id}"): "no SDK/MCP coverage yet",
    # ---- providers: no SDK/MCP coverage at all -----------------------------------
    ("GET", "/api/v1/providers/video-models"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/providers/audio"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/providers/script-models"): "no SDK/MCP coverage yet",
    # ---- ops: no SDK/MCP coverage at all ------------------------------------------
    ("GET", "/api/v1/ops/metrics"): "no SDK/MCP coverage yet",
    ("GET", "/api/v1/ops/config-health"): "no SDK/MCP coverage yet",
    # ---- failures: no SDK/MCP coverage at all -------------------------------------
    ("GET", "/api/v1/failures"): "no SDK/MCP coverage yet",
    ("POST", "/api/v1/failures/replay/{kind}/{item_id}"): "no SDK/MCP coverage yet",
}


# --------------------------------------------------------------------------- #
# 6. Diff helpers (pure functions — unit-testable without spinning up FastAPI)
# --------------------------------------------------------------------------- #


@dataclass
class CoverageReport:
    total_routes: int
    covered: list[RouteKey]
    known_gaps: list[RouteKey]
    uncovered_unlisted: list[RouteKey]  # covered=False AND not in KNOWN_GAPS -> CI must fail
    stale_gaps: list[RouteKey]  # in KNOWN_GAPS AND actually covered -> CI must fail
    dead_sdk_methods: list[str]  # SDK methods pointing at a route that doesn't exist
    dead_mcp_tools: list[str]  # MCP tools pointing at a route that doesn't exist
    unmapped_sdk_methods: list[str]  # SDK methods the manifest never mentions
    unmapped_mcp_tools: list[str]  # MCP tools the manifest never mentions

    @property
    def ok(self) -> bool:
        return not (
            self.uncovered_unlisted
            or self.stale_gaps
            or self.dead_sdk_methods
            or self.dead_mcp_tools
            or self.unmapped_sdk_methods
            or self.unmapped_mcp_tools
        )

    def render(self) -> str:
        lines = [
            "=== marketer API parity report ===",
            f"public routes:        {self.total_routes}",
            f"covered (sdk+mcp):    {len(self.covered)}",
            f"known gaps:           {len(self.known_gaps)}",
            f"uncovered & unlisted: {len(self.uncovered_unlisted)}  (CI-failing if > 0)",
            f"stale known-gaps:     {len(self.stale_gaps)}  (CI-failing if > 0)",
            f"dead sdk methods:     {len(self.dead_sdk_methods)}  (CI-failing if > 0)",
            f"dead mcp tools:       {len(self.dead_mcp_tools)}  (CI-failing if > 0)",
            f"unmapped sdk methods: {len(self.unmapped_sdk_methods)}  (CI-failing if > 0)",
            f"unmapped mcp tools:   {len(self.unmapped_mcp_tools)}  (CI-failing if > 0)",
        ]
        if self.uncovered_unlisted:
            lines.append("--- uncovered & unlisted routes ---")
            lines.extend(f"  {m} {p}" for m, p in self.uncovered_unlisted)
        if self.stale_gaps:
            lines.append("--- stale KNOWN_GAPS entries (now actually covered) ---")
            lines.extend(f"  {m} {p}" for m, p in self.stale_gaps)
        if self.dead_sdk_methods:
            lines.append("--- dead SDK methods (route no longer exists) ---")
            lines.extend(f"  {n}" for n in self.dead_sdk_methods)
        if self.dead_mcp_tools:
            lines.append("--- dead MCP tools (route no longer exists) ---")
            lines.extend(f"  {n}" for n in self.dead_mcp_tools)
        if self.unmapped_sdk_methods:
            lines.append("--- SDK methods the manifest never mentions ---")
            lines.extend(f"  {n}" for n in self.unmapped_sdk_methods)
        if self.unmapped_mcp_tools:
            lines.append("--- MCP tools the manifest never mentions ---")
            lines.extend(f"  {n}" for n in self.unmapped_mcp_tools)
        return "\n".join(lines)


def compute_gap_report(
    routes: list[RouteKey],
    coverage_manifest: dict[RouteKey, Coverage],
    known_gaps: dict[RouteKey, str],
    sdk_methods: list[str],
    mcp_tools: list[str],
    partial_coverage: dict[RouteKey, Coverage] | None = None,
) -> CoverageReport:
    """Pure diff function — the core contract logic, independent of I/O.

    Kept dependency-free (no FastAPI/httpx/MCP objects) so it can be
    unit-tested directly with synthetic inputs to prove the guard actually
    catches regressions (see tests/test_api_parity.py::test_meta_*).
    """
    partial_coverage = partial_coverage or {}
    route_set = set(routes)
    covered_keys = {key for key, cov in coverage_manifest.items() if key in route_set}
    gap_keys = {key for key in known_gaps if key in route_set}

    uncovered_unlisted = sorted(route_set - covered_keys - gap_keys)
    stale_gaps = sorted(key for key in known_gaps if key in covered_keys)

    # Every route referenced by the manifest (full or partial) must actually
    # exist; an entry for a deleted route means the SDK/MCP method backing
    # it is dead code that should have been removed along with the route.
    combined_manifest: dict[RouteKey, Coverage] = {**coverage_manifest, **partial_coverage}
    dead_manifest_routes = {key for key in combined_manifest if key not in route_set}
    dead_sdk_methods = sorted(
        combined_manifest[key].sdk_method
        for key in dead_manifest_routes
        if combined_manifest[key].sdk_method
    )
    dead_mcp_tool_names = sorted(
        combined_manifest[key].mcp_tool
        for key in dead_manifest_routes
        if combined_manifest[key].mcp_tool
    )

    return CoverageReport(
        total_routes=len(routes),
        covered=sorted(covered_keys),
        known_gaps=sorted(gap_keys),
        uncovered_unlisted=uncovered_unlisted,
        stale_gaps=stale_gaps,
        dead_sdk_methods=dead_sdk_methods,
        dead_mcp_tools=dead_mcp_tool_names,
        unmapped_sdk_methods=unmapped_sdk_methods(sdk_methods, coverage_manifest, partial_coverage),
        unmapped_mcp_tools=unmapped_mcp_tools(mcp_tools, coverage_manifest, partial_coverage),
    )


def unmapped_sdk_methods(
    sdk_methods: list[str],
    coverage_manifest: dict[RouteKey, Coverage],
    partial_coverage: dict[RouteKey, Coverage] | None = None,
) -> list[str]:
    """SDK methods that exist but are not referenced by any manifest entry.

    Distinct from ``dead_sdk_methods`` in the report: this catches methods
    the manifest simply forgot to mention (e.g. a brand new SDK method
    added without updating api_coverage.py), regardless of whether their
    route exists.
    """
    mapped = {cov.sdk_method for cov in coverage_manifest.values() if cov.sdk_method}
    mapped |= {cov.sdk_method for cov in (partial_coverage or {}).values() if cov.sdk_method}
    return sorted(set(sdk_methods) - mapped)


def unmapped_mcp_tools(
    mcp_tools: list[str],
    coverage_manifest: dict[RouteKey, Coverage],
    partial_coverage: dict[RouteKey, Coverage] | None = None,
) -> list[str]:
    """MCP tools that exist but are not referenced by any manifest entry."""
    mapped = {cov.mcp_tool for cov in coverage_manifest.values() if cov.mcp_tool}
    mapped |= {cov.mcp_tool for cov in (partial_coverage or {}).values() if cov.mcp_tool}
    return sorted(set(mcp_tools) - mapped)
