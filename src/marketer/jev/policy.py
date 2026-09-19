"""Confidence-gated policy helpers.

From https://docs.typesafe.ai/confidence and the LangChain harness post:
confidence is a second axis. Thresholds scale with the cost of being wrong.
"""
from __future__ import annotations

from typing import Literal

from .primitives import ChoiceAnswer, NoulAnswer, ScoreAnswer

Gate = Literal["act", "confirm", "escalate"]


def gate_choice(
    answer: ChoiceAnswer,
    *,
    floor: float = 0.5,
    act_at: float = 0.75,
) -> Gate:
    """Three-path gate for a Choice.

    - confidence < floor → escalate (do not guess)
    - floor ≤ confidence < act_at → confirm / review
    - confidence ≥ act_at → act automatically
    """
    if answer.confidence < floor:
        return "escalate"
    if answer.confidence < act_at:
        return "confirm"
    return "act"


def gate_noul(
    answer: NoulAnswer,
    *,
    yes_at: float = 0.7,
    no_at: float = 0.3,
) -> Literal["yes", "no", "uncertain"]:
    """Noul has no separate confidence — the probability *is* the belief."""
    if answer.noul >= yes_at:
        return "yes"
    if answer.noul <= no_at:
        return "no"
    return "uncertain"


def gate_score(
    answer: ScoreAnswer,
    *,
    floor: float = 0.5,
) -> Gate:
    if answer.confidence < floor:
        return "escalate"
    return "act"


def weighted_composite(
    scores: dict[str, ScoreAnswer],
    weights: dict[str, float],
) -> float:
    """Combine atomic Score answers into one ``[0, 1]`` number.

    Missing keys are skipped; weights are renormalized over the scores
    that actually arrived so a dropped question cannot silently zero the
    composite.
    """
    total_w = 0.0
    acc = 0.0
    for key, weight in weights.items():
        ans = scores.get(key)
        if ans is None or weight <= 0:
            continue
        acc += weight * ans.normalized()
        total_w += weight
    if total_w <= 0:
        return 0.0
    return acc / total_w
