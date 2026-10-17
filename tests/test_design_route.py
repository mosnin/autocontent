"""Route-level tests for /api/v1/design.

Repos and the Modal spawn are monkeypatched; auth is bypassed via
dependency_overrides. Covers the paid-spawn contract: foreign niches
never enqueue, unbilled generate 402s before a row exists, and retry /
step-retry claims are single-use so a double-click cannot double-spend.
"""
from __future__ import annotations

from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.design.plan import DesignPlan, PlanStep, StepInputs
from marketer.repos import design_projects as projects_repo
from marketer.repos import niches as niches_repo

USER = "user_design"
AUTH = {"Authorization": "Bearer mkt_x"}
NICHE_ID = UUID("00000000-0000-0000-0000-000000000021")


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id=USER, email="u@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _plan() -> dict:
    return DesignPlan(
        title="hero",
        format="1:1",
        steps=[
            PlanStep(
                index=0,
                id="hero_plate",
                operation="generate",
                label="hero",
                inputs=StepInputs(prompt="a product on marble"),
                status="done",
                output_path="/tmp/hero.png",
            )
        ],
    ).model_dump()


class FakeStore:
    def __init__(self) -> None:
        self.rows: dict[UUID, dict] = {}

    def seed(self, **over) -> dict:
        row = {
            "id": uuid4(),
            "user_id": USER,
            "niche_id": NICHE_ID,
            "brief": "Launch kit",
            "format": "1:1",
            "max_steps": 8,
            "status": "queued",
            "plan": None,
            "error": None,
        }
        row.update(over)
        self.rows[row["id"]] = row
        return row


def _env(monkeypatch):
    store = FakeStore()
    spawns: list[tuple] = []

    async def fake_create(**kw):
        return store.seed(
            brief=kw["brief"],
            niche_id=kw["niche_id"],
            user_id=kw["user_id"],
            format=kw.get("fmt", "1:1"),
            max_steps=kw.get("max_steps", 8),
        )

    async def fake_get(project_id, *, user_id):
        row = store.rows.get(project_id)
        return row if row and row["user_id"] == user_id else None

    async def fake_claim_retry(project_id, *, user_id):
        row = store.rows.get(project_id)
        if not row or row["user_id"] != user_id or row["status"] != "failed":
            return False
        row.update(status="queued", error=None)
        return True

    async def fake_claim_step(project_id, *, user_id, plan):
        row = store.rows.get(project_id)
        if not row or row["user_id"] != user_id or row["status"] not in {"done", "failed"}:
            return False
        row.update(status="queued", plan=plan, error=None)
        return True

    monkeypatch.setattr(projects_repo, "create", fake_create)
    monkeypatch.setattr(projects_repo, "get", fake_get)
    monkeypatch.setattr(projects_repo, "claim_for_retry", fake_claim_retry)
    monkeypatch.setattr(projects_repo, "claim_step_retry", fake_claim_step)

    async def fake_niche(niche_id, *, user_id):
        return object() if niche_id == NICHE_ID else None

    monkeypatch.setattr(niches_repo, "get", fake_niche)

    from backend.routes import design as design_routes

    monkeypatch.setattr(
        design_routes,
        "_spawn",
        lambda user_id, project_id, from_step_id="": spawns.append(
            (user_id, project_id, from_step_id)
        ),
    )
    return {"store": store, "spawns": spawns}


def test_create_for_a_foreign_niche_is_404(monkeypatch):
    _reset_limiter()
    env = _env(monkeypatch)
    resp = _client(monkeypatch).post(
        "/api/v1/design/projects",
        json={"niche_id": str(uuid4()), "brief": "Launch kit"},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert "niche" in resp.json()["detail"]
    assert env["spawns"] == []
    assert env["store"].rows == {}


def test_create_refuses_when_unbilled_usage_disabled(monkeypatch):
    _reset_limiter()
    env = _env(monkeypatch)
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)
    resp = _client(monkeypatch).post(
        "/api/v1/design/projects",
        json={"niche_id": str(NICHE_ID), "brief": "Launch kit"},
        headers=AUTH,
    )
    assert resp.status_code == 402
    assert "unbilled" in resp.json()["detail"]
    assert env["spawns"] == []
    assert env["store"].rows == {}


def test_retry_claims_a_failed_project_exactly_once(monkeypatch):
    _reset_limiter()
    env = _env(monkeypatch)
    row = env["store"].seed(status="failed", error="boom")
    client = _client(monkeypatch)

    first = client.post(f"/api/v1/design/projects/{row['id']}/retry", headers=AUTH)
    assert first.status_code == 202
    assert first.json() == {"status": "queued"}

    second = client.post(f"/api/v1/design/projects/{row['id']}/retry", headers=AUTH)
    assert second.status_code == 409
    assert env["spawns"] == [(USER, row["id"], "")]


def test_step_retry_claims_a_done_project_exactly_once(monkeypatch):
    """Two clicks on a finished step must not spawn two paid re-renders."""
    _reset_limiter()
    env = _env(monkeypatch)
    row = env["store"].seed(status="done", plan=_plan())
    client = _client(monkeypatch)
    path = f"/api/v1/design/projects/{row['id']}/steps/hero_plate/retry"

    first = client.post(path, headers=AUTH)
    assert first.status_code == 202
    assert first.json() == {"status": "queued", "from_step": "hero_plate"}

    second = client.post(path, headers=AUTH)
    assert second.status_code == 409
    assert env["spawns"] == [(USER, row["id"], "hero_plate")]


def test_step_retry_conflicts_when_project_is_still_running(monkeypatch):
    """A running project must not accept a second step retry (double spend)."""
    _reset_limiter()
    env = _env(monkeypatch)
    row = env["store"].seed(status="running", plan=_plan())
    resp = _client(monkeypatch).post(
        f"/api/v1/design/projects/{row['id']}/steps/hero_plate/retry",
        headers=AUTH,
    )
    assert resp.status_code == 409
    assert "retry a step only when done or failed" in resp.json()["detail"]
    assert env["spawns"] == []


def test_step_retry_of_a_foreign_project_is_404(monkeypatch):
    _reset_limiter()
    env = _env(monkeypatch)
    row = env["store"].seed(user_id="someone_else", status="done", plan=_plan())
    resp = _client(monkeypatch).post(
        f"/api/v1/design/projects/{row['id']}/steps/hero_plate/retry",
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert env["spawns"] == []
