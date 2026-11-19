"""/api/v1/memory: who may do what. The tenant is always the authenticated
user; the agent (service token + x-tenant-id) can read and write non-person
facts but can never confirm, correct or forget one.

No DB: the memory repo's storage functions are monkeypatched; validation runs
for real.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from marketer.models import User
from marketer.repos import memory as memory_repo
from tests.auth_helpers import ctx_for

SERVICE_TOKEN = "svc_" + "c" * 40
AGENT = {"authorization": f"Bearer {SERVICE_TOKEN}", "x-tenant-id": "user_t"}
BODY = {
    "subject": {"type": "brand", "name": "Pasta Club"},
    "predicate": "voice",
    "value": "Warm and practical",
    "source": {"kind": "message", "ref": "chat:1"},
}


def _fact(**over):
    now = datetime(2026, 3, 1, tzinfo=timezone.utc)
    d = dict(
        id=uuid4(), subject_type="brand", subject_name="Pasta Club", subject_key="pasta-club",
        predicate="voice", kind="attribute", value="Warm", object_type=None, object_name=None,
        object_key=None, source_kind="message", source_ref="chat:1", source_at=now,
        source_excerpt=None, trust="unconfirmed", confidence=0.6, valid_from=now, invalid_at=None,
        invalid_reason=None, superseded_by=None, pending=False, challenges=None, created_at=now,
    )
    d.update(over)
    return memory_repo.Fact(**d)


@pytest.fixture
def calls(monkeypatch) -> list[tuple]:
    seen: list[tuple] = []

    async def write_fact(user_id, fact, *, actor):
        seen.append(("write", user_id, fact, actor))
        return memory_repo.WriteOutcome(status="created", fact=_fact(trust=fact.trust))

    async def list_facts(user_id, **kw):
        seen.append(("list", user_id, kw))
        return [_fact()]

    async def fact_counts(user_id):
        return {"current": 1, "pending": 0, "total": 1}

    async def confirm_fact(user_id, fact_id):
        seen.append(("confirm", user_id, fact_id))
        return _fact(id=fact_id, trust="trusted")

    async def correct_fact(user_id, fact_id, **kw):
        seen.append(("correct", user_id, fact_id))
        return None

    async def forget_fact(user_id, fact_id):
        seen.append(("forget", user_id, fact_id))
        return True

    async def merge_duplicates(user_id, keep, drop, *, actor):
        seen.append(("merge", user_id, actor))
        return len(drop)

    async def record_learning(user_id, **kw):
        seen.append(("learning", user_id, kw))
        now = datetime(2026, 3, 1, tzinfo=timezone.utc)
        return memory_repo.Learning(id=uuid4(), claim=kw["claim"], status=kw["status"], evidence=kw["evidence"],
                                    confidence=0.4, source=kw["source"], created_at=now, updated_at=now)

    for name, fn in dict(write_fact=write_fact, list_facts=list_facts, fact_counts=fact_counts,
                         confirm_fact=confirm_fact, correct_fact=correct_fact, forget_fact=forget_fact,
                         merge_duplicates=merge_duplicates, record_learning=record_learning).items():
        monkeypatch.setattr(memory_repo, name, fn)
    return seen


def _app() -> FastAPI:
    from backend.routes import memory

    app = FastAPI()
    app.include_router(memory.router, prefix="/api/v1/memory")
    return app


@pytest.fixture
def agent(monkeypatch):
    """Full auth path: the real require_user with the agent service token."""
    from backend import auth
    from marketer.config import settings
    from marketer.repos import users as users_repo

    monkeypatch.setattr(settings, "agent_service_token", SERVICE_TOKEN)

    async def get(uid):
        return User(id=uid, email=f"{uid}@x.io") if uid == "user_t" else None

    monkeypatch.setattr(users_repo, "get", get)
    monkeypatch.setattr(auth, "_consume_failure_token", lambda req: None)
    return TestClient(_app())


@pytest.fixture
def person():
    from backend.auth import require_user

    app = _app()
    app.dependency_overrides[require_user] = lambda: ctx_for("owner", user_id="user_p", email="p@x.io")
    return TestClient(app)


def test_requires_auth(agent, calls):
    assert agent.get("/api/v1/memory/facts").status_code == 401
    assert agent.post("/api/v1/memory/facts", json=BODY).status_code == 401
    assert agent.get("/api/v1/memory/facts", headers={"authorization": f"Bearer {SERVICE_TOKEN}"}).status_code == 401
    assert calls == []


def test_agent_writes_as_the_tenant_and_never_as_trusted(agent, calls):
    r = agent.post("/api/v1/memory/facts", json={**BODY, "user_id": "someone_else", "trust": "trusted"}, headers=AGENT)
    assert r.status_code == 200, r.text
    _, user_id, fact, actor = calls[0]
    assert (user_id, actor, fact.trust, fact.source_kind) == ("user_t", "agent", "unconfirmed", "message")


def test_agent_cannot_claim_to_be_the_person(agent, calls):
    body = {**BODY, "source": {"kind": "person", "ref": "memory-page"}}
    assert agent.post("/api/v1/memory/facts", json=body, headers=AGENT).status_code == 422
    assert agent.post("/api/v1/memory/facts", json={k: v for k, v in BODY.items() if k != "source"}, headers=AGENT).status_code == 422
    assert calls == []


@pytest.mark.parametrize("path", ["confirm", "correct", "forget"])
def test_agent_cannot_confirm_correct_or_forget(agent, calls, path):
    r = agent.post(f"/api/v1/memory/facts/{uuid4()}/{path}", json={"value": "x"}, headers=AGENT)
    assert r.status_code == 403
    assert calls == []


def test_secrets_and_off_ontology_facts_are_rejected_before_storage(agent, calls):
    for over in (
        {"value": "our password: hunter2hunter2"},
        {"predicate": "favourite_colour"},
        {"subject": {"type": "planet", "name": "Mars"}},
        {"value": "x" * 501},
    ):
        assert agent.post("/api/v1/memory/facts", json={**BODY, **over}, headers=AGENT).status_code == 422
    assert calls == []


def test_person_writes_trusted_whatever_the_body_says(person, calls):
    body = {**BODY, "source": {"kind": "web", "ref": "https://example.com"}, "confidence": 0.1}
    assert person.post("/api/v1/memory/facts", json=body).status_code == 200
    _, user_id, fact, actor = calls[0]
    assert (user_id, actor, fact.trust, fact.source_kind, fact.confidence) == ("user_p", "person", "trusted", "person", 1.0)


def test_person_can_confirm_and_forget_their_own(person, calls):
    fid = uuid4()
    assert person.post(f"/api/v1/memory/facts/{fid}/confirm").json()["trust"] == "trusted"
    assert person.post(f"/api/v1/memory/facts/{fid}/forget").status_code == 204
    assert [(c[0], c[1]) for c in calls] == [("confirm", "user_p"), ("forget", "user_p")]
    # Someone else's (or a missing) fact: the repo returns None and the route says 404.
    assert person.post(f"/api/v1/memory/facts/{uuid4()}/correct", json={"value": "x"}).status_code == 404


def test_reads_are_scoped_to_the_caller(person, agent, calls):
    assert person.get("/api/v1/memory/facts?state=all&entity_type=brand").status_code == 200
    assert agent.get("/api/v1/memory/facts", headers=AGENT).status_code == 200
    assert [(c[0], c[1]) for c in calls] == [("list", "user_p"), ("list", "user_t")]
    assert person.get("/api/v1/memory/facts?entity_type=planet").status_code == 422
    assert person.get("/api/v1/memory/facts?limit=5000").status_code == 422


def test_learning_without_evidence_or_measurement_is_refused(agent, calls):
    base = {"claim": "Numbers in hooks win"}
    assert agent.post("/api/v1/memory/learnings", json={**base, "evidence": []}, headers=AGENT).status_code == 422
    weak = {**base, "status": "supported", "evidence": [{"kind": "post", "ref": "p1", "label": "one post"}]}
    assert agent.post("/api/v1/memory/learnings", json=weak, headers=AGENT).status_code == 422
    assert calls == []
    ok = {**base, "status": "supported",
          "evidence": [{"kind": "metric", "ref": "pm:1", "label": "12 posts", "metric": "ctr", "value": 0.04, "n": 12}]}
    r = agent.post("/api/v1/memory/learnings", json=ok, headers=AGENT)
    assert r.status_code == 201 and calls[0][1] == "user_t" and calls[0][2]["source"] == "analyst"
