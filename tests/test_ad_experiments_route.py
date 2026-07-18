"""Route-level tests for /api/v1/ads/experiments. Mounts ONLY the
experiments router in a minimal FastAPI app (rather than backend.main.
create_app(), which bundles every other team's routers and would couple
these tests to unrelated, concurrently-changing files) with auth bypassed
via dependency_overrides — the same require_user object backend/auth.py
defines, so the override applies regardless of which router uses it.

marketer.services.ad_experiments and marketer.repos.ad_experiments are
monkeypatched so these tests exercise routing/validation/error-mapping only,
independent of the DB (that's covered by tests/test_ad_experiments_pg.py)."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(monkeypatch) -> TestClient:
    from backend.auth import AuthCtx, require_user
    from backend.routes import experiments

    async def _fake():
        return AuthCtx(user_id="user_exp", email="a@t.com")

    app = FastAPI()
    app.include_router(experiments.router, prefix="/api/v1/ads/experiments")
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _mk_experiment(**kw):
    from marketer.repos.ad_experiments import AdExperiment

    base = dict(
        id=uuid4(), user_id="user_exp", campaign_id=uuid4(), kind="budget_ramp",
        status="draft", config={}, result={}, created_at=datetime.now(timezone.utc),
        started_at=None, completed_at=None,
    )
    base.update(kw)
    return AdExperiment(**base)


def _mk_arm(**kw):
    from marketer.repos.ad_experiments import AdExperimentArm

    base = dict(
        id=uuid4(), experiment_id=uuid4(), creative_id=uuid4(), label="A",
        metrics={}, is_winner=False, created_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdExperimentArm(**base)


HEADERS = {"Authorization": "Bearer mkt_x"}


# --------------------------------------------------------------------------- create

def test_create_experiment_success(monkeypatch):
    from marketer.services import ad_experiments as svc

    exp = _mk_experiment(kind="budget_ramp")

    async def _create(*, user_id, campaign_id, kind, config):
        assert user_id == "user_exp"
        return exp

    monkeypatch.setattr(svc, "create_experiment", _create)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/ads/experiments",
        json={"campaign_id": str(exp.campaign_id), "kind": "budget_ramp",
              "config": {"target_daily_usd": 100, "step_pct": 10, "interval_days": 1}},
        headers=HEADERS,
    )
    assert resp.status_code == 201
    assert resp.json()["id"] == str(exp.id)


def test_create_experiment_bad_config_returns_422(monkeypatch):
    from marketer.services import ad_experiments as svc

    async def _create(*, user_id, campaign_id, kind, config):
        raise svc.ExperimentConfigError("step_pct must be > 0 and <= 20")

    monkeypatch.setattr(svc, "create_experiment", _create)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/ads/experiments",
        json={"campaign_id": str(uuid4()), "kind": "budget_ramp",
              "config": {"target_daily_usd": 100, "step_pct": 99, "interval_days": 1}},
        headers=HEADERS,
    )
    assert resp.status_code == 422
    assert "step_pct" in resp.json()["detail"]


def test_create_experiment_missing_campaign_returns_404(monkeypatch):
    from marketer.services import ad_experiments as svc

    async def _create(*, user_id, campaign_id, kind, config):
        raise svc.ExperimentNotFound("campaign not found")

    monkeypatch.setattr(svc, "create_experiment", _create)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/ads/experiments",
        json={"campaign_id": str(uuid4()), "kind": "budget_ramp", "config": {}},
        headers=HEADERS,
    )
    assert resp.status_code == 404


# --------------------------------------------------------------------------- list / get

def test_list_experiments_filters_by_campaign(monkeypatch):
    from marketer.repos import ad_experiments as experiments_repo

    exp = _mk_experiment()
    captured = {}

    async def _list(user_id, *, campaign_id=None, limit=100):
        captured["campaign_id"] = campaign_id
        return [exp]

    monkeypatch.setattr(experiments_repo, "list_experiments", _list)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/ads/experiments?campaign_id={exp.campaign_id}", headers=HEADERS,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert captured["campaign_id"] == exp.campaign_id


def test_get_experiment_not_found_returns_404(monkeypatch):
    from marketer.repos import ad_experiments as experiments_repo

    async def _get(experiment_id, *, user_id):
        return None

    monkeypatch.setattr(experiments_repo, "get_experiment", _get)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/ads/experiments/{uuid4()}", headers=HEADERS)
    assert resp.status_code == 404


def test_get_experiment_includes_arms(monkeypatch):
    from marketer.repos import ad_experiments as experiments_repo

    exp = _mk_experiment(kind="creative_ab")
    arm = _mk_arm(experiment_id=exp.id)

    async def _get(experiment_id, *, user_id):
        return exp if experiment_id == exp.id else None

    async def _arms(experiment_id):
        return [arm]

    monkeypatch.setattr(experiments_repo, "get_experiment", _get)
    monkeypatch.setattr(experiments_repo, "list_arms", _arms)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/ads/experiments/{exp.id}", headers=HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["experiment"]["id"] == str(exp.id)
    assert body["arms"][0]["id"] == str(arm.id)


# --------------------------------------------------------------------------- start / advance / evaluate / cancel

def test_start_not_found_returns_404(monkeypatch):
    from marketer.services import ad_experiments as svc

    async def _start(experiment_id, *, user_id):
        raise svc.ExperimentNotFound("experiment not found")

    monkeypatch.setattr(svc, "start", _start)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{uuid4()}/start", headers=HEADERS)
    assert resp.status_code == 404


def test_start_conflict_returns_409(monkeypatch):
    from marketer.services import ad_experiments as svc

    async def _start(experiment_id, *, user_id):
        raise svc.ExperimentStateError("campaign must be active to start an experiment")

    monkeypatch.setattr(svc, "start", _start)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{uuid4()}/start", headers=HEADERS)
    assert resp.status_code == 409


def test_advance_wrong_kind_returns_409(monkeypatch):
    from marketer.services import ad_experiments as svc

    async def _advance(experiment_id, *, user_id):
        raise svc.ExperimentStateError("advance() only applies to budget_ramp experiments")

    monkeypatch.setattr(svc, "advance", _advance)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{uuid4()}/advance", headers=HEADERS)
    assert resp.status_code == 409


def test_advance_denied_returns_402(monkeypatch):
    """Belt-and-suspenders: even though svc.advance() is designed to catch
    AdSpendDenied internally and cancel the ramp rather than raise, the route
    still maps it to 402 consistent with routes/ads.py, in case a caller of
    the service ever surfaces it directly."""
    from marketer.services import ad_experiments as svc
    from marketer.services.ad_actions_exec import AdSpendDenied

    async def _advance(experiment_id, *, user_id):
        raise AdSpendDenied("account kill-switch is engaged")

    monkeypatch.setattr(svc, "advance", _advance)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{uuid4()}/advance", headers=HEADERS)
    assert resp.status_code == 402


def test_advance_success_returns_experiment(monkeypatch):
    from marketer.services import ad_experiments as svc

    exp = _mk_experiment(kind="budget_ramp", status="running")

    async def _advance(experiment_id, *, user_id):
        return exp

    monkeypatch.setattr(svc, "advance", _advance)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{exp.id}/advance", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["status"] == "running"


def test_evaluate_wrong_kind_returns_409(monkeypatch):
    from marketer.services import ad_experiments as svc

    async def _evaluate(experiment_id, *, user_id):
        raise svc.ExperimentStateError("evaluate() only applies to creative_ab experiments")

    monkeypatch.setattr(svc, "evaluate", _evaluate)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{uuid4()}/evaluate", headers=HEADERS)
    assert resp.status_code == 409


def test_evaluate_success_returns_experiment(monkeypatch):
    from marketer.services import ad_experiments as svc

    exp = _mk_experiment(kind="creative_ab", status="completed",
                          result={"winner_arm_id": str(uuid4())})

    async def _evaluate(experiment_id, *, user_id):
        return exp

    monkeypatch.setattr(svc, "evaluate", _evaluate)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{exp.id}/evaluate", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


def test_cancel_not_found_returns_404(monkeypatch):
    from marketer.services import ad_experiments as svc

    async def _cancel(experiment_id, *, user_id):
        raise svc.ExperimentNotFound("experiment not found")

    monkeypatch.setattr(svc, "cancel", _cancel)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{uuid4()}/cancel", headers=HEADERS)
    assert resp.status_code == 404


def test_cancel_success(monkeypatch):
    from marketer.services import ad_experiments as svc

    exp = _mk_experiment(status="cancelled")

    async def _cancel(experiment_id, *, user_id):
        return exp

    monkeypatch.setattr(svc, "cancel", _cancel)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/ads/experiments/{exp.id}/cancel", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"
