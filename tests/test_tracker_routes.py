"""Tracker routes: permissions by role through the real app and the one
enforcement point, and the HTTP mapping of service errors (docs/tracker.md).

Allowed means the policy let the request through (the handler then reaches
the stubbed service); denied means 403 with the missing permission."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.auth_helpers import as_role

T = "77777777-7777-7777-7777-777777777777"
R = "88888888-8888-8888-8888-888888888888"
V = "99999999-9999-9999-9999-999999999999"

# (method, path, body, permission)
ROUTES = [
    ("GET", "/api/v1/tracker/tables", None, "content:read"),
    ("GET", "/api/v1/tracker/templates", None, "content:read"),
    ("GET", f"/api/v1/tracker/tables/{T}", None, "content:read"),
    ("GET", f"/api/v1/tracker/tables/{T}/rows", None, "content:read"),
    ("GET", f"/api/v1/tracker/tables/{T}/rows/{R}/history", None, "content:read"),
    ("POST", "/api/v1/tracker/tables", {"name": "Ideas"}, "playbook:create"),
    ("POST", "/api/v1/tracker/tables/from-template", {"template": "ab_tests"}, "playbook:create"),
    ("PATCH", f"/api/v1/tracker/tables/{T}", {"name": "New"}, "playbook:update"),
    ("DELETE", f"/api/v1/tracker/tables/{T}", None, "playbook:delete"),
    ("POST", f"/api/v1/tracker/tables/{T}/fields", {"name": "Owner", "type": "person"}, "playbook:update"),
    ("POST", f"/api/v1/tracker/tables/{T}/views", {"name": "Board", "type": "board"}, "playbook:update"),
    ("PATCH", f"/api/v1/tracker/tables/{T}/views/{V}", {"filter_type": "or"}, "playbook:update"),
    ("POST", f"/api/v1/tracker/tables/{T}/rows", {"values": {"Name": "x"}}, "content:update"),
    ("PATCH", f"/api/v1/tracker/tables/{T}/rows/{R}", {"values": {"Name": "x"}}, "content:update"),
    ("POST", f"/api/v1/tracker/tables/{T}/rows/{R}/move", {"before_id": None}, "content:update"),
    ("DELETE", f"/api/v1/tracker/tables/{T}/rows/{R}", None, "content:delete"),
]

# role → permissions it holds among the ones above
HOLDS = {
    "owner": {"content:read", "content:update", "content:delete", "playbook:create", "playbook:update", "playbook:delete"},
    "admin": {"content:read", "content:update", "content:delete", "playbook:create", "playbook:update", "playbook:delete"},
    "marketer": {"content:read", "content:update", "content:delete", "playbook:create", "playbook:update", "playbook:delete"},
    "analyst": {"content:read"},
    "billing": set(),
}


@pytest.fixture
def audit_rows(monkeypatch):
    from marketer.repos import security_audit

    rows: list[dict] = []

    async def _insert(**kw):
        rows.append(kw)
        return len(rows)

    monkeypatch.setattr(security_audit, "insert", _insert)
    return rows


@pytest.fixture
def calls(monkeypatch):
    """Stub the service: every call is recorded and answers with a small table."""
    from marketer.tracker import service as svc

    seen: list[tuple[str, tuple, dict]] = []

    def stub(name):
        async def _f(*args, **kwargs):
            seen.append((name, args, kwargs))
            if name in ("delete_view", "delete_row"):
                return None
            if name in ("list_tables", "row_history", "members", "search_objects"):
                return []
            if name == "ab_test_table":
                return None
            return {"id": T, "type": "text", "rows": [], "row": {}}

        return _f

    for name in ("list_tables", "create_table", "get_table", "update_table", "delete_table", "create_field",
                 "update_field", "delete_field", "create_view", "update_view", "delete_view", "list_rows", "create_row",
                 "update_row", "move_row", "delete_row", "get_row", "row_history", "members", "search_objects",
                 "create_from_template", "log_ab_test", "ab_test_table"):
        monkeypatch.setattr(svc, name, stub(name))
    return seen


@pytest.fixture
def app(monkeypatch, audit_rows, calls):
    from marketer.config import settings

    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "auth_database_url", "")
    from backend.main import create_app

    a = create_app()
    yield a
    a.dependency_overrides.clear()


def _send(client, method, path, body):
    return client.request(method, path, json=body) if body is not None else client.request(method, path)


@pytest.mark.parametrize("role", list(HOLDS))
def test_routes_by_role(app, role, audit_rows):
    as_role(app, role)
    client = TestClient(app, raise_server_exceptions=False)
    for method, path, body, permission in ROUTES:
        r = _send(client, method, path, body)
        if permission in HOLDS[role]:
            assert r.status_code < 400, (role, method, path, r.text)
        else:
            assert r.status_code == 403, (role, method, path, r.text)
            assert r.json() == {"detail": "forbidden", "permission": permission}
    if role == "billing":
        assert any(row["action"] == "permission.denied" for row in audit_rows)


@pytest.mark.parametrize(
    ("actor_role", "allowed", "denied"),
    [
        # The agent acting for a marketer adds and edits rows and creates tables,
        # but never deletes rows or tables (the agent role has no content:delete or playbook:delete).
        ("marketer", {"content:read", "content:update", "playbook:create", "playbook:update"}, {"content:delete", "playbook:delete"}),
        # For an analyst it can only read.
        ("analyst", {"content:read"}, {"content:update", "content:delete", "playbook:create", "playbook:update", "playbook:delete"}),
    ],
)
def test_agent_is_capped_by_the_person(app, actor_role, allowed, denied):
    as_role(app, "agent", actor_role=actor_role)
    client = TestClient(app, raise_server_exceptions=False)
    for method, path, body, permission in ROUTES:
        r = _send(client, method, path, body)
        if permission in allowed:
            assert r.status_code < 400, (actor_role, method, path, r.text)
        else:
            assert permission in denied
            assert r.status_code == 403, (actor_role, method, path, r.text)


def test_queries_are_scoped_to_the_callers_tenant(app, calls):
    as_role(app, "marketer", user_id="tenant_a")
    client = TestClient(app)
    client.get(f"/api/v1/tracker/tables/{T}/rows?q=x")
    client.post(f"/api/v1/tracker/tables/{T}/rows", json={"values": {}})
    client.get("/api/v1/tracker/tables")
    assert calls and all(args[0] == "tenant_a" for _name, args, _kw in calls)


def test_ab_test_log_needs_playbook_create_only_when_the_log_is_missing(app, calls, monkeypatch):
    from marketer.tracker import service as svc

    # agent ∩ analyst has no content:update at all.
    as_role(app, "agent", actor_role="analyst")
    client = TestClient(app, raise_server_exceptions=False)
    r = client.post("/api/v1/tracker/ab-tests", json={"values": {"Test": "Hook A vs B"}})
    assert r.status_code == 403 and r.json()["permission"] == "content:update"

    # A person with content:update but not playbook:create (a custom set) and no log yet.
    from backend import permissions as perms

    as_role(app, "marketer", permissions=perms.permissions_for("marketer") - {"playbook:create"})
    r = client.post("/api/v1/tracker/ab-tests", json={"values": {"Test": "Hook A vs B"}})
    assert r.status_code == 403 and r.json()["permission"] == "playbook:create"

    async def has_log(_tenant):
        return T

    monkeypatch.setattr(svc, "ab_test_table", has_log)
    r = client.post("/api/v1/tracker/ab-tests", json={"values": {"Test": "Hook A vs B"}})
    assert r.status_code == 201
    assert calls[-1][0] == "log_ab_test" and calls[-1][2]["may_create_table"] is False


def test_object_search_for_campaigns_needs_campaign_read(app):
    from backend import permissions as perms

    as_role(app, "marketer", permissions=perms.permissions_for("marketer") - {"campaign:read"})
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/api/v1/tracker/objects?kind=video").status_code == 200
    r = client.get("/api/v1/tracker/objects?kind=campaign")
    assert r.status_code == 403 and r.json()["permission"] == "campaign:read"


def test_agent_sees_member_names_not_emails(app, monkeypatch):
    from marketer.tracker import service as svc

    async def people(_tenant):
        return [{"id": "p1", "name": "Sam", "email": "sam@x.co"}]

    monkeypatch.setattr(svc, "members", people)
    as_role(app, "agent", actor_role="marketer")
    client = TestClient(app)
    assert client.get("/api/v1/tracker/members").json() == [{"id": "p1", "name": "Sam"}]
    as_role(app, "marketer")
    assert client.get("/api/v1/tracker/members").json()[0]["email"] == "sam@x.co"


def test_service_errors_map_to_http(app, monkeypatch):
    from marketer.tracker import service as svc
    from marketer.tracker.fields import FieldError

    as_role(app, "marketer")
    client = TestClient(app, raise_server_exceptions=False)
    for exc, code in ((svc.NotFound(), 404), (FieldError("Views takes a number"), 422), (svc.LimitReached("too many"), 409)):
        async def boom(*_a, _exc=exc, **_k):
            raise _exc

        monkeypatch.setattr(svc, "create_row", boom)
        r = client.post(f"/api/v1/tracker/tables/{T}/rows", json={"values": {"Views": "x"}})
        assert r.status_code == code
    assert r.json()["detail"] == "too many"
    assert client.get(f"/api/v1/tracker/tables/{T}/rows?filters=not-json").status_code == 422


def test_table_delete_is_audited(app, audit_rows):
    as_role(app, "owner")
    client = TestClient(app)
    assert client.delete(f"/api/v1/tracker/tables/{T}").status_code == 204
    assert any(r["action"] == "tracker.table_deleted" and r["target_id"] == T for r in audit_rows)
