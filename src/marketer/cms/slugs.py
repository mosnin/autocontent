"""Slug normalization and per-user uniqueness resolution.

A slug is the article's public URL. Two rules follow from that and drive
everything in this module:

1. It must be stable and machine-safe. The pipeline's slug comes from an
   LLM ("kebab-case slug" in the prompt) and an edited slug comes from a
   human typing into a text box; neither is trustworthy input for a URL.
2. It must be unique per user among the articles that are actually
   addressable. Uniqueness is ultimately enforced by the partial unique
   index in migration 0037 — this module is the cooperative half that
   picks a free candidate so callers rarely hit the index, and that
   supplies the next candidate when they do.

Everything here is pure so the collision rules are testable without a DB.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Iterator

#: Ceiling on a stored slug. Not a DB limit — a readability/SEO one: search
#: engines truncate long URLs in results and nobody links a 200-char path.
#: Suffixes are budgeted inside this, never appended past it.
MAX_LENGTH = 80

#: Used when normalization leaves nothing at all (a title that is entirely
#: emoji or CJK punctuation strips to ""). A slug is required for a public
#: URL, so we must always produce *something*.
FALLBACK = "article"

_NON_SLUG = re.compile(r"[^a-z0-9]+")
_DEDUPE_HYPHEN = re.compile(r"-{2,}")
# Matches a numeric disambiguator we appended earlier ("-2", "-17"), so
# re-resolving an already-resolved slug doesn't stack suffixes forever.
_EXISTING_SUFFIX = re.compile(r"-(\d+)$")


def normalize(raw: str | None, *, fallback: str = FALLBACK) -> str:
    """Reduce arbitrary text to a lowercase ASCII kebab-case slug.

    Unicode is transliterated rather than dropped wholesale ("Café" ->
    "cafe", not "caf") because losing letters silently changes the word.
    """
    if not raw:
        return fallback

    # NFKD splits accented letters into base + combining mark; dropping the
    # non-ASCII bytes then leaves the base letter behind.
    decomposed = unicodedata.normalize("NFKD", raw)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")

    slug = _NON_SLUG.sub("-", ascii_only.lower())
    slug = _DEDUPE_HYPHEN.sub("-", slug).strip("-")

    if not slug:
        return fallback

    return _truncate(slug, MAX_LENGTH)


def _truncate(slug: str, limit: int) -> str:
    """Cut to `limit` on a word boundary where one is reasonably close.

    Cutting mid-word ("how-to-build-a-conte") looks broken; cutting at the
    previous hyphen only helps if it isn't miles back, hence the 75%
    threshold before falling back to a hard cut.
    """
    if len(slug) <= limit:
        return slug
    cut = slug[:limit]
    last_hyphen = cut.rfind("-")
    if last_hyphen >= int(limit * 0.75):
        cut = cut[:last_hyphen]
    return cut.rstrip("-")


def base_of(slug: str) -> str:
    """Strip a previously-appended numeric disambiguator.

    Re-publishing "my-post-2" must try "my-post-2" first (it may well be
    free again) but must not grow into "my-post-2-2" when it isn't.
    """
    return _EXISTING_SUFFIX.sub("", slug)


def candidates(base: str, *, limit: int = 100) -> Iterator[str]:
    """Yield `base`, `base-2`, `base-3`, ... trimmed to fit MAX_LENGTH.

    The suffix budget is taken out of the base, not added on top, so a
    maximally long slug still obeys the ceiling after disambiguation.
    """
    normalized = normalize(base)
    yield normalized
    for n in range(2, limit + 1):
        suffix = f"-{n}"
        stem = _truncate(normalized, MAX_LENGTH - len(suffix)).rstrip("-")
        yield f"{stem or FALLBACK}{suffix}"


def resolve(base: str, taken: Iterable[str], *, limit: int = 100) -> str:
    """First candidate for `base` that is not in `taken`.

    `taken` is the set of slugs already backing a public URL for this user,
    *excluding* the article being resolved — an article keeping its own slug
    across an edit must not be told it collides with itself.

    Exhausting `limit` candidates means someone has 100 articles named the
    same thing; falling back to the last candidate (rather than raising)
    would mint a duplicate URL, so we raise and let the caller 409.
    """
    seen = {s for s in taken if s}
    for candidate in candidates(base, limit=limit):
        if candidate not in seen:
            return candidate
    raise SlugExhausted(
        f"no free slug for {base!r} after {limit} candidates"
    )


class SlugExhausted(RuntimeError):
    """Raised when every candidate slug for a base is already taken."""
