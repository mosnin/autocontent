"""Transcribe the Framer static export into React components.

This is deliberately a *transcription*, not a reimplementation. The DOM is
parsed and re-emitted as JSX with the same elements, the same attributes
and the same inline styles; the stylesheet is copied byte-for-byte with
only asset URLs rewritten. Nothing here decides what the page looks like
— that decision is already made, 271KB of it, and the job is to not
corrupt it on the way across.
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import opsra_content as content  # noqa: E402

SRC = Path("/home/user/autocontent/web/opsra")
OUT = Path("/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad/out")

# Void elements must be self-closed in JSX or the parser rejects them.
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}

# HTML attribute -> JSX prop. Anything not listed passes through unchanged,
# which is correct for data-* and aria-*.
RENAME = {
    "class": "className", "for": "htmlFor", "tabindex": "tabIndex",
    "colspan": "colSpan", "rowspan": "rowSpan", "srcset": "srcSet",
    "maxlength": "maxLength", "autoplay": "autoPlay", "playsinline": "playsInline",
    "readonly": "readOnly", "contenteditable": "contentEditable",
    "spellcheck": "spellCheck", "crossorigin": "crossOrigin",
    "datetime": "dateTime", "enctype": "encType", "novalidate": "noValidate",
    "usemap": "useMap", "accesskey": "accessKey",
}

# Attributes React expects as booleans/numbers rather than strings.
BOOLEAN = {"disabled", "checked", "selected", "readOnly", "multiple", "muted",
           "autoPlay", "controls", "loop", "playsInline", "noValidate", "hidden",
           "required", "open", "reversed", "default", "async", "defer"}

# Attributes React types as `number` while HTML carries them as strings.
NUMERIC = {"tabIndex", "aria-posinset", "aria-setsize", "aria-level",
           "aria-colcount", "aria-colindex", "aria-colspan", "aria-rowcount",
           "aria-rowindex", "aria-rowspan", "aria-valuemax", "aria-valuemin",
           "aria-valuenow", "span", "start", "rows", "cols", "size"}


def css_prop_to_js(prop: str) -> str:
    """`background-color` -> `backgroundColor`; `--token-x` stays verbatim.

    Custom properties MUST keep their exact name — Framer drives its whole
    colour system through them, and camelCasing `--border-color` silently
    unstyles every bordered element on the page.
    """
    prop = prop.strip()
    if prop.startswith("--"):
        return prop
    return re.sub(r"-([a-z])", lambda m: m.group(1).upper(), prop)


def split_declarations(style: str) -> list[tuple[str, str]]:
    """Split a style attribute on top-level `;` only.

    `box-shadow` values contain commas and `rgba(...)` parens, and Framer
    emits nine-shadow stacks. A naive `split(';')` is fine for `;` but a
    naive `split(':')` is not — `url(data:image/svg+xml,...)` and
    `background-image:url(...)` both carry colons in the value, so only the
    first colon may be treated as the separator.
    """
    out: list[tuple[str, str]] = []
    depth = 0
    buf = ""
    for ch in style:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == ";" and depth == 0:
            if buf.strip():
                out.append(_one(buf))
            buf = ""
        else:
            buf += ch
    if buf.strip():
        out.append(_one(buf))
    return [p for p in out if p]


def _one(decl: str):
    if ":" not in decl:
        return None
    prop, _, value = decl.partition(":")
    return (css_prop_to_js(prop), value.strip())


def style_to_jsx(style: str) -> str:
    decls = split_declarations(style)
    if not decls:
        return ""
    parts = [f"{json.dumps(p)}: {json.dumps(v)}" for p, v in decls]
    # `as CSSProperties` because React's type does not model CSS custom
    # properties (`--framer-text-color`) or newer physical properties
    # (`corner-shape`). Both are valid CSS that React passes through
    # untouched at runtime; only the compile-time type is behind.
    return "{{" + ", ".join(parts) + "} as CSSProperties}"


def rewrite_url(value: str) -> str:
    """Point local asset refs at /opsra/ under public/."""
    value = re.sub(r'(?<![\w/])(images/)', r'/site/\1', value)
    value = re.sub(r'(?<![\w/])(fonts/)', r'/site/\1', value)
    return value


def escape_text(text: str) -> str:
    """JSX treats `{`/`}` as expression delimiters; `<`/`>` as tags."""
    return (text.replace("{", "&#123;").replace("}", "&#125;")
                .replace("<", "&lt;").replace(">", "&gt;"))


class ToJsx(HTMLParser):
    def __init__(self) -> None:
        # convert_charrefs=False keeps entities as authored so we re-emit
        # exactly what Framer wrote instead of round-tripping through
        # unicode and hoping the encoding survives.
        super().__init__(convert_charrefs=False)
        self.buf: list[str] = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        self.buf.append(self._tag(tag, attrs, void=tag in VOID))
        if tag not in VOID:
            self.depth += 1

    def handle_startendtag(self, tag, attrs):
        self.buf.append(self._tag(tag, attrs, void=True))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        self.depth -= 1
        self.buf.append(f"</{tag}>")

    def handle_data(self, data):
        if data.strip():
            self.buf.append(escape_text(data))
        elif data:
            self.buf.append(" ")

    def handle_entityref(self, name):
        self.buf.append(f"&{name};")

    def handle_charref(self, name):
        self.buf.append(f"&#{name};")

    def handle_comment(self, data):
        pass  # Framer ships 306 build comments; none are load-bearing.

    def _tag(self, tag, attrs, void: bool) -> str:
        rendered = []
        for key, value in attrs:
            key = RENAME.get(key, key)
            if value is None:
                # A valueless HTML attribute is `=""`, not `={true}`. The
                # export has 179 `<img alt>` — decorative images with an
                # intentionally empty alt. Emitting a bare `alt` in JSX
                # means `alt={true}`, which is both a type error and a
                # screen-reader regression.
                rendered.append(f"{key}={{true}}" if key in BOOLEAN else f'{key}=""')
                continue
            if key == "style":
                jsx = style_to_jsx(rewrite_url(value))
                if jsx:
                    rendered.append(f"style={jsx}")
                continue
            if key in ("src", "href", "srcSet"):
                value = rewrite_url(value)
            if key in BOOLEAN:
                rendered.append(f"{key}={{true}}")
                continue
            if key in NUMERIC and re.fullmatch(r"-?\d+", value.strip()):
                # HTML carries these as strings; React types them as
                # numbers. Guarded on the value actually being an integer
                # so a malformed one stays a string and surfaces loudly
                # rather than becoming a silent NaN.
                rendered.append(f"{key}={{{int(value)}}}")
                continue
            # A JSX attribute in quotes is HTML-flavoured: backslashes are
            # literal, not escapes. `data-framer-hydrate-v2` holds embedded
            # JSON, so anything carrying a quote or backslash has to go
            # through expression form to survive intact.
            # ensure_ascii=False so `→` stays `→`. With the default, json
            # emits `→`, and inside a JSX *string* attribute that is
            # eight literal characters rather than an arrow — which shows
            # up as a silent content corruption, not an error.
            lit = json.dumps(value, ensure_ascii=False)
            if not value.isascii() or any(c in value for c in '"\\\n\r\t'):
                rendered.append(f"{key}={{{lit}}}")
            else:
                rendered.append(f"{key}={lit}")
        joined = (" " + " ".join(rendered)) if rendered else ""
        return f"<{tag}{joined}{' />' if void else '>'}"

    def result(self) -> str:
        return "".join(self.buf)


def to_jsx_open(html: str) -> str:
    """JSX for an unclosed prefix — the parser would emit no closing tags
    for the wrappers left open, so they are supplied by the shell."""
    return to_jsx(html)


def to_jsx_close(html: str) -> str:
    """JSX for a suffix whose opening tags live in the prefix. HTMLParser
    drops stray end tags, so they are re-emitted verbatim after the
    balanced part is converted."""
    return to_jsx(html)


def to_jsx(html: str) -> str:
    p = ToJsx()
    p.feed(html)
    p.close()
    return p.result()


CHAR_SPAN = (
    '<span style="display:inline-block;opacity:0.001;transform:translateX(0px) '
    'translateY(10px) scale(1) rotate(0deg) skewX(0deg) skewY(0deg)">{}</span>'
)


def rebuild_split_run(text: str) -> str:
    """Re-emit a per-character reveal run for `text`.

    The export renders this headline one <span> per character inside
    per-word `white-space:nowrap` wrappers, so the stagger animates
    letters without ever breaking a word across lines. Entities are one
    glyph and must stay in a single span — splitting `&rsquo;` across
    five would render the literal characters.
    """
    words = text.split(" ")
    out = []
    for i, word in enumerate(words):
        glyphs = re.findall(r"&\w+;|.", word)
        inner = "".join(CHAR_SPAN.format(g) for g in glyphs)
        out.append(f'<span style="white-space:nowrap">{inner}</span>')
        if i != len(words) - 1:
            out.append(CHAR_SPAN.format(" "))
    return "".join(out)


def strip_loader(html: str) -> str:
    """Remove Framer's page-loading overlay.

    It is a `position:fixed; z-index:9999` full-viewport panel marked
    `data-load-wrap`, which the Framer runtime hides once the page is
    interactive. With no runtime it never dismisses, so it covers the site
    forever — and because it is fixed it only masks one viewport, which is
    why a full-page screenshot diff still matched the original: both had
    the same overlay, and the content underneath rendered fine.
    """
    marker = html.find('data-load-wrap="true"')
    if marker == -1:
        print("loader: no data-load-wrap found (already gone?)")
        return html
    start = html.rfind("<div", 0, html.rfind("<div", 0, marker))
    depth, end = 0, None
    for tok in re.finditer(r"<(/?)div\b[^>]*?(/?)>", html[start:]):
        if tok.group(2) == "/":
            continue
        depth += -1 if tok.group(1) else 1
        if depth == 0:
            end = start + tok.end()
            break
    if end is None:
        print("loader: could not close the overlay; leaving it in place")
        return html
    print(f"loader: removed {end - start:,} bytes of loading overlay")
    return html[:start] + html[end:]


def apply_content(html: str) -> str:
    """Swap Opsra's words and marks for ours, on raw HTML.

    Done before parsing because the keys carry entities (`&rsquo;`), and
    with convert_charrefs=False the parser would hand those back as
    separate events — `Autopilot your team` + `rsquo` + `s` — which no
    whole-string key can match.
    """
    unused = []

    # Split headline first: its full text also appears in a data-framer-name
    # attribute, and rebuilding the run must not disturb that.
    for src_text, dst_text in content.SPLIT_TEXT.items():
        pattern = re.compile(
            r'(data-framer-name="' + re.escape(src_text) + r'"[^>]*>.*?<h3\b[^>]*>)(.*?)(</h3>)',
            re.S,
        )
        html, n = pattern.subn(lambda m: m.group(1) + rebuild_split_run(dst_text) + m.group(3), html)
        if not n:
            unused.append(f"SPLIT_TEXT: {src_text[:60]}…")

    # Whole text nodes only — anchored between tags so a key like "Home"
    # cannot corrupt an attribute or a substring of a longer sentence.
    for src_text, dst_text in content.TEXT.items():
        # Trailing whitespace is preserved: several nodes end with a space
        # before an inline <a>, and eating it joins two words together.
        pattern = re.compile(r">" + re.escape(src_text) + r"(\s*)<")
        html, n = pattern.subn(lambda m, d=dst_text: f">{d}{m.group(1)}<", html)
        if not n:
            unused.append(f"TEXT: {src_text[:60]}")

    for src_text, dst_text in content.ATTRS.items():
        # Framer wraps long alt text, so `alt="opsra logo\n"` carries a
        # literal newline where the eye sees a trailing space.
        pattern = re.compile(r'="\s*' + re.escape(src_text.strip()) + r'\s*"')
        html, n = pattern.subn(lambda _m, d=dst_text: f'="{d}"', html)
        if not n:
            unused.append(f"ATTRS: {src_text[:60]}")

    for src_url, dst_url in content.LINKS.items():
        if src_url not in html:
            unused.append(f"LINKS: {src_url}")
        html = html.replace(f'href="{src_url}"', f'href="{dst_url}"')

    for src_asset, dst_asset in content.ASSETS.items():
        if src_asset not in html:
            unused.append(f"ASSETS: {src_asset}")
        html = html.replace(src_asset, dst_asset)

    # A replaced <img> keeps its old srcset pointing at Opsra's renditions,
    # which the browser prefers over src and would put their wordmark back.
    html = re.sub(r'\ssrcset="[^"]*brand/[^"]*"', "", html)

    # `data-framer-name` carries the design-file layer name, which for text
    # layers is a copy of the original sentence. Invisible to a reader, but
    # it is in the DOM and in view-source, so it gets the same treatment.
    def _clean_layer_name(m: re.Match[str]) -> str:
        name = m.group(1)
        for a, b in content.TEXT.items():
            name = name.replace(a, b)
        for a, b in content.SPLIT_TEXT.items():
            name = name.replace(a, b)
        name = re.sub(r"[Oo]psra", content.BRAND, name)
        return f'data-framer-name="{name}"'

    html = re.sub(r'data-framer-name="([^"]*)"', _clean_layer_name, html)

    # Nothing Framer-branded may survive into our tree.
    leaked = sorted(set(re.findall(r"framer\.com|framerusercontent\.com|[Oo]psra|OPSRA", html)))
    if leaked:
        print("\n!! Framer/Opsra references still present:", leaked)

    if unused:
        print("\n!! content map entries that matched nothing:")
        for line in unused:
            print("   ", line)
    else:
        print("content map: every entry matched")
    return html


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    src = (SRC / "index.html").read_text(encoding="utf-8")

    # --- stylesheet: copied verbatim, only asset URLs moved ---
    blocks = re.findall(r"<style[^>]*>(.*?)</style>", src, re.S)
    css = "\n".join(b for b in blocks if len(b) > 200)
    css = re.sub(r'url\(["\']?(?!data:|https?:|/)([^)"\']+)["\']?\)',
                 lambda m: f'url("/site/{m.group(1)}")', css)
    # The export is a whole document: it assumes the initial values for
    # anything its own reset does not set. Mounted inside our app it also
    # inherits `globals.css`, whose base line-height reached every text
    # node in the Framer tree and added 4px per card in Social Proof.
    # Framer's reset covers box-sizing/margin/padding and sets font-family
    # and font-size on body, but never line-height — so that is the gap.
    css += (
        "\n/* Re-assert the initial values the export assumes. Without this "
        "the host app's\n   base typography inherits into the Framer tree. */\n"
        "#main{line-height:normal;letter-spacing:normal;text-transform:none;"
        "font-weight:400;font-style:normal}\n"
    )
    (OUT / "opsra.css").write_text(css, encoding="utf-8")
    print(f"css        {len(css):>8,} bytes")

    # --- the whole page wrapper ---
    # Every layout rule in the stylesheet is scoped under `.framer-pnUdQ`
    # (the page template class) — `.framer-pnUdQ .framer-lm07mn-container`
    # and so on. Assembling a page from bare <section>s therefore matches
    # zero layout rules, and the sections spill sideways to 7244px. The
    # wrapper chain is structural, so it is transcribed whole.
    body = src[src.index("<body"):]
    start = body.index('<div id="main"')
    depth, end = 0, None
    for tok in re.finditer(r"<(/?)div\b[^>]*?(/?)>", body[start:]):
        if tok.group(2) == "/":
            continue
        depth += -1 if tok.group(1) else 1
        if depth == 0:
            end = start + tok.end()
            break
    assert end, "could not close #main"
    main = body[start:end]

    # <style> inside the tree would have its braces escaped by the JSX text
    # rules and come out as `&#123;`. Move it to the stylesheet instead,
    # where it is the same CSS with the same specificity.
    inline_css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", main, re.S))
    main = re.sub(r"<style[^>]*>.*?</style>", "", main, flags=re.S)
    main = re.sub(r"<script[^>]*>.*?</script>", "", main, flags=re.S)
    if inline_css:
        with (OUT / "opsra.css").open("a", encoding="utf-8") as fh:
            fh.write("\n" + inline_css)
    main = strip_loader(apply_content(main))
    (OUT / "page-full.jsx.txt").write_text(to_jsx(main), encoding="utf-8")

    # Split the page into a reusable shell and the homepage body. The shell
    # keeps the #main > .framer-pnUdQ wrapper chain that every layout rule
    # is scoped under, so any page rendered inside it inherits the design
    # rather than re-deriving it.
    first = main.index("<section")
    last = main.rindex("</section>") + len("</section>")
    (OUT / "shell-head.jsx.txt").write_text(to_jsx_open(main[:first]), encoding="utf-8")
    (OUT / "shell-foot.jsx.txt").write_text(to_jsx_close(main[last:]), encoding="utf-8")
    (OUT / "home-body.jsx.txt").write_text(to_jsx(main[first:last]), encoding="utf-8")
    print(f"shell      head={first:,}  body={last-first:,}  foot={len(main)-last:,}")
    print(f"page-full  {len(main):>8,} bytes html")

    # --- sections ---
    marks = [(m.start(), m.group(1)) for m in
             re.finditer(r'<section[^>]*data-framer-name="([^"]+)"', body)]
    print(f"sections   {len(marks)}")
    for i, (pos, name) in enumerate(marks):
        # Slice the <section> element by balanced tag depth, not by the
        # offset of the next section. The last section is followed by three
        # <footer> variants and the page's closing divs; a byte-offset slice
        # swallows them and lands mid-element, which TypeScript reports as
        # an unclosed JSX fragment 58,000 characters away from the cause.
        end, depth = None, 0
        for tok in re.finditer(r"</?section\b[^>]*>", body[pos:]):
            depth += -1 if tok.group(0).startswith("</") else 1
            if depth == 0:
                end = pos + tok.end()
                break
        assert end, f"unbalanced <section> for {name}"
        jsx = to_jsx(body[pos:end])
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        (OUT / f"{slug}.jsx.txt").write_text(jsx, encoding="utf-8")
        print(f"  {slug:<16} {len(jsx):>8,} bytes")
