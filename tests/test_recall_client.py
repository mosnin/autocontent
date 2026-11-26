"""The Supermemory client and team mirroring, against the fake server: auth
header only, no redirects, one retry on an add with a stable id, none on
deletes, the breaker, URLs never sent as content, and mirroring of confirmed
facts (instant) with removal on correct/forget."""
from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from marketer.recall import repo as recall_repo
from marketer.recall import service as recall_service
from marketer.recall.config import RecallConfig
from marketer.recall.namespace import scope
from marketer.services.supermemory import Breaker, SupermemoryClient, SupermemoryError, reset_breaker
from tests.supermemory_fake import TEST_KEY, TEST_SECRET, FakeSupermemory, fake_config, set_env

TEAM = scope("team", "user_t", None, TEST_SECRET)
ALICE = scope("personal", "user_t", "usr_alice", TEST_SECRET)


def _client(fake: FakeSupermemory, **kw) -> SupermemoryClient:
    return SupermemoryClient(fake_config(), transport=fake.transport(), breaker=kw.get("breaker", Breaker()))


async def test_bearer_only_and_v5_paths():
    fake = FakeSupermemory()
    await _client(fake).add(ALICE, content="hello", doc_id="conv_1", metadata={"scope": "personal"})
    req = fake.requests[0]
    assert req["headers"]["authorization"] == f"Bearer {TEST_KEY}"
    assert not any(h in req["headers"] for h in ("x-api-key", "x-supermemory-api-key", "x-project-id"))
    assert req["path"].startswith("/ns/mkt-p-") and "/v3/" not in req["path"] and "/v5/" not in req["path"]
    assert "containerTag" not in str(req["body"]) and "customId" not in str(req["body"])
    assert req["body"]["id"] == "conv_1"


async def test_one_retry_on_add_none_on_deletes():
    fake = FakeSupermemory()
    c = _client(fake)
    fake.fail_next(503)
    await c.add(ALICE, content="x", doc_id="conv_1")
    assert [r["method"] for r in fake.requests] == ["POST", "POST"]
    fake.requests.clear()
    fake.fail_next(503, 503)
    with pytest.raises(SupermemoryError):
        await c.add(ALICE, content="x", doc_id="conv_1")
    assert len(fake.requests) == 2
    for call in (lambda: c.forget(ALICE, ["mem_1"]), lambda: c.delete_documents(ALICE, ["d"]), lambda: c.delete_namespace(ALICE)):
        fake.requests.clear()
        fake.fail_next("timeout")
        with pytest.raises(SupermemoryError):
            await call()
        assert len(fake.requests) == 1


async def test_breaker_opens_and_fails_fast():
    fake = FakeSupermemory()
    now = [0.0]
    c = _client(fake, breaker=Breaker(threshold=2, cooldown_sec=30, now=lambda: now[0]))
    fake.fail_next(500, 500)
    for _ in range(2):
        with pytest.raises(SupermemoryError):
            await c.search(ALICE, "q")
    sent = len(fake.requests)
    with pytest.raises(SupermemoryError) as e:
        await c.search(ALICE, "q")
    assert e.value.kind == "circuit_open" and len(fake.requests) == sent
    now[0] = 31
    assert await c.search(ALICE, "q") == []  # probe (namespace missing → 404 → neutral) ... then closed
    assert len(fake.requests) == sent + 1


async def test_redirects_are_not_followed_and_key_never_in_errors():
    def handler(request):
        return httpx.Response(302, headers={"location": "https://evil.test/"})

    c = SupermemoryClient(fake_config(), transport=httpx.MockTransport(handler), breaker=Breaker())
    with pytest.raises(SupermemoryError) as e:
        await c.search(ALICE, "q")
    assert e.value.kind == "redirect_refused"
    assert TEST_KEY not in str(e.value) and TEST_KEY not in repr(c)


async def test_namespace_delete_404_is_success():
    fake = FakeSupermemory()
    gone = await _client(fake).delete_namespace(ALICE)
    assert gone.existed is False


def test_not_configured_without_key_or_with_plain_http():
    assert not RecallConfig("", TEST_SECRET, "https://x").configured
    assert not RecallConfig(TEST_KEY, "short", "https://x").configured
    assert not RecallConfig(TEST_KEY, TEST_SECRET, "http://api.example.com").configured
    assert RecallConfig(TEST_KEY, TEST_SECRET, "http://localhost:6767").configured


# --------------------------------------------------------------------------- mirroring


@pytest.fixture
def mirror_env(monkeypatch):
    fake = FakeSupermemory()
    set_env(monkeypatch)
    reset_breaker()
    monkeypatch.setattr(recall_service, "client", lambda: SupermemoryClient(fake_config(), transport=fake.transport(), breaker=Breaker()))
    st = {"enabled": True, "mirror": {}}

    async def get_setting(tenant_id):
        return recall_repo.Setting(st["enabled"], None)

    async def mirror_state(tenant_id):
        return dict(st["mirror"])

    async def mirror_set(tenant_id, doc_id, h):
        st["mirror"][doc_id] = h

    async def mirror_drop(tenant_id, ids):
        for i in ids:
            st["mirror"].pop(i, None)

    for name, fn in dict(get_setting=get_setting, mirror_state=mirror_state, mirror_set=mirror_set, mirror_drop=mirror_drop).items():
        monkeypatch.setattr(recall_repo, name, fn)
    return fake, st


def _fact(**over):
    d = dict(id=uuid4(), trust="trusted", pending=False, invalid_at=None, subject_type="brand", subject_name="Pasta Club",
             predicate="voice", value="Warm, see https://pasta.example/about", object_name=None)
    d.update(over)
    return SimpleNamespace(**d)


async def test_confirmed_fact_mirrors_instantly_without_urls(mirror_env):
    fake, st = mirror_env
    f = _fact()
    assert await recall_service.mirror_fact("user_t", f) is True
    req = fake.requests[-1]
    assert req["path"] == f"/ns/{TEAM.namespace}/document"
    assert req["body"]["dreaming"] == "instant" and req["body"]["id"] == f"fact_{f.id}"
    assert "https://" not in req["body"]["content"] and "[link]" in req["body"]["content"]
    # Correct / forget removes it.
    assert await recall_service.unmirror_fact("user_t", f.id) is True
    assert fake.texts(TEAM.namespace) == [] and st["mirror"] == {}


async def test_unconfirmed_or_disabled_never_mirrors(mirror_env):
    fake, st = mirror_env
    assert await recall_service.mirror_fact("user_t", _fact(trust="unconfirmed")) is False
    assert await recall_service.mirror_fact("user_t", _fact(pending=True)) is False
    st["enabled"] = False
    assert await recall_service.mirror_fact("user_t", _fact()) is False
    assert fake.requests == []


async def test_sync_sends_changes_and_removes_gone(mirror_env, monkeypatch):
    fake, st = mirror_env
    sources = {"brand_kit": "Brand kit\nTagline: Dinner in ten", "fact_1": "Confirmed fact about brand X: voice = warm"}

    async def governed_sources(tenant_id, **kw):
        return dict(sources)

    monkeypatch.setattr(recall_repo, "governed_sources", governed_sources)
    assert await recall_service.sync_team("user_t") == {"added": 2, "removed": 0, "failed": 0}
    assert await recall_service.sync_team("user_t") == {"added": 0, "removed": 0, "failed": 0}
    del sources["fact_1"]
    sources["brand_kit"] += "\nTone: dry"
    assert await recall_service.sync_team("user_t") == {"added": 1, "removed": 1, "failed": 0}
    assert all(p.startswith(("POST /ns/mkt-t-", "DELETE /ns/mkt-t-")) for p in fake.paths())


async def test_confirm_route_mirrors_and_forget_route_unmirrors(monkeypatch):
    """The real routes hand the fact to the mirror after the response."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.auth import require_user
    from backend.routes import memory
    from marketer.repos import memory as memory_repo
    from tests.auth_helpers import ctx_for
    from tests.test_memory_route import _fact as route_fact

    seen = []

    async def confirm(user_id, fact_id):
        return route_fact(id=fact_id, trust="trusted")

    async def forget(user_id, fact_id):
        return True

    async def mirror(tenant_id, fact):
        seen.append(("mirror", tenant_id, fact.id))

    async def unmirror(tenant_id, fact_id):
        seen.append(("unmirror", tenant_id, fact_id))

    monkeypatch.setattr(memory_repo, "confirm_fact", confirm)
    monkeypatch.setattr(memory_repo, "forget_fact", forget)
    monkeypatch.setattr(recall_service, "mirror_fact", mirror)
    monkeypatch.setattr(recall_service, "unmirror_fact", unmirror)
    app = FastAPI()
    app.include_router(memory.router, prefix="/api/v1/memory")
    app.dependency_overrides[require_user] = lambda: ctx_for("owner", user_id="user_p")
    c = TestClient(app)
    fid = uuid4()
    assert c.post(f"/api/v1/memory/facts/{fid}/confirm").status_code == 200
    assert c.post(f"/api/v1/memory/facts/{fid}/forget").status_code == 204
    assert seen == [("mirror", "user_p", fid), ("unmirror", "user_p", fid)]
