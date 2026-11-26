"""Conformance: the golden request/response cases in
docs/decisions/conformance are replayed here and by the agent's TypeScript
suite (agent/test/decisions.conformance.test.ts).

A case is one vendor-neutral request, the exact wire request it must become,
a recorded or documented response, and the outcome every client must reach.
Add a case there, never a client-only expectation here, so the two clients
cannot drift apart.
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from marketer.decisions import questions as q
from marketer.services import decisions as svc

DIR = Path(__file__).resolve().parents[1] / "docs" / "decisions" / "conformance"
CONTRACT = json.loads((DIR / "contract.json").read_text())
CASES = [json.loads((DIR / f"{name}.json").read_text()) for name in CONTRACT["cases"]]

# The two clients name two failure kinds differently; the meaning is the same.
KIND = {"network": "transport"}


def _questions(spec: dict) -> q.Questions:
    out: q.Questions = {}
    for name, s in spec.items():
        if s["type"] == "yesno":
            out[name] = q.YesNo(s["instructions"])
        elif s["type"] == "choice":
            out[name] = q.Choice(s["instructions"], dict(s["options"]))
        else:
            out[name] = q.Score(s["instructions"], tuple(s["levels"]))
    return out


def test_every_case_file_is_listed():
    files = sorted(p.stem for p in DIR.glob("*.json") if p.name != "contract.json")
    assert files == sorted(CONTRACT["cases"]) and len(files) > 20


def test_endpoint_and_models_match_the_contract():
    assert q.DEFAULT_DECISIONS_URL == CONTRACT["endpoint"]
    assert q.D1_MODEL == CONTRACT["models"]["D1"]
    assert q.D0_MODEL == CONTRACT["models"]["D0"]
    assert svc._WIRE_TYPE == CONTRACT["wire_types"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
async def test_case(case):
    questions = _questions(case["questions"])
    seen: list[httpx.Request] = []

    async def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        resp = case["response"]
        if "raw" in resp:
            return httpx.Response(resp["status"], text=resp["raw"])
        return httpx.Response(resp["status"], json=resp["body"])

    client = svc.DecisionClient(key="test-key-not-real", transport=httpx.MockTransport(handle))
    expect = case["expect"]
    try:
        raw = await client.decide(case["state"], questions, model=case["model"], timeout_s=1)
    except svc.DecisionError as e:
        assert not expect["ok"], f"unexpected failure: {e}"
        assert e.kind == KIND.get(expect["kind"], expect["kind"])
        if case["response"]["status"] >= 400:
            assert e.status == case["response"]["status"]
            # The error body never reaches the message (it can echo input).
            assert str(e) == f"http: {e.status}"
        return
    finally:
        assert str(seen[0].url) == CONTRACT["endpoint"] and seen[0].method == "POST"
        assert json.loads(seen[0].content) == case["wire_request"]

    assert expect["ok"], "expected a typed failure, got answers"
    assert raw.model == expect["model"]
    assert raw.cost_usd == Decimal(str(expect["cost"]))
    assert raw.tokens == expect["tokens"]
    assert raw.answers.keys() == expect["answers"].keys()
    for name, want in expect["answers"].items():
        got = dict(raw.answers[name])
        if want["type"] == "score":
            # The shared contract gives a score as the level index. This
            # client keeps it as `level` and adds the 0..1 position tables read.
            top = len(case["questions"][name]["levels"]) - 1
            assert got.pop("level") == want["score"]
            assert got.pop("score") == pytest.approx(want["score"] / top)
            want = {k: v for k, v in want.items() if k != "score"}
        assert got == want
