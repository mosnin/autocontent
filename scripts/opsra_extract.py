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
from html.parser import HTMLParser
from pathlib import Path

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
    value = re.sub(r'(?<![\w/])(images/)', r'/opsra/\1', value)
    value = re.sub(r'(?<![\w/])(fonts/)', r'/opsra/\1', value)
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


def to_jsx(html: str) -> str:
    p = ToJsx()
    p.feed(html)
    p.close()
    return p.result()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    src = (SRC / "index.html").read_text(encoding="utf-8")

    # --- stylesheet: copied verbatim, only asset URLs moved ---
    blocks = re.findall(r"<style[^>]*>(.*?)</style>", src, re.S)
    css = "\n".join(b for b in blocks if len(b) > 200)
    css = re.sub(r'url\(["\']?(?!data:|https?:|/)([^)"\']+)["\']?\)',
                 lambda m: f'url("/opsra/{m.group(1)}")', css)
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
    (OUT / "page-full.jsx.txt").write_text(to_jsx(main), encoding="utf-8")
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
