"""The anti-drift keystone.

This suite is what keeps the marketer SDK and MCP server from silently
falling behind the REST API again — the exact failure mode this API
project exists to fix. It is deliberately GREEN today: every currently
uncovered route is explicitly acknowledged in
``marketer.api_coverage.KNOWN_GAPS``. It goes RED the moment:

  * someone adds a new route without adding an SDK method + MCP tool for
    it AND without adding it to ``KNOWN_GAPS`` (see
    ``test_every_public_route_is_covered_or_a_known_gap``);
  * an SDK method or MCP tool keeps calling a route that has been deleted
    or renamed (see ``test_no_dead_sdk_or_mcp_client_code``);
  * a route gets full SDK+MCP coverage but its ``KNOWN_GAPS`` entry isn't
    deleted (see ``test_known_gaps_only_shrinks``) — this is what forces
    later cycles to clean up the worklist as they land parity, instead of
    KNOWN_GAPS silently growing stale forever.

See ``src/marketer/api_coverage.py`` for the manifest, the enumeration
strategy for each of the three surfaces (routes / SDK / MCP), and the pure
diff function this suite exercises both against the real app and against
synthetic fixtures (the "meta" tests at the bottom, which prove the guard
itself works).
"""
from __future__ import annotations

import pytest

from marketer import api_coverage as cov


# --------------------------------------------------------------------------- #
# Shared fixtures: enumerate the real app/SDK/MCP once per test session.
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def real_routes() -> list[cov.RouteKey]:
    return [r.key for r in cov.public_routes()]


@pytest.fixture(scope="module")
def real_sdk_methods() -> list[str]:
    return cov.enumerate_sdk_methods()


@pytest.fixture(scope="module")
def real_mcp_tools() -> list[str]:
    return cov.enumerate_mcp_tools()


@pytest.fixture(scope="module")
def real_report(real_routes, real_sdk_methods, real_mcp_tools) -> cov.CoverageReport:
    return cov.compute_gap_report(
        routes=real_routes,
        coverage_manifest=cov.COVERAGE_MANIFEST,
        known_gaps=cov.KNOWN_GAPS,
        sdk_methods=real_sdk_methods,
        mcp_tools=real_mcp_tools,
        partial_coverage=cov.PARTIAL_COVERAGE,
    )


# --------------------------------------------------------------------------- #
# The contract, against the real app/SDK/MCP.
# --------------------------------------------------------------------------- #


def test_coverage_report_prints_and_is_green(real_report: cov.CoverageReport):
    """Emit the human-readable progress report, then assert the suite is green.

    Run with `-s` to see the report; pytest always shows it on failure
    regardless.
    """
    print("\n" + real_report.render())
    assert real_report.ok, real_report.render()


def test_every_public_route_is_covered_or_a_known_gap(real_report: cov.CoverageReport):
    """No route may fall through the cracks silently.

    A brand-new route that ships without an SDK method + MCP tool AND
    without a KNOWN_GAPS entry fails right here — that's the whole point.
    """
    assert real_report.uncovered_unlisted == [], (
        "These public routes have neither full SDK+MCP coverage nor a "
        "KNOWN_GAPS entry. Add SDK+MCP coverage, or add them to "
        "KNOWN_GAPS in src/marketer/api_coverage.py:\n"
        + "\n".join(f"  {m} {p}" for m, p in real_report.uncovered_unlisted)
    )


def test_known_gaps_only_shrinks(real_report: cov.CoverageReport):
    """KNOWN_GAPS may never contain a route that is actually fully covered.

    This is the forcing function: once a later cycle adds the missing SDK
    method + MCP tool for a gap, its KNOWN_GAPS entry must be deleted (and
    a COVERAGE_MANIFEST entry added) in the same change, or this fails.
    """
    assert real_report.stale_gaps == [], (
        "These KNOWN_GAPS entries are stale — the routes are now fully "
        "covered by SDK+MCP. Delete them from KNOWN_GAPS and add a "
        "COVERAGE_MANIFEST entry instead:\n"
        + "\n".join(f"  {m} {p}" for m, p in real_report.stale_gaps)
    )


def test_no_dead_sdk_or_mcp_client_code(real_report: cov.CoverageReport):
    """No SDK method / MCP tool may reference a route that no longer exists."""
    assert real_report.dead_sdk_methods == [], (
        "These SDK methods reference routes that no longer exist on the "
        "FastAPI app (dead client code — remove the method or fix the "
        "route it calls): " + ", ".join(real_report.dead_sdk_methods)
    )
    assert real_report.dead_mcp_tools == [], (
        "These MCP tools reference routes that no longer exist on the "
        "FastAPI app (dead client code): " + ", ".join(real_report.dead_mcp_tools)
    )


def test_no_undocumented_sdk_or_mcp_methods(real_report: cov.CoverageReport):
    """Every SDK method / MCP tool must be mentioned by the manifest.

    Catches manifest drift in the other direction: a new SDK method or MCP
    tool added without updating COVERAGE_MANIFEST/PARTIAL_COVERAGE, even if
    its route already exists and would otherwise look "covered" by
    accident.
    """
    assert real_report.unmapped_sdk_methods == [], (
        "These SDK methods exist but aren't referenced by "
        "COVERAGE_MANIFEST or PARTIAL_COVERAGE in src/marketer/"
        "api_coverage.py: " + ", ".join(real_report.unmapped_sdk_methods)
    )
    assert real_report.unmapped_mcp_tools == [], (
        "These MCP tools exist but aren't referenced by "
        "COVERAGE_MANIFEST or PARTIAL_COVERAGE in src/marketer/"
        "api_coverage.py: " + ", ".join(real_report.unmapped_mcp_tools)
    )


def test_allowlist_exclusions_are_all_documented_and_real(real_routes: list[cov.RouteKey]):
    """Every ALLOWLIST entry must correspond to a route that actually
    exists (no stale exclusions), each with a non-empty reason string."""
    all_routes = {r.key for r in cov.enumerate_routes()}
    for key, reason in cov.ALLOWLIST.items():
        assert key in all_routes, f"ALLOWLIST entry {key} does not correspond to a real route"
        assert reason and reason.strip(), f"ALLOWLIST entry {key} has no documented reason"


def test_coverage_manifest_and_known_gaps_do_not_overlap():
    """A route must not simultaneously claim full coverage and be a gap."""
    overlap = set(cov.COVERAGE_MANIFEST) & set(cov.KNOWN_GAPS)
    assert overlap == set(), f"Routes listed as both covered and a known gap: {sorted(overlap)}"


def test_partial_coverage_routes_are_all_known_gaps():
    """Every PARTIAL_COVERAGE route must have a corresponding KNOWN_GAPS
    entry — a partial route is, by definition, not done."""
    missing = set(cov.PARTIAL_COVERAGE) - set(cov.KNOWN_GAPS)
    assert missing == set(), (
        "PARTIAL_COVERAGE routes missing a KNOWN_GAPS entry: " f"{sorted(missing)}"
    )


def test_snapshot_counts_match_current_reality(real_report: cov.CoverageReport):
    """Pins today's numbers so an accidental route/SDK/MCP change is
    visible in a diff, not just a passing/failing test. Update these
    numbers deliberately whenever coverage genuinely changes."""
    assert real_report.total_routes == 110
    assert len(real_report.covered) == 31
    assert len(real_report.known_gaps) == 79


# --------------------------------------------------------------------------- #
# Meta-tests: prove the guard itself works, with synthetic inputs.
# --------------------------------------------------------------------------- #


def test_meta_new_uncovered_route_is_flagged():
    """A brand-new route with no manifest entry and no KNOWN_GAPS entry
    must show up as uncovered_unlisted — this is the core regression the
    whole suite exists to catch."""
    routes = [("GET", "/api/v1/existing"), ("POST", "/api/v1/brand-new-thing")]
    manifest = {("GET", "/api/v1/existing"): cov.Coverage("get_existing", "get_existing")}
    gaps: dict[cov.RouteKey, str] = {}
    report = cov.compute_gap_report(
        routes=routes,
        coverage_manifest=manifest,
        known_gaps=gaps,
        sdk_methods=["get_existing"],
        mcp_tools=["get_existing"],
    )
    assert report.uncovered_unlisted == [("POST", "/api/v1/brand-new-thing")]
    assert not report.ok


def test_meta_new_route_with_gap_entry_is_not_flagged():
    """The same new route, once acknowledged in KNOWN_GAPS, is fine."""
    routes = [("GET", "/api/v1/existing"), ("POST", "/api/v1/brand-new-thing")]
    manifest = {("GET", "/api/v1/existing"): cov.Coverage("get_existing", "get_existing")}
    gaps = {("POST", "/api/v1/brand-new-thing"): "not wired up yet"}
    report = cov.compute_gap_report(
        routes=routes,
        coverage_manifest=manifest,
        known_gaps=gaps,
        sdk_methods=["get_existing"],
        mcp_tools=["get_existing"],
    )
    assert report.uncovered_unlisted == []
    assert report.ok


def test_meta_stale_known_gap_is_flagged():
    """A KNOWN_GAPS entry for a route that IS fully covered must fail —
    this is what forces cleanup once parity actually lands."""
    routes = [("GET", "/api/v1/thing")]
    manifest = {("GET", "/api/v1/thing"): cov.Coverage("get_thing", "get_thing")}
    gaps = {("GET", "/api/v1/thing"): "stale — this got fixed but nobody removed the entry"}
    report = cov.compute_gap_report(
        routes=routes,
        coverage_manifest=manifest,
        known_gaps=gaps,
        sdk_methods=["get_thing"],
        mcp_tools=["get_thing"],
    )
    assert report.stale_gaps == [("GET", "/api/v1/thing")]
    assert not report.ok


def test_meta_deleted_route_flags_dead_sdk_and_mcp_methods():
    """Manifest entries whose route vanished must be flagged as dead
    client code, not silently ignored."""
    routes: list[cov.RouteKey] = []  # the route was removed from the app
    manifest = {("DELETE", "/api/v1/gone"): cov.Coverage("delete_gone", "delete_gone")}
    report = cov.compute_gap_report(
        routes=routes,
        coverage_manifest=manifest,
        known_gaps={},
        sdk_methods=["delete_gone"],
        mcp_tools=["delete_gone"],
    )
    assert report.dead_sdk_methods == ["delete_gone"]
    assert report.dead_mcp_tools == ["delete_gone"]
    assert not report.ok


def test_meta_partial_coverage_deleted_route_flags_dead_sdk_method():
    """The same dead-route detection must apply to PARTIAL_COVERAGE
    entries, not just fully-covered ones."""
    routes: list[cov.RouteKey] = []
    partial = {("GET", "/api/v1/half-gone"): cov.Coverage(sdk_method="half_gone")}
    report = cov.compute_gap_report(
        routes=routes,
        coverage_manifest={},
        known_gaps={("GET", "/api/v1/half-gone"): "partial"},
        sdk_methods=["half_gone"],
        mcp_tools=[],
        partial_coverage=partial,
    )
    assert report.dead_sdk_methods == ["half_gone"]
    assert not report.ok


def test_meta_unmapped_sdk_method_is_flagged():
    """A brand-new SDK method the manifest never heard of must be
    flagged, even if the route it targets happens to already exist and
    be independently covered under a different name."""
    manifest = {("GET", "/api/v1/thing"): cov.Coverage("get_thing", "get_thing")}
    unmapped = cov.unmapped_sdk_methods(
        sdk_methods=["get_thing", "brand_new_undocumented_method"],
        coverage_manifest=manifest,
    )
    assert unmapped == ["brand_new_undocumented_method"]


def test_meta_unmapped_mcp_tool_is_flagged():
    manifest = {("GET", "/api/v1/thing"): cov.Coverage("get_thing", "get_thing")}
    unmapped = cov.unmapped_mcp_tools(
        mcp_tools=["get_thing", "brand_new_undocumented_tool"],
        coverage_manifest=manifest,
    )
    assert unmapped == ["brand_new_undocumented_tool"]


def test_meta_partial_coverage_methods_are_not_flagged_as_unmapped():
    """SDK-only methods documented in PARTIAL_COVERAGE (e.g. list_tokens,
    which has no MCP tool yet) must not be flagged as "forgotten" simply
    because they aren't in COVERAGE_MANIFEST."""
    manifest: dict[cov.RouteKey, cov.Coverage] = {}
    partial = {("GET", "/api/v1/tokens"): cov.Coverage(sdk_method="list_tokens")}
    unmapped = cov.unmapped_sdk_methods(
        sdk_methods=["list_tokens"],
        coverage_manifest=manifest,
        partial_coverage=partial,
    )
    assert unmapped == []


# --------------------------------------------------------------------------- #
# Enumeration sanity checks (each surface, in isolation).
# --------------------------------------------------------------------------- #


def test_enumerate_routes_finds_a_representative_sample():
    routes = {r.key for r in cov.enumerate_routes()}
    for expected in [
        ("GET", "/api/v1/niches"),
        ("POST", "/api/v1/jobs"),
        ("GET", "/api/v1/campaigns"),
        ("GET", "/healthz"),
    ]:
        assert expected in routes, f"expected route {expected} missing from enumeration"


def test_allowlisted_routes_are_excluded_from_public_routes():
    public = {r.key for r in cov.public_routes()}
    for key in cov.ALLOWLIST:
        assert key not in public, f"{key} is in ALLOWLIST but leaked into public_routes()"


def test_enumerate_sdk_methods_excludes_plumbing(real_sdk_methods: list[str]):
    assert "aclose" not in real_sdk_methods
    assert "__aenter__" not in real_sdk_methods
    assert "list_niches" in real_sdk_methods


def test_enumerate_mcp_tools_finds_expected_tools(real_mcp_tools: list[str]):
    assert "list_niches" in real_mcp_tools
    assert "enqueue_job" in real_mcp_tools
    # tokens tools are a documented, deliberate gap — see PARTIAL_COVERAGE
    assert "list_tokens" not in real_mcp_tools


def test_enumerate_mcp_resources_is_non_empty():
    resources = cov.enumerate_mcp_resources()
    assert resources, "expected at least one @mcp.resource to be registered"
