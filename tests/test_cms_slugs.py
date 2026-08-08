"""Slug normalization + per-user uniqueness resolution.

The collision path is the important one: a slug is a public URL, and two
articles resolving to the same one is a real bug, so both the pure resolver
and the repo query that feeds it are covered here.
"""
from __future__ import annotations

import pytest

from marketer.cms import slugs


# ---------------------------------------------------------------------------
# normalize
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("How To Test Pipelines", "how-to-test-pipelines"),
        ("  spaced   out  ", "spaced-out"),
        ("Already-Kebab-Case", "already-kebab-case"),
        ("Punctuation!? Everywhere...", "punctuation-everywhere"),
        ("under_scores and/slashes", "under-scores-and-slashes"),
        ("multiple---hyphens", "multiple-hyphens"),
        ("-leading and trailing-", "leading-and-trailing"),
        ("SEO in 2026: What's Next?", "seo-in-2026-what-s-next"),
    ],
)
def test_normalize_shapes(raw, expected):
    assert slugs.normalize(raw) == expected


def test_normalize_transliterates_rather_than_dropping_letters():
    """"Café" must become "cafe", not "caf" — dropping the letter changes
    the word, which changes the URL's meaning."""
    assert slugs.normalize("Café Culture in Lyon") == "cafe-culture-in-lyon"
    assert slugs.normalize("Naïve Bayes Explained") == "naive-bayes-explained"


def test_normalize_falls_back_when_nothing_survives():
    # A title that is entirely emoji/CJK strips to "" — but a public URL
    # still needs a path segment.
    assert slugs.normalize("🎉🎉🎉") == slugs.FALLBACK
    assert slugs.normalize("") == slugs.FALLBACK
    assert slugs.normalize(None) == slugs.FALLBACK
    assert slugs.normalize("🎉", fallback="") == ""


def test_normalize_truncates_on_a_word_boundary():
    raw = "the complete and utterly exhaustive guide to enterprise content marketing operations in practice"
    out = slugs.normalize(raw)
    assert len(out) <= slugs.MAX_LENGTH
    assert not out.endswith("-")
    # Cut at a hyphen, so the last token is a whole word.
    assert raw.replace(" ", "-").startswith(out)


def test_normalize_hard_cuts_a_single_long_token():
    out = slugs.normalize("a" * 200)
    assert out == "a" * slugs.MAX_LENGTH


# ---------------------------------------------------------------------------
# candidates / base_of
# ---------------------------------------------------------------------------


def test_candidates_start_with_the_base_then_number_from_two():
    got = [c for _, c in zip(range(4), slugs.candidates("my-post"))]
    assert got == ["my-post", "my-post-2", "my-post-3", "my-post-4"]


def test_candidate_suffix_is_budgeted_inside_the_length_ceiling():
    base = "x" * slugs.MAX_LENGTH
    for candidate in [c for _, c in zip(range(12), slugs.candidates(base))]:
        assert len(candidate) <= slugs.MAX_LENGTH


def test_base_of_strips_a_previous_disambiguator():
    # Re-publishing "my-post-2" must retry "my-post" first rather than
    # growing into "my-post-2-2" forever.
    assert slugs.base_of("my-post-2") == "my-post"
    assert slugs.base_of("my-post-17") == "my-post"
    assert slugs.base_of("my-post") == "my-post"
    assert slugs.base_of("top-10") == "top"


# ---------------------------------------------------------------------------
# resolve — the collision path
# ---------------------------------------------------------------------------


def test_resolve_returns_the_base_when_free():
    assert slugs.resolve("My Post", taken=set()) == "my-post"


def test_resolve_walks_past_taken_slugs():
    taken = {"my-post", "my-post-2", "my-post-3"}
    assert slugs.resolve("My Post", taken) == "my-post-4"


def test_resolve_ignores_an_articles_own_slug():
    """The caller excludes the article being resolved from `taken`, so an
    article keeping its slug across a re-publish is not told it collides
    with itself."""
    assert slugs.resolve("my-post", taken=set()) == "my-post"


def test_resolve_normalizes_the_base_before_comparing():
    # "My Post!" and "my-post" are the same URL; the collision must be seen.
    assert slugs.resolve("My Post!", {"my-post"}) == "my-post-2"


def test_resolve_raises_rather_than_minting_a_duplicate():
    """Falling back to a colliding slug would put two articles on one URL —
    the exact bug the DB index exists to prevent. Raise instead."""
    taken = {"dupe"} | {f"dupe-{n}" for n in range(2, 12)}
    with pytest.raises(slugs.SlugExhausted):
        slugs.resolve("dupe", taken, limit=10)


def test_resolve_tolerates_nulls_in_the_taken_set():
    # The DB query can hand back rows with a null slug; they are not URLs.
    assert slugs.resolve("my-post", {None, "", "other"}) == "my-post"


# ---------------------------------------------------------------------------
# Repo-side resolution: the query that feeds `resolve`
# ---------------------------------------------------------------------------


class _FakeConn:
    """Minimal asyncpg connection stand-in: records the SQL it was given
    and replays canned rows."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self.sql: list[str] = []

    async def fetch(self, sql, *args):
        self.sql.append(sql)
        return self._rows


async def test_first_publish_resolves_a_colliding_machine_slug():
    """Machine-generated slugs ARE silently disambiguated: the input is LLM
    output, not a human's deliberate choice."""
    from uuid import uuid4

    from marketer.cms.schemas import CmsArticle
    from marketer.repos import article_revisions as repo

    conn = _FakeConn([{"slug": "seo-basics"}, {"slug": "seo-basics-2"}])
    article = CmsArticle(
        id=uuid4(),
        user_id="u1",
        niche_id=uuid4(),
        status="done",
        title="SEO Basics",
        slug="seo-basics",
    )

    assert await repo._resolve_public_slug(conn, article) == "seo-basics-3"
    # The taken-set query must mirror the partial unique index: currently
    # public OR ever published.
    assert "published_at is not null" in conn.sql[0]


async def test_republish_keeps_a_frozen_slug_verbatim():
    """An article that has been live keeps its URL; re-resolving it would
    move a page that other sites already link to."""
    from datetime import datetime, timezone
    from uuid import uuid4

    from marketer.cms.schemas import CmsArticle
    from marketer.repos import article_revisions as repo

    conn = _FakeConn([{"slug": "seo-basics"}])
    article = CmsArticle(
        id=uuid4(),
        user_id="u1",
        niche_id=uuid4(),
        status="done",
        title="SEO Basics",
        slug="seo-basics",
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )

    assert await repo._resolve_public_slug(conn, article) == "seo-basics"
    assert conn.sql == []  # no lookup needed at all


async def test_slug_derived_from_title_when_the_pipeline_left_none():
    from uuid import uuid4

    from marketer.cms.schemas import CmsArticle
    from marketer.repos import article_revisions as repo

    conn = _FakeConn([])
    article = CmsArticle(
        id=uuid4(),
        user_id="u1",
        niche_id=uuid4(),
        status="done",
        title="Programmatic SEO, Explained",
        slug=None,
    )
    assert await repo._resolve_public_slug(conn, article) == "programmatic-seo-explained"
