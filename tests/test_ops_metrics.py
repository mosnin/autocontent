"""Tests for the ops-visibility surface: the metrics service composition
(mocked repo) and the admin-gated /api/v1/ops route (mocked service)."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from marketer.repos.metrics import (
    ProviderErrorRate,
    ProviderSpend,
    SpendVelocity,
    StuckWork,
    TopSku,
)
from marketer.services import metrics as metrics_service

_ADMIN_ID = "user_admin_1"


# --------------------------------------------------------------------------- service composition


@pytest.fixture
def _mock_repo(monkeypatch):
    """Patch every marketer.repos.metrics function the service calls."""
    from marketer.repos import metrics as metrics_repo

    async def _spend_velocity(window_minutes: int) -> SpendVelocity:
        if window_minutes == 60:
            by_provider = [ProviderSpend(provider="openai", cost_usd=Decimal("3.50"), units=Decimal("10"))]
        else:
            by_provider = [
                ProviderSpend(provider="openai", cost_usd=Decimal("40.00"), units=Decimal("120")),
                ProviderSpend(provider="xai", cost_usd=Decimal("15.25"), units=Decimal("30")),
            ]
        return SpendVelocity(
            window_minutes=window_minutes,
            total_usd=sum((p.cost_usd for p in by_provider), Decimal(0)),
            by_provider=by_provider,
        )

    async def _provider_error_rates(window_minutes: int) -> list[ProviderErrorRate]:
        return [
            ProviderErrorRate(provider="openai", total=100, failed=5),   # 5% — healthy
            ProviderErrorRate(provider="xai", total=20, failed=8),       # 40% — should WARN
            ProviderErrorRate(provider="idle", total=0, failed=0),       # no traffic
        ]

    async def _stuck_work(stuck_after_minutes: int) -> StuckWork:
        return StuckWork(
            stuck_after_minutes=stuck_after_minutes,
            jobs_stuck=3,
            jobs_oldest_stuck_seconds=9000,
            image_posts_stuck=0,
            image_posts_oldest_stuck_seconds=None,
            jobs_awaiting_approval=2,
            image_posts_awaiting_approval=1,
        )

    async def _top_skus(window_minutes: int, limit: int = 10) -> list[TopSku]:
        return [TopSku(provider="openai", sku="dalle3", cost_usd=Decimal("30.00"), units=Decimal("60"))]

    async def _db_ok() -> bool:
        return True

    monkeypatch.setattr(metrics_repo, "spend_velocity", _spend_velocity)
    monkeypatch.setattr(metrics_repo, "provider_error_rates", _provider_error_rates)
    monkeypatch.setattr(metrics_repo, "stuck_work", _stuck_work)
    monkeypatch.setattr(metrics_repo, "top_skus", _top_skus)
    monkeypatch.setattr(metrics_repo, "db_ok", _db_ok)
    return metrics_repo


async def test_snapshot_composes_spend_velocity(_mock_repo):
    snap = await metrics_service.get_ops_snapshot()
    assert snap.spend_1h.total_usd == Decimal("3.50")
    assert snap.spend_24h.total_usd == Decimal("55.25")
    assert snap.spend_24h.by_provider[0].provider == "openai"


async def test_snapshot_flags_provider_over_threshold(_mock_repo):
    snap = await metrics_service.get_ops_snapshot(error_rate_warn=0.15)
    by_provider = {r.provider: r for r in snap.provider_error_rates}
    assert by_provider["openai"].warn is False
    assert by_provider["xai"].warn is True
    assert by_provider["xai"].error_rate == pytest.approx(0.4)
    # zero-traffic provider never warns even if error_rate defaults to 0
    assert by_provider["idle"].warn is False
    assert snap.any_provider_warn is True


async def test_snapshot_flags_stuck_work(_mock_repo):
    snap = await metrics_service.get_ops_snapshot()
    assert snap.stuck.jobs_stuck == 3
    assert snap.any_stuck is True
    # awaiting_approval is surfaced but does not count as "stuck"
    assert snap.stuck.jobs_awaiting_approval == 2


async def test_snapshot_no_stuck_work_is_not_flagged(monkeypatch, _mock_repo):
    from marketer.repos import metrics as metrics_repo

    async def _no_stuck(stuck_after_minutes: int) -> StuckWork:
        return StuckWork(
            stuck_after_minutes=stuck_after_minutes,
            jobs_stuck=0, jobs_oldest_stuck_seconds=None,
            image_posts_stuck=0, image_posts_oldest_stuck_seconds=None,
            jobs_awaiting_approval=0, image_posts_awaiting_approval=0,
        )

    monkeypatch.setattr(metrics_repo, "stuck_work", _no_stuck)
    snap = await metrics_service.get_ops_snapshot()
    assert snap.any_stuck is False


async def test_snapshot_carries_top_skus_and_thresholds(_mock_repo):
    snap = await metrics_service.get_ops_snapshot(stuck_after_minutes=90, error_rate_warn=0.5)
    assert snap.top_skus[0].sku == "dalle3"
    assert snap.thresholds.stuck_after_minutes == 90
    assert snap.thresholds.error_rate_warn == 0.5
    assert isinstance(snap.generated_at, datetime)
    assert snap.db_ok is True


async def test_snapshot_otel_emission_is_a_noop_by_default(_mock_repo):
    """OTEL isn't configured in tests (no OTLP endpoint) — emitting must
    never raise, and the snapshot must still be returned normally."""
    snap = await metrics_service.get_ops_snapshot()
    assert snap is not None


# --------------------------------------------------------------------------- route


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_ops_client(monkeypatch, *, role: str = "admin", suspended: bool = False) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    import marketer.repos.users as users_repo
    from marketer.models import User

    async def _get(uid):
        return User(
            id=_ADMIN_ID, email="admin@marketer.sh", role=role,
            suspended_at=datetime.now(timezone.utc) if suspended else None,
            created_at=datetime.now(timezone.utc),
        )

    async def _upsert(uid, email):
        return await _get(uid)

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(users_repo, "upsert", _upsert)

    import marketer.repos.tokens as tokens_repo
    from types import SimpleNamespace

    async def _get_by_token(tok):
        return SimpleNamespace(user_id=_ADMIN_ID)

    monkeypatch.setattr(tokens_repo, "get_by_token", _get_by_token)

    # Standalone app mounting just the ops router — main.py wiring is done
    # by the orchestrator separately; this test only needs the router +
    # auth dependency to behave exactly as they will once wired.
    from backend.routes import ops

    app = FastAPI()
    app.include_router(ops.router, prefix="/api/v1/ops")
    return TestClient(app, raise_server_exceptions=False)


_H = {"Authorization": "Bearer mkt_adminbearertoken"}


def test_ops_metrics_requires_admin_403(monkeypatch):
    _reset_limiter()
    client = _make_ops_client(monkeypatch, role="user")
    resp = client.get("/api/v1/ops/metrics", headers=_H)
    assert resp.status_code == 403


def test_ops_metrics_missing_bearer_401(monkeypatch):
    _reset_limiter()
    client = _make_ops_client(monkeypatch)
    resp = client.get("/api/v1/ops/metrics")
    assert resp.status_code == 401


def test_ops_metrics_suspended_admin_403(monkeypatch):
    _reset_limiter()
    client = _make_ops_client(monkeypatch, suspended=True)
    resp = client.get("/api/v1/ops/metrics", headers=_H)
    assert resp.status_code == 403


def test_ops_metrics_ok_returns_snapshot_shape(monkeypatch):
    _reset_limiter()
    client = _make_ops_client(monkeypatch)

    async def _fake_snapshot(**kwargs):
        return metrics_service.OpsSnapshot(
            generated_at=datetime.now(timezone.utc),
            db_ok=True,
            thresholds=metrics_service.OpsThresholds(error_rate_warn=0.15, stuck_after_minutes=120),
            spend_1h=SpendVelocity(window_minutes=60, total_usd=Decimal("1.00"), by_provider=[]),
            spend_24h=SpendVelocity(window_minutes=1440, total_usd=Decimal("10.00"), by_provider=[]),
            provider_error_rates=[],
            error_window_minutes=1440,
            stuck=StuckWork(
                stuck_after_minutes=120, jobs_stuck=0, jobs_oldest_stuck_seconds=None,
                image_posts_stuck=0, image_posts_oldest_stuck_seconds=None,
                jobs_awaiting_approval=0, image_posts_awaiting_approval=0,
            ),
            top_skus=[],
            any_provider_warn=False,
            any_stuck=False,
        )

    monkeypatch.setattr(metrics_service, "get_ops_snapshot", _fake_snapshot)
    resp = client.get("/api/v1/ops/metrics", headers=_H)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) >= {
        "generated_at", "db_ok", "thresholds", "spend_1h", "spend_24h",
        "provider_error_rates", "stuck", "top_skus", "any_provider_warn", "any_stuck",
    }
    assert body["spend_24h"]["total_usd"] == "10.00"


def test_ops_metrics_query_params_forwarded(monkeypatch):
    _reset_limiter()
    client = _make_ops_client(monkeypatch)

    captured = {}

    async def _fake_snapshot(*, error_window_minutes, stuck_after_minutes):
        captured["error_window_minutes"] = error_window_minutes
        captured["stuck_after_minutes"] = stuck_after_minutes
        return metrics_service.OpsSnapshot(
            generated_at=datetime.now(timezone.utc),
            db_ok=True,
            thresholds=metrics_service.OpsThresholds(error_rate_warn=0.15, stuck_after_minutes=stuck_after_minutes),
            spend_1h=SpendVelocity(window_minutes=60, total_usd=Decimal("0"), by_provider=[]),
            spend_24h=SpendVelocity(window_minutes=error_window_minutes, total_usd=Decimal("0"), by_provider=[]),
            provider_error_rates=[],
            error_window_minutes=error_window_minutes,
            stuck=StuckWork(
                stuck_after_minutes=stuck_after_minutes, jobs_stuck=0, jobs_oldest_stuck_seconds=None,
                image_posts_stuck=0, image_posts_oldest_stuck_seconds=None,
                jobs_awaiting_approval=0, image_posts_awaiting_approval=0,
            ),
            top_skus=[],
            any_provider_warn=False,
            any_stuck=False,
        )

    monkeypatch.setattr(metrics_service, "get_ops_snapshot", _fake_snapshot)
    resp = client.get(
        "/api/v1/ops/metrics?error_window_minutes=60&stuck_after_minutes=30", headers=_H
    )
    assert resp.status_code == 200
    assert captured == {"error_window_minutes": 60, "stuck_after_minutes": 30}


def test_config_health_requires_admin_403(monkeypatch):
    _reset_limiter()
    client = _make_ops_client(monkeypatch, role="user")
    resp = client.get("/api/v1/ops/config-health", headers=_H)
    assert resp.status_code == 403


def test_config_health_ok_when_preflight_present(monkeypatch):
    """Cycle-2 Team 3's preflight module is present in this checkout, so the
    config-health section should be included (not gracefully omitted)."""
    _reset_limiter()
    client = _make_ops_client(monkeypatch)
    resp = client.get("/api/v1/ops/config-health", headers=_H)
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert "overall_status" in body
    assert isinstance(body["checks"], list)


def test_config_health_degrades_gracefully_if_preflight_missing(monkeypatch):
    """If marketer.services.preflight can't be imported (e.g. not merged
    yet in some other checkout), the route must degrade to available:false
    instead of 500ing."""
    _reset_limiter()
    client = _make_ops_client(monkeypatch)

    import builtins

    real_import = builtins.__import__

    def _blocked_import(name, *args, **kwargs):
        if name == "marketer.services.preflight":
            raise ImportError("simulated: preflight not present")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _blocked_import)
    resp = client.get("/api/v1/ops/config-health", headers=_H)
    assert resp.status_code == 200
    assert resp.json() == {"available": False}
