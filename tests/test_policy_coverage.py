"""Every registered route is classified in backend/policy.py, and every table
entry still matches a route. A new route cannot ship unclassified."""
from __future__ import annotations

import pytest

from backend import permissions as perms
from backend import policy


@pytest.fixture(scope="module")
def app():
    from backend.main import create_app

    return create_app()


def _registered(app) -> set[tuple[str, str]]:
    return {(m, p) for m, p, _route in policy.iter_routes(app)}


def test_every_route_is_classified(app):
    missing = sorted(f"{m} {p}" for m, p in _registered(app) if policy.entry_for(m, p) is None)
    assert missing == [], f"classify these routes in backend/policy.py: {missing}"


def test_no_stale_entries(app):
    registered = _registered(app)
    stale = sorted(
        f"{m} {p}" for m, p in list(policy.POLICY) + list(policy.STATIC_ROUTES)
        if (m, p) not in registered
    )
    assert stale == [], f"remove or fix these entries in backend/policy.py: {stale}"


def test_route_count_is_what_we_reviewed(app):
    api = [(m, p) for m, p in _registered(app) if (m, p) in policy.POLICY]
    assert len(api) == len(policy.POLICY)
    assert len(api) >= 135


def test_every_entry_is_valid():
    for key, entry in policy.POLICY.items():
        if isinstance(entry, str):
            assert perms.is_permission(entry), key
        elif isinstance(entry, policy.InRoute):
            assert entry.any_of and all(perms.is_permission(p) for p in entry.any_of), key
        else:
            assert entry in (policy.PUBLIC, policy.AUTHENTICATED, policy.PLATFORM_ADMIN), key


def test_public_routes_are_the_known_few():
    public = sorted(k for k, v in policy.POLICY.items() if v is policy.PUBLIC)
    assert public == sorted([
        ("GET", "/healthz"),
        ("GET", "/healthz/deep"),
        ("POST", "/api/v1/billing/webhook"),
        ("POST", "/api/v1/webhooks/ayrshare"),
    ])


def test_admin_and_ops_are_platform_admin():
    for (method, path), entry in policy.POLICY.items():
        if path.startswith(("/api/v1/admin", "/api/v1/ops")):
            assert entry is policy.PLATFORM_ADMIN, (method, path)


def test_every_route_runs_the_enforcement_point(app):
    """The policy dependency is mounted on every API route."""
    from fastapi.routing import APIRoute, iter_route_contexts

    for rc in iter_route_contexts(app.routes):
        route = rc.original_route
        if not isinstance(route, APIRoute):
            continue
        calls = {d.call for d in getattr(rc, "dependant").dependencies}
        assert policy.enforce_policy in calls, rc.path_format


def test_index_covers_every_route(app):
    index = app.state.policy_index
    for method, _path, route in policy.iter_routes(app):
        assert (method, id(route)) in index


def test_unclassified_route_is_refused(app, monkeypatch):
    """Fail closed: a route missing from the index answers 403."""
    from fastapi.testclient import TestClient

    from tests.auth_helpers import as_role

    as_role(app, "owner")
    monkeypatch.setattr(app.state, "policy_index", {})
    try:
        r = TestClient(app).get("/api/v1/jobs")
        assert r.status_code == 403
        assert r.json() == {"detail": "forbidden", "permission": "unclassified"}
    finally:
        app.dependency_overrides.clear()
