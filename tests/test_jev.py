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


async def test_after_content_qa_foreman_stop(monkeypatch):
    from marketer.jev import loops
    from marketer.symbolic.foreman import ForemanDecision

    monkeypatch.setattr(loops.settings, "jev_enabled", True)
    monkeypatch.setattr(loops, "available", lambda: True)

    async def fake_assess(state, *, spend=None):
        return ForemanDecision(
            action="stop",
            implementation_complete=0.1,
            tests_sufficient=0.1,
            requirements_satisfied=0.1,
            worker_stuck=0.9,
            needs_verification=0.1,
            work_off_track=0.8,
            meaningful_progress=0.1,
            ready_to_finish=0.1,
            backend="jev",
        )

    monkeypatch.setattr("marketer.symbolic.foreman.assess", fake_assess)
    verdict = await loops.after_content_qa({"log": "looping"})
    assert verdict.fail is True
    assert "foreman" in verdict.payload


async def test_publish_gate_parks_on_block(monkeypatch):
    from marketer.jev import loops
    from marketer.jev.harness import AutoModeDecision
    from marketer.jev.primitives import SystemOneResult

    monkeypatch.setattr(loops.settings, "jev_enabled", True)
    monkeypatch.setattr(loops, "available", lambda: True)

    async def fake_auto(state, *, tool, spend=None):
        return AutoModeDecision(
            verdict="block",
            risk=0.9,
            jailbreak=0.1,
            destructive=0.1,
            confidence=0.8,
            backend="jev",
            raw=SystemOneResult(model="jev-latest", answers={}, backend="jev"),
        )

    monkeypatch.setattr(loops, "auto_mode", fake_auto)
    parked = await loops.publish_gate({"caption": "x"}, human_approved=False)
    assert parked.park is True and parked.fail is False
    blocked = await loops.publish_gate({"caption": "x"}, human_approved=True)
    assert blocked.fail is True


async def test_campaign_tick_gate_holds(monkeypatch):
    from marketer.jev import loops
    from marketer.jev.harness import UltrafastAction
    from marketer.jev.primitives import SystemOneResult

    monkeypatch.setattr(loops.settings, "jev_enabled", True)
    monkeypatch.setattr(loops, "available", lambda: True)

    async def fake_next(state, *, targets, spend=None):
        return UltrafastAction(
            operation="HOLD",
            target=None,
            needs_generation=False,
            confidence=0.8,
            backend="jev",
            raw=SystemOneResult(model="jev-latest", answers={}, backend="jev"),
        )

    monkeypatch.setattr(loops, "next_action", fake_next)
    verdict = await loops.campaign_tick_gate(
        {"campaign": "x"}, targets={"video:1": "due video"}
    )
    assert verdict.hold is True


async def test_loops_noop_when_jev_dark(monkeypatch):
    from marketer.jev import loops

    monkeypatch.setattr(loops.settings, "jev_enabled", True)
    monkeypatch.setattr(loops, "available", lambda: False)
    v = await loops.after_content_qa({"x": 1})
    assert v.fail is False and v.park is False and v.retry is False
    assert await loops.filter_research_pages("q", [{"url": "a"}, {"url": "b"}]) == [
        {"url": "a"},
        {"url": "b"},
    ]
    assert await loops.should_index_asset({"kind": "final"}) is True


def test_candidate_spans_are_verbatim():
    from marketer.company_os.knowledge import candidate_spans, state_text

    text = (
        "Never use the word hack in headlines. "
        "Our audience is first-time founders.\n"
        "Hi."
    )
    spans = candidate_spans(text)
    assert "Never use the word hack in headlines." in spans
    assert "Our audience is first-time founders." in spans
    assert all("hack" in s or "founders" in s for s in spans)
    assert state_text({"request": "Never use slang."}) == "Never use slang."


def test_should_spawn_repurpose_is_strict():
    from marketer.jev.loops import should_spawn_repurpose

    assert should_spawn_repurpose(None) is False
    assert should_spawn_repurpose({"target": "social", "confidence": 0.99}) is False
    assert should_spawn_repurpose({"target": "article", "confidence": 0.69}) is False
    assert should_spawn_repurpose({"target": "article", "confidence": 0.7}) is True


def test_knowledge_prompt_block_is_verbatim():
    from marketer.repos.company_knowledge import KnowledgeRow, as_prompt_block

    block = as_prompt_block(
        [
            KnowledgeRow(kind="brand_rule", span="Never use hack"),
            KnowledgeRow(kind="noise", span="ignore me"),
        ]
    )
    assert "Never use hack" in block
    assert "ignore me" not in block
    assert as_prompt_block([]) == ""


async def test_classify_knowledge_spans_drops_noise(monkeypatch):
    from marketer.jev import decisions
    from marketer.jev.primitives import SystemOneResult

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        return SystemOneResult(
            model="jev-latest",
            answers={
                "k0": ChoiceAnswer(
                    choice="brand_rule",
                    probabilities={"brand_rule": 0.9, "noise": 0.1},
                    confidence=0.8,
                ),
                "k1": ChoiceAnswer(
                    choice="noise",
                    probabilities={"noise": 0.8, "brand_rule": 0.2},
                    confidence=0.9,
                ),
            },
            backend="jev",
        )

    monkeypatch.setattr(decisions, "jev_ask", fake_ask)
    out = await decisions.classify_knowledge_spans(
        ["Never use hack in headlines", "lol whatever"]
    )
    assert len(out) == 1
    assert out[0].kind == "brand_rule"
    assert out[0].text == "Never use hack in headlines"


async def test_image_post_publish_gate_parks(monkeypatch):
    from decimal import Decimal
    from uuid import uuid4

    from marketer.jev.loops import LoopVerdict
    from marketer.models import Niche, PostingWindow
    from marketer.repos import image_posts as repo
    from marketer.repos import niches as niches_repo
    from marketer.services import image_posts as svc

    pid = uuid4()
    state: dict = {}

    async def fake_get(p, *, user_id):
        return {
            "id": pid,
            "user_id": "user_jev",
            "niche_id": uuid4(),
            "kind": "single",
            "topic": "t",
            "status": "generating",
            "payload": {
                "slides": [{"index": 0, "path": "/tmp/s.png"}],
                "caption": "c",
                "hashtags": [],
            },
        }

    async def fake_niche(nid, *, user_id):
        return Niche(
            id=nid,
            user_id="user_jev",
            title="t",
            description="d",
            target_audience="a",
            visual_style="v",
            voice="onyx",
            target_duration_sec=30,
            scene_count=2,
            posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
            platforms=["reels"],
            daily_spend_cap_usd=Decimal("5"),
        )

    async def fake_save(p, *, user_id, payload):
        state["payload"] = payload
        return {"payload": payload}

    async def fake_set_status(p, *, user_id, status):
        state["status"] = status
        return {"status": status}

    async def fake_gate(st, *, tool="schedule_post", human_approved=False, spend=None):
        return LoopVerdict(
            park=True, reason="auto-mode block", payload={"auto_mode": {"verdict": "block"}}
        )

    monkeypatch.setattr(repo, "get", fake_get)
    monkeypatch.setattr(repo, "save_payload", fake_save)
    monkeypatch.setattr(repo, "set_status", fake_set_status)
    monkeypatch.setattr(niches_repo, "get", fake_niche)
    monkeypatch.setattr("marketer.jev.loops.publish_gate", fake_gate)

    result = await svc.schedule_image_post(user_id="user_jev", image_post_id=pid)
    assert result["status"] == "awaiting_approval"
    assert state["status"] == "awaiting_approval"


def test_jev_knowledge_route_ok(monkeypatch):
    from marketer.repos import company_knowledge as knowledge_repo

    async def fake_list(user_id, *, limit=40):
        from marketer.repos.company_knowledge import KnowledgeRow

        return [KnowledgeRow(kind="constraint", span="Daily cap is $5")]

    monkeypatch.setattr(knowledge_repo, "list_for_user", fake_list)
    client = _jev_client(monkeypatch)
    resp = client.get(
        "/api/v1/jev/knowledge", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"][0]["span"] == "Daily cap is $5"
    assert "Daily cap is $5" in body["prompt_block"]


def test_qwen_models_are_in_openrouter_registry():
    from marketer.services import openrouter

    ids = {m.id for m in openrouter.OPENROUTER_MODELS}
    assert "qwen/qwen3-32b" in ids
    assert "qwen/qwen3-8b" in ids
    assert "qwen/qwen3-235b-a22b" in ids
