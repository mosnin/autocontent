"""Revision capture, diffing and restore — pure.

The discipline mirrors ``repos.admin_audit``: history is append-only. An
edit captures the state being replaced *before* writing the new one, and a
restore does not rewind — it captures the current state as a fresh revision
and writes the old content forward. Nothing in this module or its repo ever
updates or deletes a revision row.

Snapshots hold the BEFORE state. That choice makes restore trivial (write
the snapshot forward) and makes "what did revision 3 change" answerable by
comparing revision 3's snapshot with revision 4's, without a replay engine.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .schemas import EDITABLE_FIELDS, ArticleEdit

#: Human labels for the summary line.
_LABELS = {
    "title": "title",
    "slug": "slug",
    "meta_description": "meta description",
    "article_markdown": "body",
}


def snapshot(article: Mapping[str, Any]) -> dict[str, Any]:
    """The editable surface of an article, as stored in a revision row."""
    return {field: article.get(field) for field in EDITABLE_FIELDS}


def apply_edit(
    article: Mapping[str, Any], edit: ArticleEdit
) -> dict[str, Any]:
    """The after-state: the article's editable surface with `edit` applied.

    Returns only the editable fields — the caller decides how to persist
    them. Fields the caller didn't send are carried through unchanged.
    """
    after = snapshot(article)
    after.update(edit.changes())
    return after


def changed_fields(
    before: Mapping[str, Any], after: Mapping[str, Any]
) -> list[str]:
    """Editable fields whose value actually differs, in EDITABLE_FIELDS order.

    Compared on the normalized (``None`` -> ``""``) value so that a client
    round-tripping a null title as an empty string is not recorded as a
    change — an edit that changed nothing must not burn a revision number.
    """
    return [
        field
        for field in EDITABLE_FIELDS
        if (before.get(field) or "") != (after.get(field) or "")
    ]


def word_count(markdown: str | None) -> int:
    """Same definition the pipeline uses (``len(markdown.split())``), so a
    hand-edited article's word_count stays comparable with a generated one."""
    return len((markdown or "").split())


def summarize(
    changed: list[str],
    before: Mapping[str, Any],
    after: Mapping[str, Any],
) -> str:
    """One-line description of an edit, e.g. ``title, body (+142 words)``.

    Computed at capture time and stored, so the revision list endpoint never
    has to load two markdown blobs per row to say what happened.
    """
    if not changed:
        return "no changes"

    parts: list[str] = []
    for field in changed:
        label = _LABELS.get(field, field)
        if field == "article_markdown":
            delta = word_count(after.get(field)) - word_count(before.get(field))
            if delta:
                parts.append(f"{label} ({delta:+d} words)")
            else:
                parts.append(label)
        else:
            parts.append(label)
    return ", ".join(parts)


def restore_payload(revision: Mapping[str, Any]) -> dict[str, Any]:
    """The editable surface to write forward when restoring `revision`.

    Only fields the snapshot actually carries are restored; a revision
    captured before a field existed (or holding a null) leaves that field
    alone rather than blanking it, because a restore must never *lose*
    content that the snapshot simply has no opinion about.
    """
    return {
        field: revision[field]
        for field in EDITABLE_FIELDS
        if revision.get(field) is not None
    }


def restore_summary(revision_number: int, changed: list[str]) -> str:
    if not changed:
        return f"restored v{revision_number} (no content change)"
    labels = ", ".join(_LABELS.get(f, f) for f in changed)
    return f"restored v{revision_number}: {labels}"
