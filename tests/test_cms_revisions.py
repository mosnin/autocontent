"""Revision capture/diff/restore — the pure half of the history machinery.

The discipline under test: snapshots hold the state being REPLACED, an edit
that changes nothing captures nothing, and restore is a forward write.
"""
from __future__ import annotations

from marketer.cms import revisions
from marketer.cms.schemas import EDITABLE_FIELDS, ArticleEdit

_ARTICLE = {
    "title": "SEO Basics",
    "slug": "seo-basics",
    "meta_description": "A short guide.",
    "article_markdown": "# SEO Basics\n\nOne two three.",
    # Fields outside the editable surface must be ignored throughout.
    "word_count": 5,
    "status": "done",
    "hero_image_path": "/vol/hero.png",
}


# ---------------------------------------------------------------------------
# snapshot / apply_edit
# ---------------------------------------------------------------------------


def test_snapshot_captures_exactly_the_editable_surface():
    snap = revisions.snapshot(_ARTICLE)
    assert set(snap) == set(EDITABLE_FIELDS)
    assert snap["title"] == "SEO Basics"
    # Pipeline output is not part of a revision — restoring must never
    # rewind a hero image or a quality score.
    assert "hero_image_path" not in snap


def test_apply_edit_merges_only_the_sent_fields():
    after = revisions.apply_edit(_ARTICLE, ArticleEdit(title="SEO Basics, Revised"))
    assert after["title"] == "SEO Basics, Revised"
    assert after["article_markdown"] == _ARTICLE["article_markdown"]
    assert set(after) == set(EDITABLE_FIELDS)


def test_apply_edit_ignores_explicit_nulls():
    """`None` means "not sent", not "clear it" — there is no sane meaning
    for blanking the title of an article that may be live."""
    after = revisions.apply_edit(_ARTICLE, ArticleEdit(title=None))
    assert after["title"] == "SEO Basics"


def test_edit_changes_reports_only_what_was_sent():
    edit = ArticleEdit(title="New", meta_description=None)
    assert edit.changes() == {"title": "New"}


def test_edit_strips_whitespace_on_short_fields():
    assert ArticleEdit(title="  Padded  ").changes()["title"] == "Padded"


# ---------------------------------------------------------------------------
# diffing
# ---------------------------------------------------------------------------


def test_changed_fields_lists_real_differences_in_field_order():
    after = dict(_ARTICLE, title="New Title", article_markdown="# New\n\nBody.")
    assert revisions.changed_fields(_ARTICLE, after) == [
        "title",
        "article_markdown",
    ]


def test_changed_fields_empty_for_an_identical_write():
    assert revisions.changed_fields(_ARTICLE, revisions.snapshot(_ARTICLE)) == []


def test_none_and_empty_string_are_not_a_change():
    """A client round-tripping a null meta description as "" must not burn a
    revision number recording a change that didn't happen."""
    before = dict(_ARTICLE, meta_description=None)
    after = dict(revisions.snapshot(before), meta_description="")
    assert revisions.changed_fields(before, after) == []


# ---------------------------------------------------------------------------
# summaries
# ---------------------------------------------------------------------------


def test_summary_names_fields_and_the_word_delta():
    after = dict(
        _ARTICLE,
        title="New Title",
        article_markdown=_ARTICLE["article_markdown"] + " four five six seven.",
    )
    changed = revisions.changed_fields(_ARTICLE, after)
    summary = revisions.summarize(changed, _ARTICLE, after)
    assert summary == "title, body (+4 words)"


def test_summary_reports_a_shrinking_body_with_a_minus():
    after = dict(_ARTICLE, article_markdown="# SEO Basics")
    changed = revisions.changed_fields(_ARTICLE, after)
    assert revisions.summarize(changed, _ARTICLE, after) == "body (-3 words)"


def test_summary_of_nothing():
    assert revisions.summarize([], _ARTICLE, _ARTICLE) == "no changes"


def test_word_count_matches_the_pipeline_definition():
    # The pipeline uses len(markdown.split()); a hand-edited article must
    # stay comparable with a generated one.
    assert revisions.word_count("one two  three\nfour") == 4
    assert revisions.word_count(None) == 0


# ---------------------------------------------------------------------------
# restore
# ---------------------------------------------------------------------------


def test_restore_payload_carries_the_snapshot_forward():
    snapshot = {
        "title": "Old Title",
        "slug": "old-slug",
        "meta_description": "Old meta.",
        "article_markdown": "# Old\n\nOld body.",
    }
    assert revisions.restore_payload(snapshot) == snapshot


def test_restore_payload_skips_fields_the_snapshot_has_no_opinion_about():
    """A revision captured when meta_description was null must not blank a
    meta description written since — a restore may not LOSE content the
    snapshot simply doesn't cover."""
    snapshot = {
        "title": "Old Title",
        "slug": None,
        "meta_description": None,
        "article_markdown": "# Old",
    }
    payload = revisions.restore_payload(snapshot)
    assert payload == {"title": "Old Title", "article_markdown": "# Old"}

    current = revisions.snapshot(_ARTICLE)
    after = dict(current)
    after.update(payload)
    assert after["meta_description"] == "A short guide."
    assert after["slug"] == "seo-basics"


def test_restore_summary_labels_the_source_revision():
    assert revisions.restore_summary(3, ["title", "article_markdown"]) == (
        "restored v3: title, body"
    )
    assert revisions.restore_summary(3, []) == "restored v3 (no content change)"


def test_restore_is_a_forward_write_not_a_rewind():
    """Restoring v1 onto v3 produces a diff whose 'before' is v3 — that
    before-state is what the new revision captures, so v3 survives in
    history and the restore is itself reversible."""
    v1 = {
        "title": "Original",
        "slug": "seo-basics",
        "meta_description": "Original meta.",
        "article_markdown": "# Original",
    }
    current = revisions.snapshot(_ARTICLE)
    after = dict(current)
    after.update(revisions.restore_payload(v1))

    changed = revisions.changed_fields(current, after)
    assert changed == ["title", "meta_description", "article_markdown"]
    # The captured snapshot is the CURRENT state, not v1.
    assert current["title"] == "SEO Basics"
