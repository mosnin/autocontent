"""Every page under `web/app/(app)/` must be behind Clerk auth.

Next.js middleware matchers are static strings — they cannot be derived
from the filesystem at build time — so the list of protected segments in
`web/middleware.ts` is maintained by hand. That list has drifted before:
`library`, `templates`, and `campaigns` all shipped inside the
authenticated app group while being reachable without a session, because
adding a page and updating the matcher are two separate acts and only one
of them is load-bearing at review time.

This test closes that gap from the other side. It fails loudly when a new
`(app)/` route appears without a matching matcher entry, so the failure
mode is a red CI run rather than an unprotected page. It deliberately
lives in the Python suite because that is what CI already runs — the web
package has no test runner of its own.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parent.parent
_APP_DIR = _REPO / "web" / "app" / "(app)"
_MIDDLEWARE = _REPO / "web" / "middleware.ts"


def _route_segments() -> set[str]:
    """First-level route segments under the authenticated app group.

    Route *groups* — `(name)` — are transparent in the URL and contribute
    no segment, and files (layout.tsx, error.tsx) are not routes.
    """
    return {
        child.name
        for child in _APP_DIR.iterdir()
        if child.is_dir() and not child.name.startswith("(") and not child.name.startswith("_")
    }


def _declared_segments() -> set[str]:
    """Segments listed in middleware.ts's APP_SEGMENTS array."""
    source = _MIDDLEWARE.read_text()
    match = re.search(r"const APP_SEGMENTS = \[(.*?)\]", source, re.S)
    assert match, "middleware.ts no longer declares an APP_SEGMENTS array"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


@pytest.mark.skipif(not _APP_DIR.is_dir(), reason="web app group not present")
def test_every_app_route_is_declared_protected() -> None:
    missing = _route_segments() - _declared_segments()
    assert not missing, (
        "these routes live under web/app/(app)/ but are missing from "
        f"APP_SEGMENTS in web/middleware.ts, so they render without auth: {sorted(missing)}"
    )


@pytest.mark.skipif(not _APP_DIR.is_dir(), reason="web app group not present")
def test_no_stale_segments_declared() -> None:
    """A segment that no longer exists is dead config, and it makes the
    matcher regex broader than the app actually is."""
    stale = _declared_segments() - _route_segments()
    assert not stale, (
        "APP_SEGMENTS in web/middleware.ts lists routes that no longer "
        f"exist under web/app/(app)/: {sorted(stale)}"
    )


@pytest.mark.skipif(not _APP_DIR.is_dir(), reason="web app group not present")
def test_matcher_and_protection_share_one_source() -> None:
    """`config.matcher` decides where middleware RUNS; `isProtected`
    decides where it CHALLENGES.

    If those two diverge a route can run the middleware without being
    protected, or be "protected" by middleware that never runs. They
    cannot share a constant: Next statically analyses `config` at build
    time and rejects a computed matcher outright, so the pattern is
    literal there and derived here. This test is the join — it rebuilds
    the expected literal from APP_SEGMENTS and demands the file contain
    exactly that.
    """
    source = _MIDDLEWARE.read_text()
    assert "createRouteMatcher([APP_GROUP])" in source, (
        "isProtected must be built from APP_GROUP, not its own list"
    )

    expected = f'"/({"|".join(sorted(_declared_segments()))})(.*)"'
    matcher = re.search(r"matcher:\s*\[(.*?)\]", source, re.S)
    assert matcher, "middleware.ts no longer declares a config.matcher array"
    assert expected in matcher.group(1), (
        "config.matcher's app-group pattern has drifted from APP_SEGMENTS; "
        f"it must contain exactly {expected}"
    )


def _sign_in_url_constant(source: str) -> str:
    match = re.search(r'const SIGN_IN_URL = ("[^"]+")', source)
    assert match, "middleware.ts must declare const SIGN_IN_URL = \"...\""
    return match.group(1).strip('"')


@pytest.mark.skipif(not _MIDDLEWARE.is_file(), reason="web middleware not present")
def test_signed_out_app_routes_go_to_app_sign_in_not_portal_or_404() -> None:
    """Logged-out /dashboard must go to the *app* /sign-in page.

    Two production failures this pins:

    * ``auth.protect()`` with no unauthenticatedUrl rewrites non-document
      requests to ``/_not-found`` (``x-clerk-auth-reason: protect-rewrite``).
    * ``signInUrl`` pointing at Clerk's Account Portal
      (``https://accounts.…/sign-in``) instead of the in-app ``<SignIn />``.
    """
    source = _MIDDLEWARE.read_text()
    sign_in = _sign_in_url_constant(source)
    assert sign_in == "/sign-in", (
        f"SIGN_IN_URL must be the app path /sign-in, not {sign_in!r} "
        "(Account Portal hosts are owner-configured and 404/challenge)"
    )
    assert sign_in.startswith("/") and "://" not in sign_in
    assert "unauthenticatedUrl" in source
    assert "new URL(SIGN_IN_URL, req.url)" in source, (
        "unauthenticatedUrl must be same-origin from SIGN_IN_URL; a "
        "hardcoded accounts.* URL regresses to the Clerk portal"
    )
    assert "signInUrl: SIGN_IN_URL" in source
    assert "accounts." not in source
    assert '"dashboard"' in source
    sign_in_page = _REPO / "web" / "app" / "sign-in" / "[[...sign-in]]" / "page.tsx"
    assert sign_in_page.is_file(), "app /sign-in page is missing"


def test_library_templates_campaigns_are_protected() -> None:
    """Regression: these three shipped in (app)/ while missing from the
    Clerk allow-list, so the authenticated shell rendered with no session
    and the RSC data fetch ran without a JWT."""
    declared = _declared_segments()
    for segment in ("library", "templates", "campaigns"):
        assert segment in declared, f"{segment} must be in APP_SEGMENTS"
