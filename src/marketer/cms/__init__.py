"""Article CMS: hand editing, revision history, publication state, collections.

The article *pipeline* (``marketer.articles``) is a one-shot generator: it
turns a topic into a finished, SEO-complete draft. This package is what
happens to that draft afterwards — the editorial surface a CMS needs and a
generator does not:

* :mod:`.slugs`     — slug normalization and collision resolution (pure)
* :mod:`.revisions` — diffing/snapshotting the editable surface (pure)
* :mod:`.publish`   — publication-state transitions and their guards (pure)
* :mod:`.schemas`   — the wire models for all of the above

Everything here is deliberately pure: no DB, no network, no LLM. Persistence
lives in ``marketer.repos.article_revisions`` / ``marketer.repos.collections``
and the HTTP surface in ``backend.routes.cms``, so the rules that decide
whether an article may go live are testable without a database.
"""
from __future__ import annotations
