"""GET/PUT /api/v1/observability/settings (docs/observability/braintrust.md).

- GET: every member and the agent; a database error is 503 (the agent reads
  that as metadata), never a guess;
- PUT: security:manage and a person; the agent and personal access tokens are
  refused; denials and changes are audited (observability.settings_changed);
- only 'redacted' or 'metadata'; the change applies in this process at once.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from marketer.observability import context as obs_context
from marketer.repos import observability as repo
from tests.auth_helpers import DEFAULT_TENANT, as_role

URL = "/api/v1/observability/settings"


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
def state(monkeypatch):
    st = {"content": "redacted", "fail": False}

    async def get_setting(tenant_id):
        if st["fail"]:
            raise RuntimeError("db down")
        return repo.Setting(st["content"] if tenant_id == DEFAULT_TENANT else "redacted", None)

    async def set_setting(tenant_id, content):
        if st["fail"]:
            raise RuntimeError("db down")
        st["content"] = content
        return repo.Setting(content, datetime(2026, 11, 20, tzinfo=timezone.utc))

    monkeypatch.setattr(repo, "get_setting", get_setting)
    monkeypatch.setattr(repo, "set_setting", set_setting)
    obs_context.forget_cache()
    yield st
    obs_context.forget_cache()


@pytest.fixture
def app(monkeypatch, audit_rows, state):
    from marketer.config import settings

    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "auth_database_url", "")
    from backend.main import create_app
    from backend.rate_limit import limiter

    monkeypatch.setattr(limiter, "enabled", False)
    a = create_app()
    yield a
    a.dependency_overrides.clear()


def _c(app):
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("role", ["owner", "admin", "marketer", "analyst", "billing"])
def test_every_member_reads(app, role, state):
    state["content"] = "metadata"
    as_role(app, role)
    r = _c(app).get(URL)
    assert r.status_code == 200 and r.json()["content"] == "metadata"


def test_agent_reads(app):
    as_role(app, "agent", actor_role="analyst")
    r = _c(app).get(URL)
    assert r.status_code == 200 and r.json() == {"content": "redacted", "updated_at": None}


def test_unreadable_is_503(app, state):
    state["fail"] = True
    as_role(app, "analyst")
    assert _c(app).get(URL).status_code == 503


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_security_manage_changes_it_and_is_audited(app, role, audit_rows, state):
    ctx = as_role(app, role)
    r = _c(app).put(URL, json={"content": "metadata"})
    assert r.status_code == 200 and r.json()["content"] == "metadata"
    assert state["content"] == "metadata"
    (row,) = [x for x in audit_rows if x["action"] == "observability.settings_changed"]
    assert row["outcome"] == "success" and row["tenant_id"] == DEFAULT_TENANT and row["actor_id"] == ctx.actor_id
    assert row["metadata"] == {"content": "metadata", "previous": "redacted"}
    # In effect in this process at once.
    assert obs_context.cached_mode(DEFAULT_TENANT) == "metadata"


@pytest.mark.parametrize("role", ["marketer", "analyst", "billing"])
def test_others_are_refused_and_audited(app, role, audit_rows, state):
    as_role(app, role)
    r = _c(app).put(URL, json={"content": "metadata"})
    assert r.status_code == 403 and r.json() == {"detail": "forbidden", "permission": "security:manage"}
    assert state["content"] == "redacted"
    assert any(x["action"] == "permission.denied" for x in audit_rows)
    assert not any(x["action"] == "observability.settings_changed" for x in audit_rows)


def test_agent_cannot_change_it_even_for_an_owner(app, state):
    as_role(app, "agent", actor_role="owner", permissions=frozenset({"security:manage", "agent:chat"}))
    assert _c(app).put(URL, json={"content": "metadata"}).status_code == 403
    assert state["content"] == "redacted"


def test_personal_access_token_cannot_change_it(app, state):
    as_role(app, "owner", actor_type="token")
    assert _c(app).put(URL, json={"content": "metadata"}).status_code == 403
    assert state["content"] == "redacted"


@pytest.mark.parametrize("body", [{"content": "full"}, {"content": ""}, {}, {"content": "metadata", "extra": 1}])
def test_only_the_two_values(app, body):
    as_role(app, "owner")
    assert _c(app).put(URL, json=body).status_code == 422


def test_write_failure_is_503(app, state, audit_rows):
    as_role(app, "owner")
    state["fail"] = True
    assert _c(app).put(URL, json={"content": "metadata"}).status_code == 503
    assert not any(x["action"] == "observability.settings_changed" for x in audit_rows)
