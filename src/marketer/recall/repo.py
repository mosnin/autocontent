"""Postgres side of recall (migration 0032). Every function raises on a
database error; callers decide (routes: 503; the purge job: retry later).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from marketer.db import get_auth_pool, get_pool

# Backoff for a failed namespace delete: 1, 2, 4 ... minutes, capped at 6 hours.
_BACKOFF_MAX_MIN = 360
_CURSOR = "security_audit_log"


@dataclass(frozen=True)
class Setting:
    enabled: bool
    updated_at: datetime | None


@dataclass(frozen=True)
class PurgeRow:
    id: int
    kind: str
    tenant_id: str
    person_id: str | None
    reason: str
    attempts: int


# ----------------------------------------------------------------- the setting


async def get_setting(tenant_id: str) -> Setting:
    """Off when the tenant row does not exist (fail closed)."""
    pool = await get_pool()
    row = await pool.fetchrow("select supermemory_enabled, supermemory_updated_at from users where id = $1", tenant_id)
    if row is None:
        return Setting(False, None)
    return Setting(bool(row["supermemory_enabled"]), row["supermemory_updated_at"])


async def set_setting(tenant_id: str, enabled: bool) -> Setting:
    pool = await get_pool()
    row = await pool.fetchrow(
        "update users set supermemory_enabled = $2, supermemory_updated_at = now() where id = $1 "
        "returning supermemory_enabled, supermemory_updated_at",
        tenant_id, enabled,
    )
    if row is None:
        return Setting(False, None)
    return Setting(bool(row["supermemory_enabled"]), row["supermemory_updated_at"])


async def enabled_tenants(limit: int = 500) -> list[str]:
    pool = await get_pool()
    rows = await pool.fetch("select id from users where supermemory_enabled order by id limit $1", limit)
    return [r["id"] for r in rows]


# ----------------------------------------------------------------- subjects


async def register_subject(tenant_id: str, person_id: str, org_id: str | None) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into recall_subjects (tenant_id, person_id, org_id) values ($1, $2, $3)
        on conflict (tenant_id, person_id) do update
           set last_seen = now(), org_id = coalesce(excluded.org_id, recall_subjects.org_id)
        """,
        tenant_id, person_id, org_id or None,
    )


async def subjects_for_tenant(tenant_id: str) -> list[str]:
    pool = await get_pool()
    rows = await pool.fetch("select person_id from recall_subjects where tenant_id = $1", tenant_id)
    return [r["person_id"] for r in rows]


async def subjects_for_person(person_id: str) -> list[str]:
    pool = await get_pool()
    rows = await pool.fetch("select tenant_id from recall_subjects where person_id = $1", person_id)
    return [r["tenant_id"] for r in rows]


async def subjects_for_org(org_id: str) -> list[tuple[str, str]]:
    pool = await get_pool()
    rows = await pool.fetch("select tenant_id, person_id from recall_subjects where org_id = $1", org_id)
    return [(r["tenant_id"], r["person_id"]) for r in rows]


async def tenants_for_org(org_id: str) -> list[str]:
    pool = await get_pool()
    rows = await pool.fetch("select distinct tenant_id from recall_subjects where org_id = $1", org_id)
    return [r["tenant_id"] for r in rows]


# ----------------------------------------------------------------- the auth schema (read only)


async def is_member(tenant_id: str, person_id: str) -> bool | None:
    """True/False when the auth schema can say whether ``person_id`` is a member
    of the workspace whose tenant id is ``tenant_id``; None when that workspace
    is not in the auth schema (we then decide nothing). Raises on DB error."""
    pool = await get_auth_pool()
    row = await pool.fetchrow(
        """
        select exists(select 1 from auth.organization o where o."tenantId" = $1) as org_exists,
               exists(select 1 from auth.member m join auth.organization o on o.id = m."organizationId"
                       where o."tenantId" = $1 and m."userId" = $2) as member
        """,
        tenant_id, person_id,
    )
    if row is None or not row["org_exists"]:
        return None
    return bool(row["member"])


async def person_exists(person_id: str) -> bool:
    pool = await get_auth_pool()
    return bool(await pool.fetchval('select exists(select 1 from auth."user" where id = $1)', person_id))


async def org_exists(org_id: str) -> bool:
    pool = await get_auth_pool()
    return bool(await pool.fetchval("select exists(select 1 from auth.organization where id = $1)", org_id))


# ----------------------------------------------------------------- the purge queue


async def enqueue(kind: str, tenant_id: str, person_id: str | None, reason: str) -> bool:
    """Queue a namespace delete. Idempotent: True when a new row was queued,
    False when one is already pending."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into recall_purge_queue (kind, tenant_id, person_id, reason) values ($1, $2, $3, $4)
        on conflict (kind, tenant_id, coalesce(person_id, '')) where status = 'pending' do nothing
        returning id
        """,
        kind, tenant_id, person_id, reason,
    )
    return row is not None


async def due(limit: int = 50) -> list[PurgeRow]:
    """Pending rows whose next attempt is due, claimed for this run (their
    next attempt is pushed out so a concurrent run skips them)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        update recall_purge_queue q set next_attempt_at = now() + interval '10 minutes'
         where q.id in (select id from recall_purge_queue
                         where status = 'pending' and next_attempt_at <= now()
                         order by next_attempt_at limit $1 for update skip locked)
        returning id, kind, tenant_id, person_id, reason, attempts
        """,
        limit,
    )
    return [PurgeRow(r["id"], r["kind"], r["tenant_id"], r["person_id"], r["reason"], r["attempts"]) for r in rows]


async def mark_done(row: PurgeRow) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "update recall_purge_queue set status = 'done', done_at = now(), attempts = attempts + 1, last_error = null where id = $1",
            row.id,
        )
        if row.kind == "personal":
            await conn.execute("delete from recall_subjects where tenant_id = $1 and person_id = $2", row.tenant_id, row.person_id)
        else:
            await conn.execute("delete from recall_mirror where tenant_id = $1", row.tenant_id)


async def mark_failed(row: PurgeRow, error: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        update recall_purge_queue
           set attempts = attempts + 1, last_error = $2,
               next_attempt_at = now() + make_interval(mins => least($3, power(2, least(attempts, 12))::int))
         where id = $1
        """,
        row.id, error[:200], _BACKOFF_MAX_MIN,
    )


async def pending_count() -> int:
    pool = await get_pool()
    return int(await pool.fetchval("select count(*) from recall_purge_queue where status = 'pending'"))


# ----------------------------------------------------------------- audit cursor


async def audit_rows_after(last_id: int, limit: int = 200) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, action, org_id, tenant_id, actor_id, target_type, target_id
          from security_audit_log
         where id > $1 and outcome = 'success'
           and action in ('member.removed', 'member.left', 'workspace.deleted', 'platform.user_removed')
         order by id limit $2
        """,
        last_id, limit,
    )
    return [dict(r) for r in rows]


async def get_cursor() -> int:
    pool = await get_pool()
    return int(await pool.fetchval("select coalesce((select last_id from recall_audit_cursor where name = $1), 0)", _CURSOR))


async def set_cursor(last_id: int) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into recall_audit_cursor (name, last_id) values ($1, $2)
        on conflict (name) do update set last_id = greatest(recall_audit_cursor.last_id, excluded.last_id), updated_at = now()
        """,
        _CURSOR, last_id,
    )


# ----------------------------------------------------------------- team mirror state


async def mirror_state(tenant_id: str) -> dict[str, str]:
    pool = await get_pool()
    rows = await pool.fetch("select doc_id, content_hash from recall_mirror where tenant_id = $1", tenant_id)
    return {r["doc_id"]: r["content_hash"] for r in rows}


async def mirror_set(tenant_id: str, doc_id: str, content_hash: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into recall_mirror (tenant_id, doc_id, content_hash) values ($1, $2, $3)
        on conflict (tenant_id, doc_id) do update set content_hash = excluded.content_hash, synced_at = now()
        """,
        tenant_id, doc_id, content_hash,
    )


async def mirror_drop(tenant_id: str, doc_ids: list[str]) -> None:
    if not doc_ids:
        return
    pool = await get_pool()
    await pool.execute("delete from recall_mirror where tenant_id = $1 and doc_id = any($2::text[])", tenant_id, doc_ids)


# ----------------------------------------------------------------- governed sources (read only)


async def governed_sources(tenant_id: str, *, max_articles: int = 50) -> dict[str, str]:
    """``doc_id -> text`` for everything team memory mirrors: trusted current
    facts, the brand kit, live playbooks and published articles. Text only,
    never URLs as content (Supermemory would fetch them)."""
    pool = await get_pool()
    out: dict[str, str] = {}
    async with pool.acquire() as conn:
        facts = await conn.fetch(
            """
            select id, subject_type, subject_name, predicate, value, object_name from memory_facts
             where user_id = $1 and trust = 'trusted' and invalid_at is null and not pending
             order by valid_from desc limit 500
            """,
            tenant_id,
        )
        for f in facts:
            out[f"fact_{f['id']}"] = fact_text(f["subject_type"], f["subject_name"], f["predicate"], f["value"], f["object_name"])
        kit = await conn.fetchrow(
            "select brand_name, tagline, tone_of_voice, target_audience, banned_words, preferred_hashtags from brand_kits where user_id = $1",
            tenant_id,
        )
        if kit is not None:
            lines = [
                f"Brand name: {kit['brand_name']}" if kit["brand_name"] else "",
                f"Tagline: {kit['tagline']}" if kit["tagline"] else "",
                f"Tone of voice: {kit['tone_of_voice']}" if kit["tone_of_voice"] else "",
                f"Target audience: {kit['target_audience']}" if kit["target_audience"] else "",
                f"Banned words: {', '.join(kit['banned_words'])}" if kit["banned_words"] else "",
                f"Preferred hashtags: {', '.join(kit['preferred_hashtags'])}" if kit["preferred_hashtags"] else "",
            ]
            text = "\n".join(line for line in lines if line)
            if text:
                out["brand_kit"] = "Brand kit (confirmed by the workspace)\n" + text
        niches = await conn.fetch(
            "select id, title, description, target_audience from niches where user_id = $1 and archived_at is null order by created_at limit 100",
            tenant_id,
        )
        for n in niches:
            out[f"playbook_{n['id']}"] = f"Playbook: {n['title']}\n{n['description']}\nAudience: {n['target_audience']}"
        articles = await conn.fetch(
            """
            select id, title, meta_description, focus_keyword from articles
             where user_id = $1 and status = 'done' and title is not null
             order by created_at desc limit $2
            """,
            tenant_id, max_articles,
        )
        for a in articles:
            out[f"article_{a['id']}"] = f"Published article: {a['title']}\n{a['meta_description'] or ''}\nKeyword: {a['focus_keyword']}".strip()
    return out


def fact_text(subject_type: str, subject_name: str, predicate: str, value: str | None, object_name: str | None) -> str:
    what = value if value else (object_name or "")
    return f"Confirmed fact about {subject_type} {subject_name}: {predicate.replace('_', ' ')} = {what}"
