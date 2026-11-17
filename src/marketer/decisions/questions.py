"""The versioned question registry for backend decision points.

Every question, option, level, threshold, timeout and model slug used by a
decision point lives here, so a reviewer can read the whole policy surface
in one file and a tuned threshold can't drift in from a call site.

Vocabulary mirrors ``.intent-onboarding/packages/core/src/decisions.ts``:
questions are ``yesno`` / ``choice`` / ``score``; answers are a probability
(yesno), a choice with confidence and probabilities (choice), or a score
with confidence (score). Scores are normalised to 0..1 by the client.

Questions are atomic and observable ("does the hook name a number?"),
never "should we publish?". Arithmetic, dates, caps and word counts stay in
code and reach the model, if at all, as stated facts in the state.

Bump a point's version whenever its questions, options or thresholds
change: the version is logged next to every answer so tuning data from two
versions is never mixed.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal

# ---------------------------------------------------------------------------
# Question types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class YesNo:
    instructions: str
    type: Literal["yesno"] = "yesno"


@dataclass(frozen=True)
class Choice:
    instructions: str
    options: dict[str, str | None]
    type: Literal["choice"] = "choice"


@dataclass(frozen=True)
class Score:
    instructions: str
    levels: tuple[str, ...]
    type: Literal["score"] = "score"


Question = YesNo | Choice | Score
Questions = dict[str, Question]

# ---------------------------------------------------------------------------
# Endpoint, models and points
# ---------------------------------------------------------------------------

# The decisions path is under /alpha/ and may move: it is config, overridable
# with OPENROUTER_DECISIONS_URL.
DEFAULT_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"

# Pinned, dated slugs. Never a "-latest" alias: a model release must not be
# able to move a tuned threshold. Override with MARKETER_DECISIONS_MODEL /
# MARKETER_DECISIONS_MODEL_D0.
D1_MODEL = "typesafe/jev-1.13-20260917"
D0_MODEL = "kev-4b"

# Pre-flight spend estimate for one decision call. Decision calls cost a tiny
# fraction of a cent; the estimate only needs to stop a call when a cap or the
# prepaid balance is already exhausted.
CALL_ESTIMATE_USD = "0.001"

Tier = Literal["D1", "D0"]
FailMode = Literal["open", "closed"]


class Point(str, Enum):
    WHAT_TO_POST = "what_to_post"   # plan point 3
    HOOK_SCORE = "hook_score"       # plan point 4
    BUDGET_SHIFT = "budget_shift"   # plan point 5
    QA_VIDEO = "qa_video"           # plan point 9 (video)
    QA_ARTICLE = "qa_article"       # plan point 9 (article)


@dataclass(frozen=True)
class PointSpec:
    point: Point
    plan_number: int
    version: str
    timeout_s: float
    tier: Tier
    # What a failed call (timeout, error, abstain) does. "open": today's rule,
    # silently. "closed": today's guarded rule, never a looser path.
    fail: FailMode


POINTS: dict[Point, PointSpec] = {
    Point.WHAT_TO_POST: PointSpec(Point.WHAT_TO_POST, 3, "what_to_post.v1", 2.0, "D1", "open"),
    Point.HOOK_SCORE: PointSpec(Point.HOOK_SCORE, 4, "hook_score.v1", 1.5, "D1", "open"),
    Point.BUDGET_SHIFT: PointSpec(Point.BUDGET_SHIFT, 5, "budget_shift.v1", 2.0, "D1", "closed"),
    Point.QA_VIDEO: PointSpec(Point.QA_VIDEO, 9, "qa_video.v1", 3.0, "D1", "closed"),
    Point.QA_ARTICLE: PointSpec(Point.QA_ARTICLE, 9, "qa_article.v1", 3.0, "D1", "closed"),
}

# Above this many candidates, point 3 scores on the cheap D0 tier.
D0_CANDIDATE_THRESHOLD = 30

# A yes/no answer counts as "yes" at or above this probability.
YES = 0.5

# ---------------------------------------------------------------------------
# Point 3: what to post next
# ---------------------------------------------------------------------------

INTEREST_LEVELS: tuple[str, ...] = (
    "no interest",
    "slight interest",
    "moderate interest",
    "strong interest",
    "must-watch",
)


def what_to_post_questions(n_candidates: int) -> Questions:
    """One question per candidate per criterion (one candidate per question,
    so answers never blur between candidates)."""
    qs: Questions = {}
    for i in range(n_candidates):
        c = f"candidates[{i}]"
        qs[f"c{i}_interest"] = Score(
            f"How likely is {c} to interest the audience described in `audience`?",
            INTEREST_LEVELS,
        )
        qs[f"c{i}_repeat"] = YesNo(
            f"Does {c} repeat or closely duplicate a topic in `recent_topics`?"
        )
        qs[f"c{i}_on_niche"] = YesNo(f"Is {c} on-niche for the niche in `niche`?")
    return qs


# ---------------------------------------------------------------------------
# Point 4: score a hook before spending
# ---------------------------------------------------------------------------

STOP_LEVELS: tuple[str, ...] = (
    "scrolls past instantly",
    "glances",
    "pauses briefly",
    "stops",
    "stops and watches to the end",
)

HOOK_QUESTIONS_V1: Questions = {
    "specific_promise": YesNo("Does `hook` make a specific promise to the viewer?"),
    "greeting_filler": YesNo("Does `hook` open with a greeting or filler words?"),
    "concrete_outcome": YesNo("Does `hook` name a number or a concrete outcome?"),
    "open_loop": YesNo("Does `scene0` open a loop that the rest of the video pays off?"),
    "stop_scroll": Score(
        "Would the viewer described in `audience` stop scrolling at `hook`?", STOP_LEVELS
    ),
}

# Only asked when the state carries brand rules.
HOOK_FORBIDDEN_CLAIM = YesNo(
    "Does `hook` or `scene0` make a claim or touch a topic that `brand_rules` forbid?"
)

HOOK_FORBIDDEN_MIN = 0.5      # forbidden-claim probability that holds the draft
HOOK_STOP_SCROLL_MIN = 0.25   # normalised stop-scroll score below this is weak


def hook_questions(*, has_brand_rules: bool) -> Questions:
    qs = dict(HOOK_QUESTIONS_V1)
    if has_brand_rules:
        qs["forbidden_claim"] = HOOK_FORBIDDEN_CLAIM
    return qs


# ---------------------------------------------------------------------------
# Point 5: budget shifts (judgment inputs only; the number stays in code)
# ---------------------------------------------------------------------------

BUDGET_CAUSES: dict[str, str | None] = {
    "tracking": "Conversion tracking broke or stopped reporting",
    "fatigue": "The audience has seen the creative too often",
    "seasonality": "A seasonal or calendar effect",
    "auction": "Auction competition or prices changed",
    "real_performance": "The campaign genuinely performs better or worse",
}

BUDGET_QUESTIONS_V1: Questions = {
    "tracking_break": YesNo(
        "In `daily`, did conversions drop to near zero on a day when spend continued?"
    ),
    "fatigue": YesNo(
        "Do the last 3 days in `daily` show the same creative's CTR falling steadily?"
    ),
    "cause": Choice(
        "What best explains the change in `daily`, given `recent_changes` and "
        "`creative_age_days`?",
        BUDGET_CAUSES,
    ),
}

BUDGET_TRACKING_MIN = 0.5        # tracking-break probability that blocks a change
BUDGET_FATIGUE_MIN = 0.5         # fatigue probability that redirects to a refresh
BUDGET_CAUSE_CONFIDENCE_MIN = 0.6  # a cause choice counts only above this

# ---------------------------------------------------------------------------
# Point 9: QA verify (video and article)
# ---------------------------------------------------------------------------

GROUNDED_OPTIONS: dict[str, str | None] = {
    "supported": "Every factual claim is supported by the source",
    "unsupported": "At least one factual claim is not supported by the source",
    "declined": "The draft makes no checkable factual claims",
}

# Ship only if grounded = supported at or above this probability AND every
# check clears VERIFY_CHECK_MIN in its passing direction. One failure bounces;
# scores are never averaged.
VERIFY_GROUNDED_MIN = 0.8
VERIFY_CHECK_MIN = 0.9

# Bound the questions a single call carries.
MAX_BRAND_RULES = 8


@dataclass(frozen=True)
class Check:
    """A verify check: the question and which answer passes."""

    question: YesNo
    pass_when: Literal["yes", "no"]


VIDEO_CHECKS_V1: dict[str, Check] = {
    "takeaway_match": Check(
        YesNo("Does `transcript` deliver the takeaway that `script` promises?"), "yes"
    ),
    "on_niche": Check(YesNo("Does `transcript` stay on the niche in `niche`?"), "yes"),
}

ARTICLE_CHECKS_V1: dict[str, Check] = {
    "answers_intent": Check(
        YesNo("Does `draft` answer the search intent behind `focus_keyword`?"), "yes"
    ),
}

ARTICLE_GROUNDED = Choice(
    "Are the factual claims in `draft` supported by `research`?", GROUNDED_OPTIONS
)


def brand_rule_checks(rules: list[str], *, subject: str) -> dict[str, Check]:
    return {
        f"rule_{i}": Check(YesNo(f"Does `{subject}` break `brand_rules[{i}]`?"), "no")
        for i in range(min(len(rules), MAX_BRAND_RULES))
    }


def video_checks(brand_rules: list[str]) -> dict[str, Check]:
    return {**VIDEO_CHECKS_V1, **brand_rule_checks(brand_rules, subject="transcript")}


def article_checks(brand_rules: list[str]) -> dict[str, Check]:
    return {**ARTICLE_CHECKS_V1, **brand_rule_checks(brand_rules, subject="draft")}


def verify_questions(checks: dict[str, Check], *, grounded: Choice | None = None) -> Questions:
    qs: Questions = {name: c.question for name, c in checks.items()}
    if grounded is not None:
        qs["grounded"] = grounded
    return qs


# Caps on what goes into a state, so a request stays inside the model's context.
MAX_DRAFT_CHARS = 24_000
MAX_CONTEXT_CHARS = 2_000
