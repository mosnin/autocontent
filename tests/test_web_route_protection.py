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
    decides where it CHALLENGES. If those two lists ever diverge, a route
    can run the middleware without being protected (or be "protected" by
    middleware that never runs) — so both must be built from APP_GROUP."""
    source = _MIDDLEWARE.read_text()
    assert "createRouteMatcher([APP_GROUP])" in source
    assert re.search(r"matcher:\s*\[\s*APP_GROUP", source)
