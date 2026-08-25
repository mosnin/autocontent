"""Agent fix prompts: ordering, selection, and the rendered text.

The prompt text is a product surface — users paste it into a coding agent —
so this suite pins the wording and the exact ordering rules rather than just
checking that a string comes out. Expectations were cross-checked against the
TypeScript original (`ai-seo-audit/lib/agent-fix-prompt.ts`), which produces a
byte-identical prompt for the same audit.
"""
from __future__ import annotations

import pytest

from marketer.seoaudit.agent_prompt import TOP_ISSUE_COUNT, build_agent_fix_prompts
from marketer.seoaudit.audit import build_rule_context, score_context
from marketer.seoaudit.types import (
    AuditBand,
    AuditCategory,
    AuditItem,
    AuditResult,
    AuditStatus,
)

# A client-rendered, noindexed shell. Kept local rather than imported from
# the scoring suite so each test module stands alone; the end-to-end category
# totals for this page live in test_seo_audit_scoring.py.
THIN_URL = "https://acme.example/"
THIN_HTML = """<!doctype html>
<html><head>
<title>Acme</title>
<meta name="robots" content="noindex, nofollow">
</head>
<body>
<div id="root"></div>
<a href="/pricing/">Pricing</a>
<p>Start free. Get started with the Acme platform today.</p>
</body></html>
"""


def _audit(url: str, html: str, markdown: str) -> AuditResult:
    return score_context(build_rule_context(url=url, markdown=markdown, html=html))


def _item(rule_id: str, status: AuditStatus, max_score: float) -> AuditItem:
    return AuditItem(
        id=rule_id,
        label=f"Label for {rule_id}.",
        status=status,
        evidence=f"Evidence for {rule_id}.",
        recommendation=f"Recommendation for {rule_id}.",
        score=0.0,
        max_score=max_score,
    )


def _result(items: list[AuditItem], *, score: float = 50.0) -> AuditResult:
    return AuditResult(
        url="https://acme.example/page/",
        host="acme.example",
        fetched_at="2024-11-18T00:00:00Z",
        score=score,
        band=AuditBand(label="Below average", interpretation="interp"),
        categories=[
            AuditCategory(
                id="A",
                name="Technical AI Crawlability",
                description="d",
                score=0.0,
                max_score=28.4,
                items=items,
            )
        ],
    )


# ---------------------------------------------------------------------------
# Selection and ordering
# ---------------------------------------------------------------------------


def test_only_fail_and_partial_findings_are_actionable():
    result = _result(
        [
            _item("R1", AuditStatus.fail, 4.0),
            _item("R2", AuditStatus.partial, 3.0),
            _item("R3", AuditStatus.passed, 9.0),
            _item("R4", AuditStatus.na, 0.0),
        ]
    )
    prompts = build_agent_fix_prompts(result)
    assert [issue.id for issue in prompts.top_issues] == ["R1", "R2"]
    assert "R3" not in prompts.full
    assert "R4" not in prompts.full


def test_top_issues_are_capped_at_eight():
    result = _result([_item(f"R{i:02d}", AuditStatus.fail, 10.0 - i) for i in range(12)])
    prompts = build_agent_fix_prompts(result)
    assert TOP_ISSUE_COUNT == 8
    assert len(prompts.top_issues) == 8
    assert [issue.id for issue in prompts.top_issues] == [f"R{i:02d}" for i in range(8)]


def test_top_issues_sort_by_max_score_descending():
    result = _result(
        [
            _item("LOW", AuditStatus.fail, 1.0),
            _item("HIGH", AuditStatus.partial, 9.0),
            _item("MID", AuditStatus.fail, 5.0),
        ]
    )
    assert [i.id for i in build_agent_fix_prompts(result).top_issues] == [
        "HIGH",
        "MID",
        "LOW",
    ]


def test_ties_on_max_score_break_on_id_as_a_string():
    """The tiebreak is a plain string comparison (the source's
    `localeCompare`), so "D12" sorts BEFORE "D5" — `1` < `5`. Without a
    deterministic tiebreak the prompt text would churn between runs of the
    same audit, which matters because it gets pasted into diffs and issues."""
    result = _result(
        [
            _item("D6", AuditStatus.fail, 6.4),
            _item("D5", AuditStatus.fail, 6.4),
            _item("D12", AuditStatus.fail, 6.4),
        ]
    )
    assert [i.id for i in build_agent_fix_prompts(result).top_issues] == [
        "D12",
        "D5",
        "D6",
    ]


def test_real_audit_top_issue_order_matches_the_typescript_source():
    """Transcribed from the TypeScript original run over the same fixture:
    A8 (11.4), then the 6.4 tie broken by id, then the 5.7 tie, then 5.6, 4.5."""
    prompts = _audit(THIN_URL, THIN_HTML, "").agent_prompts
    assert [issue.id for issue in prompts.top_issues] == [
        "A8", "D12", "D5", "D6", "A11", "A12", "E12", "C1",
    ]


def test_top_issue_entries_carry_the_rule_label():
    prompts = _audit(THIN_URL, THIN_HTML, "").agent_prompts
    assert prompts.top_issues[0].label == "Critical content is present in the raw HTML response."


def test_full_prompt_lists_every_actionable_issue_not_just_the_top_eight():
    result = _result([_item(f"R{i:02d}", AuditStatus.fail, 10.0 - i) for i in range(12)])
    prompts = build_agent_fix_prompts(result)
    assert len(prompts.top_issues) == 8
    for i in range(12):
        assert f"- R{i:02d} Label for R{i:02d}." in prompts.full


def test_full_prompt_keeps_issues_in_priority_order():
    result = _result(
        [
            _item("LOW", AuditStatus.fail, 1.0),
            _item("HIGH", AuditStatus.fail, 9.0),
        ]
    )
    full = build_agent_fix_prompts(result).full
    assert full.index("- HIGH ") < full.index("- LOW ")


# ---------------------------------------------------------------------------
# Rendered text
# ---------------------------------------------------------------------------


def test_full_prompt_header_names_the_target_score_and_band():
    result = _result([_item("R1", AuditStatus.fail, 4.0)], score=42.5)
    full = build_agent_fix_prompts(result).full
    assert "Target URL: https://acme.example/page/" in full
    assert "Current score: 42.5/100 (Below average)" in full


def test_full_prompt_forbids_fabricating_authority():
    """Several rules reward signals an agent could trivially invent, so the
    prompt has to say not to. This is a product requirement, not a nicety."""
    full = build_agent_fix_prompts(_result([_item("R1", AuditStatus.fail, 4.0)])).full
    assert (
        "Do not fabricate off-site authority, reviews, authorship, credentials, "
        "dates, or analytics evidence." in full
    )


def test_full_prompt_says_so_when_nothing_is_actionable():
    result = _result([_item("R1", AuditStatus.passed, 4.0)])
    prompts = build_agent_fix_prompts(result)
    assert prompts.top_issues == []
    assert "No failing or partial automated checks were found." in prompts.full


def test_full_prompt_issue_block_format():
    result = _result([_item("R1", AuditStatus.partial, 4.25)])
    full = build_agent_fix_prompts(result).full
    assert (
        "- R1 Label for R1.\n"
        "  Category: Technical AI Crawlability\n"
        "  Status: partial\n"
        "  Score impact: 4.2 possible points\n"
        "  Evidence: Evidence for R1.\n"
        "  Required fix: Recommendation for R1."
    ) in full


def test_issue_prompt_contains_every_field_an_agent_needs():
    result = _result([_item("R1", AuditStatus.fail, 11.4)])
    prompt = build_agent_fix_prompts(result).top_issues[0].prompt
    assert "Target URL: https://acme.example/page/" in prompt
    assert "Finding: R1 Label for R1." in prompt
    assert "Category: Technical AI Crawlability" in prompt
    assert "Status: fail" in prompt
    assert "Score impact: 11.4 possible points" in prompt
    assert "Evidence: Evidence for R1." in prompt
    assert "Required fix: Recommendation for R1." in prompt
    assert "Report back with files changed and verification performed." in prompt


@pytest.mark.parametrize("status", [AuditStatus.fail, AuditStatus.partial])
def test_status_renders_as_its_wire_value_not_the_enum_repr(status):
    """Python 3.11 changed Enum.__format__ to emit "AuditStatus.fail"; the
    model pins __str__/__format__ back to the wire value so the class name
    never leaks into user-visible prompt copy."""
    result = _result([_item("R1", status, 4.0)])
    prompts = build_agent_fix_prompts(result)
    assert f"Status: {status.value}" in prompts.full
    assert f"Status: {status.value}" in prompts.top_issues[0].prompt
    assert "AuditStatus." not in prompts.full
    assert "AuditStatus." not in prompts.top_issues[0].prompt


def test_score_impact_is_always_one_decimal():
    result = _result([_item("R1", AuditStatus.fail, 3.0), _item("R2", AuditStatus.fail, 2.0)])
    full = build_agent_fix_prompts(result).full
    assert "Score impact: 3.0 possible points" in full
    assert "Score impact: 2.0 possible points" in full


# ---------------------------------------------------------------------------
# top_priorities (assembled in score_context, formatted the same way)
# ---------------------------------------------------------------------------


def test_top_priorities_are_the_five_highest_max_score_actionable_items():
    result = _audit(THIN_URL, THIN_HTML, "")
    assert len(result.top_priorities) == 5
    for line in result.top_priorities:
        rule_id, recommendation = line.split(": ", 1)
        assert rule_id
        assert recommendation


def test_top_priorities_use_the_id_colon_recommendation_format():
    result = _audit(THIN_URL, THIN_HTML, "")
    assert result.top_priorities[0] == (
        "A8: Render primary copy, headings, FAQs, and schema on the server. AI "
        "crawlers often do not execute client-side JavaScript."
    )


def test_the_two_ranked_lists_break_ties_differently():
    """`top_priorities` and the prompt's `top_issues` both rank by max_score,
    but only the prompt adds an id tiebreak — `top_priorities` is a plain
    stable sort, so equal-impact findings keep their catalog order.

    The asymmetry is in the source too (lib/audit.ts sorts on maxScore alone;
    lib/agent-fix-prompt.ts sorts on `maxScore || id.localeCompare`), and both
    orderings below are transcribed from running it. Reconciling them here
    would silently reorder every stored audit's headline list.
    """
    result = _audit(THIN_URL, THIN_HTML, "")
    priority_ids = [line.split(":", 1)[0] for line in result.top_priorities]
    prompt_ids = [issue.id for issue in result.agent_prompts.top_issues]

    # Catalog order for the 6.4-point tie: D5, D6, D12.
    assert priority_ids == ["A8", "D5", "D6", "D12", "A11"]
    # Id order for the same tie: D12, D5, D6.
    assert prompt_ids[:5] == ["A8", "D12", "D5", "D6", "A11"]
    # Same findings either way, just ordered differently.
    assert set(priority_ids) == set(prompt_ids[:5])


def test_a_near_perfect_page_still_gets_a_prompt():
    """One partial finding is still worth a prompt — the surface must not go
    blank just because the page scores well."""
    result = _result([_item("B13", AuditStatus.partial, 2.0), _item("A1", AuditStatus.passed, 5.7)])
    prompts = build_agent_fix_prompts(result)
    assert [i.id for i in prompts.top_issues] == ["B13"]
    assert "No failing or partial automated checks were found." not in prompts.full


def test_prompts_are_attached_to_every_scored_result():
    result = _audit(THIN_URL, THIN_HTML, "")
    assert result.agent_prompts.full.startswith("You are an AI SEO implementation agent.")
    assert result.agent_prompts.top_issues
    for issue in result.agent_prompts.top_issues:
        assert issue.prompt.startswith("You are an AI SEO implementation agent.")
