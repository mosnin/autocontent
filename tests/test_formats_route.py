"""Route-level tests for /api/v1/formats.

Repos and the Modal spawn are monkeypatched; auth is bypassed via
dependency_overrides. No DB, no network, no Modal.

The load-bearing test here is `test_trends_is_not_swallowed_by_the_key
_route`: `/{key}` is a catch-all declared in the same router, and if it
is ever moved above `/trends` the whole research feature 404s while the
catalog keeps working.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.models import Niche, PostingWindow
from marketer.repos import niches as niches_repo
from marketer.repos import trend_reports as reports_repo

USER = "user_formats"
OTHER = "someone_else"
NICHE_ID = UUID("11111111-1111-1111-1111-111111111111")


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.routes import formats as formats_routes

    async def _fake():
        return AuthCtx(user_id=USER, email="u@t.com")

    app = create_app()
    # Mounted here when main.py hasn't wired the router yet, so this suite
    # exercises the real router either way.
    mounted = any(
        str(getattr(r, "path", "")).startswith("/api/v1/formats") for r in app.routes
    )
    if not mounted:
        app.include_router(
            formats_routes.router, prefix="/api/v1/formats", tags=["formats"]
        )
    app.dependency_overrides[require_user] = _fake
    _reset_limiter()
    return TestClient(app, raise_server_exceptions=False)


def _niche(user_id: str = USER) -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=user_id,
        title="Home espresso",
        description="d",
        target_audience="beginners",
        hashtags=[],
        visual_style="warm macro",
        voice="friendly",
        target_duration_sec=30,
        scene_count=5,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        created_at=datetime.now(timezone.utc),
    )


def _report_row(report_id, *, status="done", grounded=True, report=None) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "id": report_id,
        "user_id": USER,
        "niche_id": NICHE_ID,
        "status": status,
        "grounded": grounded,
        "report": report if report is not None else {},
        "error": None,
        "created_at": now,
        "updated_at": now,
    }


@pytest.fixture
def spawned(monkeypatch) -> list[tuple[str, UUID]]:
    """Capture Modal spawns instead of importing modal."""
    from backend.routes import formats as formats_routes

    calls: list[tuple[str, UUID]] = []
    monkeypatch.setattr(
        formats_routes, "_spawn", lambda user_id, report_id: calls.append((user_id, report_id))
    )
    return calls


def _stub_niche(monkeypatch, niche: Niche | None) -> None:
    async def fake_get(niche_id, *, user_id):
        return niche if niche is not None and niche.user_id == user_id else None

    monkeypatch.setattr(niches_repo, "get", fake_get)


# ----------------------------------------------------------------- catalog


def test_catalog_lists_every_format_with_what_the_picker_needs(monkeypatch):
    client = _client(monkeypatch)
    resp = client.get("/api/v1/formats")
    assert resp.status_code == 200
    rows = resp.json()
    from marketer.formats import registry

    assert [r["key"] for r in rows] == list(registry.FORMAT_KEYS)
    row = rows[0]
    assert row["label"] and row["description"]
    assert "->" in row["structure"]
    assert row["target_duration_sec"] > 0
    assert row["best_for"]


def test_one_format_returns_the_beat_contract_and_voice_direction(monkeypatch):
    client = _client(monkeypatch)
    resp = client.get("/api/v1/formats/explainer")
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "explainer"
    assert body["beats"]["structure"].startswith("Hook ->")
    assert len(body["contract"]["specs"]) == len(body["beats"]["beats"])
    assert body["voice"]["persona"]
    assert body["voice"]["words_per_minute"] > 0
    assert body["pacing"]["shots_per_beat"] == 2
    assert "BEAT CONTRACT" in body["scriptwriter_directives"]


def test_an_unknown_format_key_is_a_404(monkeypatch):
    client = _client(monkeypatch)
    resp = client.get("/api/v1/formats/documentry")
    assert resp.status_code == 404
    assert "documentry" in resp.json()["detail"]


def test_the_catalog_is_free_and_hits_nothing(monkeypatch):
    """No DB, no LLM, no provider — a picker must be able to render
    without spending anything."""

    async def explode(*a, **kw):  # pragma: no cover - must not be called
        raise AssertionError("catalog endpoint touched the database")

    monkeypatch.setattr(niches_repo, "get", explode)
    monkeypatch.setattr(reports_repo, "list_for_user", explode)
    client = _client(monkeypatch)
    assert client.get("/api/v1/formats").status_code == 200
    assert client.get("/api/v1/formats/listicle").status_code == 200


# ------------------------------------------------------------ route order


def test_trends_is_not_swallowed_by_the_key_route(monkeypatch):
    """`/{key}` would match "trends" if it were declared first: the list
    would 404 as an unknown format and the POST would 405."""

    async def fake_list(user_id, *, niche_id=None, limit=25):
        return []

    monkeypatch.setattr(reports_repo, "list_for_user", fake_list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/formats/trends")
    assert resp.status_code == 200
    assert resp.json() == []


# ------------------------------------------------------------- trends: run


def test_starting_research_returns_202_and_spawns_the_job(monkeypatch, spawned):
    _stub_niche(monkeypatch, _niche())
    created: list[dict] = []
    report_id = uuid4()

    async def fake_create(*, user_id, niche_id):
        created.append({"user_id": user_id, "niche_id": niche_id})
        return _report_row(report_id, status="queued", grounded=False)

    monkeypatch.setattr(reports_repo, "create", fake_create)
    client = _client(monkeypatch)

    resp = client.post("/api/v1/formats/trends", json={"niche_id": str(NICHE_ID)})

    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued"
    assert body["grounded"] is False
    assert created == [{"user_id": USER, "niche_id": NICHE_ID}]
    assert spawned == [(USER, report_id)]


def test_research_against_someone_elses_niche_is_a_404(monkeypatch, spawned):
    """Checked before the row is created: otherwise a caller could seed
    reports against another tenant's niche and spend against its cap."""
    _stub_niche(monkeypatch, _niche(user_id=OTHER))

    async def fake_create(**kw):  # pragma: no cover - must not be reached
        raise AssertionError("created a report for an unowned niche")

    monkeypatch.setattr(reports_repo, "create", fake_create)
    client = _client(monkeypatch)

    resp = client.post("/api/v1/formats/trends", json={"niche_id": str(NICHE_ID)})
    assert resp.status_code == 404
    assert spawned == []


def test_a_malformed_niche_id_is_a_422(monkeypatch):
    client = _client(monkeypatch)
    resp = client.post("/api/v1/formats/trends", json={"niche_id": "not-a-uuid"})
    assert resp.status_code == 422


# ------------------------------------------------------------ trends: read


def test_listing_reports_passes_the_niche_filter_and_limit(monkeypatch):
    seen: list[dict] = []

    async def fake_list(user_id, *, niche_id=None, limit=25):
        seen.append({"user_id": user_id, "niche_id": niche_id, "limit": limit})
        return [_report_row(uuid4(), status="done")]

    monkeypatch.setattr(reports_repo, "list_for_user", fake_list)
    client = _client(monkeypatch)

    resp = client.get(f"/api/v1/formats/trends?niche_id={NICHE_ID}&limit=5")
    assert resp.status_code == 200
    assert seen == [{"user_id": USER, "niche_id": NICHE_ID, "limit": 5}]
    row = resp.json()[0]
    # The list view carries status + provenance, never the findings blob.
    assert set(row) == {
        "id",
        "niche_id",
        "status",
        "grounded",
        "error",
        "created_at",
        "updated_at",
    }


def test_an_out_of_range_limit_is_rejected(monkeypatch):
    client = _client(monkeypatch)
    assert client.get("/api/v1/formats/trends?limit=0").status_code == 422
    assert client.get("/api/v1/formats/trends?limit=9999").status_code == 422


def test_report_detail_returns_themes_hooks_sources_and_angles(monkeypatch):
    report_id = uuid4()
    blob = {
        "niche_title": "Home espresso",
        "queries": ["home espresso trending topics this month"],
        "themes": [{"theme": "pressure profiling", "why_now": "cheap gear", "evidence": ""}],
        "hooks": [{"hook": "why your first shot is sour", "open_loop": "what changes"}],
        "angles": [
            {"title": "why the first shot is sour", "format_key": "explainer", "why": "m"}
        ],
        "sources": [
            {"title": "R", "url": "https://example.com/p", "domain": "example.com"}
        ],
        "grounded": True,
        "notes": [],
    }

    async def fake_get(rid, *, user_id):
        return _report_row(rid, report=blob) if user_id == USER else None

    monkeypatch.setattr(reports_repo, "get", fake_get)
    client = _client(monkeypatch)

    resp = client.get(f"/api/v1/formats/trends/{report_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["grounded"] is True
    assert body["report"]["themes"][0]["theme"] == "pressure profiling"
    assert body["report"]["hooks"][0]["hook"]
    assert body["report"]["sources"][0]["domain"] == "example.com"
    # Angles are matched to a real catalog format so the UI can link them.
    from marketer.formats import registry

    assert registry.get_format(body["report"]["angles"][0]["format_key"]) is not None


def test_an_in_flight_report_returns_an_empty_findings_blob(monkeypatch):
    """The client polls this endpoint while the run is queued; it must
    not have to special-case a half-written row."""

    async def fake_get(rid, *, user_id):
        return _report_row(rid, status="queued", grounded=False, report={})

    monkeypatch.setattr(reports_repo, "get", fake_get)
    client = _client(monkeypatch)

    resp = client.get(f"/api/v1/formats/trends/{uuid4()}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "queued"
    assert body["report"]["themes"] == []
    assert body["report"]["grounded"] is False


def test_another_users_report_is_a_404_not_a_403(monkeypatch):
    """404 so report ids can't be probed for existence."""

    async def fake_get(rid, *, user_id):
        return None

    monkeypatch.setattr(reports_repo, "get", fake_get)
    client = _client(monkeypatch)
    assert client.get(f"/api/v1/formats/trends/{uuid4()}").status_code == 404
