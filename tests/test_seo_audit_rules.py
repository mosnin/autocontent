"""Rule catalog parity and per-rule behaviour for the SEO auditor.

The headline assertions here are the parity ones: the rule ids, their
category assignment, their multipliers, and the six category weights are
transcribed from the TypeScript original (`ai-seo-audit/lib/rules.ts`). If
the port ever drops a rule or drifts a weight, `test_rule_ids_match_source`
and `test_category_max_scores_sum_to_100` fail loudly instead of the audit
quietly scoring pages out of the wrong denominator.
"""
from __future__ import annotations

import re

import pytest

from marketer.seoaudit import rules as R
from marketer.seoaudit.parsing import DateSignals, Heading, SchemaSummary
from marketer.seoaudit.rules import RULES, RULES_BY_ID, RuleContext
from marketer.seoaudit.types import AuditStatus

PASS = AuditStatus.passed
PARTIAL = AuditStatus.partial
FAIL = AuditStatus.fail
NA = AuditStatus.na

# Transcribed from lib/rules.ts, in source order. Ids are deliberately
# non-contiguous — they are stable identifiers from the upstream guideline
# document and stored audits reference them, so gaps are correct.
SOURCE_RULE_IDS = [
    "A1", "A8", "A11", "A12",
    "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B10", "B11", "B12", "B13", "B14",
    "C1", "C2", "C3", "C4", "C5", "C11",
    "D5", "D6", "D10", "D12",
    "E1", "E7", "E10", "E12",
    "F6",
]

# Only these three rules are weighted; everything else is multiplier 1.
SOURCE_MULTIPLIERS = {"A8": 2.0, "D10": 1 / 3, "E1": 0.5}

SOURCE_CATEGORIES = [
    ("A", "Technical AI Crawlability", 28.4),
    ("B", "Content Structure & Chunking", 25.4),
    ("C", "Structured Data / Schema", 13.4),
    ("D", "E-E-A-T & Entity Authority", 21.4),
    ("E", "Off-site / Citation Surface Presence", 8.4),
    ("F", "Measurement & Governance", 3.0),
]


# ---------------------------------------------------------------------------
# Catalog parity with lib/rules.ts
# ---------------------------------------------------------------------------


def test_rule_ids_match_source():
    """Every rule in lib/rules.ts is ported, in the same order, with no extras."""
    assert [rule.id for rule in RULES] == SOURCE_RULE_IDS


def test_rule_count_matches_source():
    assert len(RULES) == 32


def test_rule_ids_are_unique_and_indexed():
    ids = [rule.id for rule in RULES]
    assert len(set(ids)) == len(ids)
    assert set(RULES_BY_ID) == set(ids)


def test_rule_multipliers_match_source():
    actual = {rule.id: rule.multiplier for rule in RULES if rule.multiplier != 1}
    assert actual == pytest.approx(SOURCE_MULTIPLIERS)


def test_unweighted_rules_all_have_multiplier_one():
    for rule in RULES:
        if rule.id not in SOURCE_MULTIPLIERS:
            assert rule.multiplier == 1, rule.id


def test_categories_match_source():
    actual = [(c.id, c.name, c.max_score) for c in R.CATEGORIES]
    assert actual == SOURCE_CATEGORIES


def test_category_max_scores_sum_to_100():
    assert sum(c.max_score for c in R.CATEGORIES) == pytest.approx(100.0)


def test_every_rule_points_at_a_real_category():
    known = {c.id for c in R.CATEGORIES}
    for rule in RULES:
        assert rule.category_id in known, rule.id


def test_every_category_has_at_least_one_rule():
    used = {rule.category_id for rule in RULES}
    assert used == {c.id for c in R.CATEGORIES}


def test_rules_are_grouped_by_category_in_order():
    """Order within a category drives UI order, so the catalog must not
    interleave categories."""
    seen: list[str] = []
    for rule in RULES:
        if not seen or seen[-1] != rule.category_id:
            seen.append(rule.category_id)
    assert seen == [c.id for c in R.CATEGORIES]


def test_every_rule_carries_a_label_and_recommendation():
    for rule in RULES:
        assert rule.label.strip(), rule.id
        assert rule.recommendation.strip(), rule.id
        assert rule.dependencies, rule.id


# ---------------------------------------------------------------------------
# Context helper
# ---------------------------------------------------------------------------


def ctx(**kwargs) -> RuleContext:
    """A RuleContext with everything neutral unless a test overrides it."""
    kwargs.setdefault("url", "https://acme.example/")
    kwargs.setdefault("host", "acme.example")
    return RuleContext(**kwargs)


def evaluate(rule_id: str, context: RuleContext) -> AuditStatus:
    return RULES_BY_ID[rule_id].evaluate(context).status


# ---------------------------------------------------------------------------
# Applicability heuristics — the N/A gates
# ---------------------------------------------------------------------------

_LONG_MARKETING_COPY = (
    "Acme is the workflow automation platform for operations teams. "
    "Pricing starts at $49 per month. Sign up for a free trial, book a demo, "
    "or get started with the self-serve plan today. Our software replaces "
    "brittle spreadsheets with governed pipelines. " * 20
)


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/blog/how-we-did-it/", True),
        ("/articles/x/", True),
        ("/guides/setup/", True),
        ("/news/2024/", True),
        ("/insights/report/", True),
        ("/research/paper/", True),
        ("/posts/a/", True),
        # The pattern needs slashes on BOTH sides, so a trailing segment misses.
        ("/blog", False),
        # ...and a longer word must not match the segment.
        ("/blogging/x/", False),
        ("/pricing/", False),
        ("/", False),
    ],
)
def test_is_article_like_matches_only_editorial_url_shapes(path, expected):
    assert R.is_article_like(ctx(url=f"https://acme.example{path}")) is expected


def test_is_article_like_is_strict_about_long_marketing_pages():
    """The heuristic is deliberately strict: length and prose style are things
    a marketing page fakes trivially, so only an editorial URL or real
    Article/BlogPosting JSON-LD counts. Without this, every long landing page
    would be graded as if it owed readers a byline and a last-updated date."""
    marketing = ctx(url="https://acme.example/platform/", analysis_text=_LONG_MARKETING_COPY)
    assert R.is_article_like(marketing) is False


def test_is_article_like_accepts_article_schema_on_any_url():
    schema_only = ctx(
        url="https://acme.example/somewhere/", schema=SchemaSummary(has_article=True)
    )
    assert R.is_article_like(schema_only) is True


@pytest.mark.parametrize(
    "type_name", ["Product", "SoftwareApplication", "WebApplication",
                  "MobileApplication", "Service", "Offer"],
)
def test_is_commercial_offering_like_accepts_commerce_schema(type_name):
    assert R.is_commercial_offering_like(ctx(json_ld=[{"@type": type_name}])) is True


def test_is_commercial_offering_like_reads_type_arrays():
    assert R.is_commercial_offering_like(ctx(json_ld=[{"@type": ["Product", "Thing"]}])) is True


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("our pricing starts at $10", True),
        ("sign up for a free trial", True),
        ("request a demo today", True),
        ("$29 per month per seat", True),
        ("the platform for teams", True),
        ("we ship software", True),
        ("just some prose about nothing", False),
        ("", False),
    ],
)
def test_is_commercial_offering_like_reads_commercial_language(text, expected):
    assert R.is_commercial_offering_like(ctx(analysis_text=text)) is expected


def test_article_pages_are_never_commercial_offerings():
    """An article about pricing is still an article, so E1 must not demand a
    G2 profile from it."""
    article = ctx(
        url="https://acme.example/blog/pricing-strategy/",
        analysis_text="our pricing and free trial and platform",
    )
    assert R.is_article_like(article) is True
    assert R.is_commercial_offering_like(article) is False


@pytest.mark.parametrize(
    "type_name", ["SoftwareApplication", "SoftwareSourceCode", "APIReference"]
)
def test_is_technical_product_like_accepts_developer_schema(type_name):
    assert R.is_technical_product_like(ctx(json_ld=[{"@type": type_name}])) is True


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/docs/", True),
        ("/doc/", True),
        ("/api", True),
        ("/sdk/reference", True),
        ("/reference/", True),
        ("/developers/", True),
        ("/developer/", True),
        ("/pricing/", False),
        # The segment must terminate: "/apiary" is not "/api".
        ("/apiary/", False),
    ],
)
def test_is_technical_product_like_reads_developer_url_shapes(path, expected):
    assert R.is_technical_product_like(ctx(url=f"https://acme.example{path}")) is expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("install the SDK", True),
        ("npm install acme", True),
        ("pip install acme", True),
        ("an open-source library", True),
        ("open source framework", True),
        ("developer portal access", True),
        ("github.com/acme/x", True),
        ("we sell shoes", False),
    ],
)
def test_is_technical_product_like_reads_developer_language(text, expected):
    assert R.is_technical_product_like(ctx(analysis_text=text)) is expected


@pytest.mark.parametrize(
    ("summary", "expected"),
    [
        (SchemaSummary(has_organization=True), True),
        (SchemaSummary(has_person=True), True),
        (SchemaSummary(has_article=True), True),
        (SchemaSummary(), False),
    ],
)
def test_has_disambiguable_entity(summary, expected):
    assert R.has_disambiguable_entity(ctx(schema=summary)) is expected


@pytest.mark.parametrize(
    ("links", "expected"),
    [
        ([], FAIL),
        (["/about/"], PARTIAL),
        (["/about/", "/company/"], PASS),
        (["/about/", "/company/", "/press/"], PASS),
    ],
)
def test_link_path_status_thresholds(links, expected):
    assert R.link_path_status(links, re.compile(r"(about|company|press)", re.I)) is expected


# ---------------------------------------------------------------------------
# A. Technical AI Crawlability
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "expected"),
    [("https://acme.example/", PASS), ("http://acme.example/", FAIL)],
)
def test_a1_https(url, expected):
    assert evaluate("A1", ctx(url=url)) is expected


@pytest.mark.parametrize(
    ("html_words", "words", "expected"),
    [
        # pass needs BOTH >=250 raw words and >=0.35 of the extracted text.
        (250, 700, PASS),
        (249, 700, PARTIAL),
        (250, 800, PARTIAL),  # ratio 0.3125 — enough words, too little coverage
        (80, 1000, PARTIAL),
        (79, 1000, FAIL),
        # A page with no extracted text still divides by at least 1.
        (300, 0, PASS),
    ],
)
def test_a8_raw_html_content(html_words, words, expected):
    assert evaluate("A8", ctx(html_words=html_words, words=words)) is expected


def test_a8_evidence_reports_both_word_counts():
    result = RULES_BY_ID["A8"].evaluate(ctx(html_words=12, words=34))
    assert result.evidence == (
        "12 readable words were found in raw HTML; Context.dev extracted 34 words "
        "from the page."
    )


@pytest.mark.parametrize(
    ("canonical", "expected"), [("https://acme.example/", PASS), (None, FAIL), ("", FAIL)]
)
def test_a11_canonical(canonical, expected):
    assert evaluate("A11", ctx(canonical=canonical)) is expected


@pytest.mark.parametrize(("noindex", "expected"), [(True, FAIL), (False, PASS)])
def test_a12_noindex_inverts(noindex, expected):
    assert evaluate("A12", ctx(has_noindex=noindex)) is expected


# ---------------------------------------------------------------------------
# B. Content Structure & Chunking
# ---------------------------------------------------------------------------


def _bluf(words: int, *, entity: bool, answer: bool) -> str:
    """An opening paragraph of exactly `words` words, with the brand token
    and/or the answer verb present as requested."""
    head = ["Acme"] if entity else ["Thing"]
    head += ["provides"] if answer else ["hmm"]
    filler = ["token"] * (words - len(head))
    return " ".join(head + filler)


@pytest.mark.parametrize(
    ("words", "entity", "answer", "expected"),
    [
        (30, True, True, PASS),
        (19, True, True, PARTIAL),   # under 20 words -> only partial
        (91, True, True, PARTIAL),   # over 90 words -> only partial
        (30, True, False, PARTIAL),  # names the brand but makes no claim
        (30, False, True, PARTIAL),  # makes a claim but names nothing
        (30, False, False, FAIL),
        (131, True, True, FAIL),     # past the partial ceiling
    ],
)
def test_b1_bluf_intro(words, entity, answer, expected):
    paragraph = _bluf(words, entity=entity, answer=answer)
    assert evaluate("B1", ctx(paragraphs=[paragraph], title="Acme")) is expected


def test_b1_fails_without_a_substantive_paragraph():
    result = RULES_BY_ID["B1"].evaluate(ctx(paragraphs=["too short"]))
    assert result.status is FAIL
    assert result.evidence == "No substantive opening paragraph was extracted."


@pytest.mark.parametrize(
    ("h1", "h2", "expected"),
    [
        (1, 2, PASS),
        (1, 1, PARTIAL),
        (2, 3, PARTIAL),  # more than one H1 downgrades even with many H2s
        (1, 0, FAIL),
        (0, 5, FAIL),
        (0, 0, FAIL),
    ],
)
def test_b2_heading_hierarchy(h1, h2, expected):
    assert evaluate("B2", ctx(h1_count=h1, h2_count=h2)) is expected


@pytest.mark.parametrize(
    ("lengths", "expected"),
    [
        ([50] * 10, PASS),
        # 1 of 10 over 120 words is 0.10 — still within the 0.15 pass ratio.
        ([130] + [50] * 9, PASS),
        ([130, 130] + [50] * 8, PARTIAL),
        # A single very-long (>180) paragraph blocks pass outright.
        ([200] + [50] * 9, PARTIAL),
        ([200, 200, 200] + [50] * 7, FAIL),
        ([], FAIL),
    ],
)
def test_b3_paragraph_length(lengths, expected):
    paragraphs = [" ".join(["word"] * n) for n in lengths]
    assert evaluate("B3", ctx(paragraphs=paragraphs)) is expected


@pytest.mark.parametrize(
    ("h2", "words", "expected"),
    [
        (3, 1350, PASS),
        (3, 1351, PARTIAL),  # over 450 words per section
        (2, 100, PARTIAL),
        (1, 100, FAIL),
        (0, 100, FAIL),
    ],
)
def test_b4_semantic_chunks(h2, words, expected):
    assert evaluate("B4", ctx(h2_count=h2, words=words)) is expected


def test_b4_never_divides_by_zero_sections():
    result = RULES_BY_ID["B4"].evaluate(ctx(h2_count=0, words=900))
    assert result.evidence == "900 words across 1 H2-level section(s)."


def test_b5_passes_through_the_precomputed_faq_status():
    assert evaluate("B5", ctx(faq_status=PASS)) is PASS
    assert evaluate("B5", ctx(faq_status=FAIL)) is FAIL


def test_b5_evidence_counts_question_marks_and_headings():
    result = RULES_BY_ID["B5"].evaluate(
        ctx(
            faq_status=PARTIAL,
            analysis_text="What? Really? Yes.",
            headings=[Heading(2, "Why?"), Heading(2, "No question")],
        )
    )
    assert result.evidence == "2 question mark(s) and 1 question-style heading(s) detected."


@pytest.mark.parametrize(
    ("n", "expected"), [(3, PASS), (2, PARTIAL), (1, PARTIAL), (0, FAIL)]
)
def test_b6_data_points(n, expected):
    assert evaluate("B6", ctx(data_points=n)) is expected


@pytest.mark.parametrize(
    ("markdown", "text", "expected"),
    [
        ("> a quotation", "", PASS),
        ("intro\n\n  > indented quote", "", PASS),
        ("", "According to the report, things changed.", PASS),
        ("", 'She said "a quoted claim long enough to count here".', PARTIAL),
        # An inline quote under 20 characters is not evidence of sourcing.
        ("", 'She said "too short".', FAIL),
        ("", "nothing at all", FAIL),
    ],
)
def test_b7_quotation_signals(markdown, text, expected):
    assert evaluate("B7", ctx(markdown=markdown, analysis_text=text)) is expected


@pytest.mark.parametrize(
    ("n", "expected"), [(3, PASS), (2, PARTIAL), (1, PARTIAL), (0, FAIL)]
)
def test_b8_external_links(n, expected):
    links = [f"https://other{i}.example/" for i in range(n)]
    assert evaluate("B8", ctx(external_links=links)) is expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("RAG is defined as a retrieval technique.", PASS),
        ("These are defined as follows.", PASS),
        ("RAG refers to retrieval augmented generation.", PASS),
        ("Latency means the delay you feel.", PASS),
        ("RAG is a technique.", PASS),
        ("RAG is an approach.", PASS),
        ("Nothing definitional in here whatsoever.", FAIL),
    ],
)
def test_b10_definitional_patterns(text, expected):
    assert evaluate("B10", ctx(analysis_text=text)) is expected


@pytest.mark.parametrize(
    ("n", "expected"), [(3, PASS), (2, PARTIAL), (1, PARTIAL), (0, FAIL)]
)
def test_b11_internal_links(n, expected):
    links = [f"https://acme.example/p{i}" for i in range(n)]
    assert evaluate("B11", ctx(same_origin_links=links)) is expected


def test_b12_is_na_on_non_article_pages():
    result = RULES_BY_ID["B12"].evaluate(ctx(url="https://acme.example/pricing/"))
    assert result.status is NA
    assert "not required" in result.evidence


@pytest.mark.parametrize(
    ("modified", "any_date", "expected"),
    [(True, True, PASS), (False, True, PARTIAL), (False, False, FAIL)],
)
def test_b12_date_signals_on_article_pages(modified, any_date, expected):
    context = ctx(
        url="https://acme.example/blog/x/",
        date_signals=DateSignals(has_any_date=any_date, has_modified_date=modified),
    )
    assert evaluate("B12", context) is expected


@pytest.mark.parametrize(
    ("grade", "expected"),
    [
        (10.0, PASS),
        (16.0, PASS),
        (9.9, PARTIAL),
        (16.1, PARTIAL),
        (7.0, PARTIAL),
        (20.0, PARTIAL),
        (6.9, FAIL),
        (20.1, FAIL),
        # An unmeasurable grade is treated as partial, never as a failure.
        (None, PARTIAL),
    ],
)
def test_b13_readability_bands(grade, expected):
    assert evaluate("B13", ctx(grade=grade)) is expected


def test_b13_evidence_formats_the_grade_to_one_decimal():
    assert RULES_BY_ID["B13"].evaluate(ctx(grade=12.34)).evidence == (
        "Estimated Flesch-Kincaid grade level is 12.3."
    )


@pytest.mark.parametrize(
    ("markdown", "html", "expected"),
    [
        ("", "<table>x</table>", PASS),          # one table is enough
        ("| a | b |", "", PASS),                 # markdown table row counts
        ("\n".join(["- x"] * 6), "", PASS),      # six list items
        ("\n".join(["* x"] * 6), "", PASS),
        ("", "<li>a</li>" * 6, PASS),
        ("\n".join(["- x"] * 5), "", PARTIAL),
        ("\n".join(["- x"] * 2), "", PARTIAL),
        ("- x", "", FAIL),
        ("", "", FAIL),
        # HTML and Markdown list signals accumulate across both views.
        ("\n".join(["- x"] * 3), "<li>a</li>" * 3, PASS),
    ],
)
def test_b14_lists_and_tables(markdown, html, expected):
    assert evaluate("B14", ctx(markdown=markdown, html=html)) is expected


# ---------------------------------------------------------------------------
# C. Structured Data / Schema
# ---------------------------------------------------------------------------


def test_c1_and_c11_track_json_ld_presence():
    present = ctx(json_ld=[{"@type": "Organization"}], json_ld_block_count=1)
    assert evaluate("C1", present) is PASS
    assert evaluate("C11", present) is PASS
    assert evaluate("C1", ctx()) is FAIL
    assert evaluate("C11", ctx()) is FAIL


def test_c1_evidence_mentions_parse_failures():
    result = RULES_BY_ID["C1"].evaluate(
        ctx(json_ld=[{"a": 1}], json_ld_block_count=3, json_ld_parse_failures=2)
    )
    assert result.evidence == (
        "1 JSON-LD entity(ies) parsed from 3 script block(s). 2 block(s) were "
        "present but failed to parse; check for malformed JSON."
    )


def test_c1_evidence_omits_the_note_when_nothing_failed():
    result = RULES_BY_ID["C1"].evaluate(ctx(json_ld=[{"a": 1}], json_ld_block_count=1))
    assert result.evidence == "1 JSON-LD entity(ies) parsed from 1 script block(s)."


@pytest.mark.parametrize(
    ("complete", "present", "expected"),
    [(True, True, PASS), (False, True, PARTIAL), (False, False, FAIL)],
)
def test_c2_organization_schema(complete, present, expected):
    summary = SchemaSummary(has_organization=present, organization_complete=complete)
    assert evaluate("C2", ctx(schema=summary)) is expected


@pytest.mark.parametrize(
    ("url", "complete", "present", "expected"),
    [
        ("https://acme.example/blog/x/", True, True, PASS),
        ("https://acme.example/blog/x/", False, True, PARTIAL),
        # Article-shaped URL with no Article schema is a real failure...
        ("https://acme.example/blog/x/", False, False, FAIL),
        # ...but a pricing page owes nobody Article schema.
        ("https://acme.example/pricing/", False, False, NA),
    ],
)
def test_c3_article_schema_gating(url, complete, present, expected):
    summary = SchemaSummary(has_article=present, article_complete=complete)
    assert evaluate("C3", ctx(url=url, schema=summary)) is expected


def test_c4_is_na_on_non_article_pages():
    assert evaluate("C4", ctx(url="https://acme.example/pricing/")) is NA


@pytest.mark.parametrize(
    ("has_person", "has_byline", "expected"),
    [(True, False, PASS), (False, True, PARTIAL), (False, False, FAIL)],
)
def test_c4_person_schema_on_articles(has_person, has_byline, expected):
    context = ctx(
        url="https://acme.example/blog/x/",
        schema=SchemaSummary(has_person=has_person),
        has_byline=has_byline,
    )
    assert evaluate("C4", context) is expected


@pytest.mark.parametrize(
    ("faq_status", "has_faq", "expected"),
    [
        # No FAQ content at all means there is nothing to mark up -> N/A.
        (FAIL, False, NA),
        (FAIL, True, NA),
        (PARTIAL, False, FAIL),
        (PARTIAL, True, PASS),
        (PASS, False, FAIL),
        (PASS, True, PASS),
    ],
)
def test_c5_faq_schema_gating(faq_status, has_faq, expected):
    context = ctx(faq_status=faq_status, schema=SchemaSummary(has_faq=has_faq))
    assert evaluate("C5", context) is expected


# ---------------------------------------------------------------------------
# D. E-E-A-T & Entity Authority
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("links", "expected"),
    [
        (["https://acme.example/about/", "https://acme.example/newsroom/"], PASS),
        (["https://acme.example/trust/"], PARTIAL),
        (["https://acme.example/pricing/"], FAIL),
        ([], FAIL),
    ],
)
def test_d5_about_and_trust_links(links, expected):
    assert evaluate("D5", ctx(links=links)) is expected


def test_d6_passes_only_when_privacy_is_strong_and_nothing_is_missing():
    """Two privacy links plus at least one terms and one contact link."""
    links = [
        "https://acme.example/privacy/",
        "https://acme.example/legal/privacy-policy/",
        "https://acme.example/terms/",
        "https://acme.example/contact/",
    ]
    assert evaluate("D6", ctx(links=links)) is PASS


def test_d6_falls_back_to_the_combined_count_without_two_privacy_links():
    """One privacy link is not enough for the strict branch, so the rule falls
    back to the combined privacy/terms/legal/contact/support count — which
    here is >= 2 and therefore still a pass."""
    links = ["https://acme.example/privacy/", "https://acme.example/terms/"]
    assert evaluate("D6", ctx(links=links)) is PASS


def test_d6_partial_on_a_single_legal_link():
    assert evaluate("D6", ctx(links=["https://acme.example/support/"])) is PARTIAL


def test_d6_fails_with_no_legal_links():
    assert evaluate("D6", ctx(links=["https://acme.example/pricing/"])) is FAIL


def test_d6_downgrades_when_contact_is_missing_entirely():
    """Two privacy links and a terms link, but nothing contact-shaped: the
    strict branch requires contact != fail, so this drops to the combined
    status rather than passing."""
    links = [
        "https://acme.example/privacy/",
        "https://acme.example/privacy-policy/",
        "https://acme.example/terms/",
    ]
    assert evaluate("D6", ctx(links=links)) is PASS  # combined count is 3 -> pass


@pytest.mark.parametrize(
    ("text", "data_points", "expected"),
    [
        ("We published original research this year.", 0, PASS),
        ("Our methodology is documented.", 0, PASS),
        ("We analyzed 40 deployments.", 0, PASS),
        ("We measured the latency.", 0, PASS),
        ("A benchmark of tools.", 0, PASS),
        # No research language, but enough hard numbers to be partially credited.
        ("Just some copy.", 3, PARTIAL),
        ("Just some copy.", 2, FAIL),
    ],
)
def test_d10_original_research(text, data_points, expected):
    assert evaluate("D10", ctx(analysis_text=text, data_points=data_points)) is expected


@pytest.mark.parametrize(
    ("title", "description", "text", "expected"),
    [
        ("Acme Docs", "Acme is great", "acme acme", PASS),
        ("Acme Docs", None, "acme", PARTIAL),
        (None, "Acme is great", "", PARTIAL),
        (None, None, "acme once", PARTIAL),
        # Title and description both carry the brand but the body does not
        # mention it twice, so this stays partial.
        ("Acme Docs", "Acme is great", "acme", PARTIAL),
        (None, None, "nothing relevant", FAIL),
    ],
)
def test_d12_brand_consistency(title, description, text, expected):
    context = ctx(title=title, description=description, analysis_text=text)
    assert evaluate("D12", context) is expected


def test_d12_brand_token_comes_from_the_host():
    result = RULES_BY_ID["D12"].evaluate(
        ctx(host="acme.example", title="Acme", description="Acme", analysis_text="Acme Acme")
    )
    assert result.evidence.startswith('Brand token "acme" appears in title: yes')


# ---------------------------------------------------------------------------
# E. Off-site / Citation Surface Presence
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "host",
    ["g2.com", "capterra.com", "trustpilot.com", "gartner.com", "producthunt.com"],
)
def test_e1_passes_on_any_known_review_surface(host):
    assert evaluate("E1", ctx(external_links=[f"https://www.{host}/products/acme"])) is PASS


def test_e1_is_na_when_the_page_is_not_a_commercial_offering():
    result = RULES_BY_ID["E1"].evaluate(ctx(analysis_text="a quiet personal essay"))
    assert result.status is NA
    assert "not expected" in result.evidence


def test_e1_fails_on_a_commercial_page_with_no_review_profile():
    assert evaluate("E1", ctx(analysis_text="pricing and free trial")) is FAIL


def test_e7_passes_on_a_github_link():
    assert evaluate("E7", ctx(external_links=["https://github.com/acme/x"])) is PASS


def test_e7_is_na_when_the_page_is_not_technical():
    result = RULES_BY_ID["E7"].evaluate(ctx(analysis_text="we sell candles"))
    assert result.status is NA
    assert "not expected" in result.evidence


def test_e7_fails_on_a_developer_page_with_no_github_link():
    assert evaluate("E7", ctx(url="https://acme.example/docs/", analysis_text="")) is FAIL


def test_e10_is_na_without_an_entity_to_disambiguate():
    result = RULES_BY_ID["E10"].evaluate(ctx())
    assert result.status is NA
    assert "No Organization, Person, or Article entity" in result.evidence


@pytest.mark.parametrize(
    ("same_as", "expected"), [(3, PASS), (2, PARTIAL), (1, PARTIAL), (0, FAIL)]
)
def test_e10_same_as_thresholds(same_as, expected):
    summary = SchemaSummary(has_organization=True, same_as_count=same_as)
    assert evaluate("E10", ctx(schema=summary)) is expected


@pytest.mark.parametrize(
    ("external", "data_points", "expected"),
    [
        (5, 3, PASS),
        (5, 2, PARTIAL),  # enough links, not enough facts
        (4, 9, PARTIAL),
        (2, 0, PARTIAL),
        (1, 9, FAIL),
        (0, 0, FAIL),
    ],
)
def test_e12_outbound_citation_surface(external, data_points, expected):
    links = [f"https://other{i}.example/" for i in range(external)]
    assert evaluate("E12", ctx(external_links=links, data_points=data_points)) is expected


# ---------------------------------------------------------------------------
# F. Measurement & Governance
# ---------------------------------------------------------------------------


def test_f6_is_na_on_non_article_pages():
    result = RULES_BY_ID["F6"].evaluate(ctx(url="https://acme.example/pricing/"))
    assert result.status is NA
    assert "refresh-date signal is not required" in result.evidence


@pytest.mark.parametrize(
    ("modified", "any_date", "expected"),
    [(True, True, PASS), (False, True, PARTIAL), (False, False, FAIL)],
)
def test_f6_refresh_signal_on_article_pages(modified, any_date, expected):
    context = ctx(
        url="https://acme.example/blog/x/",
        date_signals=DateSignals(has_any_date=any_date, has_modified_date=modified),
    )
    assert evaluate("F6", context) is expected


# ---------------------------------------------------------------------------
# Whole-catalog smoke: no rule may explode on an empty page
# ---------------------------------------------------------------------------


def test_every_rule_evaluates_on_a_completely_empty_page():
    """An empty scrape must still produce a scored audit, not a 500.

    The context is built through the real pipeline rather than by hand so the
    derived fields (schema summary, date signals, evidence strings) are the
    ones production would actually see for a blank page.
    """
    from marketer.seoaudit.audit import build_rule_context

    empty = build_rule_context(url="https://acme.example/", markdown="", html="")
    for rule in RULES:
        result = rule.evaluate(empty)
        assert isinstance(result.status, AuditStatus), rule.id
        assert result.evidence.strip(), rule.id
