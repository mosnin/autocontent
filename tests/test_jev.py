"""Jev harness — primitives, policy, client parse, ask, decisions, routes."""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from marketer.jev import client as jev_client
from marketer.jev import policy
from marketer.jev.primitives import (
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    Score,
    ScoreAnswer,
    parse_answer,
)
from marketer.models import Idea


def test_choice_and_score_bounds():
    with pytest.raises(ValueError, match="2-255"):
        Choice(instructions="x", criteria={"only": None})
    with pytest.raises(ValueError, match="2-10"):
        Score(instructions="x", criteria=["one"])
    Choice(instructions="x", criteria={"a": "A", "b": "B"})
    Score(instructions="x", criteria=["low", "high"])


def test_parse_answers_and_helpers():
    n = parse_answer({"type": "noul", "noul": 0.91})
    assert isinstance(n, NoulAnswer) and n.is_yes()
    c = parse_answer({
        "type": "choice",
        "choice": "billing",
        "probabilities": {"billing": 0.9, "tech": 0.1},
        "confidence": 0.8,
    })
    assert isinstance(c, ChoiceAnswer) and c.choice == "billing"
    s = parse_answer({
        "type": "score",
        "score": 1.5,
        "legend": {"0": "low", "1": "mid", "2": "high"},
        "probabilities": {"0": 0.1, "1": 0.3, "2": 0.6},
        "confidence": 0.7,
    })
    assert isinstance(s, ScoreAnswer)
    assert 0.7 <= s.normalized() <= 0.8


def test_confidence_gates():
    unsure = ChoiceAnswer(
        choice="a", probabilities={"a": 0.4, "b": 0.6}, confidence=0.3
    )
    mid = ChoiceAnswer(
        choice="a", probabilities={"a": 0.7, "b": 0.3}, confidence=0.6
    )
    sure = ChoiceAnswer(
        choice="a", probabilities={"a": 0.95, "b": 0.05}, confidence=0.9
    )
    assert policy.gate_choice(unsure) == "escalate"
    assert policy.gate_choice(mid) == "confirm"
    assert policy.gate_choice(sure) == "act"
    assert policy.gate_noul(NoulAnswer(noul=0.8)) == "yes"
    assert policy.gate_noul(NoulAnswer(noul=0.2)) == "no"
    assert policy.gate_noul(NoulAnswer(noul=0.5)) == "uncertain"


def test_weighted_composite_renormalizes_missing():
    scores = {
        "a": ScoreAnswer(score=2, legend={"0": "x", "1": "y", "2": "z"}),
    }
    assert policy.weighted_composite(scores, {"a": 1, "b": 4}) == 1.0
    assert policy.weighted_composite({}, {"a": 1}) == 0.0


def test_jev_cost_is_input_only():
    assert jev_client.jev_cost(1_000_000, 50_000) == Decimal("0.042000")


def test_client_parse_result():
    result = jev_client._parse_result(
        {
            "model": "jev-1.13.0",
            "answers": {
                "urgent": {"type": "noul", "noul": 0.99},
                "dept": {
                    "type": "choice",
                    "choice": "billing",
                    "probabilities": {"billing": 1.0},
                    "confidence": 0.9,
                },
            },
            "usage": {"input_tokens": 200, "output_tokens": 0},
        }
    )
    assert result.backend == "jev"
    assert result.noul("urgent").noul == pytest.approx(0.99)
    assert result.choice("dept").choice == "billing"


async def test_ask_raises_when_neither_backend_configured(monkeypatch):
    from marketer.config import settings
    from marketer.jev.ask import DecisionUnavailable, ask

    monkeypatch.setattr(settings, "typesafe_api_key", "")
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    with pytest.raises(DecisionUnavailable):
        await ask("state", {"q": Noul(instructions="yes?")})


async def test_ask_uses_jev_then_logs_spend(monkeypatch, fake_spend):
    from marketer.jev.ask import ask
    from marketer.jev.primitives import SystemOneResult, Usage

    async def fake_system_one(state, questions, **kw):
        return SystemOneResult(
            model="jev-1.13.0",
            answers={"q": NoulAnswer(noul=0.8)},
            usage=Usage(input_tokens=100),
            backend="jev",
        )

    monkeypatch.setattr(jev_client, "enabled", lambda: True)
    monkeypatch.setattr(jev_client, "system_one", fake_system_one)
    ctx, rec = fake_spend
    result = await ask("s", {"q": Noul(instructions="x")}, spend=ctx)
    assert result.noul("q").noul == 0.8
    assert rec.entries[0].provider == "typesafe"
    assert rec.entries[0].sku == "jev:jev-1.13.0"


async def test_judge_ideas_picks_highest_composite(monkeypatch):
    from marketer.jev import decisions
    from marketer.jev.primitives import SystemOneResult

    candidates = [
        Idea(topic="a", angle="a", hook="a", target_audience="x", why_it_works="y"),
        Idea(topic="b", angle="b", hook="b", target_audience="x", why_it_works="y"),
    ]

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        answers = {}
        # candidate 1 wins on every dimension
        for i in range(2):
            val = 2.7 if i == 1 else 0.4
            for dim in ("hook", "payoff", "fresh"):
                answers[f"c{i}_{dim}"] = ScoreAnswer(
                    score=val,
                    legend={"0": "a", "1": "b", "2": "c", "3": "d"},
                    confidence=0.9,
                )
        return SystemOneResult(model="jev-latest", answers=answers, backend="jev")

    monkeypatch.setattr(decisions, "jev_ask", fake_ask)
    pick = await decisions.judge_ideas("niche", candidates)
    assert pick.winner_index == 1


async def test_judge_video_fails_generic_hook(monkeypatch):
    from marketer.jev import decisions
    from marketer.jev.primitives import SystemOneResult

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        return SystemOneResult(
            model="jev-latest",
            answers={
                "hook": ScoreAnswer(
                    score=0, legend={"0": "a", "1": "b", "2": "c", "3": "d"}
                ),
                "retention": ScoreAnswer(
                    score=2, legend={"0": "a", "1": "b", "2": "c", "3": "d"}
                ),
                "clarity": ScoreAnswer(
                    score=2, legend={"0": "a", "1": "b", "2": "c", "3": "d"}
                ),
                "on_niche": NoulAnswer(noul=0.9),
                "generic_hook": NoulAnswer(noul=0.95),
                "action": ChoiceAnswer(
                    choice="publish",
                    probabilities={"publish": 0.6, "regenerate_script": 0.4},
                    confidence=0.5,
                ),
            },
            backend="jev",
        )

    monkeypatch.setattr(decisions, "jev_ask", fake_ask)
    verdict = await decisions.judge_video({"script": {}})
    assert verdict.report.passed is False
    assert verdict.report.suggested_action == "regenerate_script"
    assert any("hook" in i for i in verdict.report.issues)


async def test_route_model_picks_cheapest_capable_tier(monkeypatch):
    from marketer.jev import harness
    from marketer.jev.primitives import SystemOneResult

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        return SystemOneResult(
            model="jev-latest",
            answers={
                "tier": ChoiceAnswer(
                    choice="fast",
                    probabilities={"fast": 0.8, "standard": 0.15, "powerful": 0.05},
                    confidence=0.85,
                )
            },
            backend="jev",
        )

    monkeypatch.setattr(harness, "jev_ask", fake_ask)
    route = await harness.route_model("rewrite this caption")
    assert route.tier == "fast"
    assert route.model_id == "qwen/qwen3-8b"


async def test_auto_mode_blocks_high_risk(monkeypatch):
    from marketer.jev import harness
    from marketer.jev.primitives import SystemOneResult

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        return SystemOneResult(
            model="jev-latest",
            answers={
                "risky": NoulAnswer(noul=0.92),
                "jailbreak": NoulAnswer(noul=0.1),
                "destructive": NoulAnswer(noul=0.2),
                "severity": ScoreAnswer(
                    score=2, legend={"0": "n", "1": "l", "2": "s"}, confidence=0.8
                ),
            },
            backend="jev",
        )

    monkeypatch.setattr(harness, "jev_ask", fake_ask)
    decision = await harness.auto_mode({"tool": "bash"}, tool="bash")
    assert decision.verdict == "block"


async def test_foreman_policy_stop_when_stuck(monkeypatch):
    from marketer.jev.primitives import SystemOneResult
    from marketer.symbolic import foreman

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        return SystemOneResult(
            model="jev-latest",
            answers={
                k: NoulAnswer(noul=0.9 if k == "worker_stuck" else 0.1)
                for k in questions
            },
            backend="jev",
        )

    monkeypatch.setattr(foreman, "jev_ask", fake_ask)
    decision = await foreman.assess({"log": "looping"})
    assert decision.action == "stop"


async def test_company_os_escalates_low_confidence(monkeypatch):
    from marketer.company_os import opencompany
    from marketer.jev.primitives import SystemOneResult

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        return SystemOneResult(
            model="jev-latest",
            answers={
                "surface": ChoiceAnswer(
                    choice="ads",
                    probabilities={"ads": 0.3, "human": 0.25},
                    confidence=0.2,
                ),
                "task": ChoiceAnswer(
                    choice="ready",
                    probabilities={"ready": 0.5, "blocked": 0.5},
                    confidence=0.4,
                ),
                "knowledge_write": NoulAnswer(noul=0.1),
                "stakes": ScoreAnswer(
                    score=3,
                    legend={"0": "c", "1": "w", "2": "b", "3": "m"},
                    confidence=0.8,
                ),
            },
            backend="jev",
        )

    monkeypatch.setattr(opencompany, "jev_ask", fake_ask)
    route = await opencompany.route_workspace("raise the Meta budget 10x")
    assert route.surface == "human"
    assert route.gate == "escalate"


def _jev_client(monkeypatch) -> TestClient:
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.rate_limit import limiter
    from marketer.config import settings

    limiter.reset()
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    async def _fake():
        return AuthCtx(user_id="user_jev", email="j@j.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_jev_status_and_voice_status_routes(monkeypatch):
    client = _jev_client(monkeypatch)
    headers = {"Authorization": "Bearer mkt_x"}
    jev = client.get("/api/v1/jev/status", headers=headers)
    assert jev.status_code == 200
    body = jev.json()
    assert "available" in body
    assert "default_generation_model" in body
    voice = client.get("/api/v1/voice/status", headers=headers)
    assert voice.status_code == 200
    assert "ready" in voice.json()


def test_jev_ask_409_when_unavailable(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "typesafe_api_key", "")
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    client = _jev_client(monkeypatch)
    headers = {"Authorization": "Bearer mkt_x"}
    resp = client.post(
        "/api/v1/jev/ask",
        headers=headers,
        json={
            "state": "hello",
            "questions": {
                "urgent": {"type": "noul", "instructions": "urgent?"}
            },
        },
    )
    assert resp.status_code == 409
    assert client.post(
        "/api/v1/jev/route",
        headers=headers,
        json={"state": "hello"},
    ).status_code == 409
    assert client.post(
        "/api/v1/jev/auto-mode",
        headers=headers,
        json={"tool": "bash", "state": {}},
    ).status_code == 409


def test_voice_session_409_without_openai(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "openai_api_key", "")
    client = _jev_client(monkeypatch)
    resp = client.post(
        "/api/v1/voice/session",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_qwen_models_are_in_openrouter_registry():
    from marketer.services import openrouter

    ids = {m.id for m in openrouter.OPENROUTER_MODELS}
    assert "qwen/qwen3-32b" in ids
    assert "qwen/qwen3-8b" in ids
    assert "qwen/qwen3-235b-a22b" in ids
