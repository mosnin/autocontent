"""Authoritative source for every AI-SEO audit rule (port of lib/rules.ts).

To add, remove, or tune a rule:
  1. Edit (or add) an entry in ``RULES`` below.
  2. Make sure its ``category_id`` points at one of the entries in ``CATEGORIES``.
  3. Declare every input it reads from the page via ``dependencies`` (this is
     documentation only; the evaluator receives the full ``RuleContext``).
  4. Optionally set ``multiplier`` (defaults to 1) to weight the rule inside
     its category. A category's ``max_score`` is split across the multipliers
     of its *applicable* rules.

Everything downstream (scoring, agent prompts, UI) derives from this file.

Rule ids are not contiguous (A1, A8, A11, ...): they are stable identifiers
carried over from the upstream guideline document, and audits stored in the
database reference them, so gaps are intentional — never renumber.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from .parsing import (
    DateSignals,
    Heading,
    JsonObject,
    SchemaSummary,
    count_matches,
    count_words,
)
from .types import AuditStatus

PASS = AuditStatus.passed
PARTIAL = AuditStatus.partial
FAIL = AuditStatus.fail
NA = AuditStatus.na


@dataclass
class RuleContext:
    """Everything a rule's evaluator can read about the audited page.

    Built once per audit by ``audit.py`` and passed to every rule.
    """

    url: str
    host: str

    title: str | None = None
    description: str | None = None
    canonical: str | None = None
    has_noindex: bool = False

    html: str = ""
    html_text: str = ""
    html_words: int = 0
    markdown: str = ""
    analysis_text: str = ""
    words: int = 0

    paragraphs: list[str] = field(default_factory=list)
    headings: list[Heading] = field(default_factory=list)
    h1_count: int = 0
    h2_count: int = 0

    links: list[str] = field(default_factory=list)
    external_links: list[str] = field(default_factory=list)
    same_origin_links: list[str] = field(default_factory=list)

    json_ld: list[JsonObject] = field(default_factory=list)
    #: Total ld+json script blocks found, including those that failed to parse.
    json_ld_block_count: int = 0
    #: Blocks that were present but could not be parsed.
    json_ld_parse_failures: int = 0
    schema: SchemaSummary = field(default_factory=SchemaSummary)

    data_points: int = 0
    grade: float | None = None
    date_signals: DateSignals = field(default_factory=DateSignals)

    #: Precomputed FAQ-content presence, shared by B5 and C5.
    faq_status: AuditStatus = AuditStatus.fail
    #: Precomputed byline presence, shared by C4 and friends.
    has_byline: bool = False

    @property
    def url_path(self) -> str:
        return urlsplit(self.url).path

    @property
    def url_scheme(self) -> str:
        return urlsplit(self.url).scheme.lower()


@dataclass
class RuleEvaluation:
    status: AuditStatus
    evidence: str


@dataclass
class Rule:
    id: str
    category_id: str
    label: str
    recommendation: str
    #: Free-form list of inputs this rule reads. Documentation only.
    dependencies: list[str]
    evaluate: Callable[[RuleContext], RuleEvaluation]
    #: Weight relative to siblings in the same category.
    multiplier: float = 1.0


@dataclass
class CategoryDef:
    id: str
    name: str
    description: str
    max_score: float


# ---------------------------------------------------------------------------
# Categories: total max_score adds to 100.
# ---------------------------------------------------------------------------

CATEGORIES: list[CategoryDef] = [
    CategoryDef(
        id="A",
        name="Technical AI Crawlability",
        description="Can AI retrieval crawlers fetch and parse the page without JavaScript?",
        max_score=28.4,
    ),
    CategoryDef(
        id="B",
        name="Content Structure & Chunking",
        description="Can answer engines extract self-contained, quotable passages?",
        max_score=25.4,
    ),
    CategoryDef(
        id="C",
        name="Structured Data / Schema",
        description="Does the raw HTML expose machine-readable entities and page facts?",
        max_score=13.4,
    ),
    CategoryDef(
        id="D",
        name="E-E-A-T & Entity Authority",
        description="Does the page expose trust, authorship, and entity signals?",
        max_score=21.4,
    ),
    CategoryDef(
        id="E",
        name="Off-site / Citation Surface Presence",
        description="Does the page connect the brand to surfaces AI engines often cite?",
        max_score=8.4,
    ),
    CategoryDef(
        id="F",
        name="Measurement & Governance",
        description="Are monitoring and refresh signals visible or inferable?",
        max_score=3.0,
    ),
]


# ---------------------------------------------------------------------------
# Helpers used by rule evaluators. Kept here so rules.py is self-contained.
# ---------------------------------------------------------------------------


def escape_regexp(value: str) -> str:
    return re.escape(value)


def clip(value: str, max_len: int) -> str:
    return value if len(value) <= max_len else f"{value[: max_len - 1]}..."


def first_useful_paragraph(paragraphs: list[str]) -> str:
    return next((p for p in paragraphs if count_words(p) >= 12), "")


def is_article_like(ctx: RuleContext) -> bool:
    """Heuristic for "this is a blog post / article / editorial page."

    Used by the date-freshness rules (B12, F6) and the article-schema rule
    (C3). Intentionally strict: long marketing pages should NOT match, so we
    require either an editorial URL pattern or actual Article/BlogPosting
    JSON-LD — nothing about length or prose style, which marketing pages fake
    easily.
    """
    return bool(
        re.search(
            r"/(blog|article|articles|guide|guides|news|post|posts|insight|insights|research)/",
            ctx.url_path,
            re.I,
        )
    ) or ctx.schema.has_article


def is_commercial_offering_like(ctx: RuleContext) -> bool:
    """Does the page read as a commercial product/SaaS offering?

    Gates rules that only matter when there is something to sell or review.
    """
    if is_article_like(ctx):
        return False
    if has_json_ld_type(
        ctx,
        [
            "Product",
            "SoftwareApplication",
            "WebApplication",
            "MobileApplication",
            "Service",
            "Offer",
        ],
    ):
        return True
    return bool(
        re.search(
            r"\b(pricing|free trial|start free|sign up|signup|sign-up|get started|"
            r"request a demo|schedule a demo|book a demo|buy now|add to cart|subscribe|"
            r"per (?:month|user|seat)|saas|platform|software)\b",
            ctx.analysis_text,
            re.I,
        )
    )


def is_technical_product_like(ctx: RuleContext) -> bool:
    """Does the page read as a technical/developer product (API, SDK, docs)?

    Gates GitHub-presence and similar developer-surface rules.
    """
    if has_json_ld_type(
        ctx, ["SoftwareApplication", "SoftwareSourceCode", "APIReference"]
    ):
        return True
    if re.search(r"/(docs?|api|sdk|reference|developers?)(/|\Z)", ctx.url_path, re.I):
        return True
    return bool(
        re.search(
            r"\b(api|sdk|cli|library|framework|open[- ]source|"
            r"developer (?:portal|docs|guide)|npm install|pip install|brew install|"
            r"github\.com/[^\s]+)\b",
            ctx.analysis_text,
            re.I,
        )
    )


def has_disambiguable_entity(ctx: RuleContext) -> bool:
    """Does the page expose an Organization/Person/Article worth disambiguating?"""
    return ctx.schema.has_organization or ctx.schema.has_person or ctx.schema.has_article


def has_json_ld_type(ctx: RuleContext, types: list[str]) -> bool:
    for obj in ctx.json_ld:
        raw = obj.get("@type")
        actual = raw if isinstance(raw, list) else [raw]
        if any(isinstance(t, str) and t in types for t in actual):
            return True
    return False


def link_path_status(links: list[str], pattern: re.Pattern[str]) -> AuditStatus:
    count = sum(1 for link in links if pattern.search(link))
    if count >= 2:
        return PASS
    if count == 1:
        return PARTIAL
    return FAIL


# ---------------------------------------------------------------------------
# A. Technical AI Crawlability
# ---------------------------------------------------------------------------


def _a1(ctx: RuleContext) -> RuleEvaluation:
    https = ctx.url_scheme == "https"
    return RuleEvaluation(
        status=PASS if https else FAIL,
        evidence=(
            "The submitted URL uses HTTPS."
            if https
            else "The submitted URL is not HTTPS."
        ),
    )


def _a8(ctx: RuleContext) -> RuleEvaluation:
    html_words = ctx.html_words
    extracted = max(ctx.words, 1)
    ratio = html_words / extracted
    if html_words >= 250 and ratio >= 0.35:
        status = PASS
    elif html_words >= 80:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=(
            f"{html_words} readable words were found in raw HTML; Context.dev "
            f"extracted {ctx.words} words from the page."
        ),
    )


def _a11(ctx: RuleContext) -> RuleEvaluation:
    return RuleEvaluation(
        status=PASS if ctx.canonical else FAIL,
        evidence=(
            f"Canonical URL: {ctx.canonical}."
            if ctx.canonical
            else "No canonical link tag was found in the raw HTML."
        ),
    )


def _a12(ctx: RuleContext) -> RuleEvaluation:
    return RuleEvaluation(
        status=FAIL if ctx.has_noindex else PASS,
        evidence=(
            "A robots noindex directive appears in the page HTML."
            if ctx.has_noindex
            else "No robots noindex directive was detected in the raw HTML."
        ),
    )


# ---------------------------------------------------------------------------
# B. Content Structure & Chunking
# ---------------------------------------------------------------------------


def _b1(ctx: RuleContext) -> RuleEvaluation:
    first = first_useful_paragraph(ctx.paragraphs)
    status = FAIL
    if first:
        w = count_words(first)
        tokens = [ctx.host.split(".")[0]]
        tokens += [
            t
            for t in re.split(r"[\s|:.-]+", ctx.title or "")
            if len(t) > 3
        ][:4]
        tokens = [t for t in tokens if t]
        names_entity = any(
            re.search(rf"\b{escape_regexp(t)}\b", first, re.I) for t in tokens
        )
        answer_pattern = bool(
            re.search(
                r"\b(is|are|helps|provides|offers|refers to|means|enables|builds|delivers)\b",
                first,
                re.I,
            )
        )
        if 20 <= w <= 90 and names_entity and answer_pattern:
            status = PASS
        elif 12 <= w <= 130 and (names_entity or answer_pattern):
            status = PARTIAL
    return RuleEvaluation(
        status=status,
        evidence=(
            f'First substantive paragraph: "{clip(first, 180)}"'
            if first
            else "No substantive opening paragraph was extracted."
        ),
    )


def _b2(ctx: RuleContext) -> RuleEvaluation:
    if ctx.h1_count == 1 and ctx.h2_count >= 2:
        status = PASS
    elif ctx.h1_count >= 1 and ctx.h2_count >= 1:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=(
            f"Detected {ctx.h1_count} H1 heading(s), {ctx.h2_count} H2 heading(s), "
            f"and {len(ctx.headings)} total Markdown/HTML headings."
        ),
    )


def _b3(ctx: RuleContext) -> RuleEvaluation:
    paragraphs = ctx.paragraphs
    long = sum(1 for p in paragraphs if count_words(p) > 120)
    very_long = sum(1 for p in paragraphs if count_words(p) > 180)
    status = FAIL
    if paragraphs:
        if very_long == 0 and long / len(paragraphs) <= 0.15:
            status = PASS
        elif very_long <= 2 and long / len(paragraphs) <= 0.35:
            status = PARTIAL
    return RuleEvaluation(
        status=status,
        evidence=f"{len(paragraphs)} paragraph(s) found; {long} exceed 120 words.",
    )


def _b4(ctx: RuleContext) -> RuleEvaluation:
    sections = max(ctx.h2_count, 1)
    if ctx.h2_count >= 3 and ctx.words / sections <= 450:
        status = PASS
    elif ctx.h2_count >= 2:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=f"{ctx.words} words across {sections} H2-level section(s).",
    )


_QUESTION_MARK_RE = re.compile(r"\?")


def _b5(ctx: RuleContext) -> RuleEvaluation:
    question_headings = sum(1 for h in ctx.headings if "?" in h.text)
    question_marks = count_matches(ctx.analysis_text, _QUESTION_MARK_RE)
    return RuleEvaluation(
        status=ctx.faq_status,
        evidence=(
            f"{question_marks} question mark(s) and "
            f"{question_headings} question-style heading(s) detected."
        ),
    )


def _b6(ctx: RuleContext) -> RuleEvaluation:
    if ctx.data_points >= 3:
        status = PASS
    elif ctx.data_points >= 1:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=(
            f"{ctx.data_points} dated specifics, percentages, money values, "
            "multipliers, or named-entity-like data points were detected."
        ),
    )


def _b7(ctx: RuleContext) -> RuleEvaluation:
    blockquote = bool(re.search(r"(^|\n)\s*>", ctx.markdown))
    according_to = bool(re.search(r"\baccording to\b", ctx.analysis_text, re.I))
    inline_quote = bool(re.search(r'"[^"]{20,}"', ctx.analysis_text))
    if blockquote or according_to:
        status = PASS
    elif inline_quote:
        status = PARTIAL
    else:
        status = FAIL
    if blockquote:
        evidence = "Markdown blockquote syntax was found."
    elif according_to:
        evidence = 'The phrase "according to" was found.'
    else:
        evidence = "No obvious quotation or source-attribution pattern was found."
    return RuleEvaluation(status=status, evidence=evidence)


def _b8(ctx: RuleContext) -> RuleEvaluation:
    n = len(ctx.external_links)
    if n >= 3:
        status = PASS
    elif n >= 1:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status, evidence=f"{n} external link(s) were detected."
    )


def _b10(ctx: RuleContext) -> RuleEvaluation:
    found = bool(
        re.search(
            r"\b(is defined as|are defined as|refers to|means|is a|is an)\b",
            ctx.analysis_text,
            re.I,
        )
    )
    return RuleEvaluation(
        status=PASS if found else FAIL,
        evidence=(
            "A definitional sentence pattern was detected."
            if found
            else "No clear definitional sentence pattern was detected."
        ),
    )


def _b11(ctx: RuleContext) -> RuleEvaluation:
    n = len(ctx.same_origin_links)
    if n >= 3:
        status = PASS
    elif n >= 1:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=f"{n} same-origin link(s) were detected in the page HTML or Markdown.",
    )


def _b12(ctx: RuleContext) -> RuleEvaluation:
    if not is_article_like(ctx):
        return RuleEvaluation(
            status=NA,
            evidence=(
                "This page does not look like an article or blog post, so a "
                "last-updated date is not required."
            ),
        )
    if ctx.date_signals.has_modified_date:
        status = PASS
    elif ctx.date_signals.has_any_date:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(status=status, evidence=ctx.date_signals.evidence)


def _b13(ctx: RuleContext) -> RuleEvaluation:
    g = ctx.grade
    if g is None:
        status = PARTIAL
    elif 10 <= g <= 16:
        status = PASS
    elif 7 <= g <= 20:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=(
            "Readability could not be estimated from the extracted text."
            if g is None
            else f"Estimated Flesch-Kincaid grade level is {g:.1f}."
        ),
    )


def _b14(ctx: RuleContext) -> RuleEvaluation:
    lists = count_matches(ctx.markdown, re.compile(r"^[-*]\s+", re.M)) + count_matches(
        ctx.html, re.compile(r"<li\b", re.I)
    )
    tables = count_matches(
        ctx.markdown, re.compile(r"^\|.+\|$", re.M)
    ) + count_matches(ctx.html, re.compile(r"<table\b", re.I))
    if tables >= 1 or lists >= 6:
        status = PASS
    elif lists >= 2:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=f"{lists} list item(s) and {tables} table signal(s) detected.",
    )


# ---------------------------------------------------------------------------
# C. Structured Data / Schema
# ---------------------------------------------------------------------------


def _c1(ctx: RuleContext) -> RuleEvaluation:
    failure_note = (
        f" {ctx.json_ld_parse_failures} block(s) were present but failed to parse; "
        "check for malformed JSON."
        if ctx.json_ld_parse_failures > 0
        else ""
    )
    return RuleEvaluation(
        status=PASS if ctx.json_ld else FAIL,
        evidence=(
            f"{len(ctx.json_ld)} JSON-LD entity(ies) parsed from "
            f"{ctx.json_ld_block_count} script block(s).{failure_note}"
        ),
    )


def _c2(ctx: RuleContext) -> RuleEvaluation:
    if ctx.schema.organization_complete:
        status = PASS
    elif ctx.schema.has_organization:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(status=status, evidence=ctx.schema.organization_evidence)


def _c3(ctx: RuleContext) -> RuleEvaluation:
    if ctx.schema.article_complete:
        status = PASS
    elif ctx.schema.has_article:
        status = PARTIAL
    elif is_article_like(ctx):
        status = FAIL
    else:
        status = NA
    return RuleEvaluation(status=status, evidence=ctx.schema.article_evidence)


def _c4(ctx: RuleContext) -> RuleEvaluation:
    if not is_article_like(ctx):
        return RuleEvaluation(
            status=NA,
            evidence=(
                "This page does not look like an article or blog post, so Person "
                "schema is not required."
            ),
        )
    if ctx.schema.has_person:
        return RuleEvaluation(status=PASS, evidence="Person schema was found.")
    if ctx.has_byline:
        return RuleEvaluation(
            status=PARTIAL,
            evidence="A byline was detected, but no Person schema was found.",
        )
    return RuleEvaluation(
        status=FAIL, evidence="No Person schema or byline signal was found."
    )


def _c5(ctx: RuleContext) -> RuleEvaluation:
    # No FAQ-like content on the page means there is nothing to mark up.
    if ctx.faq_status == FAIL:
        status = NA
    elif ctx.schema.has_faq:
        status = PASS
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=(
            "FAQPage schema was found."
            if ctx.schema.has_faq
            else "FAQ-like content was found without FAQPage schema."
        ),
    )


def _c11(ctx: RuleContext) -> RuleEvaluation:
    return RuleEvaluation(
        status=PASS if ctx.json_ld else FAIL,
        evidence=(
            "JSON-LD was present in the raw HTML response."
            if ctx.json_ld
            else "No JSON-LD was present in the raw HTML response."
        ),
    )


# ---------------------------------------------------------------------------
# D. E-E-A-T & Entity Authority
# ---------------------------------------------------------------------------

_D5_RE = re.compile(r"(about|company|trust|newsroom|press)", re.I)
_D6_ANY_RE = re.compile(r"(privacy|terms|legal|contact|support)", re.I)


def _d5(ctx: RuleContext) -> RuleEvaluation:
    count = sum(1 for link in ctx.links if _D5_RE.search(link))
    return RuleEvaluation(
        status=link_path_status(ctx.links, _D5_RE),
        evidence=f"{count} about/trust/newsroom-style link(s) detected.",
    )


def _d6(ctx: RuleContext) -> RuleEvaluation:
    privacy = link_path_status(ctx.links, re.compile(r"(privacy)", re.I))
    terms = link_path_status(ctx.links, re.compile(r"(terms|legal)", re.I))
    contact = link_path_status(ctx.links, re.compile(r"(contact|support)", re.I))
    combined = link_path_status(ctx.links, _D6_ANY_RE)
    status = (
        PASS
        if privacy == PASS and terms != FAIL and contact != FAIL
        else combined
    )
    count = sum(1 for link in ctx.links if _D6_ANY_RE.search(link))
    return RuleEvaluation(
        status=status,
        evidence=f"{count} privacy/terms/contact-style link(s) detected.",
    )


def _d10(ctx: RuleContext) -> RuleEvaluation:
    found = bool(
        re.search(
            r"\b(original research|study|survey|benchmark|dataset|methodology|"
            r"proprietary data|we analyzed|we measured)\b",
            ctx.analysis_text,
            re.I,
        )
    )
    if found:
        status = PASS
    elif ctx.data_points >= 3:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=(
            "Research or methodology language was detected."
            if found
            else (
                f"{ctx.data_points} data point(s) were detected without strong "
                "original-research language."
            )
        ),
    )


def _d12(ctx: RuleContext) -> RuleEvaluation:
    brand = ctx.host.split(".")[0]
    title_has_brand = bool(
        ctx.title and re.search(escape_regexp(brand), ctx.title, re.I)
    )
    desc_has_brand = bool(
        ctx.description and re.search(escape_regexp(brand), ctx.description, re.I)
    )
    body_mentions = count_matches(
        ctx.analysis_text, re.compile(rf"\b{escape_regexp(brand)}\b", re.I)
    )
    if title_has_brand and desc_has_brand and body_mentions >= 2:
        status = PASS
    elif title_has_brand or desc_has_brand or body_mentions >= 1:
        status = PARTIAL
    else:
        status = FAIL
    # The evidence line reports whether a title/description exists at all,
    # not whether it contains the brand — a quirk of the source kept as-is so
    # stored audits stay comparable across the port.
    return RuleEvaluation(
        status=status,
        evidence=(
            f'Brand token "{brand}" appears in title: '
            f"{'yes' if ctx.title else 'no'}, meta description: "
            f"{'yes' if ctx.description else 'no'}, body mentions: {body_mentions}."
        ),
    )


# ---------------------------------------------------------------------------
# E. Off-site / Citation Surface Presence
# ---------------------------------------------------------------------------

_E1_RE = re.compile(
    r"(g2\.com|capterra\.com|trustpilot\.com|gartner\.com|producthunt\.com)", re.I
)


def _e1(ctx: RuleContext) -> RuleEvaluation:
    count = sum(1 for link in ctx.external_links if _E1_RE.search(link))
    if count > 0:
        return RuleEvaluation(
            status=PASS, evidence=f"{count} review/marketplace link(s) detected."
        )
    if not is_commercial_offering_like(ctx):
        return RuleEvaluation(
            status=NA,
            evidence=(
                "This page does not look like a commercial product or SaaS offering, "
                "so review/marketplace profiles are not expected."
            ),
        )
    return RuleEvaluation(
        status=FAIL,
        evidence=(
            "Page reads as a commercial product/SaaS offering, but no review or "
            "marketplace profile link was detected."
        ),
    )


def _e7(ctx: RuleContext) -> RuleEvaluation:
    found = bool(re.search(r"github\.com", " ".join(ctx.external_links), re.I))
    if found:
        return RuleEvaluation(status=PASS, evidence="A GitHub link was detected.")
    if not is_technical_product_like(ctx):
        return RuleEvaluation(
            status=NA,
            evidence=(
                "This page does not look like a technical or developer product, so a "
                "GitHub surface is not expected."
            ),
        )
    return RuleEvaluation(
        status=FAIL,
        evidence=(
            "Page reads as a developer/technical product, but no GitHub link was "
            "detected."
        ),
    )


def _e10(ctx: RuleContext) -> RuleEvaluation:
    if not has_disambiguable_entity(ctx):
        return RuleEvaluation(
            status=NA,
            evidence=(
                "No Organization, Person, or Article entity was found on this page to "
                "attach sameAs links to."
            ),
        )
    n = ctx.schema.same_as_count
    if n >= 3:
        status = PASS
    elif n >= 1:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status, evidence=f"{n} sameAs link(s) were found in JSON-LD."
    )


def _e12(ctx: RuleContext) -> RuleEvaluation:
    n = len(ctx.external_links)
    if n >= 5 and ctx.data_points >= 3:
        status = PASS
    elif n >= 2:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(
        status=status,
        evidence=f"{n} external link(s) and {ctx.data_points} data point(s) were detected.",
    )


# ---------------------------------------------------------------------------
# F. Measurement & Governance
# ---------------------------------------------------------------------------


def _f6(ctx: RuleContext) -> RuleEvaluation:
    if not is_article_like(ctx):
        return RuleEvaluation(
            status=NA,
            evidence=(
                "This page does not look like an article or blog post, so a "
                "refresh-date signal is not required."
            ),
        )
    if ctx.date_signals.has_modified_date:
        status = PASS
    elif ctx.date_signals.has_any_date:
        status = PARTIAL
    else:
        status = FAIL
    return RuleEvaluation(status=status, evidence=ctx.date_signals.evidence)


# ---------------------------------------------------------------------------
# Rules: the authoritative list. Order within a category controls UI order.
# ---------------------------------------------------------------------------

RULES: list[Rule] = [
    # ----- A. Technical AI Crawlability -------------------------------------
    Rule(
        id="A1",
        category_id="A",
        label="HTTPS is used for the audited URL.",
        recommendation=(
            "Serve the page over HTTPS and redirect HTTP to HTTPS with a single 301."
        ),
        dependencies=["url"],
        evaluate=_a1,
    ),
    Rule(
        id="A8",
        category_id="A",
        label="Critical content is present in the raw HTML response.",
        recommendation=(
            "Render primary copy, headings, FAQs, and schema on the server. AI "
            "crawlers often do not execute client-side JavaScript."
        ),
        dependencies=["html", "text"],
        multiplier=2,
        evaluate=_a8,
    ),
    Rule(
        id="A11",
        category_id="A",
        label="Canonical tag is present and points to an indexable URL.",
        recommendation=(
            "Add a self-referencing canonical tag, or a deliberate canonical target "
            "for duplicate variants."
        ),
        dependencies=["canonical"],
        evaluate=_a11,
    ),
    Rule(
        id="A12",
        category_id="A",
        label="No noindex directive was found.",
        recommendation=(
            "Remove noindex from pages that should be eligible for AI search citation."
        ),
        dependencies=["noindex-meta"],
        evaluate=_a12,
    ),
    # ----- B. Content Structure & Chunking ----------------------------------
    Rule(
        id="B1",
        category_id="B",
        label="The page opens with a direct-answer BLUF intro naming the entity.",
        recommendation=(
            "Start with a 2-3 sentence answer that names the brand, product, or topic "
            "and states what the page is about."
        ),
        dependencies=["paragraphs", "title", "url"],
        evaluate=_b1,
    ),
    Rule(
        id="B2",
        category_id="B",
        label="Heading hierarchy is clear with one H1 and topical H2 sections.",
        recommendation=(
            "Use one H1, then H2/H3 boundaries for each answerable topic or sub-query."
        ),
        dependencies=["headings"],
        evaluate=_b2,
    ),
    Rule(
        id="B3",
        category_id="B",
        label="Paragraphs are short enough for passage retrieval.",
        recommendation=(
            "Keep paragraphs to one idea each, usually 1-4 sentences and under roughly "
            "120 words."
        ),
        dependencies=["paragraphs"],
        evaluate=_b3,
    ),
    Rule(
        id="B4",
        category_id="B",
        label="Sections are self-contained semantic chunks.",
        recommendation=(
            "Break long pages into specific H2/H3 sections that can stand alone when "
            "retrieved as chunks."
        ),
        dependencies=["headings", "text"],
        evaluate=_b4,
    ),
    Rule(
        id="B5",
        category_id="B",
        label="FAQ or Q&A structure appears where appropriate.",
        recommendation=(
            "Add a concise FAQ section for common prompt-style questions, especially "
            "on commercial and informational pages."
        ),
        dependencies=["text", "headings"],
        evaluate=_b5,
    ),
    Rule(
        id="B6",
        category_id="B",
        label="The page contains concrete data points.",
        recommendation=(
            "Add dated statistics, named sources, percentages, benchmarks, prices, or "
            "other extractable facts."
        ),
        dependencies=["data-points"],
        evaluate=_b6,
    ),
    Rule(
        id="B7",
        category_id="B",
        label="Quoted source or expert language is present.",
        recommendation=(
            "Include at least one clearly attributed quote or sourced claim on "
            "long-form pages."
        ),
        dependencies=["markdown", "text"],
        evaluate=_b7,
    ),
    Rule(
        id="B8",
        category_id="B",
        label="External citations support major claims.",
        recommendation=(
            "Link major factual claims to authoritative external sources so AI engines "
            "can cross-check them."
        ),
        dependencies=["links"],
        evaluate=_b8,
    ),
    Rule(
        id="B10",
        category_id="B",
        label="Definitional sentence patterns are present.",
        recommendation=(
            'Use patterns like "X is defined as..." or "X refers to..." for core '
            "concepts."
        ),
        dependencies=["text"],
        evaluate=_b10,
    ),
    Rule(
        id="B11",
        category_id="B",
        label="Internal links create sibling-page fan-out coverage.",
        recommendation=(
            "Link to at least three related pages that cover adjacent questions, "
            "comparisons, use cases, or FAQs."
        ),
        dependencies=["links"],
        evaluate=_b11,
    ),
    Rule(
        id="B12",
        category_id="B",
        label="A visible or structured last-updated date exists.",
        recommendation=(
            "Show a visible updated date and include dateModified in schema for pages "
            "that should be cited."
        ),
        dependencies=["date-signals", "url", "text"],
        evaluate=_b12,
    ),
    Rule(
        id="B13",
        category_id="B",
        label="Readability is in a useful AI citation range.",
        recommendation=(
            "Aim for clear expert prose: specific enough to be trusted, but not dense "
            "academic copy."
        ),
        dependencies=["readability"],
        evaluate=_b13,
    ),
    Rule(
        id="B14",
        category_id="B",
        label="Lists or tables make comparisons machine-extractable.",
        recommendation=(
            "Use bullets, numbered lists, and tables for steps, comparisons, "
            "pros/cons, and factual summaries."
        ),
        dependencies=["markdown", "html"],
        evaluate=_b14,
    ),
    # ----- C. Structured Data / Schema --------------------------------------
    Rule(
        id="C1",
        category_id="C",
        label="JSON-LD structured data is present.",
        recommendation=(
            "Add server-rendered JSON-LD. Start with WebPage, Organization, Article, "
            "Person, and FAQPage as applicable."
        ),
        dependencies=["json-ld"],
        evaluate=_c1,
    ),
    Rule(
        id="C2",
        category_id="C",
        label="Organization schema includes name, URL, logo, and sameAs.",
        recommendation=(
            "Add Organization schema with name, url, logo, and sameAs links to "
            "authoritative profiles."
        ),
        dependencies=["schema-summary"],
        evaluate=_c2,
    ),
    Rule(
        id="C3",
        category_id="C",
        label="Article or BlogPosting schema includes authorship and dates.",
        recommendation=(
            "For editorial pages, include Article or BlogPosting schema with headline, "
            "author, datePublished, and dateModified."
        ),
        dependencies=["schema-summary", "text", "url"],
        evaluate=_c3,
    ),
    Rule(
        id="C4",
        category_id="C",
        label="Person schema supports visible authors.",
        recommendation=(
            "Add Person schema for each author, including jobTitle, worksFor, "
            "credentials, and sameAs profiles."
        ),
        dependencies=["schema-summary", "text", "url"],
        evaluate=_c4,
    ),
    Rule(
        id="C5",
        category_id="C",
        label="FAQPage schema exists when Q&A content exists.",
        recommendation=(
            "When FAQ content is visible, mirror the questions and answers in FAQPage "
            "JSON-LD."
        ),
        dependencies=["schema-summary", "text", "headings"],
        evaluate=_c5,
    ),
    Rule(
        id="C11",
        category_id="C",
        label="Schema appears in the initial HTML response.",
        recommendation=(
            "Do not rely on client-side JavaScript to inject important schema."
        ),
        dependencies=["json-ld"],
        evaluate=_c11,
    ),
    # ----- D. E-E-A-T & Entity Authority ------------------------------------
    Rule(
        id="D5",
        category_id="D",
        label="About, company, trust, or newsroom pages are linked.",
        recommendation=(
            "Make About, Company, Trust, or Newsroom pages easy to reach from the "
            "audited page."
        ),
        dependencies=["links"],
        evaluate=_d5,
    ),
    Rule(
        id="D6",
        category_id="D",
        label="Privacy, terms, and contact information are linked.",
        recommendation=(
            "Expose privacy policy, terms, contact, and support paths in the page "
            "chrome or footer."
        ),
        dependencies=["links"],
        evaluate=_d6,
    ),
    Rule(
        id="D10",
        category_id="D",
        label="Original research or proprietary data signals exist.",
        recommendation=(
            "Publish original data, methodology, benchmarks, or named research that "
            "other sites can cite."
        ),
        dependencies=["text", "data-points"],
        multiplier=1 / 3,
        evaluate=_d10,
    ),
    Rule(
        id="D12",
        category_id="D",
        label="Brand/entity descriptors are consistent.",
        recommendation=(
            "Use the same brand name, category, and entity descriptors in title, meta "
            "description, headings, schema, and body copy."
        ),
        dependencies=["title", "description", "text"],
        evaluate=_d12,
    ),
    # ----- E. Off-site / Citation Surface Presence --------------------------
    Rule(
        id="E1",
        category_id="E",
        label="Review or marketplace citation surfaces are linked.",
        recommendation=(
            "Link to maintained profiles on review or marketplace sites (G2, Capterra, "
            "Trustpilot, Gartner, ProductHunt) that match your category."
        ),
        dependencies=["links", "text", "json-ld"],
        multiplier=0.5,
        evaluate=_e1,
    ),
    Rule(
        id="E7",
        category_id="E",
        label="GitHub or developer surface is linked when relevant.",
        recommendation=(
            "For technical products, link active GitHub repositories, examples, or "
            "developer docs."
        ),
        dependencies=["links", "text", "json-ld", "url"],
        evaluate=_e7,
    ),
    Rule(
        id="E10",
        category_id="E",
        label="Entity disambiguation is supported by sameAs links.",
        recommendation=(
            "Use sameAs links to Wikidata, LinkedIn, Crunchbase, Wikipedia, GitHub, or "
            "other authoritative profiles on Organization or Person schema."
        ),
        dependencies=["schema-summary"],
        evaluate=_e10,
    ),
    Rule(
        id="E12",
        category_id="E",
        label="Outbound citations place the entity near named category sources.",
        recommendation=(
            "Cite and co-occur with authoritative category sources, benchmarks, "
            "standards, and named experts."
        ),
        dependencies=["links", "data-points"],
        evaluate=_e12,
    ),
    # ----- F. Measurement & Governance --------------------------------------
    Rule(
        id="F6",
        category_id="F",
        label="A content refresh signal is visible.",
        recommendation=(
            "Publish visible updated dates and refresh important pages quarterly."
        ),
        dependencies=["date-signals", "url", "text"],
        evaluate=_f6,
    ),
]


# ---------------------------------------------------------------------------
# Convenience indexes for consumers that look rules up by id.
# ---------------------------------------------------------------------------

RULES_BY_ID: dict[str, Rule] = {rule.id: rule for rule in RULES}
CATEGORIES_BY_ID: dict[str, CategoryDef] = {c.id: c for c in CATEGORIES}
