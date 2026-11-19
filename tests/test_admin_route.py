"""Admin API: RBAC gate, audit recording, and cross-tenant ops."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient

from marketer.models import User
from marketer.repos.admin import AdminUserRow, PlatformOverview

_ADMIN_ID = "user_admin_1"
_TARGET_ID = "user_target_9"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_client(
    monkeypatch, *, role: str = "admin", suspended: bool = False, two_factor: bool = True
) -> TestClient:
    """A platform admin signs in with the session JWT; the identity query is
    stubbed so require_admin's real checks (role, two-factor, ban) run.
    ``suspended`` now means a banned person (tenant suspension is a
    workspace matter and does not apply to platform routes)."""
    from marketer.config import settings
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from marketer.repos import auth_identity
    from tests.auth_helpers import JwtKit, session_identity

    kit = JwtKit.install(monkeypatch)

    async def _session(sid, sub, org):
        return session_identity(
            person_id=sub, email="admin@marketer.sh", platform_role=role,
            two_factor_enabled=two_factor, banned=suspended,
        )

    monkeypatch.setattr(auth_identity, "session_identity", _session)
    _H["Authorization"] = f"Bearer {kit.mint(sub=_ADMIN_ID)}"

    # Silence the audit writer (no DB).
    import marketer.repos.admin_audit as audit_repo
    recorded: list[dict] = []

    async def _record(**kw):
        recorded.append(kw)

    monkeypatch.setattr(audit_repo, "record", _record)

    from backend.main import create_app
    app = create_app()
    client = TestClient(app, raise_server_exceptions=False)
    client._recorded = recorded  # type: ignore[attr-defined]
    return client


_H: dict[str, str] = {}  # set by _make_client to a freshly minted JWT


def test_non_admin_gets_403(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch, role="user")
    resp = client.get("/api/v1/admin/overview", headers=_H)
    assert resp.status_code == 403


def test_suspended_admin_blocked(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch, role="admin", suspended=True)
    resp = client.get("/api/v1/admin/overview", headers=_H)
    assert resp.status_code == 403


def test_admin_without_two_factor_gets_403(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch, role="admin", two_factor=False)
    resp = client.get("/api/v1/admin/overview", headers=_H)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "admin_requires_two_factor"


def test_personal_token_never_reaches_admin(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch)
    resp = client.get("/api/v1/admin/overview", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 403


def test_missing_bearer_401(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch)
    resp = client.get("/api/v1/admin/overview")
    assert resp.status_code == 401


def test_overview_ok_and_audited(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch)
    import marketer.repos.admin as admin_repo

    async def _overview():
        return PlatformOverview(
            total_users=10, admin_users=1, suspended_users=0, new_users_7d=3,
            total_niches=5, total_jobs=20, jobs_24h=4, failed_jobs_24h=1,
            total_articles=8, articles_24h=2, spend_today_usd=Decimal("1.50"),
            spend_30d_usd=Decimal("42.00"), credit_liability_usd=Decimal("120.00"),
        )

    monkeypatch.setattr(admin_repo, "overview", _overview)
    resp = client.get("/api/v1/admin/overview", headers=_H)
    assert resp.status_code == 200
    assert resp.json()["total_users"] == 10
    assert any(r["action"] == "overview.view" for r in client._recorded)


def test_suspend_records_audit_with_actor_and_target(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch)
    import marketer.repos.admin as admin_repo

    async def _set_suspended(uid, *, suspended, reason=None):
        return True

    async def _get_user(uid):
        return AdminUserRow(
            user=User(id=uid, email="t@t.com", created_at=datetime.now(timezone.utc)),
            niche_count=0, job_count=0, article_count=0, spend_total_usd=Decimal("0"),
        )

    monkeypatch.setattr(admin_repo, "set_suspended", _set_suspended)
    monkeypatch.setattr(admin_repo, "get_user", _get_user)
    resp = client.post(
        f"/api/v1/admin/users/{_TARGET_ID}/suspension",
        json={"suspended": True, "reason": "abuse"}, headers=_H,
    )
    assert resp.status_code == 200
    entry = next(r for r in client._recorded if r["action"] == "user.suspend")
    assert entry["actor_id"] == _ADMIN_ID
    assert entry["target_id"] == _TARGET_ID
    assert entry["metadata"]["reason"] == "abuse"


def test_cannot_suspend_self(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch)
    resp = client.post(
        f"/api/v1/admin/users/{_ADMIN_ID}/suspension",
        json={"suspended": True}, headers=_H,
    )
    assert resp.status_code == 400


def test_grant_credits_rejects_nonpositive(monkeypatch):
    _reset_limiter()
    client = _make_client(monkeypatch)
    resp = client.post(
        f"/api/v1/admin/users/{_TARGET_ID}/credits",
        json={"amount_usd": "0"}, headers=_H,
    )
    assert resp.status_code == 422
