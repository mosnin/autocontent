"""Article Markdown to HTML, for publishing to WordPress.

Covers what the article writer produces: headings, paragraphs, bullet and
numbered lists, block quotes, bold, italic, inline code and links. Every
piece of text is HTML-escaped and raw HTML in the Markdown is shown as text,
never passed through, so model-written content cannot inject markup or
script into a customer's site. Links keep only http(s) and site-relative
targets.
"""
from __future__ import annotations

import html
import re
from typing import Any

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET = re.compile(r"^\s*[-*+]\s+(.*)$")
_NUMBERED = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_QUOTE = re.compile(r"^>\s?(.*)$")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_ITALIC = re.compile(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<![_\w])_(?!\s)(.+?)(?<!\s)_(?![_\w])")
_CODE = re.compile(r"`([^`]+)`")


def _safe_href(url: str) -> str | None:
    u = html.unescape(url).strip()
    if u.startswith("/") and not u.startswith("//"):
        return u
    if re.match(r"^https?://[^\s/]+", u, re.I):
        return u
    return None


def inline(text: str) -> str:
    """Escape, then apply inline Markdown. Code spans are protected first."""
    codes: list[str] = []

    def _code(m: re.Match[str]) -> str:
        codes.append(f"<code>{html.escape(m.group(1))}</code>")
        return f"\x00{len(codes) - 1}\x00"

    out = _CODE.sub(_code, text)
    out = html.escape(out, quote=True)

    def _link(m: re.Match[str]) -> str:
        href = _safe_href(m.group(2))
        if href is None:
            return m.group(1)
        return f'<a href="{html.escape(href, quote=True)}">{m.group(1)}</a>'

    out = _LINK.sub(_link, out)
    out = _BOLD.sub(lambda m: f"<strong>{m.group(1) or m.group(2)}</strong>", out)
    out = _ITALIC.sub(lambda m: f"<em>{m.group(1) or m.group(2)}</em>", out)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], out)


def to_html(markdown: str, *, drop_leading_h1: bool = True) -> str:
    """Render the article. The leading H1 is dropped by default because
    WordPress shows the post title itself."""
    lines = (markdown or "").replace("\r\n", "\n").split("\n")
    blocks: list[str] = []
    para: list[str] = []
    items: list[str] = []
    list_tag = ""
    quote: list[str] = []
    seen_content = False

    def flush_para() -> None:
        nonlocal para
        if para:
            blocks.append(f"<p>{inline(' '.join(para))}</p>")
            para = []

    def flush_list() -> None:
        nonlocal items, list_tag
        if items:
            blocks.append(f"<{list_tag}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{list_tag}>")
            items, list_tag = [], ""

    def flush_quote() -> None:
        nonlocal quote
        if quote:
            blocks.append(f"<blockquote><p>{inline(' '.join(quote))}</p></blockquote>")
            quote = []

    def flush_all() -> None:
        flush_para()
        flush_list()
        flush_quote()

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            flush_all()
            continue
        if line.strip() in ("---", "***", "___"):
            flush_all()
            blocks.append("<hr>")
            continue
        h = _HEADING.match(line)
        if h:
            flush_all()
            level = len(h.group(1))
            if level == 1 and drop_leading_h1 and not seen_content:
                seen_content = True
                continue
            blocks.append(f"<h{level}>{inline(h.group(2).strip())}</h{level}>")
            seen_content = True
            continue
        seen_content = True
        q = _QUOTE.match(line)
        if q:
            flush_para()
            flush_list()
            quote.append(q.group(1))
            continue
        b = _BULLET.match(line)
        n = None if b else _NUMBERED.match(line)
        if b or n:
            flush_para()
            flush_quote()
            tag = "ul" if b else "ol"
            if list_tag and list_tag != tag:
                flush_list()
            list_tag = tag
            items.append((b or n).group(1))  # type: ignore[union-attr]
            continue
        if items and raw.startswith(("  ", "\t")):
            items[-1] += " " + line.strip()
            continue
        flush_list()
        flush_quote()
        para.append(line.strip())
    flush_all()
    return "\n".join(blocks)


def cover_figure(cover: dict[str, Any] | None) -> str:
    """The Unsplash cover as a hotlinked figure with its credit (Unsplash
    guidelines: hotlink, credit the photographer and Unsplash)."""
    if not cover or cover.get("source") != "unsplash":
        return ""
    url, author, author_url, unsplash_url = (
        cover.get("url"), cover.get("author_name"), cover.get("author_url"), cover.get("unsplash_url"),
    )
    if not all(isinstance(v, str) and v for v in (url, author, author_url, unsplash_url)):
        return ""
    if not (str(url).startswith("https://images.unsplash.com/") or str(url).startswith("https://plus.unsplash.com/")):
        return ""
    e = lambda v: html.escape(str(v), quote=True)  # noqa: E731
    return (
        f'<figure><img src="{e(url)}" alt="{e(cover.get("alt") or "")}">'
        f'<figcaption>Photo by <a href="{e(author_url)}">{e(author)}</a> on '
        f'<a href="{e(unsplash_url)}">Unsplash</a></figcaption></figure>'
    )
