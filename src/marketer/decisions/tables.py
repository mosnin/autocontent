"""Truth tables: answers (plus facts computed in code) to an action.

Pure functions, no I/O. Each table only ever tightens: it can hold, bounce,
drop or block, never approve something today's rule would refuse or move
money. A table is only consulted when the call succeeded; a failed call
takes the point's fallback in ``points``, never a table row.

Answer shapes (normalised by the client):
    yesno  -> {"type": "yesno", "probability": p}
    choice -> {"type": "choice", "choice": k, "confidence": c, "probabilities": {...}}
    score  -> {"type": "score", "score": s (0..1), "confidence": c}
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from . import questions as q

Answers = dict[str, dict[str, Any]]


def _p(answers: Answers, key: str) -> float:
    return float(answers[key]["probability"])


def _score(answers: Answers, key: str) -> float:
    return float(answers[key]["score"])


# ---------------------------------------------------------------------------
# Point 3: what to post next
# ---------------------------------------------------------------------------


def rank_candidates(answers: Answers, n_candidates: int) -> list[int]:
    """Candidate indices, best first. Drops repeats and off-niche candidates,
    sorts by interest score, breaks ties on freshness (lower repeat
    probability), then on original order. Empty when every candidate drops."""
    kept: list[tuple[float, float, int]] = []
    for i in range(n_candidates):
        repeat = _p(answers, f"c{i}_repeat")
        on_niche = _p(answers, f"c{i}_on_niche")
        if repeat >= q.YES or on_niche < q.YES:
            continue
        kept.append((-_score(answers, f"c{i}_interest"), repeat, i))
    kept.sort()
    return [i for _, _, i in kept]


# ---------------------------------------------------------------------------
# Point 4: score a hook before spending
# ---------------------------------------------------------------------------

HookAction = Literal["hold", "regenerate", "proceed"]


def hook_action(
    answers: Answers, *, word_count_ok: bool, banned_word_hit: bool
) -> HookAction:
    """hold: a forbidden claim (model) or a banned word (code).
    regenerate: a weak hook (filler opener, no promise and no concrete
    outcome, low stop-scroll score) or too many words (code).
    proceed: otherwise."""
    if banned_word_hit:
        return "hold"
    if "forbidden_claim" in answers and _p(answers, "forbidden_claim") >= q.HOOK_FORBIDDEN_MIN:
        return "hold"
    weak = (
        not word_count_ok
        or _p(answers, "greeting_filler") >= q.YES
        or (
            _p(answers, "specific_promise") < q.YES
            and _p(answers, "concrete_outcome") < q.YES
        )
        or _score(answers, "stop_scroll") < q.HOOK_STOP_SCROLL_MIN
    )
    return "regenerate" if weak else "proceed"


# ---------------------------------------------------------------------------
# Point 5: budget shifts
# ---------------------------------------------------------------------------

BudgetAction = Literal["hold_alert", "creative_refresh", "rule"]


def budget_action(answers: Answers) -> BudgetAction:
    """hold_alert: tracking looks broken, so no budget change and a person is
    told. creative_refresh: fatigue, so propose a creative refresh instead of
    a budget change. rule: today's ROAS rule (still guarded and approval-gated).
    The budget number itself is never touched here."""
    cause = answers["cause"]
    cause_sure = float(cause["confidence"]) >= q.BUDGET_CAUSE_CONFIDENCE_MIN
    if _p(answers, "tracking_break") >= q.BUDGET_TRACKING_MIN or (
        cause_sure and cause["choice"] == "tracking"
    ):
        return "hold_alert"
    if _p(answers, "fatigue") >= q.BUDGET_FATIGUE_MIN or (
        cause_sure and cause["choice"] == "fatigue"
    ):
        return "creative_refresh"
    return "rule"


# ---------------------------------------------------------------------------
# Point 9: verify a video or an article
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Verdict:
    passed: bool
    failures: list[str] = field(default_factory=list)


def verify(
    answers: Answers, checks: dict[str, q.Check], *, grounded_asked: bool
) -> Verdict:
    """Every check must clear ``VERIFY_CHECK_MIN`` in its passing direction and,
    when asked, grounded must be ``supported`` at ``VERIFY_GROUNDED_MIN`` or
    more. Each check is judged alone: one failure bounces, nothing is averaged."""
    failures: list[str] = []
    if grounded_asked:
        g = answers["grounded"]
        supported = float(g.get("probabilities", {}).get("supported", 0.0))
        if g["choice"] == "supported":
            supported = max(supported, float(g["confidence"]))
        if supported < q.VERIFY_GROUNDED_MIN:
            failures.append("grounded")
    for name, check in checks.items():
        p = _p(answers, name)
        passing = p if check.pass_when == "yes" else 1.0 - p
        if passing < q.VERIFY_CHECK_MIN:
            failures.append(name)
    return Verdict(passed=not failures, failures=failures)
