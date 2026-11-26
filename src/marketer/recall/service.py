"""What routes and jobs call for recall. Every namespace comes from identity:

- ``personal_scope(ctx)``: the caller's own personal namespace, from
  ``ctx.user_id`` (tenant) and ``ctx.actor_id`` (person). A context without a
  person (token, unverified agent) has none.
- ``team_scope(tenant_id)``: the workspace's team namespace.

No function here takes a namespace, and no route passes another person's id.
Mirroring (team) sends only governed sources: confirmed facts, the brand kit,
playbooks and published articles. Conversations never reach team memory.
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

from marketer.recall import config as recall_config
from marketer.recall import repo
from marketer.recall.namespace import NamespaceRefused, Scope, scope
from marketer.services.supermemory import SupermemoryClient, SupermemoryError

log = logging.getLogger(__name__)

_URL = re.compile(r"\b(?:https?|ftp)://\S+|\bwww\.\S+", re.IGNORECASE)
MAX_MIRROR_DOCS_PER_TICK = 200


def client() -> SupermemoryClient:
    """Indirection so tests swap in a client on a fake transport."""
    return SupermemoryClient()


def configured() -> bool:
    return recall_config.load().configured


def strip_urls(text: str) -> str:
    """URLs never go as content: Supermemory fetches a URL server-side."""
    return _URL.sub("[link]", text)


def personal_scope(ctx: Any) -> Scope | None:
    """The caller's personal namespace, or None when the context has no
    verified person (personal access tokens, an agent call without a verified
    ``x-actor-id``) or an id we refuse to derive from."""
    actor = getattr(ctx, "actor_id", "") or ""
    if not actor or getattr(ctx, "actor_type", "user") == "token":
        return None
    cfg = recall_config.load()
    try:
        return scope("personal", ctx.user_id, actor, cfg.namespace_secret)
    except NamespaceRefused:
        return None


def team_scope(tenant_id: str) -> Scope | None:
    cfg = recall_config.load()
    try:
        return scope("team", tenant_id, None, cfg.namespace_secret)
    except NamespaceRefused:
        return None


def subject_scope(tenant_id: str, person_id: str) -> Scope | None:
    """For the purge job only: a personal namespace from a queue row."""
    cfg = recall_config.load()
    try:
        return scope("personal", tenant_id, person_id, cfg.namespace_secret)
    except NamespaceRefused:
        return None


async def enabled(tenant_id: str) -> bool:
    """Reads and writes happen only when the workspace turned recall on AND the
    deployment is configured. A database error raises (callers fail closed)."""
    if not configured():
        return False
    return (await repo.get_setting(tenant_id)).enabled


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


# ----------------------------------------------------------------- team mirroring


async def mirror_fact(tenant_id: str, fact: Any) -> bool:
    """A fact was confirmed (or corrected to a new trusted value): add it to
    team memory now, with ``dreaming: "instant"`` so teammates see it right away.
    Best effort: the sync tick reconciles whatever this misses."""
    if fact is None or getattr(fact, "trust", None) != "trusted" or getattr(fact, "pending", False) or getattr(fact, "invalid_at", None):
        return False
    try:
        if not await enabled(tenant_id):
            return False
        team = team_scope(tenant_id)
        if team is None:
            return False
        text = strip_urls(repo.fact_text(fact.subject_type, fact.subject_name, fact.predicate, fact.value, fact.object_name))
        doc_id = f"fact_{fact.id}"
        await client().add(team, content=text, doc_id=doc_id, metadata={"scope": "team", "kind": "fact", "source": "memory_facts"}, dreaming="instant")
        await repo.mirror_set(tenant_id, doc_id, _hash(text))
        return True
    except (SupermemoryError, Exception):  # noqa: BLE001 — mirroring never fails the person's action
        log.warning("recall.mirror_fact_failed tenant_hash=%s", _hash(tenant_id)[:8], exc_info=False)
        return False


async def unmirror_fact(tenant_id: str, fact_id: Any) -> bool:
    """A fact was corrected or forgotten: remove its mirror from team memory.
    Runs even when recall was turned off since (a forget must not linger)."""
    if not configured():
        return False
    doc_id = f"fact_{fact_id}"
    try:
        state = await repo.mirror_state(tenant_id)
        if doc_id not in state:
            return False
        team = team_scope(tenant_id)
        if team is None:
            return False
        await client().delete_documents(team, [doc_id])
        await repo.mirror_drop(tenant_id, [doc_id])
        return True
    except (SupermemoryError, Exception):  # noqa: BLE001 — the sync tick retries the removal
        log.warning("recall.unmirror_failed tenant_hash=%s", _hash(tenant_id)[:8], exc_info=False)
        return False


async def sync_team(tenant_id: str, *, max_docs: int = MAX_MIRROR_DOCS_PER_TICK) -> dict[str, int]:
    """Bring the team namespace in line with Postgres: add what changed, remove
    what is gone. Used to seed on enable and by the scheduler tick."""
    counts = {"added": 0, "removed": 0, "failed": 0}
    if not await enabled(tenant_id):
        return counts
    team = team_scope(tenant_id)
    if team is None:
        return counts
    sm = client()
    sources = await repo.governed_sources(tenant_id)
    state = await repo.mirror_state(tenant_id)
    gone = [doc for doc in state if doc not in sources]
    for i in range(0, len(gone), 100):
        batch = gone[i : i + 100]
        try:
            await sm.delete_documents(team, batch)
            await repo.mirror_drop(tenant_id, batch)
            counts["removed"] += len(batch)
        except SupermemoryError:
            counts["failed"] += len(batch)
    budget = max_docs
    for doc_id, raw in sources.items():
        text = strip_urls(raw)
        h = _hash(text)
        if state.get(doc_id) == h:
            continue
        if budget <= 0:
            break
        budget -= 1
        kind = doc_id.split("_", 1)[0]
        try:
            await sm.add(team, content=text, doc_id=doc_id, metadata={"scope": "team", "kind": kind}, dreaming="instant" if kind == "fact" else "dynamic")
            await repo.mirror_set(tenant_id, doc_id, h)
            counts["added"] += 1
        except SupermemoryError:
            counts["failed"] += 1
    return counts


# ----------------------------------------------------------------- deletion helpers


async def enqueue_workspace(tenant_id: str, reason: str) -> int:
    """Queue the team namespace and every known personal namespace of a workspace."""
    n = int(await repo.enqueue("team", tenant_id, None, reason))
    for person in await repo.subjects_for_tenant(tenant_id):
        n += int(await repo.enqueue("personal", tenant_id, person, reason))
    return n
