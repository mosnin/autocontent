"""Audit orchestrator (port of lib/audit.ts + lib/perform-audit.ts).

Responsibilities:
  1. Pull page HTML and Markdown from Context.dev.
  2. Parse those into a `RuleContext` (everything rules need to inspect).
  3. Run every rule from `rules.py` and assemble the `AuditResult`.

We NEVER make direct HTTP calls to the audited site. All page bytes flow
through `services.context_dev`, which owns rendering and robots compliance.
To change *what* is measured, edit `rules.py`.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

from ..config import settings
from ..logging import get_logger
from ..services import context_dev
from ..services.context_dev import ContextDevUnavailable
from . import parsing
from .agent_prompt import build_agent_fix_prompts
from .rules import RuleContext
from .scoring import round1, score_band, score_categories
from .types import AuditDiagnostics, AuditResult, AuditStats

log = get_logger(__name__)

# Bump when the AuditResult shape or any rule's scoring changes, so stored
# blobs from an older shape are never served as if they were current. The
# cache key mixes this in, which retires the whole cache generation at once
# instead of requiring a delete.
CACHE_SCHEMA_VERSION = "v13"

#: How many top fail/partial findings become the headline priority list.
TOP_PRIORITY_COUNT = 5


class SeoAuditDisabled(RuntimeError):
    """The auditor is switched off or Context.dev is unconfigured.

    Callers turn this into a clean 409 — a missing feature flag or key is a
    deployment state, not a server error.
    """


def ensure_enabled() -> None:
    if not settings.seo_audit_enabled:
        raise SeoAuditDisabled("the SEO auditor is not enabled")
    if not context_dev.is_configured():
        raise SeoAuditDisabled("context.dev is not configured")


# --------------------------------------------------------------------- URLs


def normalize_audit_url(raw: str) -> str | None:
    """Canonicalize user input into an audit URL, or None if it isn't one.

    Keeps the full path and query (audits are per-page, not per-domain),
    strips `www.`, lowercases the host, and drops the fragment.
    """
    trimmed = raw.strip()
    if not trimmed:
        return None
    with_protocol = trimmed if re.match(r"^https?://", trimmed, re.I) else f"https://{trimmed}"
    try:
        parts = urlsplit(with_protocol)
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        return None
    try:
        hostname = parts.hostname
        port = parts.port
    except ValueError:  # malformed port
        return None
    if not hostname:
        return None
    hostname = re.sub(r"^www\.", "", hostname.lower())
    if "." not in hostname:
        return None
    netloc = f"{hostname}:{port}" if port else hostname
    return urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))


def display_host(url: str) -> str:
    try:
        hostname = urlsplit(url).hostname
    except ValueError:
        return url
    if not hostname:
        return url
    return re.sub(r"^www\.", "", hostname)


def audit_cache_key(url: str) -> str:
    return hashlib.sha256(f"{CACHE_SCHEMA_VERSION}:{url}".encode()).hexdigest()


# ----------------------------------------------------------------- fetching


async def _scrape(url: str) -> tuple[str, str, str, str]:
    """Fetch Markdown + HTML concurrently, tolerating one of them failing.

    Mirrors the source's `Promise.allSettled`: a page whose Markdown
    extraction fails can still be audited off the raw HTML, and vice versa.
    Diagnostics carry which half landed so a low score is never mistaken for
    a scrape problem.
    """
    markdown_result, html_result = await asyncio.gather(
        context_dev.scrape_markdown(url),
        context_dev.scrape_html(url, wait_for_ms=settings.seo_audit_html_wait_ms),
        return_exceptions=True,
    )

    markdown = ""
    markdown_status = "ready"
    if isinstance(markdown_result, BaseException):
        markdown_status = "failed"
        log.warning(
            "seo_audit.markdown_scrape_failed",
            extra={"url": url, "error": str(markdown_result)},
        )
    else:
        markdown = markdown_result
        markdown_status = "ready" if markdown else "empty"

    html = ""
    html_status = "ready"
    if isinstance(html_result, BaseException):
        html_status = "failed"
        log.warning(
            "seo_audit.html_scrape_failed",
            extra={"url": url, "error": str(html_result)},
        )
    else:
        html = html_result
        html_status = "ready" if html else "empty"

    # Deviation from the source, which would happily score a page it never
    # saw: if BOTH scrapes failed there is nothing to audit, and persisting a
    # near-zero score would be a lie about the page. Surface the vendor
    # failure instead.
    if markdown_status == "failed" and html_status == "failed":
        raise ContextDevUnavailable(f"context.dev could not fetch {url}")

    return markdown, html, markdown_status, html_status


# --------------------------------------------------------- context building


def build_rule_context(*, url: str, markdown: str, html: str) -> RuleContext:
    """Parse the two scrapes into everything the rules read.

    Exposed separately from `run_audit` so tests (and any future offline
    re-scoring of stored HTML) can build a context without network calls.
    """
    host = display_host(url)
    origin = parsing.url_origin(url)

    html_text = parsing.html_to_text(html)
    analysis_text = parsing.normalize_whitespace(markdown or html_text)
    title = parsing.extract_title(html) or parsing.first_markdown_heading(markdown)
    description = parsing.extract_meta_content(html, "description")

    links = parsing.extract_links(html, markdown, url)
    external_links = [link for link in links if parsing.url_origin(link) != origin]
    same_origin_links = [link for link in links if parsing.url_origin(link) == origin]

    blocks = parsing.extract_json_ld(html)
    schema = parsing.summarize_schema(blocks.schemas)
    headings = parsing.extract_headings(html, markdown)

    # HTML tag counts and Markdown heading counts disagree constantly (one
    # view may be truncated, the other may render headings as bold text), so
    # take the more generous of the two rather than trusting either alone.
    h1_count = max(
        parsing.count_matches(html, re.compile(r"<h1\b", re.I)),
        sum(1 for h in headings if h.level == 1),
    )
    h2_count = max(
        parsing.count_matches(html, re.compile(r"<h2\b", re.I)),
        sum(1 for h in headings if h.level == 2),
    )

    return RuleContext(
        url=url,
        host=host,
        title=title,
        description=description,
        canonical=parsing.extract_canonical(html),
        has_noindex=parsing.detect_noindex(html),
        html=html,
        html_text=html_text,
        html_words=parsing.count_words(html_text),
        markdown=markdown,
        analysis_text=analysis_text,
        words=parsing.count_words(analysis_text),
        paragraphs=parsing.extract_paragraphs(markdown or html_text),
        headings=headings,
        h1_count=h1_count,
        h2_count=h2_count,
        links=links,
        external_links=external_links,
        same_origin_links=same_origin_links,
        json_ld=blocks.schemas,
        json_ld_block_count=blocks.block_count,
        json_ld_parse_failures=blocks.parse_failures,
        schema=schema,
        data_points=parsing.count_data_points(analysis_text),
        grade=parsing.flesch_kincaid_grade(analysis_text),
        date_signals=parsing.extract_date_signals(html, analysis_text, blocks.schemas),
        faq_status=parsing.compute_faq_status(analysis_text, headings),
        has_byline=parsing.detect_byline(analysis_text, schema),
    )


# --------------------------------------------------------------- the audit


def score_context(
    ctx: RuleContext,
    *,
    markdown_status: str = "ready",
    html_status: str = "ready",
) -> AuditResult:
    """Run every rule against a built context and assemble the result."""
    categories = score_categories(ctx)
    score = round1(sum(category.score for category in categories))

    actionable = [
        item
        for category in categories
        for item in category.items
        if item.status.value in ("fail", "partial")
    ]
    actionable.sort(key=lambda item: item.max_score, reverse=True)
    top_priorities = [
        f"{item.id}: {item.recommendation}" for item in actionable[:TOP_PRIORITY_COUNT]
    ]

    result = AuditResult(
        url=ctx.url,
        host=ctx.host,
        title=ctx.title,
        description=ctx.description,
        fetched_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        score=score,
        band=score_band(score),
        top_priorities=top_priorities,
        stats=AuditStats(
            markdown_chars=len(ctx.markdown),
            raw_html_chars=len(ctx.html),
            words=ctx.words,
            headings=len(ctx.headings),
            links=len(ctx.links),
            external_links=len(ctx.external_links),
            json_ld_blocks=ctx.json_ld_block_count,
        ),
        categories=categories,
        diagnostics=AuditDiagnostics(
            context_dev_markdown=markdown_status,
            context_dev_html=html_status,
            json_ld_parse_failures=ctx.json_ld_parse_failures,
        ),
    )
    result.agent_prompts = build_agent_fix_prompts(result)
    return result


async def run_audit(normalized_url: str) -> AuditResult:
    """Scrape, parse, score. Raises `ContextDevUnavailable` if the page
    could not be fetched at all, `SeoAuditDisabled` if the feature is off."""
    ensure_enabled()
    markdown, html, markdown_status, html_status = await _scrape(normalized_url)
    ctx = build_rule_context(url=normalized_url, markdown=markdown, html=html)
    return score_context(ctx, markdown_status=markdown_status, html_status=html_status)
