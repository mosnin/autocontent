"""Decision points wired into the pipelines: 3 (what to post), 4 (hook gate),
5 (budget shifts) and 9 (QA verify).

For each point: no key leaves today's behaviour untouched, shadow logs the
table's choice but acts on the rule, enforce acts on the table (tightening
only), and a timeout or an error takes the fallback.
"""
from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from marketer.decisions import points
from marketer.decisions import questions as q
from marketer.models import Idea, Scene, Script
from marketer.repos import decision_log as decision_log_repo
from marketer.repos import feature_flags as flags_repo
from marketer.services import decisions as svc

# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


@pytest.fixture
def logged(monkeypatch) -> list[dict]:
    rows: list[dict] = []

    async def insert(**kw):
        rows.append(kw)

    monkeypatch.setattr(decision_log_repo, "insert", insert)
    return rows


@pytest.fixture
def model(monkeypatch):
    """Turn decisions on and answer from a callable(questions) -> answers.
    Set ``model.mode`` per test; set ``model.fail`` to 'timeout' or 'error'."""

    class M:
        mode = "shadow"
        fail: str | None = None
        answer = None
        calls: list[dict] = []

    m = M()
    m.calls = []
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")

    async def no_flags():
        return []

    monkeypatch.setattr(flags_repo, "list_all", no_flags)

    async def handle(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content)
        m.calls.append(body)
        if m.fail == "timeout":
            await asyncio.sleep(2)
        if m.fail == "error":
            return httpx.Response(502, json={"error": "upstream"})
        return httpx.Response(200, json={
            "answers": _wire(m.answer(body["questions"]), body["questions"]),
            "model": body["model"],
            "usage": {"cost": 0.00002, "input_tokens": 90, "output_tokens": 10},
        })

    real_client = svc.DecisionClient
    monkeypatch.setattr(
        svc, "DecisionClient",
        lambda: real_client(key="k", transport=httpx.MockTransport(handle)),
    )

    def set_mode(point: q.Point, mode: str):
        monkeypatch.setenv(f"MARKETER_DECISION_{point.value.upper()}_MODE", mode)
        for p in q.POINTS:  # keep timeouts short so the timeout row is fast
            monkeypatch.setitem(q.POINTS, p, replace(q.POINTS[p], timeout_s=0.1))

    m.set_mode = set_mode
    return m


def yn(p):
    return {"noul": p}


def sc(s):
    """A score as a 0..1 position; ``_wire`` turns it into the level index
    the API returns for the question's scale."""
    return {"score": s, "confidence": 0.9}


def _wire(answers: dict, questions: dict) -> dict:
    """Stamp the short answers above with what the API really sends: the
    answer's type, and a score as a level index (0..levels-1)."""
    out = {}
    for name, a in answers.items():
        a = dict(a)
        if "noul" in a:
            a.setdefault("type", "noul")
        elif "choice" in a:
            a.setdefault("type", "choice")
        elif "score" in a:
            a.setdefault("type", "score")
            a["score"] = a["score"] * (len(questions[name]["criteria"]) - 1)
        out[name] = a
    return out


# ---------------------------------------------------------------------------
# Point 3: what to post next (ideation)
# ---------------------------------------------------------------------------


def _ideas(n=3):
    return [Idea(topic=f"t{i}", angle=f"a{i}", hook=f"h{i}", target_audience="x",
                 why_it_works="y") for i in range(n)]


def _rank_answer(prefs: dict[int, float], repeats=(), off_niche=()):
    def answer(questions):
        out = {}
        for name in questions:
            i = int(name[1:name.index("_")])
            if name.endswith("_interest"):
                out[name] = sc(prefs.get(i, 0.1))
            elif name.endswith("_repeat"):
                out[name] = yn(0.9 if i in repeats else 0.1)
            else:
                out[name] = yn(0.1 if i in off_niche else 0.9)
        return out
    return answer


async def _pick(spend, judge_index=0, ideas=None):
    ideas = ideas or _ideas()
    scored = points.start(points.score_ideas(
        ideas, niche_title="n", target_audience="a", recent_topics=["old"], spend=spend))
    return await points.pick_idea(scored, judge_index)


async def test_point3_no_key_returns_judge_pick(fake_spend, logged):
    spend, rec = fake_spend
    assert await _pick(spend, judge_index=2) == 2
    assert logged == [] and rec.entries == []


async def test_point3_shadow_logs_table_pick_but_keeps_judge(model, fake_spend, logged):
    model.set_mode(q.Point.WHAT_TO_POST, "shadow")
    model.answer = _rank_answer({1: 0.9})
    spend, rec = fake_spend
    assert await _pick(spend, judge_index=0) == 0
    assert logged[0]["table_action"] == "pick:1" and logged[0]["action_taken"] == "pick:0"
    assert len(rec.entries) == 1  # metered


async def test_point3_enforce_takes_table_pick(model, fake_spend, logged):
    model.set_mode(q.Point.WHAT_TO_POST, "enforce")
    model.answer = _rank_answer({0: 0.95, 2: 0.6}, repeats={0})
    spend, _ = fake_spend
    assert await _pick(spend, judge_index=1) == 2
    assert logged[0]["action_taken"] == "pick:2" and logged[0]["fallback_used"] is False


async def test_point3_enforce_all_dropped_falls_back_to_judge(model, fake_spend, logged):
    model.set_mode(q.Point.WHAT_TO_POST, "enforce")
    model.answer = _rank_answer({}, repeats={0, 1}, off_niche={2})
    spend, _ = fake_spend
    assert await _pick(spend, judge_index=1) == 1
    assert logged[0]["table_action"] == "none" and logged[0]["fallback_used"] is True


@pytest.mark.parametrize("fail", ["timeout", "error"])
async def test_point3_failure_falls_back_to_judge(model, fake_spend, logged, fail):
    model.set_mode(q.Point.WHAT_TO_POST, "enforce")
    model.fail = fail
    spend, rec = fake_spend
    assert await _pick(spend, judge_index=2) == 2
    assert logged[0]["fallback_used"] is True and rec.entries == []


async def test_point3_more_than_30_candidates_uses_d0(model, fake_spend, logged):
    model.set_mode(q.Point.WHAT_TO_POST, "shadow")
    model.answer = _rank_answer({})
    spend, _ = fake_spend
    await _pick(spend, ideas=_ideas(31))
    assert model.calls[0]["model"] == q.D0_MODEL


async def test_run_ideation_enforce_overrides_judge(model, fake_spend, logged, monkeypatch):
    from marketer.agents import ideation
    from marketer.config import settings

    monkeypatch.setattr(settings, "ideation_candidates", 3)
    ideas = _ideas()
    calls = {"n": 0}

    class R:
        def __init__(self, out):
            self.out = out

        def final_output_as(self, cls):
            return self.out

    async def fake_run(agent, prompt, spend=None, **kw):
        if agent.name == "IdeaJudge":
            return R(ideation.IdeaVerdict(winner_index=0, reasoning="r"))
        calls["n"] += 1
        return R(ideas[calls["n"] - 1])

    monkeypatch.setattr(ideation, "run_metered", fake_run)
    model.set_mode(q.Point.WHAT_TO_POST, "enforce")
    model.answer = _rank_answer({2: 0.9})
    spend, _ = fake_spend
    assert (await ideation.run_ideation("niche", spend=spend)).topic == "t2"

    model.set_mode(q.Point.WHAT_TO_POST, "shadow")
    calls["n"] = 0
    assert (await ideation.run_ideation("niche", spend=spend)).topic == "t0"


# ---------------------------------------------------------------------------
# Point 4: hook gate
# ---------------------------------------------------------------------------


def _script(hook="You are losing $40 a month to one setting", narration=None):
    narration = narration or "You are losing forty dollars a month and the fix takes one tap"
    return Script(
        idea=Idea(topic="t", angle="a", hook=hook, target_audience="x", why_it_works="y"),
        scenes=[Scene(index=0, narration=narration, visual_prompt="v", motion_prompt="m",
                      duration_sec=5), Scene(index=1, narration="more", visual_prompt="v",
                                             motion_prompt="m", duration_sec=5)],
        total_duration_sec=10,
    )


def _hook_answer(weak=False, forbidden=0.0):
    def answer(questions):
        out = {
            "specific_promise": yn(0.2 if weak else 0.9),
            "greeting_filler": yn(0.1),
            "concrete_outcome": yn(0.2 if weak else 0.9),
            "open_loop": yn(0.8),
            "stop_scroll": sc(0.7),
        }
        if "forbidden_claim" in questions:
            out["forbidden_claim"] = yn(forbidden)
        return out
    return answer


async def _gate(spend, script=None, rewrite=None, rules=(), banned=()):
    async def no_rewrite(s):
        raise AssertionError("rewrite must not run")

    return await points.gate_hook(
        script or _script(), niche_title="n", target_audience="a",
        brand_rules=list(rules), banned_words=list(banned),
        rewrite=rewrite or no_rewrite, spend=spend,
    )


async def test_point4_no_key_proceeds_untouched(fake_spend, logged):
    spend, rec = fake_spend
    s = _script()
    out, action = await _gate(spend, s, banned=["losing"])
    assert out is s and action == "proceed" and logged == [] and rec.entries == []


async def test_point4_shadow_never_holds_or_rewrites(model, fake_spend, logged):
    model.set_mode(q.Point.HOOK_SCORE, "shadow")
    model.answer = _hook_answer(forbidden=0.9)
    spend, _ = fake_spend
    s = _script()
    out, action = await _gate(spend, s, rules=["Never touch: crypto"])
    assert out is s and action == "proceed"
    assert logged[0]["table_action"] == "hold" and logged[0]["action_taken"] == "proceed"
    assert "brand_rules" in str(model.calls[0]["questions"]["forbidden_claim"])


async def test_point4_enforce_holds_forbidden_claim(model, fake_spend, logged):
    model.set_mode(q.Point.HOOK_SCORE, "enforce")
    model.answer = _hook_answer(forbidden=0.6)
    spend, _ = fake_spend
    _, action = await _gate(spend, rules=["Never touch: crypto"])
    assert action == "hold" and logged[0]["action_taken"] == "hold"


async def test_point4_enforce_holds_banned_word_from_code(model, fake_spend, logged):
    model.set_mode(q.Point.HOOK_SCORE, "enforce")
    model.answer = _hook_answer()
    spend, _ = fake_spend
    _, action = await _gate(spend, banned=["Losing"])
    assert action == "hold"


async def test_point4_enforce_regenerates_once_and_keeps_a_good_rewrite(model, fake_spend, logged):
    model.set_mode(q.Point.HOOK_SCORE, "enforce")
    model.answer = _hook_answer(weak=True)
    spend, _ = fake_spend
    calls = []
    better = _script(hook="Three numbers decide your rent")

    async def rewrite(s):
        calls.append(s)
        return better

    out, action = await _gate(spend, rewrite=rewrite)
    assert action == "regenerated" and out is better and len(calls) == 1
    assert len(model.calls) == 1  # the rewrite is not re-judged by the model


async def test_point4_enforce_rejects_a_rewrite_that_fails_code_checks(model, fake_spend, logged):
    model.set_mode(q.Point.HOOK_SCORE, "enforce")
    model.answer = _hook_answer(weak=True)
    spend, _ = fake_spend
    s = _script()

    async def too_long(_):
        return _script(hook=" ".join(["word"] * 20))

    out, action = await _gate(spend, s, rewrite=too_long)
    assert out is s and action == "proceed"


async def test_point4_enforce_failed_rewrite_keeps_original(model, fake_spend, logged):
    model.set_mode(q.Point.HOOK_SCORE, "enforce")
    model.answer = _hook_answer(weak=True)
    spend, _ = fake_spend
    s = _script()

    async def broken(_):
        raise RuntimeError("model down")

    out, action = await _gate(spend, s, rewrite=broken)
    assert out is s and action == "proceed"


async def test_point4_rewrite_cap_breach_propagates(model, fake_spend, logged):
    from marketer.repos.spend import SpendCapExceeded

    model.set_mode(q.Point.HOOK_SCORE, "enforce")
    model.answer = _hook_answer(weak=True)
    spend, _ = fake_spend

    async def capped(_):
        raise SpendCapExceeded("cap", scope="niche")

    with pytest.raises(SpendCapExceeded):
        await _gate(spend, rewrite=capped)


@pytest.mark.parametrize("fail", ["timeout", "error"])
async def test_point4_failure_proceeds(model, fake_spend, logged, fail):
    model.set_mode(q.Point.HOOK_SCORE, "enforce")
    model.fail = fail
    spend, _ = fake_spend
    s = _script()
    out, action = await _gate(spend, s, rules=["x"])
    assert out is s and action == "proceed" and logged[0]["fallback_used"] is True


async def test_rewrite_hook_checks_pacing_in_code(monkeypatch, fake_spend):
    from marketer.agents import scriptwriter

    class R:
        def __init__(self, out):
            self.out = out

        def final_output_as(self, cls):
            return self.out

    out = scriptwriter.HookRewrite(hook="Three numbers decide your rent",
                                   scene0_narration=" ".join(["w"] * 12))

    async def fake_run(agent, prompt, spend=None, **kw):
        return R(out)

    monkeypatch.setattr(scriptwriter, "run_metered", fake_run)
    spend, _ = fake_spend
    s = _script()
    new = await scriptwriter.rewrite_hook(s, spend=spend)  # 12 words in a 5 s scene: ok
    assert new.idea.hook == out.hook and new.scenes[0].narration == out.scene0_narration
    assert new.scenes[1] == s.scenes[1] and s.idea.hook != out.hook

    out.scene0_narration = "too short"
    assert await scriptwriter.rewrite_hook(s, spend=spend) is None


# ---------------------------------------------------------------------------
# Point 5: budget shifts (fails closed to today's rule)
# ---------------------------------------------------------------------------


def _metrics():
    from marketer.repos.ads import AdMetricsDaily

    start = date.today() - timedelta(days=6)
    return [AdMetricsDaily(date=start + timedelta(days=i), impressions=1000, clicks=50,
                           spend_usd=Decimal("10"), conversions=Decimal(i % 3),
                           revenue_usd=Decimal("40")) for i in range(7)]


def _campaign():
    from datetime import datetime, timezone

    from marketer.repos.ads import AdCampaign

    now = datetime.now(timezone.utc)
    fields = AdCampaign.model_fields
    data = {"id": uuid4(), "user_id": "u1", "daily_budget_usd": Decimal("10")}
    for name in ("ad_account_id", "account_id"):
        if name in fields:
            data[name] = uuid4()
    for name in ("created_at", "updated_at"):
        if name in fields:
            data[name] = now
    return AdCampaign.model_construct(**{**{k: None for k in fields}, **data,
                                         "name": "Spring", "status": "active"})


@pytest.fixture
def ad_repos(monkeypatch):
    from marketer.repos import ad_actions as ad_actions_repo
    from marketer.repos import ads as ads_repo

    async def no_actions(**kw):
        return []

    async def no_creatives(user_id, campaign_id=None):
        return []

    monkeypatch.setattr(ad_actions_repo, "list_", no_actions)
    monkeypatch.setattr(ads_repo, "list_creatives", no_creatives)


def _budget_answer(tracking=0.1, fatigue=0.1, cause="real_performance"):
    def answer(questions):
        return {"tracking_break": yn(tracking), "fatigue": yn(fatigue),
                "cause": {"choice": cause, "confidence": 0.8, "probabilities": {}}}
    return answer


async def test_point5_no_key_is_rule(logged, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("no context reads without a key")

    monkeypatch.setattr(points, "_budget_context", boom)
    assert await points.judge_budget_change(user_id="u1", campaign=_campaign(),
                                            metrics=_metrics()) == "rule"
    assert logged == []


async def test_point5_shadow_keeps_rule_and_logs_verdict(model, logged, ad_repos):
    model.set_mode(q.Point.BUDGET_SHIFT, "shadow")
    model.answer = _budget_answer(tracking=0.95)
    assert await points.judge_budget_change(user_id="u1", campaign=_campaign(),
                                            metrics=_metrics()) == "rule"
    assert logged[0]["table_action"] == "hold_alert" and logged[0]["action_taken"] == "rule"
    daily = model.calls[0]["state"]["daily"]
    assert daily[0]["ctr"] == 0.05 and daily[0]["roas"] == 4.0  # computed in code


async def test_point5_enforce_tracking_break_holds_and_alerts(model, logged, ad_repos,
                                                              monkeypatch):
    alerts = []

    async def alert(user_id, campaign):
        alerts.append(user_id)

    monkeypatch.setattr(points, "_alert_tracking_break", alert)
    model.set_mode(q.Point.BUDGET_SHIFT, "enforce")
    model.answer = _budget_answer(tracking=0.95)
    assert await points.judge_budget_change(user_id="u1", campaign=_campaign(),
                                            metrics=_metrics()) == "hold_alert"
    assert alerts == ["u1"]


async def test_point5_enforce_fatigue_refreshes_creative(model, logged, ad_repos):
    model.set_mode(q.Point.BUDGET_SHIFT, "enforce")
    model.answer = _budget_answer(fatigue=0.8)
    assert await points.judge_budget_change(user_id="u1", campaign=_campaign(),
                                            metrics=_metrics()) == "creative_refresh"


@pytest.mark.parametrize("fail", ["timeout", "error"])
async def test_point5_failure_fails_closed_to_rule(model, logged, ad_repos, fail):
    model.set_mode(q.Point.BUDGET_SHIFT, "enforce")
    model.fail = fail
    assert await points.judge_budget_change(user_id="u1", campaign=_campaign(),
                                            metrics=_metrics()) == "rule"
    assert logged[0]["fallback_used"] is True


async def test_optimize_campaign_enforce_hold_proposes_nothing(model, logged, ad_repos,
                                                               monkeypatch):
    from marketer.repos import ads as ads_repo
    from marketer.services import ad_workflows

    campaign = _campaign()
    proposals = []

    async def get_campaign(cid, *, user_id):
        return campaign

    async def campaign_metrics(cid, *, user_id):
        return _metrics()

    async def propose(**kw):
        proposals.append(kw)
        return {"status": "proposed"}

    async def no_alert(*a):
        return None

    monkeypatch.setattr(ads_repo, "get_campaign", get_campaign)
    monkeypatch.setattr(ads_repo, "campaign_metrics", campaign_metrics)
    monkeypatch.setattr(ad_workflows, "propose_budget_change", propose)
    monkeypatch.setattr(points, "_alert_tracking_break", no_alert)

    model.set_mode(q.Point.BUDGET_SHIFT, "enforce")
    model.answer = _budget_answer(tracking=0.95)
    out = await ad_workflows.optimize_campaign(user_id="u1", campaign_id=campaign.id)
    assert out == {"status": "held", "reason": "tracking looks broken", "alert": True}
    assert proposals == []

    # Shadow: today's rule proposes exactly as before.
    model.set_mode(q.Point.BUDGET_SHIFT, "shadow")
    out = await ad_workflows.optimize_campaign(user_id="u1", campaign_id=campaign.id)
    assert out == {"status": "proposed"} and len(proposals) == 1


# ---------------------------------------------------------------------------
# Point 9: QA verify (video and article)
# ---------------------------------------------------------------------------


def _verify_answer(fail: set[str] = frozenset(), grounded="supported"):
    def answer(questions):
        out = {}
        for name in questions:
            if name == "grounded":
                out[name] = {"choice": grounded, "confidence": 0.9, "probabilities": {}}
            elif name.startswith("rule_"):
                out[name] = yn(0.5 if name in fail else 0.02)
            else:
                out[name] = yn(0.5 if name in fail else 0.97)
        return out
    return answer


def _report(passed=True):
    from marketer.agents.qa import QAReport

    return QAReport(passed=passed, issues=[], suggested_action="publish" if passed else "reject")


async def _verify_video(spend, report):
    from marketer.agents.qa import verify_report

    return await verify_report(report, script=_script(), transcript="words",
                               niche_title="n", brand_rules=["Never touch: crypto"], spend=spend)


async def test_point9_no_key_report_unchanged(fake_spend, logged):
    spend, _ = fake_spend
    r = _report()
    assert await _verify_video(spend, r) is r and logged == []


async def test_point9_shadow_never_bounces(model, fake_spend, logged):
    model.set_mode(q.Point.QA_VIDEO, "shadow")
    model.answer = _verify_answer({"takeaway_match"})
    spend, _ = fake_spend
    r = _report()
    assert await _verify_video(spend, r) is r
    assert logged[0]["table_action"] == "bounce" and logged[0]["action_taken"] == "pass"


async def test_point9_enforce_one_failure_bounces(model, fake_spend, logged):
    model.set_mode(q.Point.QA_VIDEO, "enforce")
    model.answer = _verify_answer({"rule_0"})
    spend, _ = fake_spend
    out = await _verify_video(spend, _report())
    assert not out.passed and out.suggested_action == "regenerate_script"
    assert out.issues == ["verify failed: rule_0"]


async def test_point9_enforce_all_clear_passes(model, fake_spend, logged):
    model.set_mode(q.Point.QA_VIDEO, "enforce")
    model.answer = _verify_answer()
    spend, _ = fake_spend
    r = _report()
    assert await _verify_video(spend, r) is r


async def test_point9_failed_report_is_not_reverified(model, fake_spend, logged):
    model.set_mode(q.Point.QA_VIDEO, "enforce")
    spend, _ = fake_spend
    r = _report(passed=False)
    assert await _verify_video(spend, r) is r and model.calls == []


@pytest.mark.parametrize("fail", ["timeout", "error"])
async def test_point9_failure_keeps_todays_report(model, fake_spend, logged, fail):
    model.set_mode(q.Point.QA_VIDEO, "enforce")
    model.fail = fail
    spend, _ = fake_spend
    r = _report()
    assert await _verify_video(spend, r) is r and logged[0]["fallback_used"] is True


async def test_point9_article_grounding_only_with_research(model, fake_spend, logged):
    from marketer.articles.models import SerpAnalysis

    model.set_mode(q.Point.QA_ARTICLE, "enforce")
    model.answer = _verify_answer(grounded="unsupported")
    spend, _ = fake_spend
    assert await points.verify_article(markdown="# x", focus_keyword="k", research=SerpAnalysis(),
                                       brand_rules=[], rule_passed=True, spend=spend) is None
    assert "grounded" not in model.calls[0]["questions"]

    research = SerpAnalysis.model_validate(
        {"topResults": [{"title": "t", "url": "https://e.test", "snippet": "s", "domain": "e.test"}]}
    )
    failures = await points.verify_article(markdown="# x", focus_keyword="k", research=research,
                                           brand_rules=[], rule_passed=True, spend=spend)
    assert failures == ["grounded"]
