"""Routes for /api/v1/stories: permissions per role, the status machine,
render approval through the rails (kill switch, argument binding), the story
ceiling, and that file routes never leak paths."""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from marketer.story import service
from marketer.story.models import Scene, Shot, StoryPlan, StoryStatus
from marketer.story.settings import story_settings
from marketer.story.store import InMemoryStoryStore, set_store
from tests.auth_helpers import DEFAULT_TENANT, as_role
from tests.story_fakes import new_story

H = {"Authorization": "Bearer mkt_x"}


@pytest.fixture
def env(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "auth_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    store = InMemoryStoryStore()
    prev_store = set_store(store)
    spawned: list[tuple] = []

    async def spawn(user_id, story_id, stage, arg):
        spawned.append((user_id, story_id, stage, arg))

    prev_spawn = service.set_spawner(spawn)
    from backend.main import create_app

    app = create_app()
    yield app, store, spawned
    set_store(prev_store)
    service.set_spawner(prev_spawn)


def _client(app, role="owner", **kw) -> TestClient:
    as_role(app, role, **kw)
    return TestClient(app, raise_server_exceptions=False)


async def _boarded(store, *, shots=3, estimate_micros=750_000, status=StoryStatus.storyboard_ready):
    s = await store.create(new_story(DEFAULT_TENANT, status=status))
    plan = StoryPlan(scenes=[Scene(heading="INT", script="x")],
                     shots=[Shot(idx=i, scene_idx=0, first_frame=f"f{i}") for i in range(shots)])
    return await store.update(s.id, user_id=s.user_id, plan=plan, estimate_micros=estimate_micros)


def test_create_spawns_the_script_stage(env):
    app, store, spawned = env
    r = _client(app, "marketer").post("/api/v1/stories", json={"source": "a barista saves the morning"}, headers=H)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "writing" and "video_path" not in body
    assert spawned[0][2] == "script"


@pytest.mark.parametrize("role,status", [("analyst", 403), ("billing", 403), ("marketer", 202), ("admin", 202)])
def test_create_needs_content_create(env, role, status):
    app, _, _ = env
    r = _client(app, role).post("/api/v1/stories", json={"source": "an idea"}, headers=H)
    assert r.status_code == status


async def test_analyst_reads_but_cannot_render(env):
    app, store, _ = env
    s = await _boarded(store)
    c = _client(app, "analyst")
    assert c.get(f"/api/v1/stories/{s.id}", headers=H).status_code == 200
    assert c.get("/api/v1/stories", headers=H).json()[0]["shots"] == 3
    assert c.post(f"/api/v1/stories/{s.id}/render", headers=H).status_code == 403


async def test_other_workspace_gets_404(env):
    app, store, _ = env
    s = await store.create(new_story("someone_else"))
    assert _client(app).get(f"/api/v1/stories/{s.id}", headers=H).status_code == 404


async def test_small_render_starts_at_once(env):
    app, store, spawned = env
    s = await _boarded(store)
    r = _client(app, "marketer").post(f"/api/v1/stories/{s.id}/render", headers=H)
    assert r.status_code == 202 and r.json()["status"] == "rendering"
    assert spawned[-1][2] == "render"
    # A double click loses the status race: nothing is spawned twice.
    again = _client(app, "marketer").post(f"/api/v1/stories/{s.id}/render", headers=H)
    assert again.status_code == 409 and len(spawned) == 1


async def test_large_render_waits_for_spend_approval(env, rails_store):
    app, store, spawned = env
    s = await _boarded(store, estimate_micros=6_000_000)
    r = _client(app, "marketer").post(f"/api/v1/stories/{s.id}/render", headers=H)
    assert r.json()["status"] == "awaiting_approval" and r.json()["needs_approval"] is True
    assert spawned == []
    # The agent acting for nobody has no spend:approve.
    assert _client(app, "agent").post(f"/api/v1/stories/{s.id}/render/approve", headers=H).status_code == 403
    ok = _client(app, "owner").post(f"/api/v1/stories/{s.id}/render/approve", headers=H)
    assert ok.status_code == 202, ok.text
    assert ok.json()["status"] == "rendering" and spawned[-1][2] == "render"
    rows = [r for r in rails_store.rows.values() if r.action == "content.story.render"]
    assert len(rows) == 1 and rows[0].outcome == "succeeded"


async def test_spend_kill_switch_blocks_the_approval(env, rails_store):
    app, store, spawned = env
    s = await _boarded(store, estimate_micros=6_000_000)
    c = _client(app, "owner")
    c.post(f"/api/v1/stories/{s.id}/render", headers=H)
    rails_store.kill_switches.add("spend")
    r = c.post(f"/api/v1/stories/{s.id}/render/approve", headers=H)
    assert r.status_code == 402 and "kill_switch" in r.json()["detail"]
    assert spawned == []
    assert (await store.get(s.id, user_id=s.user_id)).status == StoryStatus.awaiting_approval


async def test_approval_is_bound_to_the_storyboard(env):
    app, store, spawned = env
    s = await _boarded(store, estimate_micros=6_000_000)
    c = _client(app, "owner")
    c.post(f"/api/v1/stories/{s.id}/render", headers=H)
    # The storyboard changes under the pending approval (a frame redrawn elsewhere).
    cur = await store.get(s.id, user_id=s.user_id)
    shots = [sh.model_copy(update={"frame_rev": 1}) if sh.idx == 0 else sh for sh in cur.plan.shots]
    await store.update(s.id, user_id=s.user_id, plan=cur.plan.model_copy(update={"shots": shots}))
    r = c.post(f"/api/v1/stories/{s.id}/render/approve", headers=H)
    assert r.status_code == 409 and "approval_args_mismatch" in r.json()["detail"]
    assert spawned == []


async def test_render_over_the_story_ceiling_is_refused(env, monkeypatch):
    app, store, spawned = env
    monkeypatch.setattr(story_settings, "max_usd", Decimal("1"))
    s = await _boarded(store, estimate_micros=1_500_000)
    r = _client(app).post(f"/api/v1/stories/{s.id}/render", headers=H)
    assert r.status_code == 402 and spawned == []


async def test_regenerate_bumps_one_shot_and_spawns_its_frame(env):
    app, store, spawned = env
    s = await _boarded(store)
    r = _client(app, "marketer").post(f"/api/v1/stories/{s.id}/shots/1/regenerate", json={"first_frame": "close-up"}, headers=H)
    assert r.status_code == 202, r.text
    shots = r.json()["shots"]
    assert [sh["frame_rev"] for sh in shots] == [0, 1, 0] and shots[1]["first_frame"] == "close-up"
    assert spawned[-1][2:] == ("frame", "1")
    assert _client(app).post(f"/api/v1/stories/{s.id}/shots/9/regenerate", json={}, headers=H).status_code == 409


async def test_edit_script_starts_a_new_revision(env):
    app, store, _ = env
    s = await _boarded(store)
    r = _client(app, "marketer").put(f"/api/v1/stories/{s.id}/script", json={"scenes": [{"heading": "EXT", "script": "new"}]}, headers=H)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["revision"] == 1 and b["status"] == "script_ready" and b["shots"] == []


async def test_storyboard_needs_a_ready_script(env):
    app, store, spawned = env
    s = await store.create(new_story(DEFAULT_TENANT, status=StoryStatus.writing))
    assert _client(app).post(f"/api/v1/stories/{s.id}/storyboard", headers=H).status_code == 409
    await store.update(s.id, user_id=s.user_id, status=StoryStatus.script_ready)
    assert _client(app).post(f"/api/v1/stories/{s.id}/storyboard", headers=H).status_code == 202
    assert spawned[-1][2] == "storyboard"


async def test_retry_resumes_the_failed_stage(env):
    app, store, spawned = env
    s = await _boarded(store, status=StoryStatus.storyboard_ready)
    await store.update(s.id, user_id=s.user_id, status=StoryStatus.failed, stage="frame:2", error="boom")
    r = _client(app).post(f"/api/v1/stories/{s.id}/retry", headers=H)
    assert r.status_code == 202 and r.json()["status"] == "boarding"
    assert spawned[-1][2:] == ("frame", "2")


async def test_spawn_failure_releases_the_row(env):
    app, store, _ = env

    async def broken(*a):
        raise ConnectionError("queue down")

    service.set_spawner(broken)
    s = await _boarded(store)
    r = _client(app).post(f"/api/v1/stories/{s.id}/render", headers=H)
    assert r.status_code == 503
    assert (await store.get(s.id, user_id=s.user_id)).status == StoryStatus.failed


async def test_files_404_without_a_checkpoint(env):
    app, store, _ = env
    s = await _boarded(store)
    c = _client(app)
    assert c.get(f"/api/v1/stories/{s.id}/shots/0/frame", headers=H).status_code == 404
    assert c.get(f"/api/v1/stories/{s.id}/video", headers=H).status_code == 404


async def test_frame_route_serves_the_checkpointed_file(env, tmp_path):
    app, store, _ = env
    s = await _boarded(store)
    f = tmp_path / "f.png"
    f.write_bytes(b"\x89PNG")
    await store.put_checkpoint(s.id, "frame:r0:0.0", {"path": str(f)})
    r = _client(app).get(f"/api/v1/stories/{s.id}/shots/0/frame", headers=H)
    assert r.status_code == 200 and r.content == b"\x89PNG"
    assert _client(app).get(f"/api/v1/stories/{s.id}", headers=H).json()["shots"][0]["frame_ready"] is True
