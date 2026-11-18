"""services.decisions: the client, mode resolution, metering and the log.

No network: OpenRouter is an httpx.MockTransport. No DB: the decision_log
repo and the feature-flags repo are monkeypatched.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest

from marketer.decisions import questions as q
from marketer.repos import decision_log as decision_log_repo
from marketer.repos import feature_flags as flags_repo
from marketer.repos.feature_flags import FeatureFlag
from marketer.services import decisions as svc

QS: q.Questions = {
    "filler": q.YesNo("Does `hook` open with filler?"),
    "cause": q.Choice("Why?", {"a": None, "b": "B"}),
    "stop": q.Score("Stop?", ("no", "maybe", "yes")),
}
# The wire shape, as the API returns it (docs/decisions/openrouter-contract.md):
# every answer carries its type, and a score is the expected level (0..2 here).
GOOD_ANSWERS = {
    "filler": {"type": "noul", "noul": 0.2},
    "cause": {"type": "choice", "choice": "b", "confidence": 0.7,
              "probabilities": {"a": 0.3, "b": 0.7}},
    "stop": {"type": "score", "score": 1.2, "confidence": 0.8,
             "probabilities": {"0": 0.1, "1": 0.6, "2": 0.3}},
}
STATE = {"hook": "You are losing $40 a month to this setting", "email": "x@example.com"}


def ok_body(**over) -> dict:
    return {"answers": GOOD_ANSWERS, "model": q.D1_MODEL,
            "usage": {"cost": 0.000012, "input_tokens": 300, "output_tokens": 21}, **over}


def transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def json_handler(body: dict, status: int = 200, seen: list | None = None):
    async def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, json=body)
    return handle


@pytest.fixture
def logged(monkeypatch) -> list[dict]:
    rows: list[dict] = []

    async def insert(**kw):
        rows.append(kw)

    monkeypatch.setattr(decision_log_repo, "insert", insert)
    return rows


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")

    async def no_flags():
        return []

    monkeypatch.setattr(flags_repo, "list_all", no_flags)


def client_with(handler) -> svc.DecisionClient:
    return svc.DecisionClient(key="or-test-key", transport=transport(handler))


# ---------------------------------------------------------------------------
# No key: off, nothing touched
# ---------------------------------------------------------------------------


async def test_no_key_is_off_and_touches_nothing(monkeypatch, fake_spend, logged):
    from marketer.config import settings

    monkeypatch.setattr(settings, "openrouter_api_key", "")

    async def boom(*a, **k):
        raise AssertionError("must not be called without a key")

    monkeypatch.setattr(flags_repo, "list_all", boom)
    monkeypatch.setattr(svc.DecisionClient, "decide", boom)
    spend, rec = fake_spend
    monkeypatch.setattr(spend, "ensure_can_spend", boom)

    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1", spend=spend)
    assert d.mode == "off" and not d.ok and not d.enforce
    await d.log(action="proceed", rule_action="proceed")
    assert logged == [] and rec.entries == []
    assert await svc.resolve_mode(q.Point.HOOK_SCORE) == "off"


async def test_backend_generation_key_does_not_turn_decisions_on(monkeypatch):
    from marketer.config import settings

    async def no_flags():
        return []

    monkeypatch.setattr(flags_repo, "list_all", no_flags)
    monkeypatch.setattr(settings, "openrouter_api_key", "or-backend")
    # Decisions are opt-in: only OPENROUTER_API_KEY turns them on.
    assert svc.api_key() == ""
    assert await svc.resolve_mode(q.Point.HOOK_SCORE) == "off"


# ---------------------------------------------------------------------------
# Mode resolution
# ---------------------------------------------------------------------------


async def test_key_defaults_every_point_to_shadow_never_enforce(with_key):
    for point in q.Point:
        assert await svc.resolve_mode(point) == "shadow"


async def test_env_per_point_and_kill_switch(with_key, monkeypatch):
    monkeypatch.setenv("MARKETER_DECISION_HOOK_SCORE_MODE", "enforce")
    assert await svc.resolve_mode(q.Point.HOOK_SCORE) == "enforce"
    assert await svc.resolve_mode(q.Point.QA_VIDEO) == "shadow"
    monkeypatch.setenv("MARKETER_DECISIONS_MODE", "off")
    assert await svc.resolve_mode(q.Point.HOOK_SCORE) == "off"


async def test_invalid_env_mode_is_ignored(with_key, monkeypatch):
    monkeypatch.setenv("MARKETER_DECISION_HOOK_SCORE_MODE", "yolo")
    assert await svc.resolve_mode(q.Point.HOOK_SCORE) == "shadow"


async def test_feature_flags_promote_or_switch_off(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")
    now = datetime.now(timezone.utc)

    def flag(key, on=True):
        return FeatureFlag(key=key, enabled=on, description="", updated_by=None,
                           updated_at=now, created_at=now)

    async def flags():
        return [
            flag("decision.qa_video.enforce"),
            flag("decision.hook_score.enforce"),
            flag("decision.hook_score.off"),      # off beats enforce
            flag("decision.budget_shift.enforce", on=False),
            flag("unrelated.flag"),
        ]

    monkeypatch.setattr(flags_repo, "list_all", flags)
    svc.reset_flag_cache()
    assert await svc.resolve_mode(q.Point.QA_VIDEO) == "enforce"
    assert await svc.resolve_mode(q.Point.HOOK_SCORE) == "off"
    assert await svc.resolve_mode(q.Point.BUDGET_SHIFT) == "shadow"


async def test_flag_read_failure_falls_back_to_shadow(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")

    async def broken():
        raise RuntimeError("no db")

    monkeypatch.setattr(flags_repo, "list_all", broken)
    svc.reset_flag_cache()
    assert await svc.resolve_mode(q.Point.QA_VIDEO) == "shadow"


# ---------------------------------------------------------------------------
# Mocked success
# ---------------------------------------------------------------------------


async def test_success_normalises_answers_meters_and_logs(with_key, fake_spend, logged):
    seen: list[httpx.Request] = []
    spend, rec = fake_spend
    d = await svc.decide(
        q.Point.HOOK_SCORE, STATE, QS, user_id="u1", spend=spend,
        subject_kind="job", subject_id="j1",
        client=client_with(json_handler(ok_body(), seen=seen)),
    )
    assert d.ok and d.mode == "shadow" and not d.enforce
    assert d.answers == {
        "filler": {"type": "yesno", "probability": 0.2},
        "cause": {"type": "choice", "choice": "b", "confidence": 0.7,
                  "probabilities": {"a": 0.3, "b": 0.7}},
        "stop": {"type": "score", "score": 0.6, "level": 1.2, "confidence": 0.8},
    }

    req = seen[0]
    assert str(req.url) == q.DEFAULT_DECISIONS_URL
    assert req.headers["authorization"] == "Bearer or-test-key"
    sent = json.loads(req.content)
    assert sent["model"] == q.D1_MODEL
    assert sent["questions"]["filler"] == {"type": "noul", "instructions": QS["filler"].instructions}
    # Choice options and score levels both travel as `criteria`.
    assert sent["questions"]["cause"] == {
        "type": "choice", "instructions": "Why?", "criteria": {"a": None, "b": "B"}}
    assert sent["questions"]["stop"] == {
        "type": "score", "instructions": "Stop?", "criteria": ["no", "maybe", "yes"]}

    # Metered into the spend ledger at OpenRouter's returned cost.
    assert len(rec.entries) == 1
    e = rec.entries[0]
    assert (e.provider, e.sku) == ("openrouter", f"decision:{q.D1_MODEL}")
    assert e.cost_usd == Decimal("0.000012") and e.units == Decimal(321)  # input + output

    await d.log(action="proceed", rule_action="proceed", table_action="regenerate")
    await d.log(action="proceed", rule_action="proceed")  # logged once only
    assert len(logged) == 1
    row = logged[0]
    assert row["point"] == "hook_score" and row["mode"] == "shadow"
    assert row["questions_version"] == "hook_score.v1"
    assert row["fallback_used"] is False and row["reason"] is None
    assert row["table_action"] == "regenerate" and row["action_taken"] == "proceed"
    assert row["cost_usd"] == Decimal("0.000012")
    assert row["subject_kind"] == "job" and row["subject_id"] == "j1"
    # The state is hashed, never stored: no raw PII in the row.
    assert row["state_hash"] == svc.state_hash(STATE) and len(row["state_hash"]) == 64
    assert "x@example.com" not in json.dumps(row, default=str)


@pytest.mark.parametrize("level, normalised", [(0, 0.0), (0.5, 0.25), (1, 0.5), (2, 1.0)])
async def test_a_score_is_a_level_index_and_is_always_normalised(with_key, level, normalised):
    # A level at or below 1 is still a level: 0.5 of 0..2 is weak, not middling.
    body = ok_body(answers={**GOOD_ANSWERS,
                            "stop": {"type": "score", "score": level, "confidence": 0.9}})
    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1",
                         client=client_with(json_handler(body)))
    assert d.answers["stop"]["score"] == normalised
    assert d.answers["stop"]["level"] == level


async def test_url_and_model_come_from_env(with_key, monkeypatch):
    monkeypatch.setenv("OPENROUTER_DECISIONS_URL", "https://example.test/decide")
    monkeypatch.setenv("MARKETER_DECISIONS_MODEL", "typesafe/jev-9-20990101")
    seen: list[httpx.Request] = []
    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1",
                         client=svc.DecisionClient(key="k", transport=transport(
                             json_handler(ok_body(model=None), seen=seen))))
    assert str(seen[0].url) == "https://example.test/decide"
    assert json.loads(seen[0].content)["model"] == "typesafe/jev-9-20990101"
    assert d.model == "typesafe/jev-9-20990101"


async def test_d0_tier_uses_cheap_model(with_key):
    seen: list[httpx.Request] = []
    await svc.decide(q.Point.WHAT_TO_POST, STATE, QS, user_id="u1", tier="D0",
                     client=client_with(json_handler(ok_body(), seen=seen)))
    assert json.loads(seen[0].content)["model"] == q.D0_MODEL


# ---------------------------------------------------------------------------
# Second tier: batch scoring only, and only when the model is down
# ---------------------------------------------------------------------------


def _by_model(responses: dict[str, tuple[int, dict]], seen: list[str]):
    async def handle(request: httpx.Request) -> httpx.Response:
        model = json.loads(request.content)["model"]
        seen.append(model)
        status, body = responses[model]
        return httpx.Response(status, json=body)
    return handle


def test_only_batch_scoring_has_a_second_tier():
    assert [p for p, spec in q.POINTS.items() if spec.second_tier] == [q.Point.WHAT_TO_POST]
    # Pinned, dated slugs with an author: never a floating alias.
    for slug in (q.D1_MODEL, q.D0_MODEL):
        assert "/" in slug and slug[-8:].isdigit() and "latest" not in slug


@pytest.mark.parametrize("status", [500, 502, 503, 429, 408])
async def test_batch_scoring_tries_the_second_tier_when_the_model_is_down(
    with_key, fake_spend, status
):
    seen: list[str] = []
    spend, rec = fake_spend
    d = await svc.decide(
        q.Point.WHAT_TO_POST, STATE, QS, user_id="u1", spend=spend,
        client=client_with(_by_model({
            q.D1_MODEL: (status, {"error": {"code": status, "message": "down"}}),
            q.D0_MODEL: (200, ok_body(model=q.D0_MODEL)),
        }, seen)),
    )
    assert seen == [q.D1_MODEL, q.D0_MODEL]
    assert d.ok and d.model == q.D0_MODEL
    # Metered once, under the model that answered.
    assert [e.sku for e in rec.entries] == [f"decision:{q.D0_MODEL}"]


@pytest.mark.parametrize("status", [400, 401, 402, 403, 404, 413])
async def test_no_second_tier_for_a_request_another_model_would_not_fix(with_key, status):
    seen: list[str] = []
    d = await svc.decide(
        q.Point.WHAT_TO_POST, STATE, QS, user_id="u1",
        client=client_with(_by_model({
            q.D1_MODEL: (status, {"error": {"code": status, "message": "no"}}),
            q.D0_MODEL: (200, ok_body(model=q.D0_MODEL)),
        }, seen)),
    )
    assert seen == [q.D1_MODEL] and not d.ok and d.error == f"http: {status}"


async def test_no_second_tier_for_a_refusal_or_a_malformed_answer(with_key):
    for answers in ({**GOOD_ANSWERS, "filler": {"type": "refusal"}}, {"filler": {"nope": 1}}):
        seen: list[str] = []
        d = await svc.decide(
            q.Point.WHAT_TO_POST, STATE, QS, user_id="u1",
            client=client_with(_by_model({
                q.D1_MODEL: (200, ok_body(answers=answers)),
                q.D0_MODEL: (200, ok_body(model=q.D0_MODEL)),
            }, seen)),
        )
        assert seen == [q.D1_MODEL] and not d.ok


async def test_second_tier_failure_is_still_a_failure(with_key, fake_spend):
    seen: list[str] = []
    spend, rec = fake_spend
    down = (503, {"error": {"code": 503, "message": "down"}})
    d = await svc.decide(
        q.Point.WHAT_TO_POST, STATE, QS, user_id="u1", spend=spend,
        client=client_with(_by_model({q.D1_MODEL: down, q.D0_MODEL: down}, seen)),
    )
    assert seen == [q.D1_MODEL, q.D0_MODEL]
    assert not d.ok and d.error == "http: 503" and rec.entries == []


@pytest.mark.parametrize(
    "point", [q.Point.HOOK_SCORE, q.Point.BUDGET_SHIFT, q.Point.QA_VIDEO, q.Point.QA_ARTICLE]
)
async def test_gating_points_never_switch_model(with_key, point):
    seen: list[str] = []
    d = await svc.decide(
        point, STATE, QS, user_id="u1",
        client=client_with(_by_model({
            q.D1_MODEL: (503, {"error": {"code": 503, "message": "down"}}),
            q.D0_MODEL: (200, ok_body(model=q.D0_MODEL)),
        }, seen)),
    )
    assert seen == [q.D1_MODEL] and not d.ok


async def test_already_on_the_second_tier_does_not_call_it_twice(with_key):
    seen: list[str] = []
    down = (503, {"error": {"code": 503, "message": "down"}})
    d = await svc.decide(
        q.Point.WHAT_TO_POST, STATE, QS, user_id="u1", tier="D0",
        client=client_with(_by_model({q.D0_MODEL: down}, seen)),
    )
    assert seen == [q.D0_MODEL] and not d.ok


# ---------------------------------------------------------------------------
# Metering failures never change the decision
# ---------------------------------------------------------------------------


class _NotNull(Exception):
    """Shaped like the driver's error for Postgres 23502."""

    sqlstate = "23502"


async def test_niche_less_ledger_row_rejected_by_the_schema_is_logged_and_skipped(
    with_key, fake_spend, caplog
):
    spend, rec = fake_spend
    spend.niche_id = None

    async def reject(entry):
        raise _NotNull('null value in column "niche_id" violates not-null constraint')

    spend.record = reject
    with caplog.at_level("WARNING"):
        d = await svc.decide(q.Point.BUDGET_SHIFT, STATE, QS, user_id="u1", spend=spend,
                             client=client_with(json_handler(ok_body())))
    assert d.ok and d.cost_usd == Decimal("0.000012")
    assert any("spend_ledger needs a nullable niche_id" in r.message for r in caplog.records)


async def test_any_other_metering_error_is_logged_and_the_decision_stands(
    with_key, fake_spend, caplog
):
    spend, _ = fake_spend

    async def broken(entry):
        raise RuntimeError("db down")

    spend.record = broken
    with caplog.at_level("WARNING"):
        d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1", spend=spend,
                             client=client_with(json_handler(ok_body())))
    assert d.ok
    assert any(r.message == "decision metering raised" for r in caplog.records)


async def test_ledger_context_is_niche_less_and_none_without_a_database(monkeypatch):
    from marketer.services import spend_context

    async def build(**kw):
        assert kw == {"user_id": "u1", "niche_id": None, "job_id": None}
        return "ctx"

    monkeypatch.setattr(spend_context, "default_context", build)
    assert await svc.ledger_context("u1") == "ctx"

    async def no_db(**kw):
        raise RuntimeError("no database")

    monkeypatch.setattr(spend_context, "default_context", no_db)
    assert await svc.ledger_context("u1") is None


# ---------------------------------------------------------------------------
# Failures take the fallback (a failure is never a "no")
# ---------------------------------------------------------------------------


async def test_timeout_takes_the_fallback(with_key, monkeypatch, fake_spend, logged):
    monkeypatch.setitem(q.POINTS, q.Point.HOOK_SCORE,
                        replace(q.POINTS[q.Point.HOOK_SCORE], timeout_s=0.05))

    async def slow(request):
        await asyncio.sleep(2)
        return httpx.Response(200, json=ok_body())

    spend, rec = fake_spend
    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1", spend=spend,
                         client=client_with(slow))
    assert not d.ok and not d.enforce
    assert d.error.startswith("timeout")
    assert d.latency_ms < 1500
    assert rec.entries == []  # nothing priced, nothing metered
    await d.log(action="proceed", rule_action="proceed")
    assert logged[0]["fallback_used"] is True and logged[0]["answers"] is None


@pytest.mark.parametrize(
    "handler_body, status, kind",
    [
        ({"error": "boom"}, 500, "http"),
        ({"error": "rate"}, 429, "http"),
        (ok_body(usage={}), 200, "no_cost"),               # unpriced: rejected
        (ok_body(usage={"cost": -1}), 200, "no_cost"),
        (ok_body(answers={"filler": {"type": "noul", "noul": 0.2}}), 200, "invalid"),  # partial
        (ok_body(answers={**GOOD_ANSWERS, "filler": {"type": "noul", "noul": 1.7}}),
         200, "invalid"),
        (ok_body(answers={**GOOD_ANSWERS, "filler": {"noul": 0.2}}), 200, "invalid"),  # untyped
        (ok_body(answers={**GOOD_ANSWERS,
                          "cause": {"type": "choice", "choice": "zzz", "confidence": 1}}),
         200, "invalid"),
        (ok_body(answers={**GOOD_ANSWERS,
                          "stop": {"type": "score", "score": 2.5, "confidence": 1}}),
         200, "invalid"),
        (ok_body(answers={**GOOD_ANSWERS, "filler": {"type": "refusal"}}), 200, "refused"),
        ([1, 2, 3], 200, "invalid"),
    ],
)
async def test_errors_take_the_fallback(with_key, fake_spend, handler_body, status, kind):
    spend, rec = fake_spend
    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1", spend=spend,
                         client=client_with(json_handler(handler_body, status)))
    assert not d.ok and d.error.startswith(kind)
    assert rec.entries == []


async def test_transport_error_takes_the_fallback(with_key):
    async def down(request):
        raise httpx.ConnectError("refused")

    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1", client=client_with(down))
    assert not d.ok and d.error.startswith("transport")


async def test_refused_spend_preflight_skips_the_call(with_key, fake_spend):
    from marketer.repos.spend import SpendCapExceeded

    spend, _ = fake_spend
    calls = []

    async def refuse(_est):
        raise SpendCapExceeded("cap", scope="niche")

    spend.ensure_can_spend = refuse
    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1", spend=spend,
                         client=client_with(json_handler(ok_body(), seen=calls)))
    assert not d.ok and calls == []


async def test_log_write_failure_never_raises(with_key, monkeypatch):
    async def broken(**kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(decision_log_repo, "insert", broken)
    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id="u1",
                         client=client_with(json_handler(ok_body())))
    await d.log(action="proceed", rule_action="proceed")  # no exception


async def test_no_user_means_no_call(with_key):
    calls = []
    d = await svc.decide(q.Point.HOOK_SCORE, STATE, QS, user_id=None,
                         client=client_with(json_handler(ok_body(), seen=calls)))
    assert d.mode == "off" and calls == []

