"""scripts/braintrust_decisions_eval.py: the conformance cases as a Braintrust
experiment. No network: replay uses recorded responses, uploads go to a mock
transport, and without keys nothing is uploaded."""
from __future__ import annotations

import json

import httpx
import pytest

from scripts import braintrust_decisions_eval as ev

FAKE_KEY = "bt-test-key-not-real"


def test_every_case_replays_conformant():
    results = ev.asyncio.run(ev.run("replay", ev.load_cases()))
    assert len(results) == len(ev.load_cases()) > 20
    assert ev.summary(results) == {"conformance": 1.0}


def test_a_broken_client_shows_up_as_a_failed_case(monkeypatch):
    from marketer.services import decisions as svc

    real = svc._from_wire

    def wrong(questions, answers):
        out = real(questions, answers)
        return {k: {**v, "type": "tampered"} for k, v in out.items()}

    monkeypatch.setattr(svc, "_from_wire", wrong)
    cases = [c for c in ev.load_cases() if c["expect"]["ok"]][:2]
    results = ev.asyncio.run(ev.run("replay", cases))
    assert all(r.scores["conformance"] == 0.0 for r in results)


def test_agreement():
    case = {"expect": {"answers": {"a": {"type": "yesno", "probability": 0.8}, "b": {"type": "choice", "choice": "x"}, "c": {"type": "score", "score": 1.2}}}}
    assert ev.agreement(case, {"a": {"probability": 0.9}, "b": {"choice": "x"}, "c": {"score": 1}}) == 1.0
    assert ev.agreement(case, {"a": {"probability": 0.1}, "b": {"choice": "y"}, "c": {"score": 2}}) == 0.0


def test_no_keys_means_no_upload():
    assert ev.braintrust_config({}) is None
    assert ev.braintrust_config({"BRAINTRUST_API_KEY": FAKE_KEY}) is None
    assert ev.braintrust_config({"BRAINTRUST_API_KEY": FAKE_KEY, "BRAINTRUST_PROJECT_ID": "p1", "BRAINTRUST_API_URL": "https://api-eu.braintrust.dev/"}) == (
        FAKE_KEY, "p1", "https://api-eu.braintrust.dev")


def test_upload_creates_one_experiment_and_inserts_every_case():
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/v1/experiment":
            return httpx.Response(200, json={"id": "exp-1", "name": "decisions-replay-abc"})
        return httpx.Response(200, json={"row_ids": []})

    results = ev.asyncio.run(ev.run("replay", ev.load_cases()))
    exp = ev.upload(results, mode="replay", key=FAKE_KEY, project_id="p1", api_url="https://api.braintrust.dev",
                    base_experiment_id="exp-main", transport=httpx.MockTransport(handle), env={"GITHUB_SHA": "abcdef1234567890"})
    assert exp["id"] == "exp-1"
    create, *inserts = seen
    body = json.loads(create.content)
    assert create.headers["authorization"] == f"Bearer {FAKE_KEY}"
    assert body["project_id"] == "p1" and body["name"] == "decisions-replay-abcdef123456" and body["base_exp_id"] == "exp-main"
    events = [e for r in inserts for e in json.loads(r.content)["events"]]
    assert all(r.url.path == "/v1/experiment/exp-1/insert" for r in inserts)
    assert len(events) == len(results)
    assert set(events[0]) == {"input", "output", "expected", "scores", "metadata", "tags"}


def test_upload_error_raises_with_status_only():
    def handle(request):
        return httpx.Response(401, text="bad key " + FAKE_KEY)

    with pytest.raises(RuntimeError) as e:
        ev.upload([], mode="replay", key=FAKE_KEY, project_id="p1", api_url="https://api.braintrust.dev", transport=httpx.MockTransport(handle))
    assert FAKE_KEY not in str(e.value)


def test_main_without_keys_prints_and_passes(monkeypatch, capsys):
    monkeypatch.delenv("BRAINTRUST_API_KEY", raising=False)
    monkeypatch.delenv("BRAINTRUST_PROJECT_ID", raising=False)

    def no_upload(*a, **k):
        raise AssertionError("must not upload without keys")

    monkeypatch.setattr(ev, "upload", no_upload)
    assert ev.main([]) == 0
    out = capsys.readouterr().out
    assert '"conformance": 1.0' in out and "nothing uploaded" in out


def test_live_needs_a_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert ev.main(["--live", "--dry-run"]) == 2
