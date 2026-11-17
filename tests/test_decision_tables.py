"""Truth tables for the backend decision points, row by row.

Pure functions: answers (plus facts computed in code) in, action out.
"""
from __future__ import annotations

import pytest

from marketer.decisions import questions as q
from marketer.decisions import tables


def yn(p: float) -> dict:
    return {"type": "yesno", "probability": p}


def sc(s: float, c: float = 0.9) -> dict:
    return {"type": "score", "score": s, "confidence": c}


def ch(choice: str, c: float, probs: dict | None = None) -> dict:
    return {"type": "choice", "choice": choice, "confidence": c, "probabilities": probs or {}}


# ---------------------------------------------------------------------------
# Registry sanity
# ---------------------------------------------------------------------------


def test_every_point_has_a_versioned_spec_and_pinned_models():
    for point, spec in q.POINTS.items():
        assert spec.point is point
        assert spec.version.startswith(point.value + ".v")
        assert 0 < spec.timeout_s <= 3.0
    assert q.POINTS[q.Point.BUDGET_SHIFT].fail == "closed"
    for slug in (q.D1_MODEL, q.D0_MODEL):
        assert "latest" not in slug


def test_what_to_post_questions_are_one_per_candidate_per_criterion():
    qs = q.what_to_post_questions(3)
    assert set(qs) == {f"c{i}_{k}" for i in range(3) for k in ("interest", "repeat", "on_niche")}
    assert "candidates[1]" in qs["c1_repeat"].instructions


def test_hook_questions_add_forbidden_claim_only_with_rules():
    assert "forbidden_claim" not in q.hook_questions(has_brand_rules=False)
    assert "forbidden_claim" in q.hook_questions(has_brand_rules=True)


def test_brand_rule_checks_are_capped():
    checks = q.brand_rule_checks([f"r{i}" for i in range(20)], subject="draft")
    assert len(checks) == q.MAX_BRAND_RULES
    assert all(c.pass_when == "no" for c in checks.values())


# ---------------------------------------------------------------------------
# Point 3: rank_candidates
# ---------------------------------------------------------------------------


def _cand(interest, repeat=0.1, on_niche=0.9):
    return {"interest": sc(interest), "repeat": yn(repeat), "on_niche": yn(on_niche)}


def _rank_answers(*cands) -> dict:
    out = {}
    for i, c in enumerate(cands):
        out[f"c{i}_interest"] = c["interest"]
        out[f"c{i}_repeat"] = c["repeat"]
        out[f"c{i}_on_niche"] = c["on_niche"]
    return out


def test_rank_sorts_by_interest():
    a = _rank_answers(_cand(0.2), _cand(0.9), _cand(0.5))
    assert tables.rank_candidates(a, 3) == [1, 2, 0]


def test_rank_drops_repeats():
    a = _rank_answers(_cand(0.9, repeat=0.5), _cand(0.3))
    assert tables.rank_candidates(a, 2) == [1]


def test_rank_drops_off_niche():
    a = _rank_answers(_cand(0.9, on_niche=0.49), _cand(0.3))
    assert tables.rank_candidates(a, 2) == [1]


def test_rank_tie_breaks_on_freshness_then_order():
    a = _rank_answers(_cand(0.7, repeat=0.3), _cand(0.7, repeat=0.1), _cand(0.7, repeat=0.1))
    assert tables.rank_candidates(a, 3) == [1, 2, 0]


def test_rank_empty_when_every_candidate_drops():
    a = _rank_answers(_cand(0.9, repeat=0.8), _cand(0.9, on_niche=0.1))
    assert tables.rank_candidates(a, 2) == []


# ---------------------------------------------------------------------------
# Point 4: hook_action
# ---------------------------------------------------------------------------

STRONG = {
    "specific_promise": yn(0.9),
    "greeting_filler": yn(0.05),
    "concrete_outcome": yn(0.8),
    "open_loop": yn(0.8),
    "stop_scroll": sc(0.75),
}


def _hook(**over) -> dict:
    return {**STRONG, **{k: v for k, v in over.items()}}


@pytest.mark.parametrize(
    "answers, word_ok, banned, expected",
    [
        (_hook(), True, False, "proceed"),
        (_hook(), True, True, "hold"),                                   # banned word (code)
        (_hook(forbidden_claim=yn(0.5)), True, False, "hold"),            # forbidden claim
        (_hook(forbidden_claim=yn(0.49)), True, False, "proceed"),
        (_hook(forbidden_claim=yn(0.9), greeting_filler=yn(0.9)), True, False, "hold"),
        (_hook(), False, False, "regenerate"),                            # too many words
        (_hook(greeting_filler=yn(0.5)), True, False, "regenerate"),
        (_hook(specific_promise=yn(0.4), concrete_outcome=yn(0.4)), True, False, "regenerate"),
        (_hook(specific_promise=yn(0.4), concrete_outcome=yn(0.6)), True, False, "proceed"),
        (_hook(specific_promise=yn(0.6), concrete_outcome=yn(0.4)), True, False, "proceed"),
        (_hook(stop_scroll=sc(0.24)), True, False, "regenerate"),
        (_hook(stop_scroll=sc(0.25)), True, False, "proceed"),
    ],
)
def test_hook_action_rows(answers, word_ok, banned, expected):
    assert tables.hook_action(answers, word_count_ok=word_ok, banned_word_hit=banned) == expected


# ---------------------------------------------------------------------------
# Point 5: budget_action
# ---------------------------------------------------------------------------


def _budget(tracking=0.1, fatigue=0.1, cause="real_performance", conf=0.8) -> dict:
    return {"tracking_break": yn(tracking), "fatigue": yn(fatigue), "cause": ch(cause, conf)}


@pytest.mark.parametrize(
    "answers, expected",
    [
        (_budget(), "rule"),
        (_budget(tracking=0.5), "hold_alert"),
        (_budget(tracking=0.9, fatigue=0.9), "hold_alert"),             # tracking wins
        (_budget(cause="tracking", conf=0.6), "hold_alert"),
        (_budget(cause="tracking", conf=0.59), "rule"),                  # unsure cause ignored
        (_budget(fatigue=0.5), "creative_refresh"),
        (_budget(cause="fatigue", conf=0.7), "creative_refresh"),
        (_budget(cause="fatigue", conf=0.5), "rule"),
        (_budget(cause="seasonality"), "rule"),
        (_budget(cause="auction"), "rule"),
    ],
)
def test_budget_action_rows(answers, expected):
    assert tables.budget_action(answers) == expected


# ---------------------------------------------------------------------------
# Point 9: verify
# ---------------------------------------------------------------------------

CHECKS = {
    "takeaway_match": q.Check(q.YesNo("x"), "yes"),
    "rule_0": q.Check(q.YesNo("y"), "no"),
}


def test_verify_passes_when_every_check_clears():
    v = tables.verify({"takeaway_match": yn(0.95), "rule_0": yn(0.05)}, CHECKS, grounded_asked=False)
    assert v.passed and v.failures == []


def test_verify_one_failure_bounces_even_if_others_are_perfect():
    """Never averaged: a 0.89 on one check fails though the other is 1.0."""
    v = tables.verify({"takeaway_match": yn(0.89), "rule_0": yn(0.0)}, CHECKS, grounded_asked=False)
    assert not v.passed and v.failures == ["takeaway_match"]


def test_verify_no_direction_check():
    v = tables.verify({"takeaway_match": yn(1.0), "rule_0": yn(0.11)}, CHECKS, grounded_asked=False)
    assert v.failures == ["rule_0"]
    v = tables.verify({"takeaway_match": yn(0.9), "rule_0": yn(0.1)}, CHECKS, grounded_asked=False)
    assert v.passed


@pytest.mark.parametrize(
    "grounded, ok",
    [
        (ch("supported", 0.8), True),
        (ch("supported", 0.79), False),
        (ch("unsupported", 0.6, {"supported": 0.3}), False),
        (ch("declined", 0.9, {"supported": 0.05}), False),
        (ch("supported", 0.5, {"supported": 0.85}), True),
    ],
)
def test_verify_grounded_rows(grounded, ok):
    answers = {"takeaway_match": yn(0.95), "rule_0": yn(0.05), "grounded": grounded}
    v = tables.verify(answers, CHECKS, grounded_asked=True)
    assert v.passed is ok
    assert ("grounded" in v.failures) is (not ok)


def test_verify_reports_every_failure():
    answers = {"takeaway_match": yn(0.1), "rule_0": yn(0.9), "grounded": ch("unsupported", 0.9)}
    v = tables.verify(answers, CHECKS, grounded_asked=True)
    assert v.failures == ["grounded", "takeaway_match", "rule_0"]
