"""SEO metadata rules: meta title, meta description, slug and keywords.

One place decides what valid metadata is, for the pipeline (which fits what
the model wrote) and for the edit route (which refuses what a person typed).

- meta title: 1 to 60 characters
- meta description: 1 to 155 characters
- slug: lowercase ASCII words joined by single hyphens, at most 80 characters
- focus keyword: 1 to 100 characters
- secondary keywords: at most 10, each 1 to 60 characters, distinct from each
  other and from the focus keyword (case-insensitive)
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

META_TITLE_MAX = 60
META_DESCRIPTION_MAX = 155
SLUG_MAX = 80
FOCUS_KEYWORD_MAX = 100
SECONDARY_MAX = 10
SECONDARY_KEYWORD_MAX = 60

_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SPACE = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class SeoMeta:
    meta_title: str
    meta_description: str
    slug: str
    focus_keyword: str
    secondary_keywords: tuple[str, ...]


def clean_text(value: str | None) -> str:
    """Collapse whitespace, drop control characters."""
    return _SPACE.sub(" ", _CONTROL.sub(" ", value or "")).strip()


def fit(value: str | None, limit: int) -> str:
    """Shorten to ``limit`` characters at a word boundary, without a trailing
    separator. Text that already fits is returned unchanged."""
    text = clean_text(value)
    if len(text) <= limit:
        return text
    cut = text[: limit + 1]
    space = cut.rfind(" ")
    out = cut[:space] if space >= limit // 2 else text[:limit]
    return out.rstrip(" ,;:-|")


def slugify(value: str | None) -> str:
    """ASCII, lowercase, hyphen-separated, at most SLUG_MAX characters, cut at
    a hyphen when it has to be shortened."""
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if len(text) > SLUG_MAX:
        text = text[: SLUG_MAX + 1]
        text = text[: text.rfind("-")] if "-" in text else text[:SLUG_MAX]
        text = text.strip("-")
    return text


def dedupe_keywords(focus: str, keywords: list[str] | tuple[str, ...]) -> list[str]:
    seen = {clean_text(focus).lower()}
    out: list[str] = []
    for k in keywords:
        k = fit(k, SECONDARY_KEYWORD_MAX)
        if not k or k.lower() in seen:
            continue
        seen.add(k.lower())
        out.append(k)
        if len(out) == SECONDARY_MAX:
            break
    return out


def normalize(
    *, meta_title: str | None, meta_description: str | None, slug: str | None,
    focus_keyword: str | None, secondary_keywords: list[str] | tuple[str, ...] = (),
    fallback_title: str = "",
) -> SeoMeta:
    """Fit model-written metadata into the rules (the pipeline's path)."""
    title = fit(meta_title or fallback_title, META_TITLE_MAX)
    focus = fit(focus_keyword, FOCUS_KEYWORD_MAX)
    return SeoMeta(
        meta_title=title,
        meta_description=fit(meta_description, META_DESCRIPTION_MAX),
        slug=slugify(slug or title),
        focus_keyword=focus,
        secondary_keywords=tuple(dedupe_keywords(focus, list(secondary_keywords))),
    )


def validate(
    *, meta_title: str, meta_description: str, slug: str, focus_keyword: str,
    secondary_keywords: list[str] | tuple[str, ...],
) -> dict[str, str]:
    """Problems with metadata a person typed, by field. Empty when valid.
    Nothing is shortened or rewritten here: a person sees the problem."""
    errors: dict[str, str] = {}
    t = clean_text(meta_title)
    if not t:
        errors["meta_title"] = "Add a meta title."
    elif len(t) > META_TITLE_MAX:
        errors["meta_title"] = f"Keep the meta title to {META_TITLE_MAX} characters ({len(t)} now)."
    d = clean_text(meta_description)
    if not d:
        errors["meta_description"] = "Add a meta description."
    elif len(d) > META_DESCRIPTION_MAX:
        errors["meta_description"] = (
            f"Keep the meta description to {META_DESCRIPTION_MAX} characters ({len(d)} now)."
        )
    if not slug:
        errors["slug"] = "Add a slug."
    elif len(slug) > SLUG_MAX:
        errors["slug"] = f"Keep the slug to {SLUG_MAX} characters."
    elif not _SLUG.match(slug):
        errors["slug"] = "Use lowercase letters, numbers and single hyphens."
    f = clean_text(focus_keyword)
    if not f:
        errors["focus_keyword"] = "Add a focus keyword."
    elif len(f) > FOCUS_KEYWORD_MAX:
        errors["focus_keyword"] = f"Keep the focus keyword to {FOCUS_KEYWORD_MAX} characters."
    if len(secondary_keywords) > SECONDARY_MAX:
        errors["secondary_keywords"] = f"Use at most {SECONDARY_MAX} secondary keywords."
    else:
        seen = {f.lower()}
        for k in secondary_keywords:
            k2 = clean_text(k)
            if not k2 or len(k2) > SECONDARY_KEYWORD_MAX:
                errors["secondary_keywords"] = (
                    f"Each secondary keyword needs 1 to {SECONDARY_KEYWORD_MAX} characters."
                )
                break
            if k2.lower() in seen:
                errors["secondary_keywords"] = f"“{k2}” is listed twice (or is the focus keyword)."
                break
            seen.add(k2.lower())
    return errors
