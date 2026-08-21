"""Route-level tests for /api/v1/motion.

Repos and the Modal spawn are monkeypatched; auth is bypassed via
dependency_overrides. No DB, no network, no Modal. Covers the HTTP
contract, the ownership scoping (foreign rows are 404, never 403), the
atomic failed->queued retry claim, and the streaming-file 404 discipline.
"""
from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.repos import jobs as jobs_repo
from marketer.repos import motion_projects as projects_repo
from marketer.repos import niches as niches_repo

USER = "user_motion"
AUTH = {"Authorization": "Bearer mkt_x"}
NICHE_ID = UUID("00000000-0000-0000-0000-000000000011")


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.routes import motion as motion_routes

    async def _fake():
        return AuthCtx(user_id=USER, email="u@t.com")

    app = create_app()
    # The router is mounted here when main.py hasn't wired it yet, so this
    # suite exercises the real router either way.
    mounted = any(
        str(getattr(r, "path", "")).startswith("/api/v1/motion") for r in app.routes
    )
    if not mounted:
        app.include_router(motion_routes.router, prefix="/api/v1/motion", tags=["motion"])
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


class FakeStore:
    def __init__(self) -> None:
        self.rows: dict[UUID, dict] = {}

    def seed(self, **over) -> dict:
        row = {
            "id": uuid4(),
            "user_id": USER,
            "niche_id": NICHE_ID,
            "job_id": None,
            "narration": "A barista pours espresso.",
            "style_key": "modern-flat",
            "aspect": "9:16",
            "source": "generated",
            "status": "queued",
            "beats": [],
            "overlays": [],
            "video_path": None,
            "error": None,
        }
        row.update(over)
        self.rows[row["id"]] = row
        return row


@pytest.fixture
def env(monkeypatch):
    store = FakeStore()
    spawns: list[tuple] = []

    async def fake_create(**kw):
        return store.seed(
            narration=kw["narration"], job_id=kw.get("job_id"),
            style_key=kw["style_key"], aspect=kw["aspect"], source=kw["source"],
            niche_id=kw["niche_id"], user_id=kw["user_id"],
        )

    async def fake_get(project_id, *, user_id):
        row = store.rows.get(project_id)
        return row if row and row["user_id"] == user_id else None

    async def fake_list(user_id, *, status=None, limit=50):
        rows = [r for r in store.rows.values() if r["user_id"] == user_id]
        if status:
            rows = [r for r in rows if r["status"] == status]
        return rows[:limit]

    async def fake_claim_retry(project_id, *, user_id):
        row = store.rows.get(project_id)
        if not row or row["user_id"] != user_id or row["status"] != "failed":
            return False
        row.update(status="queued", error=None)
        return True

    for name, fn in [
        ("create", fake_create), ("get", fake_get),
        ("list_for_user", fake_list), ("claim_for_retry", fake_claim_retry),
    ]:
        monkeypatch.setattr(projects_repo, name, fn)

    async def fake_niche(niche_id, *, user_id):
        return object() if niche_id == NICHE_ID else None

    monkeypatch.setattr(niches_repo, "get", fake_niche)

    async def fake_job(job_id, *, user_id):
        return object() if str(job_id).startswith("11111111") else None

    monkeypatch.setattr(jobs_repo, "get", fake_job)

    from backend.routes import motion as motion_routes

    monkeypatch.setattr(
        motion_routes, "_spawn", lambda user_id, project_id: spawns.append((user_id, project_id))
    )
    return {"store": store, "spawns": spawns}


def body(**over) -> dict:
    payload = {"niche_id": str(NICHE_ID), "narration": "A barista pours espresso."}
    payload.update(over)
    return payload


# --------------------------------------------------------------- catalog


def test_styles_returns_the_catalog_with_type_previews(monkeypatch, env):
    _reset_limiter()
    rows = _client(monkeypatch).get("/api/v1/motion/styles", headers=AUTH).json()
    assert len(rows) >= 4
    first = rows[0]
    assert {"key", "label", "description", "preview", "palette", "finish"} <= set(first)
    assert first["preview"]["type_preview"]


# ---------------------------------------------------------------- create


def test_create_refuses_when_unbilled_usage_disabled(monkeypatch, env):
    """Motion generate must 402 before a row exists when unbilled is off."""
    _reset_limiter()
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)
    resp = _client(monkeypatch).post("/api/v1/motion/projects", json=body(), headers=AUTH)
    assert resp.status_code == 402
    assert env["spawns"] == []
    assert env["store"].rows == {}


def test_create_returns_202_and_spawns_the_worker(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post("/api/v1/motion/projects", json=body(), headers=AUTH)
    assert resp.status_code == 202, resp.text
    row = resp.json()
    assert row["status"] == "queued"
    assert row["style_key"] == "modern-flat"
    assert row["aspect"] == "9:16" and row["source"] == "generated"
    assert env["spawns"] == [(USER, UUID(row["id"]))]


def test_create_accepts_a_job_id_instead_of_narration(monkeypatch, env):
    _reset_limiter()
    job_id = "11111111-1111-1111-1111-111111111111"
    resp = _client(monkeypatch).post(
        "/api/v1/motion/projects",
        json={"niche_id": str(NICHE_ID), "job_id": job_id, "source": "stock"},
        headers=AUTH,
    )
    assert resp.status_code == 202, resp.text
    assert resp.json()["job_id"] == job_id


def test_create_without_narration_or_job_is_422(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/motion/projects", json={"niche_id": str(NICHE_ID)}, headers=AUTH
    )
    assert resp.status_code == 422
    assert "narration or job_id" in resp.json()["detail"]
    assert env["spawns"] == []


def test_create_with_an_unknown_style_is_422(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/motion/projects", json=body(style_key="disco-inferno"), headers=AUTH
    )
    assert resp.status_code == 422
    assert "unknown style" in resp.json()["detail"]
    assert env["spawns"] == []


@pytest.mark.parametrize(
    "payload", [{"aspect": "21:9"}, {"source": "vibes"}, {"narration": "x" * 9000}]
)
def test_create_rejects_out_of_contract_bodies(monkeypatch, env, payload):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/motion/projects", json=body(**payload), headers=AUTH
    )
    assert resp.status_code == 422
    assert env["spawns"] == []


def test_create_for_a_foreign_niche_is_404(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/motion/projects", json=body(niche_id=str(uuid4())), headers=AUTH
    )
    assert resp.status_code == 404
    assert env["spawns"] == []


def test_create_for_a_foreign_job_is_404(monkeypatch, env):
    """A foreign job id must not pull another user's voiceover into a render."""
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/motion/projects",
        json={"niche_id": str(NICHE_ID), "job_id": str(uuid4())},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert env["spawns"] == []


# ------------------------------------------------------------ read paths


def test_list_is_scoped_and_filterable(monkeypatch, env):
    _reset_limiter()
    env["store"].seed(status="done")
    env["store"].seed(status="failed", error="boom")
    env["store"].seed(user_id="someone_else")
    client = _client(monkeypatch)

    rows = client.get("/api/v1/motion/projects", headers=AUTH).json()
    assert len(rows) == 2
    failed = client.get("/api/v1/motion/projects?status_filter=failed", headers=AUTH).json()
    assert [r["status"] for r in failed] == ["failed"]


def test_detail_serves_the_beats_with_their_sourcing_and_keyword(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(
        status="done",
        beats=[
            {
                "index": 0, "start": 0.0, "end": 4.0, "text": "espresso",
                "broll": {
                    "sourcing": "stock", "keyword": "pouring espresso",
                    "stock_query": "pouring espresso clean minimal editorial",
                    "prompt": "collage of espresso", "status": "done", "tags": [],
                },
            }
        ],
        overlays=[{"text": "ESPRESSO", "start": 0.0, "end": 3.9, "beat_index": 0}],
    )
    detail = _client(monkeypatch).get(
        f"/api/v1/motion/projects/{row['id']}", headers=AUTH
    ).json()
    beat = detail["beats"][0]
    assert beat["broll"]["sourcing"] == "stock"
    assert beat["broll"]["keyword"] == "pouring espresso"
    assert beat["broll"]["prompt"]
    assert detail["overlays"][0]["text"] == "ESPRESSO"


def test_detail_for_a_foreign_project_is_404_not_403(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(user_id="someone_else")
    resp = _client(monkeypatch).get(f"/api/v1/motion/projects/{row['id']}", headers=AUTH)
    assert resp.status_code == 404


# ----------------------------------------------------------------- video


def test_video_streams_the_finished_file(monkeypatch, env, tmp_path):
    _reset_limiter()
    video = tmp_path / "final.mp4"
    video.write_bytes(b"mp4 bytes")
    row = env["store"].seed(status="done", video_path=str(video))
    resp = _client(monkeypatch).get(
        f"/api/v1/motion/projects/{row['id']}/video", headers=AUTH
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "video/mp4"
    assert resp.content == b"mp4 bytes"


def test_video_is_404_while_the_project_is_still_running(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="rendering")
    resp = _client(monkeypatch).get(
        f"/api/v1/motion/projects/{row['id']}/video", headers=AUTH
    )
    assert resp.status_code == 404


def test_video_is_404_when_the_file_is_gone(monkeypatch, env, tmp_path):
    """A swept artifact is a 404, not a 500 on an unreadable path."""
    _reset_limiter()
    row = env["store"].seed(status="done", video_path=str(tmp_path / "swept.mp4"))
    resp = _client(monkeypatch).get(
        f"/api/v1/motion/projects/{row['id']}/video", headers=AUTH
    )
    assert resp.status_code == 404


def test_video_of_a_foreign_project_is_404(monkeypatch, env, tmp_path):
    _reset_limiter()
    video = tmp_path / "theirs.mp4"
    video.write_bytes(b"secret")
    row = env["store"].seed(user_id="someone_else", status="done", video_path=str(video))
    resp = _client(monkeypatch).get(
        f"/api/v1/motion/projects/{row['id']}/video", headers=AUTH
    )
    assert resp.status_code == 404


# ----------------------------------------------------------------- retry


def test_retry_claims_a_failed_project_exactly_once(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="failed", error="boom")
    client = _client(monkeypatch)

    first = client.post(f"/api/v1/motion/projects/{row['id']}/retry", headers=AUTH)
    assert first.status_code == 202
    assert first.json() == {"status": "queued"}

    # A double-click cannot double-spawn: the row is no longer failed.
    second = client.post(f"/api/v1/motion/projects/{row['id']}/retry", headers=AUTH)
    assert second.status_code == 409
    assert len(env["spawns"]) == 1


def test_retry_of_a_running_project_is_409(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="rendering")
    resp = _client(monkeypatch).post(
        f"/api/v1/motion/projects/{row['id']}/retry", headers=AUTH
    )
    assert resp.status_code == 409
    assert "not failed" in resp.json()["detail"]
    assert env["spawns"] == []


def test_retry_of_an_unknown_project_is_404(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        f"/api/v1/motion/projects/{uuid4()}/retry", headers=AUTH
    )
    assert resp.status_code == 404
    assert env["spawns"] == []
