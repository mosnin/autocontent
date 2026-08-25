"""Category scoring and score bands (port of the scoring half of lib/audit.ts).

The only subtle part is the denominator: a category's `max_score` is split
across its rules by multiplier, but only the rules that actually applied.
"""
from __future__ import annotations

import math

from .rules import CATEGORIES, RULES, CategoryDef, RuleContext
from .types import AuditBand, AuditCategory, AuditItem, AuditStatus

#: Fraction of a rule's share each status earns. `na` is listed for
#: completeness — N/A rules never reach the arithmetic at all.
STATUS_VALUE: dict[AuditStatus, float] = {
    AuditStatus.passed: 1.0,
    AuditStatus.partial: 0.5,
    AuditStatus.fail: 0.0,
    AuditStatus.na: 0.0,
}


def round1(value: float) -> float:
    """Round half-up to one decimal.

    Python's built-in `round` is banker's rounding, which would disagree
    with the source's `Math.round(v * 10) / 10` on exact .x5 values and
    quietly shift stored scores. Scores are never negative here, so
    floor(x + 0.5) is the faithful equivalent.
    """
    return math.floor(value * 10 + 0.5) / 10


def score_category(category: CategoryDef, ctx: RuleContext) -> AuditCategory:
    rules = [rule for rule in RULES if rule.category_id == category.id]
    evaluated = [(rule, rule.evaluate(ctx)) for rule in rules]

    # The denominator only includes applicable (non-N/A) rules, so N/A items
    # neither inflate the score by taking full credit nor shrink the weights
    # of the rules that did apply — the category is simply scored out of what
    # was relevant to this page.
    applicable = [(rule, res) for rule, res in evaluated if res.status != AuditStatus.na]
    denominator = sum(rule.multiplier for rule, _ in applicable)

    items: list[AuditItem] = []
    for rule, result in evaluated:
        if result.status == AuditStatus.na:
            items.append(
                AuditItem(
                    id=rule.id,
                    label=rule.label,
                    status=result.status,
                    evidence=result.evidence,
                    recommendation=rule.recommendation,
                    max_score=0.0,
                    score=0.0,
                )
            )
            continue
        item_max = (
            (category.max_score * rule.multiplier) / denominator
            if denominator > 0
            else 0.0
        )
        items.append(
            AuditItem(
                id=rule.id,
                label=rule.label,
                status=result.status,
                evidence=result.evidence,
                recommendation=rule.recommendation,
                max_score=round1(item_max),
                score=round1(item_max * STATUS_VALUE[result.status]),
            )
        )

    items.sort(key=lambda item: item.max_score, reverse=True)

    return AuditCategory(
        id=category.id,
        name=category.name,
        description=category.description,
        score=round1(sum(item.score for item in items)),
        max_score=category.max_score,
        na_excluded=len(evaluated) - len(applicable),
        items=items,
    )


def score_categories(ctx: RuleContext) -> list[AuditCategory]:
    return [score_category(category, ctx) for category in CATEGORIES]


def score_band(score: float) -> AuditBand:
    if score <= 40:
        return AuditBand(
            label="Critical",
            interpretation=(
                "The page is structurally hard for AI engines to fetch, parse, or trust."
            ),
        )
    if score <= 55:
        return AuditBand(
            label="Below average",
            interpretation=(
                "Foundations are present in places, but the page is losing "
                "extractability and trust signals."
            ),
        )
    if score <= 70:
        return AuditBand(
            label="Average",
            interpretation=(
                "The page has reasonable AI SEO hygiene, with gaps in chunking, "
                "schema, or authority signals."
            ),
        )
    if score <= 85:
        return AuditBand(
            label="Strong",
            interpretation=(
                "The page is structured well enough to compete for AI citations on "
                "relevant prompts."
            ),
        )
    return AuditBand(
        label="Excellent",
        interpretation=(
            "The page exposes strong crawlability, structure, schema, and trust "
            "signals."
        ),
    )
