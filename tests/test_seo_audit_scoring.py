"""Scoring invariants, score bands, and end-to-end port fidelity.

`test_end_to_end_*` are the headline tests: three realistic page fixtures are
pushed through the whole rule set and their per-category totals, N/A counts,
and bands are compared against numbers produced by running the TypeScript
original (`ai-seo-audit/lib/audit.ts` + `lib/rules.ts`) over byte-identical
input. They are what proves the port is faithful rather than merely working.
"""
from __future__ import annotations

import pytest

from marketer.seoaudit import scoring
from marketer.seoaudit.audit import build_rule_context, score_context
from marketer.seoaudit.rules import CategoryDef, Rule, RuleContext, RuleEvaluation
from marketer.seoaudit.scoring import round1, score_band, score_categories, score_category
from marketer.seoaudit.types import AuditStatus

PASS = AuditStatus.passed
PARTIAL = AuditStatus.partial
FAIL = AuditStatus.fail
NA = AuditStatus.na


# ---------------------------------------------------------------------------
# round1: half-up, not banker's
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        # Python's built-in round() is banker's rounding and would give 0.2/0.2
        # here; the source uses Math.round(v * 10) / 10, which is half-up.
        (0.25, 0.3),
        (0.35, 0.4),
        (2.25, 2.3),
        (2.35, 2.4),
        (0.15, 0.2),
        (0.0, 0.0),
        (5.64, 5.6),
        (5.66, 5.7),
        (28.4 / 5, 5.7),
    ],
)
def test_round1_rounds_half_up(value, expected):
    assert round1(value) == pytest.approx(expected)


def test_round1_disagrees_with_bankers_rounding_where_it_matters():
    """Guard the reason round1 exists: if someone swaps it for round(), this
    fails instead of quietly shifting every stored score."""
    assert round(2.25, 1) == 2.2
    assert round1(2.25) == 2.3


# ---------------------------------------------------------------------------
# Score bands, at the exact boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("score", "label"),
    [
        (0, "Critical"),
        (39.9, "Critical"),
        (40, "Critical"),        # boundary is inclusive
        (40.1, "Below average"),
        (55, "Below average"),
        (55.1, "Average"),
        (70, "Average"),
        (70.1, "Strong"),
        (85, "Strong"),
        (85.1, "Excellent"),
        (100, "Excellent"),
    ],
)
def test_score_band_boundaries(score, label):
    assert score_band(score).label == label


def test_every_band_carries_an_interpretation():
    for score in (0, 50, 60, 80, 95):
        assert score_band(score).interpretation.strip()


# ---------------------------------------------------------------------------
# Category scoring invariants, against a synthetic rule set
# ---------------------------------------------------------------------------

_CATEGORY = CategoryDef(id="T", name="Test", description="d", max_score=30.0)


def _rule(rule_id: str, status: AuditStatus, multiplier: float = 1.0) -> Rule:
    return Rule(
        id=rule_id,
        category_id="T",
        label=f"label {rule_id}",
        recommendation=f"fix {rule_id}",
        dependencies=["text"],
        multiplier=multiplier,
        evaluate=lambda _ctx, s=status: RuleEvaluation(status=s, evidence=f"ev {rule_id}"),
    )


def _score(monkeypatch, rules: list[Rule]):
    monkeypatch.setattr(scoring, "RULES", rules)
    return score_category(_CATEGORY, RuleContext(url="https://x.example/", host="x.example"))


def test_status_values_are_pass_1_partial_half_fail_0(monkeypatch):
    category = _score(
        monkeypatch, [_rule("R1", PASS), _rule("R2", PARTIAL), _rule("R3", FAIL)]
    )
    by_id = {item.id: item for item in category.items}
    # Three equal-weight rules split a 30-point category into 10s.
    assert all(item.max_score == 10.0 for item in category.items)
    assert by_id["R1"].score == 10.0
    assert by_id["R2"].score == 5.0
    assert by_id["R3"].score == 0.0
    assert category.score == 15.0
    assert category.na_excluded == 0


def test_na_rules_are_excluded_from_the_denominator(monkeypatch):
    """An N/A rule takes no slice of the category at all: the applicable rules
    split the full max_score between them, so their weights GROW rather than
    the N/A rule silently banking or burning points."""
    category = _score(monkeypatch, [_rule("R1", PASS), _rule("R2", PASS), _rule("R3", NA)])
    by_id = {item.id: item for item in category.items}
    assert by_id["R1"].max_score == 15.0
    assert by_id["R2"].max_score == 15.0
    # The N/A item is reported, but contributes nothing in either direction.
    assert by_id["R3"].max_score == 0.0
    assert by_id["R3"].score == 0.0
    assert category.score == 30.0
    assert category.na_excluded == 1


def test_na_rules_never_earn_credit(monkeypatch):
    """A category where everything applicable failed scores zero even though
    an N/A rule is present — N/A is not free points."""
    category = _score(monkeypatch, [_rule("R1", FAIL), _rule("R2", NA)])
    assert category.score == 0.0
    assert category.na_excluded == 1


def test_a_category_of_only_na_rules_scores_zero(monkeypatch):
    """Denominator 0: no division by zero, no credit, every item flat."""
    category = _score(monkeypatch, [_rule("R1", NA), _rule("R2", NA)])
    assert category.score == 0.0
    assert category.na_excluded == 2
    assert all(item.max_score == 0.0 and item.score == 0.0 for item in category.items)


def test_multipliers_split_the_category_proportionally(monkeypatch):
    """A weight-2 rule takes twice the share of a weight-1 sibling."""
    category = _score(
        monkeypatch, [_rule("R1", PASS, multiplier=2), _rule("R2", PASS), _rule("R3", PASS)]
    )
    by_id = {item.id: item for item in category.items}
    assert by_id["R1"].max_score == 15.0  # 30 * 2/4
    assert by_id["R2"].max_score == 7.5   # 30 * 1/4
    assert by_id["R3"].max_score == 7.5


def test_na_removes_its_multiplier_from_the_denominator(monkeypatch):
    """The heavy rule going N/A hands its weight back to the survivors rather
    than leaving them scored out of a denominator that still counts it."""
    category = _score(
        monkeypatch, [_rule("R1", NA, multiplier=2), _rule("R2", PASS), _rule("R3", PASS)]
    )
    by_id = {item.id: item for item in category.items}
    assert by_id["R2"].max_score == 15.0
    assert by_id["R3"].max_score == 15.0
    assert category.score == 30.0


def test_items_are_sorted_by_max_score_descending(monkeypatch):
    category = _score(
        monkeypatch,
        [_rule("R1", PASS), _rule("R2", PASS, multiplier=3), _rule("R3", NA)],
    )
    assert [item.id for item in category.items] == ["R2", "R1", "R3"]
    assert [item.max_score for item in category.items] == sorted(
        (item.max_score for item in category.items), reverse=True
    )


def test_scores_are_rounded_to_one_decimal(monkeypatch):
    """30 split three ways is exact, but 30 split seven ways is not."""
    category = _score(monkeypatch, [_rule(f"R{i}", PASS) for i in range(7)])
    for item in category.items:
        assert item.max_score == 4.3  # 30/7 = 4.2857...
        assert round(item.max_score, 1) == item.max_score
    assert category.score == 30.1  # rounding each item can overshoot the max


def test_item_carries_the_rules_label_recommendation_and_evidence(monkeypatch):
    category = _score(monkeypatch, [_rule("R1", FAIL)])
    item = category.items[0]
    assert (item.label, item.recommendation, item.evidence) == ("label R1", "fix R1", "ev R1")


def test_category_metadata_is_copied_from_the_definition(monkeypatch):
    category = _score(monkeypatch, [_rule("R1", PASS)])
    assert (category.id, category.name, category.max_score) == ("T", "Test", 30.0)


def test_score_categories_returns_all_six_in_order():
    ctx = build_rule_context(url="https://acme.example/", markdown="", html="")
    assert [c.id for c in score_categories(ctx)] == ["A", "B", "C", "D", "E", "F"]


# ---------------------------------------------------------------------------
# End-to-end fixtures
# ---------------------------------------------------------------------------

RICH_URL = "https://acme.example/blog/rag-benchmarks/"
RICH_HTML = """<!doctype html>
<html lang="en">
<head>
<title>Retrieval Augmented Generation Benchmarks &amp; Results | Acme</title>
<meta name="description" content="Acme benchmarked 12 retrieval stacks in 2024. Full methodology, latency numbers, and cost per 1,000 queries.">
<link rel="canonical" href="https://acme.example/blog/rag-benchmarks/">
<meta name="robots" content="index, follow">
<script type = 'application/ld+json'>
{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","name":"Acme","url":"https://acme.example/","logo":"https://acme.example/logo.png","sameAs":["https://github.com/acme","https://www.linkedin.com/company/acme","https://www.crunchbase.com/organization/acme"]},
 {"@type":"BlogPosting","headline":"Retrieval Augmented Generation Benchmarks","author":{"@type":"Person","name":"Dana Ruiz"},"datePublished":"2024-03-04","dateModified":"2024-11-18"},
 {"@type":"Person","name":"Dana Ruiz","jobTitle":"Principal Engineer"},
 {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How were the stacks chosen?"}]}
]}
</script>
</head>
<body>
<a data-href="/tracking/decoy" href="/about/">About Acme</a>
<a href="/company/">Company</a>
<a href="/legal/privacy/">Privacy</a>
<a href="/legal/terms/">Terms</a>
<a href="/support/contact/">Contact</a>
<a href="https://github.com/acme/rag-bench">Benchmark source</a>
<a href="https://www.nist.gov/standards">NIST standards</a>
<a href="https://arxiv.org/abs/2005.11401">Original RAG paper</a>
<a href="https://en.wikipedia.org/wiki/Information_retrieval">Information retrieval</a>
<a href="https://research.google/pubs/">Google Research</a>
<a href="/blog/vector-databases/">Vector databases</a>
<a href="/blog/chunking-strategies/">Chunking strategies</a>
<a href="/guides/evaluation/">Evaluation guide</a>
<h1>Retrieval Augmented Generation Benchmarks</h1>
<p>Retrieval augmented generation is a technique that grounds a language model in documents fetched at query time. Acme measured 12 production stacks across 4,200 queries to find out which combinations actually hold up under load, and what each one costs.</p>
<h2>How we ran the benchmark</h2>
<p>We analyzed every stack with the same corpus and the same 4,200 question set. According to our methodology, each run was repeated 3 times and the median was recorded.</p>
<ul><li>Fixed corpus of 1,200,000 chunks</li><li>Identical embedding model</li><li>Warm cache excluded</li></ul>
<h2>Latency results</h2>
<table><tr><td>Stack</td><td>p95</td></tr><tr><td>Acme</td><td>184ms</td></tr></table>
<p>The fastest stack returned answers in 184ms at p95, which is 2.4x faster than the median stack. Cost landed at $12 per 1,000 queries for the leader and $31 for the slowest.</p>
<h2>What surprised us</h2>
<p>Reranking helped 38% of queries but hurt 9% of them, so the naive assumption that reranking is always worth the extra latency is wrong for short factual questions.</p>
<h2>Frequently asked questions</h2>
<h3>How were the stacks chosen?</h3>
<p>We picked the twelve stacks that appeared most often in our customer deployments during 2024, then verified each vendor could run the corpus unmodified.</p>
<h3>Will you rerun this benchmark?</h3>
<p>Yes. We refresh this study every two quarters and publish the raw dataset alongside it so other teams can reproduce the numbers.</p>
<p>By Dana Ruiz. Last updated <time datetime="2024-11-18">November 18, 2024</time>.</p>
</body>
</html>
"""

RICH_MARKDOWN = """# Retrieval Augmented Generation Benchmarks

Retrieval augmented generation is a technique that grounds a language model in documents fetched at query time. Acme measured 12 production stacks across 4,200 queries to find out which combinations actually hold up under load, and what each one costs.

## How we ran the benchmark

We analyzed every stack with the same corpus and the same 4,200 question set. According to our methodology, each run was repeated 3 times and the median was recorded.

- Fixed corpus of 1,200,000 chunks
- Identical embedding model
- Warm cache excluded

## Latency results

| Stack | p95 |
| --- | --- |
| Acme | 184ms |

The fastest stack returned answers in 184ms at p95, which is 2.4x faster than the median stack. Cost landed at $12 per 1,000 queries for the leader and $31 for the slowest.

## What surprised us

Reranking helped 38% of queries but hurt 9% of them, so the naive assumption that reranking is always worth the extra latency is wrong for short factual questions.

## Frequently asked questions

### How were the stacks chosen?

We picked the twelve stacks that appeared most often in our customer deployments during 2024, then verified each vendor could run the corpus unmodified.

### Will you rerun this benchmark?

Yes. We refresh this study every two quarters and publish the raw dataset alongside it so other teams can reproduce the numbers.

By Dana Ruiz. Last updated November 18, 2024.

[Vector databases](https://acme.example/blog/vector-databases/) and [the original RAG paper](https://arxiv.org/abs/2005.11401) go deeper.
"""

MKT_URL = "https://acme.example/pricing/"
MKT_HTML = """<!doctype html>
<html lang="en"><head>
<title>Acme Platform Pricing</title>
<meta name="description" content="Acme pricing, plans, and what each tier includes.">
<link rel="canonical" href="https://acme.example/pricing/">
<script type="application/ld+json">{"@type":"Organization","name":"Acme","url":"https://acme.example/"}</script>
</head><body>
<a href="/about/">About</a><a href="/company/careers/">Careers</a>
<a href="/legal/privacy/">Privacy</a><a href="/legal/terms/">Terms</a><a href="/support/">Support</a>
<a href="https://www.g2.com/products/acme">Reviews on G2</a>
<a href="https://status.acme-cdn.example/">Status</a>
<h1>Acme Platform Pricing</h1>
<h2>Plans</h2>
<h2>What is included</h2>
<h2>Frequently asked questions</h2>
<ul><li>Starter</li><li>Growth</li><li>Scale</li></ul>
</body></html>
"""

MKT_MARKDOWN = """# Acme Platform Pricing

Acme is a workflow automation platform that helps operations teams replace brittle spreadsheets with governed, auditable pipelines. Pricing starts at $49 per month and scales with the number of connected systems rather than the number of seats.

## Plans

Every plan includes unlimited seats, the full connector catalog, and the audit log. The difference between tiers is throughput and retention, not features, because gating features made customers buy the wrong tier.

- Starter: $49 per month, 10,000 runs
- Growth: $199 per month, 100,000 runs
- Scale: custom pricing, unlimited runs

## What is included

Every tier includes SOC 2 Type II controls, single sign-on, and 90 day log retention. Scale customers get a dedicated environment and a 99.9% uptime commitment backed by service credits.

Migration support is included for annual contracts. Most teams finish their first production pipeline within two weeks of signing up, and the median customer connects 6 systems in the first quarter.

## Frequently asked questions

Can I change plans at any time? Yes, upgrades take effect immediately and downgrades apply at the next renewal date. Do you offer a free trial? Yes, every plan includes a 14 day free trial with no card required.

Teams that outgrow Starter usually do so because of run volume rather than seat count, so the upgrade is predictable and shows up in the usage dashboard a few weeks before it matters.
"""

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


def _audit(url: str, html: str, markdown: str):
    return score_context(build_rule_context(url=url, markdown=markdown, html=html))


def _statuses(result) -> dict[str, str]:
    return {
        item.id: item.status.value for category in result.categories for item in category.items
    }


# --- fixture 1: a well-built editorial page ---------------------------------


def test_end_to_end_rich_article_matches_the_typescript_source():
    """A fully-equipped article page: schema graph, canonical, FAQ, byline,
    dates, internal and external links. Category totals and band transcribed
    from the TypeScript original run over the same bytes."""
    result = _audit(RICH_URL, RICH_HTML, RICH_MARKDOWN)

    assert {c.id: c.score for c in result.categories} == {
        "A": 28.5, "B": 25.0, "C": 13.2, "D": 21.3, "E": 8.4, "F": 3.0,
    }
    assert result.score == 99.4
    assert result.band.label == "Excellent"
    # Only E1 is N/A: an article is never a commercial offering.
    assert {c.id: c.na_excluded for c in result.categories} == {
        "A": 0, "B": 0, "C": 0, "D": 0, "E": 1, "F": 0,
    }


def test_end_to_end_rich_article_item_statuses():
    statuses = _statuses(_audit(RICH_URL, RICH_HTML, RICH_MARKDOWN))
    assert statuses["A8"] == "pass"    # server-rendered copy
    assert statuses["C3"] == "pass"    # complete BlogPosting schema
    assert statuses["C5"] == "pass"    # FAQ content and FAQPage schema
    assert statuses["E1"] == "na"      # article, not a commercial offering
    assert statuses["E10"] == "pass"   # three sameAs links
    assert statuses["F6"] == "pass"    # dateModified present
    assert statuses["B13"] == "partial"  # grade ~10.0 sits just under the band


def test_end_to_end_rich_article_a_category_may_exceed_its_max_by_rounding():
    """Each item is rounded to one decimal before the category sums them, so a
    category of four items can land 0.1 over its declared max. Faithful to the
    source, which rounds in exactly the same order."""
    category = {c.id: c for c in _audit(RICH_URL, RICH_HTML, RICH_MARKDOWN).categories}["A"]
    assert category.score == 28.5
    assert category.max_score == 28.4


# --- fixture 2: a long marketing page (the mixed-status headline case) ------


def test_end_to_end_marketing_page_matches_the_typescript_source():
    """The headline parity case: a long pricing page with a mix of pass,
    partial, fail, and N/A in every category. Numbers transcribed from the
    TypeScript original run over the same bytes."""
    result = _audit(MKT_URL, MKT_HTML, MKT_MARKDOWN)

    assert {c.id: c.score for c in result.categories} == {
        "A": 17.1, "B": 22.1, "C": 8.5, "D": 20.3, "E": 3.4, "F": 0.0,
    }
    assert result.score == 71.4
    assert result.band.label == "Strong"
    assert {c.id: c.na_excluded for c in result.categories} == {
        "A": 0, "B": 1, "C": 2, "D": 0, "E": 1, "F": 1,
    }


def test_end_to_end_marketing_page_is_not_treated_as_an_article():
    """The isArticleLike gate is what keeps a long marketing page from being
    marked down for missing a byline and a last-updated date."""
    statuses = _statuses(_audit(MKT_URL, MKT_HTML, MKT_MARKDOWN))
    assert statuses["B12"] == "na"   # last-updated date
    assert statuses["C3"] == "na"    # Article schema
    assert statuses["C4"] == "na"    # Person schema
    assert statuses["F6"] == "na"    # refresh signal
    # ...while the commercial gates DO apply to it.
    assert statuses["E1"] == "pass"  # links a G2 profile
    assert statuses["E7"] == "na"    # not a developer product


def test_end_to_end_marketing_page_item_statuses():
    statuses = _statuses(_audit(MKT_URL, MKT_HTML, MKT_MARKDOWN))
    # Client-rendered body: 25 words of raw HTML against 200+ extracted.
    assert statuses["A8"] == "fail"
    assert statuses["A11"] == "pass"
    assert statuses["C1"] == "pass"
    assert statuses["C2"] == "partial"  # Organization without logo or sameAs
    assert statuses["C5"] == "fail"     # FAQ content, no FAQPage schema
    assert statuses["E10"] == "fail"    # entity present, zero sameAs
    assert statuses["B7"] == "fail"     # no quotes or attributions
    assert statuses["B8"] == "partial"  # two external links


def test_a_category_whose_only_rule_is_na_scores_zero_out_of_its_max():
    """Category F holds exactly one rule, so on a non-article page the whole
    category is N/A: score 0, max unchanged, one exclusion recorded."""
    category = {c.id: c for c in _audit(MKT_URL, MKT_HTML, MKT_MARKDOWN).categories}["F"]
    assert (category.score, category.max_score, category.na_excluded) == (0.0, 3.0, 1)
    assert [(i.id, i.max_score, i.score) for i in category.items] == [("F6", 0.0, 0.0)]


# --- fixture 3: a client-rendered, noindexed shell --------------------------


def test_end_to_end_thin_page_matches_the_typescript_source():
    """An empty SPA shell with a noindex directive: everything that can fail,
    does. Numbers transcribed from the TypeScript original."""
    result = _audit(THIN_URL, THIN_HTML, "")

    assert {c.id: c.score for c in result.categories} == {
        "A": 5.7, "B": 4.3, "C": 0.0, "D": 3.2, "E": 0.0, "F": 0.0,
    }
    assert result.score == 13.2
    assert result.band.label == "Critical"
    assert {c.id: c.na_excluded for c in result.categories} == {
        "A": 0, "B": 1, "C": 3, "D": 0, "E": 2, "F": 1,
    }


def test_end_to_end_thin_page_flags_noindex_and_missing_canonical():
    statuses = _statuses(_audit(THIN_URL, THIN_HTML, ""))
    assert statuses["A12"] == "fail"  # noindex directive present
    assert statuses["A11"] == "fail"  # no canonical
    assert statuses["A1"] == "pass"   # ...but it is served over HTTPS


def test_thin_page_falls_back_to_html_text_when_markdown_is_empty():
    """With no Markdown, the analysis text comes from the raw HTML, so the
    audit still scores the page instead of reporting an empty one."""
    result = _audit(THIN_URL, THIN_HTML, "")
    assert result.stats.markdown_chars == 0
    assert result.stats.words > 0
    assert result.title == "Acme"


# ---------------------------------------------------------------------------
# score_context assembly
# ---------------------------------------------------------------------------


def test_total_score_is_the_rounded_sum_of_category_scores():
    result = _audit(MKT_URL, MKT_HTML, MKT_MARKDOWN)
    assert result.score == round1(sum(c.score for c in result.categories))


def test_top_priorities_are_the_five_highest_impact_actionable_findings():
    result = _audit(MKT_URL, MKT_HTML, MKT_MARKDOWN)
    assert len(result.top_priorities) == 5
    assert result.top_priorities[0].startswith("A8: ")

    actionable = [
        item
        for category in result.categories
        for item in category.items
        if item.status in (FAIL, PARTIAL)
    ]
    best = sorted(actionable, key=lambda i: -i.max_score)[:5]
    assert result.top_priorities == [f"{i.id}: {i.recommendation}" for i in best]


def test_top_priorities_never_include_passing_or_na_findings():
    result = _audit(RICH_URL, RICH_HTML, RICH_MARKDOWN)
    by_id = {i.id: i for c in result.categories for i in c.items}
    for line in result.top_priorities:
        rule_id = line.split(":", 1)[0]
        assert by_id[rule_id].status in (FAIL, PARTIAL)


def test_stats_describe_the_scraped_page():
    result = _audit(RICH_URL, RICH_HTML, RICH_MARKDOWN)
    assert result.stats.raw_html_chars == len(RICH_HTML)
    assert result.stats.markdown_chars == len(RICH_MARKDOWN)
    assert result.stats.json_ld_blocks == 1
    assert result.stats.external_links == 5
    assert result.stats.links == 13
    assert result.stats.headings == 7


def test_diagnostics_carry_the_scrape_outcome():
    ctx = build_rule_context(url=THIN_URL, markdown="", html=THIN_HTML)
    result = score_context(ctx, markdown_status="failed", html_status="ready")
    assert result.diagnostics.context_dev_markdown == "failed"
    assert result.diagnostics.context_dev_html == "ready"
    assert result.diagnostics.json_ld_parse_failures == 0


def test_diagnostics_report_json_ld_parse_failures():
    html = '<script type="application/ld+json">{oops</script>'
    result = _audit("https://acme.example/", html, "")
    assert result.diagnostics.json_ld_parse_failures == 1


def test_result_records_url_host_title_and_description():
    result = _audit(RICH_URL, RICH_HTML, RICH_MARKDOWN)
    assert result.url == RICH_URL
    assert result.host == "acme.example"
    assert result.title == "Retrieval Augmented Generation Benchmarks & Results | Acme"
    assert result.description.startswith("Acme benchmarked 12 retrieval stacks")
    assert result.fetched_at.endswith("Z")


def test_result_is_json_serializable_for_storage():
    """The whole result is persisted as a jsonb blob and re-validated on read."""
    from marketer.seoaudit.types import AuditResult

    result = _audit(MKT_URL, MKT_HTML, MKT_MARKDOWN)
    blob = result.model_dump(mode="json")
    assert AuditResult.model_validate(blob).score == result.score
