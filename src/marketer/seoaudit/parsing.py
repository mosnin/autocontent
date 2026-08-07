r"""Turn raw HTML + Markdown into the structured facts rules read.

Direct port of the parsing half of lib/audit.ts. Deliberately regex-based
and dependency-free: the source is regex-based, the shapes it produces are
what the rule thresholds were tuned against, and swapping in a real HTML
parser here would silently move every score.

Notable regex deviations forced by Python's `re` (JS RegExp has no direct
equivalent in a few places):

*   `\p{L}`-style Unicode classes do not exist in `re`. The source never
    used them either — it used explicit ranges — so the ranges are carried
    over verbatim as `\uXXXX` escapes.
*   JS `$` (without the `m` flag) matches only at end of input; Python's
    `$` also matches before a trailing newline. Where that difference is
    reachable we use `\Z`.
*   `Intl.Segmenter` word segmentation has no stdlib equivalent, so
    `count_words` implements the source's documented regex fallback. For
    Latin text the two agree; for CJK both count characters.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

from .types import AuditStatus

JsonObject = dict[str, Any]

# The source's literal CJK character ranges, respelled as escapes: CJK
# unified U+4E00-9FFF, ext-A U+3400-4DBF, compat U+F900-FAFF, hiragana
# U+3040-309F, katakana U+30A0-30FF, hangul U+AC00-D7AF. Python's `re` has
# no `\p{Script=Han}` and no `\p{L}`, so explicit ranges are the only
# option — which is what the source used anyway.
_CJK = (
    "\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"
    "\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af"
)
_CJK_RE = re.compile(f"[{_CJK}]")
# Latin letters/digits incl. Latin-1 Supplement + Extended-A/B (U+00C0-U+024F).
_LATIN_WORD_RE = re.compile("[A-Za-z0-9\\u00c0-\\u024f][A-Za-z0-9\\u00c0-\\u024f'-]*")


@dataclass
class Heading:
    level: int
    text: str


@dataclass
class SchemaSummary:
    has_organization: bool = False
    organization_complete: bool = False
    organization_evidence: str = ""
    has_article: bool = False
    article_complete: bool = False
    article_evidence: str = ""
    has_person: bool = False
    has_author: bool = False
    has_faq: bool = False
    same_as_count: int = 0


@dataclass
class DateSignals:
    has_any_date: bool = False
    has_modified_date: bool = False
    evidence: str = ""


@dataclass
class JsonLdBlocks:
    schemas: list[JsonObject] = field(default_factory=list)
    #: Every `<script type="application/ld+json">` found, parseable or not.
    block_count: int = 0
    #: Blocks that were present but could not be parsed.
    parse_failures: int = 0


# --------------------------------------------------------------------- text


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def decode_html(value: str) -> str:
    """Decode the handful of entities the source decodes, in its order.

    Order is load-bearing: `&amp;` is expanded before `&lt;`/`&gt;` so that
    `&amp;lt;` round-trips to `<` exactly as the browser would.
    """
    return (
        value.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )


def html_to_text(html: str) -> str:
    stripped = re.sub(r"<script\b[\s\S]*?</script>", " ", html, flags=re.I)
    stripped = re.sub(r"<style\b[\s\S]*?</style>", " ", stripped, flags=re.I)
    stripped = re.sub(r"<noscript\b[\s\S]*?</noscript>", " ", stripped, flags=re.I)
    stripped = re.sub(r"<[^>]+>", " ", stripped)
    return normalize_whitespace(decode_html(stripped))


def count_words(text: str) -> int:
    """Approximate word count for Latin + CJK text.

    The source prefers `Intl.Segmenter` and falls back to this regex pair;
    Python has no segmenter in the stdlib, so the fallback is the whole
    implementation here. Latin words are counted as tokens, CJK as
    characters (the same rough approximation the source documents).
    """
    return len(_LATIN_WORD_RE.findall(text)) + len(_CJK_RE.findall(text))


def count_matches(text: str, pattern: re.Pattern[str] | str) -> int:
    compiled = re.compile(pattern) if isinstance(pattern, str) else pattern
    return len(compiled.findall(text))


# ------------------------------------------------------------- head metadata


def get_attr(tag: str, attr: str) -> str | None:
    """Read one attribute off a single start tag.

    Requires an attribute boundary (start-of-tag or whitespace) before the
    name so that `href` does NOT match `data-href`. Supports double-quoted,
    single-quoted, and unquoted values.
    """
    pattern = re.compile(
        rf"(?:^|\s){re.escape(attr)}\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))",
        re.I,
    )
    match = pattern.search(tag)
    if not match:
        return None
    return decode_html(match.group(1) or match.group(2) or match.group(3) or "")


def extract_title(html: str) -> str | None:
    match = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.I)
    return decode_html(normalize_whitespace(match.group(1))) if match else None


def first_markdown_heading(markdown: str) -> str | None:
    match = re.search(r"^#\s+(.+)$", markdown, re.M)
    return normalize_whitespace(match.group(1)) if match else None


def extract_meta_content(html: str, name: str) -> str | None:
    for tag in re.findall(r"<meta\b[^>]*>", html, re.I):
        tag_name = get_attr(tag, "name") or get_attr(tag, "property")
        if tag_name and tag_name.lower() == name.lower():
            content = get_attr(tag, "content")
            if content:
                return decode_html(content)
    return None


def extract_canonical(html: str) -> str | None:
    for tag in re.findall(r"<link\b[^>]*>", html, re.I):
        rel = get_attr(tag, "rel")
        if rel and "canonical" in rel.lower().split():
            return get_attr(tag, "href")
    return None


def detect_noindex(html: str) -> bool:
    for tag in re.findall(r"<meta\b[^>]*>", html, re.I):
        name = get_attr(tag, "name") or get_attr(tag, "property") or ""
        content = get_attr(tag, "content") or ""
        if re.search(r"robots|googlebot", name, re.I) and re.search(
            r"\bnoindex\b", content, re.I
        ):
            return True
    return False


# -------------------------------------------------------------------- links


def url_origin(url: str) -> str:
    """`scheme://host[:port]` — the JS `URL.origin` equivalent."""
    parts = urlsplit(url)
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}"


def _normalize_link(href: str, base_url: str) -> str | None:
    """Resolve `href` against `base_url` the way `new URL(href, base)` does.

    Returns None for anything that is not http(s) — mailto:, tel:,
    javascript:, and malformed values are all dropped, matching the
    source's try/catch-and-ignore.
    """
    try:
        absolute = urljoin(base_url, href.strip())
        parts = urlsplit(absolute)
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        return None
    netloc = parts.netloc.lower()
    # JS URL drops the default port from the serialized form.
    if (scheme == "https" and netloc.endswith(":443")) or (
        scheme == "http" and netloc.endswith(":80")
    ):
        netloc = netloc.rsplit(":", 1)[0]
    if not netloc:
        return None
    # `new URL("https://x.com").toString()` is "https://x.com/".
    path = parts.path or "/"
    return urlunsplit((scheme, netloc, path, parts.query, ""))


def extract_links(html: str, markdown: str, base_url: str) -> list[str]:
    """Absolute http(s) links from anchor tags and Markdown link syntax."""
    raw: dict[str, None] = {}  # insertion-ordered set, like the JS `Set`
    for tag in re.findall(r"<a\b[^>]*>", html, re.I):
        href = get_attr(tag, "href")
        if href:
            raw.setdefault(href, None)
    for match in re.finditer(r"\[[^\]]+\]\((https?://[^)\s]+)\)", markdown, re.I):
        raw.setdefault(match.group(1), None)

    links: dict[str, None] = {}
    for href in raw:
        normalized = _normalize_link(href, base_url)
        if normalized:
            links.setdefault(normalized, None)
    return list(links)


# ------------------------------------------------------------------ JSON-LD

# Permissive on purpose: whitespace around `=`, single/double/unquoted
# attribute values, and extra attributes on either side of `type`.
_JSON_LD_RE = re.compile(
    r"<script\b[^>]*\btype\s*=\s*"
    r"(?:\"\s*application/ld\+json\s*\"|'\s*application/ld\+json\s*'|application/ld\+json)"
    r"[^>]*>([\s\S]*?)</script>",
    re.I,
)


def strip_script_wrappers(body: str) -> str:
    """Strip wrappers some CMSs inject around inline JSON-LD::

        <!-- {...} -->
        //<![CDATA[ {...} //]]>
        /*<![CDATA[*/ {...} /*]]>*/
    """
    out = body.strip()
    out = re.sub(r"^<!--", "", out)
    out = re.sub(r"-->\Z", "", out)
    out = re.sub(r"^//\s*<!\[CDATA\[", "", out)
    out = re.sub(r"//\s*\]\]>\Z", "", out)
    out = re.sub(r"^/\*\s*<!\[CDATA\[\s*\*/", "", out)
    out = re.sub(r"/\*\s*\]\]>\s*\*/\Z", "", out)
    return out.strip()


_UNPARSED = object()


def try_parse_json(raw: str) -> Any:
    """Parse a JSON-LD body, raw first.

    `<script>` content is NOT HTML-entity-decoded by browsers, so decoding
    `&amp;` -> `&` up front would corrupt URLs with query strings. Only if
    the raw parse fails do we retry decoded, for the publishers who
    (incorrectly) HTML-encode their JSON-LD.
    """
    try:
        return json.loads(raw)
    except ValueError:
        try:
            return json.loads(decode_html(raw))
        except ValueError:
            return _UNPARSED


def flatten_schema(value: Any) -> list[JsonObject]:
    if isinstance(value, list):
        out: list[JsonObject] = []
        for item in value:
            out.extend(flatten_schema(item))
        return out
    if not isinstance(value, dict):
        return []
    objects = [value]
    graph = value.get("@graph")
    if isinstance(graph, list):
        objects.extend(node for node in graph if isinstance(node, dict))
    return objects


def extract_json_ld(html: str) -> JsonLdBlocks:
    blocks = _JSON_LD_RE.findall(html)
    schemas: list[JsonObject] = []
    parse_failures = 0
    for block in blocks:
        raw = strip_script_wrappers(block).strip()
        if not raw:
            continue
        parsed = try_parse_json(raw)
        if parsed is _UNPARSED:
            parse_failures += 1
            continue
        schemas.extend(flatten_schema(parsed))
    return JsonLdBlocks(
        schemas=schemas, block_count=len(blocks), parse_failures=parse_failures
    )


def has_schema_type(schema: JsonObject, types: list[str]) -> bool:
    raw = schema.get("@type")
    actual = raw if isinstance(raw, list) else [raw]
    return any(isinstance(t, str) and t in types for t in actual)


_ORG_TYPES = ["Organization", "LocalBusiness", "Corporation"]
_ARTICLE_TYPES = ["Article", "BlogPosting", "NewsArticle"]


def summarize_schema(schemas: list[JsonObject]) -> SchemaSummary:
    organization = next(
        (s for s in schemas if has_schema_type(s, _ORG_TYPES)), None
    )
    has_organization = organization is not None

    same_as_count = 0
    for s in schemas:
        same_as = s.get("sameAs")
        if isinstance(same_as, list):
            same_as_count += len(same_as)
        elif isinstance(same_as, str):
            same_as_count += 1

    organization_complete = bool(
        organization
        and organization.get("name")
        and organization.get("url")
        and organization.get("logo")
        and same_as_count >= 1
    )

    articles = [s for s in schemas if has_schema_type(s, _ARTICLE_TYPES)]
    article_complete = any(
        s.get("headline") and s.get("author") and s.get("datePublished")
        and s.get("dateModified")
        for s in articles
    )

    return SchemaSummary(
        has_organization=has_organization,
        organization_complete=organization_complete,
        organization_evidence=(
            "Organization-like schema found; complete core fields: "
            f"{'yes' if organization_complete else 'no'}; sameAs links: {same_as_count}."
            if has_organization
            else "No Organization-like schema was found."
        ),
        has_article=len(articles) > 0,
        article_complete=article_complete,
        article_evidence=(
            f"Article-like schema blocks: {len(articles)}; complete authorship/date "
            f"fields: {'yes' if article_complete else 'no'}."
            if articles
            else "No Article or BlogPosting schema was found."
        ),
        has_person=any(has_schema_type(s, ["Person"]) for s in schemas),
        has_author=any(bool(s.get("author")) for s in schemas),
        has_faq=any(has_schema_type(s, ["FAQPage"]) for s in schemas),
        same_as_count=same_as_count,
    )


# ----------------------------------------------------------- body structure


def extract_headings(html: str, markdown: str) -> list[Heading]:
    headings: list[Heading] = []
    for match in re.finditer(r"<h([1-6])\b[^>]*>([\s\S]*?)</h\1>", html, re.I):
        headings.append(Heading(int(match.group(1)), html_to_text(match.group(2))))
    for match in re.finditer(r"^(#{1,6})\s+(.+)$", markdown, re.M):
        headings.append(
            Heading(len(match.group(1)), normalize_whitespace(match.group(2)))
        )

    # HTML and Markdown views of the same page repeat every heading, so
    # dedupe on (level, lowercased text). Empty-text headings still claim
    # their key before being dropped, exactly as the source does.
    seen: set[str] = set()
    out: list[Heading] = []
    for h in headings:
        key = f"{h.level}:{h.text.lower()}"
        if key in seen:
            continue
        seen.add(key)
        if h.text:
            out.append(h)
    return out


def extract_paragraphs(text: str) -> list[str]:
    without_code = re.sub(r"```[\s\S]*?```", " ", text)
    paragraphs = []
    for block in re.split(r"\n{2,}", without_code):
        cleaned = re.sub(r"^#{1,6}\s+", "", block, flags=re.M)
        cleaned = re.sub(r"^[-*]\s+", "", cleaned, flags=re.M)
        cleaned = re.sub(r"\[[^\]]+\]\(([^)]+)\)", r"\1", cleaned)
        cleaned = normalize_whitespace(cleaned)
        if count_words(cleaned) >= 8:
            paragraphs.append(cleaned)
    return paragraphs


_DATA_POINT_RE = re.compile(
    r"\b(?:19|20)\d{2}\b"
    r"|\b\d+(?:\.\d+)?\s?%"
    r"|\$\s?\d+(?:[,.]\d+)*"
    r"|\b\d+(?:\.\d+)?x\b"
    r"|\b\d+(?:,\d{3})+(?:\.\d+)?\b"
)


def count_data_points(text: str) -> int:
    return len(_DATA_POINT_RE.findall(text))


def extract_date_signals(
    html: str, text: str, schemas: list[JsonObject]
) -> DateSignals:
    has_schema_modified = any(bool(s.get("dateModified")) for s in schemas)
    has_time_tag = bool(re.search(r"<time\b[^>]*(datetime=|>)", html, re.I))
    has_visible_modified = bool(
        re.search(
            r"\b(updated|last updated|modified|last modified)\b.{0,40}\b(?:19|20)\d{2}\b",
            text,
            re.I,
        )
    )
    has_any_date = (
        has_schema_modified
        or has_time_tag
        or bool(
            re.search(
                r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?"
                r"\s+\d{1,2},?\s+(?:19|20)\d{2}\b",
                text,
                re.I,
            )
        )
        or bool(re.search(r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b", text))
    )
    return DateSignals(
        has_any_date=has_any_date,
        has_modified_date=has_schema_modified or has_visible_modified,
        evidence=(
            f"dateModified schema: {'yes' if has_schema_modified else 'no'}; "
            f"visible modified date: {'yes' if has_visible_modified else 'no'}; "
            f"time tag: {'yes' if has_time_tag else 'no'}."
        ),
    )


def compute_faq_status(text: str, headings: list[Heading]) -> AuditStatus:
    """Shared by B5 (is FAQ content present?) and C5 (is it marked up?)."""
    question_headings = [h for h in headings if "?" in h.text]
    if re.search(r"\b(faq|frequently asked questions|questions and answers)\b", text, re.I):
        return AuditStatus.passed
    if len(question_headings) >= 2:
        return AuditStatus.passed
    if len(question_headings) == 1 or text.count("?") >= 2:
        return AuditStatus.partial
    return AuditStatus.fail


def detect_byline(text: str, schema: SchemaSummary) -> bool:
    if schema.has_person or schema.has_author:
        return True
    # Case-sensitive on purpose: the capitalised name is the signal.
    return bool(
        re.search(
            r"\b(by|written by|reviewed by|edited by)\s+"
            r"[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\b",
            text,
        )
    )


# -------------------------------------------------------------- readability


def cjk_ratio(text: str) -> float:
    if not text:
        return 0.0
    return len(_CJK_RE.findall(text)) / max(len(text), 1)


def count_syllables(word: str) -> int:
    cleaned = re.sub(r"[^a-z]", "", word.lower())
    if not cleaned:
        return 1
    without_silent_e = re.sub(r"e\Z", "", cleaned)
    groups = re.findall(r"[aeiouy]+", without_silent_e)
    return max(len(groups), 1)


def flesch_kincaid_grade(text: str) -> float | None:
    """Grade level, or None when the estimate would be meaningless.

    Flesch-Kincaid is English-specific, so CJK-heavy text bails out rather
    than reporting a confident nonsense number; short text bails too
    because the sentence-length term is unstable below ~80 words.
    """
    if cjk_ratio(text) > 0.35:
        return None
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
    sentences = re.findall(r"[.!?]+(?:\s|\Z)", text)
    if len(words) < 80 or len(sentences) < 3:
        return None
    syllables = sum(count_syllables(w) for w in words)
    return (
        0.39 * (len(words) / len(sentences))
        + 11.8 * (syllables / len(words))
        - 15.59
    )
