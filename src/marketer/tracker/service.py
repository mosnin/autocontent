"""Tracker: tables, fields, rows and views, scoped to one workspace.

Every function takes the tenant id (``AuthCtx.user_id``) first and every query
filters on it, so a caller can only ever see or touch its own workspace's
tables. Permissions are the route's job (backend/policy.py); this module
validates shapes, enforces limits, resolves links and writes row history.

Errors: ``NotFound`` (404), ``FieldError`` (422, a sentence for a person) and
``LimitReached`` (409).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from ..db import get_auth_pool, get_pool
from . import fields as F
from . import filters as Q
from .templates import TEMPLATES

MAX_TABLES = 50
MAX_FIELDS = 60
MAX_ROWS = 10_000
MAX_VIEWS = 30
MAX_PAGE = 500
VIEW_TYPES = ("grid", "board", "calendar", "gallery")


class NotFound(LookupError):
    pass


class LimitReached(RuntimeError):
    pass


@dataclass(frozen=True)
class Actor:
    """Who made a change, for row history (opaque ids only)."""

    id: str | None
    type: str = "user"


# --------------------------------------------------------------------------- helpers


def _j(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, (datetime, date)) else value


def _uuid_or_404(value: Any) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as e:
        raise NotFound() from e


def _table_out(r: Any) -> dict[str, Any]:
    d = dict(r)
    out = {
        "id": str(d["id"]),
        "name": d["name"],
        "description": d["description"],
        "template": d["template"],
        "created_at": _iso(d["created_at"]),
        "updated_at": _iso(d["updated_at"]),
    }
    if "row_count" in d:
        out["row_count"] = d["row_count"]
    return out


def _field_out(r: Any) -> dict[str, Any]:
    d = dict(r)
    return {
        "id": str(d["id"]),
        "table_id": str(d["table_id"]),
        "name": d["name"],
        "type": d["type"],
        "options": _j(d["options"]) or {},
        "position": d["position"],
        "is_primary": d["is_primary"],
    }


def _view_out(r: Any) -> dict[str, Any]:
    d = dict(r)
    return {
        "id": str(d["id"]),
        "table_id": str(d["table_id"]),
        "name": d["name"],
        "type": d["type"],
        "config": _j(d["config"]) or {},
        "filters": _j(d["filters"]) or [],
        "filter_type": d["filter_type"],
        "sorts": _j(d["sorts"]) or [],
        "hidden_fields": _j(d["hidden_fields"]) or [],
        "position": d["position"],
    }


def _row_out(r: Any, fields: dict[str, dict[str, Any]]) -> dict[str, Any]:
    d = dict(r)
    data = _j(d["data"]) or {}
    values = {fid: F.clean_for_read(f, data.get(fid)) for fid, f in fields.items()}
    return {
        "id": str(d["id"]),
        "table_id": str(d["table_id"]),
        "position": float(d["position"]),
        "values": values,
        "created_by": d.get("created_by"),
        "updated_by": d.get("updated_by"),
        "created_at": _iso(d["created_at"]),
        "updated_at": _iso(d["updated_at"]),
    }


async def _table_row(conn: Any, tenant: str, table_id: Any, *, lock: bool = False) -> Any:
    tid = _uuid_or_404(table_id)
    row = await conn.fetchrow(
        f"select * from tracker_tables where id = $1 and user_id = $2{' for update' if lock else ''}",
        tid, tenant,
    )
    if row is None:
        raise NotFound()
    return row


async def _fields(conn: Any, tenant: str, table_id: UUID) -> dict[str, dict[str, Any]]:
    rows = await conn.fetch(
        "select * from tracker_fields where table_id = $1 and user_id = $2 order by position, created_at",
        table_id, tenant,
    )
    return {str(r["id"]): _field_out(r) for r in rows}


# --------------------------------------------------------------------------- tables


async def list_tables(tenant: str) -> list[dict[str, Any]]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select t.*, (select count(*) from tracker_rows r where r.table_id = t.id and r.user_id = t.user_id)::int as row_count
          from tracker_tables t
         where t.user_id = $1
         order by t.created_at
        """,
        tenant,
    )
    return [_table_out(r) for r in rows]


async def create_table(
    tenant: str, actor: Actor, *, name: str, description: str = "", template: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """A table with a primary "Name" field and a grid view (unless a template
    supplies its own, through ``create_from_template``)."""
    name = name.strip()
    if not name:
        raise F.FieldError("a table needs a name")
    pool = await get_pool()
    own = conn is None
    c = conn or await pool.acquire()
    try:
        tx = c.transaction() if own else None
        if tx:
            await tx.start()
        try:
            # Serialise table creation per workspace so the limit holds.
            await c.execute("select pg_advisory_xact_lock(hashtext('tracker:' || $1))", tenant)
            n = await c.fetchval("select count(*) from tracker_tables where user_id = $1", tenant)
            if n >= MAX_TABLES:
                raise LimitReached(f"a workspace has at most {MAX_TABLES} tables")
            row = await c.fetchrow(
                """
                insert into tracker_tables (user_id, name, description, template, created_by)
                values ($1, $2, $3, $4, $5) returning *
                """,
                tenant, name[:120], description[:2000], template, actor.id,
            )
            if template is None:
                await c.execute(
                    """
                    insert into tracker_fields (user_id, table_id, name, type, position, is_primary)
                    values ($1, $2, 'Name', 'text', 0, true)
                    """,
                    tenant, row["id"],
                )
                await c.execute(
                    "insert into tracker_views (user_id, table_id, name, type) values ($1, $2, 'Grid', 'grid')",
                    tenant, row["id"],
                )
            if tx:
                await tx.commit()
        except BaseException:
            if tx:
                await tx.rollback()
            raise
    finally:
        if own:
            await pool.release(c)
    return _table_out(row)


async def get_table(tenant: str, table_id: Any) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        t = await _table_row(conn, tenant, table_id)
        fields = await _fields(conn, tenant, t["id"])
        views = await conn.fetch(
            "select * from tracker_views where table_id = $1 and user_id = $2 order by position, created_at",
            t["id"], tenant,
        )
        count = await conn.fetchval(
            "select count(*) from tracker_rows where table_id = $1 and user_id = $2", t["id"], tenant
        )
    out = _table_out(t)
    out["row_count"] = count
    out["fields"] = list(fields.values())
    out["views"] = [_view_out(v) for v in views]
    return out


async def update_table(tenant: str, table_id: Any, *, name: str | None = None, description: str | None = None) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        t = await _table_row(conn, tenant, table_id)
        if name is not None and not name.strip():
            raise F.FieldError("a table needs a name")
        row = await conn.fetchrow(
            """
            update tracker_tables
               set name = coalesce($3, name), description = coalesce($4, description), updated_at = now()
             where id = $1 and user_id = $2 returning *
            """,
            t["id"], tenant, name.strip()[:120] if name is not None else None,
            description[:2000] if description is not None else None,
        )
    return _table_out(row)


async def delete_table(tenant: str, table_id: Any) -> dict[str, Any]:
    """Delete a table, its rows, views and history, and every link field in
    the workspace that pointed at it."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id, lock=True)
        links = await conn.fetch(
            """
            select id, table_id from tracker_fields
             where user_id = $1 and type = 'link_row' and options->>'table_id' = $2 and table_id <> $3
            """,
            tenant, str(t["id"]), t["id"],
        )
        for link in links:
            await _drop_field_data(conn, tenant, link["table_id"], str(link["id"]))
        await conn.execute(
            "delete from tracker_fields where user_id = $1 and id = any($2::uuid[])",
            tenant, [link["id"] for link in links],
        )
        await conn.execute("delete from tracker_tables where id = $1 and user_id = $2", t["id"], tenant)
    return _table_out(t)


# --------------------------------------------------------------------------- fields


async def _check_link_target(conn: Any, tenant: str, options: dict[str, Any]) -> None:
    target = await conn.fetchval(
        "select id from tracker_tables where id = $1 and user_id = $2", UUID(options["table_id"]), tenant
    )
    if target is None:
        raise F.FieldError("the table to link to doesn't exist in this workspace")


async def create_field(tenant: str, table_id: Any, *, name: str, type: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    name = (name or "").strip()
    if not name or len(name) > 80:
        raise F.FieldError("a field needs a name of at most 80 characters")
    opts = F.validate_options(type, options)
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id, lock=True)
        existing = await _fields(conn, tenant, t["id"])
        if len(existing) >= MAX_FIELDS:
            raise LimitReached(f"a table has at most {MAX_FIELDS} fields")
        if any(f["name"].lower() == name.lower() for f in existing.values()):
            raise F.FieldError(f"there is already a field called {name!r}")
        if type == "link_row":
            await _check_link_target(conn, tenant, opts)
        pos = max((f["position"] for f in existing.values()), default=-1) + 1
        row = await conn.fetchrow(
            """
            insert into tracker_fields (user_id, table_id, name, type, options, position)
            values ($1, $2, $3, $4, $5::jsonb, $6) returning *
            """,
            tenant, t["id"], name, type, json.dumps(opts), pos,
        )
    return _field_out(row)


async def update_field(
    tenant: str, table_id: Any, field_id: Any, *, name: str | None = None, type: str | None = None,
    options: dict[str, Any] | None = None, position: int | None = None,
) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id, lock=True)
        fields = await _fields(conn, tenant, t["id"])
        fid = str(_uuid_or_404(field_id))
        if fid not in fields:
            raise NotFound()
        cur = fields[fid]
        new_name = cur["name"] if name is None else name.strip()
        if not new_name or len(new_name) > 80:
            raise F.FieldError("a field needs a name of at most 80 characters")
        if any(f["name"].lower() == new_name.lower() and k != fid for k, f in fields.items()):
            raise F.FieldError(f"there is already a field called {new_name!r}")
        new_type = cur["type"] if type is None else type
        if new_type != cur["type"]:
            if cur["is_primary"]:
                raise F.FieldError("the primary field stays text")
            if new_type not in F.COMPATIBLE.get(cur["type"], frozenset()):
                raise F.FieldError(
                    f"a {cur['type'].replace('_', ' ')} field can't become {new_type.replace('_', ' ')}; add a new field instead"
                )
        merged = {**cur["options"], **(options or {})} if new_type == cur["type"] else (options or cur["options"])
        opts = F.validate_options(new_type, merged)
        if new_type == "link_row" and opts.get("table_id") != cur["options"].get("table_id"):
            if cur["type"] == "link_row":
                raise F.FieldError("a link field keeps its table; add a new field instead")
        if new_type == cur["type"] == "marketer_link" and opts["kind"] != cur["options"]["kind"]:
            raise F.FieldError("a Marketer link keeps its kind; add a new field instead")
        row = await conn.fetchrow(
            """
            update tracker_fields set name = $3, type = $4, options = $5::jsonb,
                   position = coalesce($6, position), updated_at = now()
             where id = $1 and user_id = $2 returning *
            """,
            UUID(fid), tenant, new_name, new_type, json.dumps(opts), position,
        )
        if new_type != cur["type"]:
            rows = await conn.fetch(
                "select id, data from tracker_rows where table_id = $1 and user_id = $2 and data ? $3",
                t["id"], tenant, fid,
            )
            for r in rows:
                data = _j(r["data"])
                converted = F.convert_value(cur["type"], new_type, data.get(fid), opts)
                if converted is None:
                    data.pop(fid, None)
                else:
                    data[fid] = converted
                await conn.execute(
                    "update tracker_rows set data = $3::jsonb where id = $1 and user_id = $2",
                    r["id"], tenant, json.dumps(data),
                )
            # Filters written for the old type may no longer apply.
            await _scrub_views(conn, tenant, t["id"], fid, drop_filters_only=True)
    return _field_out(row)


async def _drop_field_data(conn: Any, tenant: str, table_id: UUID, fid: str) -> None:
    await conn.execute(
        "update tracker_rows set data = data - $3 where table_id = $1 and user_id = $2 and data ? $3",
        table_id, tenant, fid,
    )
    await _scrub_views(conn, tenant, table_id, fid)


async def _scrub_views(conn: Any, tenant: str, table_id: UUID, fid: str, *, drop_filters_only: bool = False) -> None:
    views = await conn.fetch("select * from tracker_views where table_id = $1 and user_id = $2", table_id, tenant)
    for v in views:
        filters = [f for f in _j(v["filters"]) or [] if f.get("field_id") != fid]
        sorts = _j(v["sorts"]) or []
        hidden = _j(v["hidden_fields"]) or []
        config = _j(v["config"]) or {}
        if not drop_filters_only:
            sorts = [s for s in sorts if s.get("field_id") != fid]
            hidden = [h for h in hidden if h != fid]
            for key in ("group_field_id", "date_field_id", "cover_field_id"):
                if config.get(key) == fid:
                    config.pop(key)
            if isinstance(config.get("card_field_ids"), list):
                config["card_field_ids"] = [c for c in config["card_field_ids"] if c != fid]
            if isinstance(config.get("field_widths"), dict):
                config["field_widths"].pop(fid, None)
        await conn.execute(
            """
            update tracker_views set filters = $3::jsonb, sorts = $4::jsonb, hidden_fields = $5::jsonb,
                   config = $6::jsonb, updated_at = now()
             where id = $1 and user_id = $2
            """,
            v["id"], tenant, json.dumps(filters), json.dumps(sorts), json.dumps(hidden), json.dumps(config),
        )


async def delete_field(tenant: str, table_id: Any, field_id: Any) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id, lock=True)
        fields = await _fields(conn, tenant, t["id"])
        fid = str(_uuid_or_404(field_id))
        if fid not in fields:
            raise NotFound()
        if fields[fid]["is_primary"]:
            raise F.FieldError("the primary field can't be deleted")
        await conn.execute("delete from tracker_fields where id = $1 and user_id = $2", UUID(fid), tenant)
        await _drop_field_data(conn, tenant, t["id"], fid)
    return fields[fid]


# --------------------------------------------------------------------------- views


def _validate_view(
    vtype: str, fields: dict[str, dict[str, Any]], *, config: dict[str, Any] | None,
    filters: Any, filter_type: str, sorts: Any, hidden: Any,
) -> dict[str, Any]:
    if vtype not in VIEW_TYPES:
        raise F.FieldError(f"view type is one of {', '.join(VIEW_TYPES)}")
    if filter_type not in ("and", "or"):
        raise F.FieldError("filter_type is and or or")
    cfg_in = dict(config or {})
    cfg: dict[str, Any] = {}

    def field_of(key: str, types: tuple[str, ...], what: str) -> None:
        raw = cfg_in.get(key)
        if raw is None:
            return
        fid = str(raw)
        if fid not in fields or fields[fid]["type"] not in types:
            raise F.FieldError(what)
        cfg[key] = fid

    field_of("group_field_id", ("single_select", "person"), "a board groups by a single select or person field")
    field_of("date_field_id", ("date",), "a calendar needs a date field")
    if vtype == "board" and "group_field_id" not in cfg:
        first = next((k for k, f in fields.items() if f["type"] == "single_select"), None)
        if first is None:
            raise F.FieldError("a board needs a single select field to group by; add one first")
        cfg["group_field_id"] = first
    if vtype == "calendar" and "date_field_id" not in cfg:
        first = next((k for k, f in fields.items() if f["type"] == "date"), None)
        if first is None:
            raise F.FieldError("a calendar needs a date field; add one first")
        cfg["date_field_id"] = first
    if isinstance(cfg_in.get("card_field_ids"), list):
        cfg["card_field_ids"] = [str(c) for c in cfg_in["card_field_ids"] if str(c) in fields][:12]
    if isinstance(cfg_in.get("field_widths"), dict):
        widths = {}
        for k, w in cfg_in["field_widths"].items():
            if str(k) in fields and isinstance(w, (int, float)) and not isinstance(w, bool):
                widths[str(k)] = int(min(640, max(80, w)))
        cfg["field_widths"] = widths
    if isinstance(cfg_in.get("field_order"), list):
        cfg["field_order"] = [str(c) for c in cfg_in["field_order"] if str(c) in fields]
    if hidden is None:
        hidden = []
    if not isinstance(hidden, list):
        raise F.FieldError("hidden_fields must be a list")
    primary = {k for k, f in fields.items() if f["is_primary"]}
    return {
        "config": cfg,
        "filters": Q.validate_filters(filters, fields),
        "filter_type": filter_type,
        "sorts": Q.validate_sorts(sorts, fields),
        "hidden_fields": [str(h) for h in hidden if str(h) in fields and str(h) not in primary],
    }


async def create_view(
    tenant: str, table_id: Any, *, name: str, type: str, config: dict[str, Any] | None = None,
    filters: Any = None, filter_type: str = "and", sorts: Any = None, hidden_fields: Any = None,
    conn: Any = None,
) -> dict[str, Any]:
    name = (name or "").strip()
    if not name or len(name) > 80:
        raise F.FieldError("a view needs a name of at most 80 characters")
    pool = await get_pool()

    async def run(c: Any) -> Any:
        t = await _table_row(c, tenant, table_id, lock=True)
        n = await c.fetchval("select count(*) from tracker_views where table_id = $1 and user_id = $2", t["id"], tenant)
        if n >= MAX_VIEWS:
            raise LimitReached(f"a table has at most {MAX_VIEWS} views")
        fields = await _fields(c, tenant, t["id"])
        v = _validate_view(type, fields, config=config, filters=filters, filter_type=filter_type, sorts=sorts, hidden=hidden_fields)
        return await c.fetchrow(
            """
            insert into tracker_views (user_id, table_id, name, type, config, filters, filter_type, sorts, hidden_fields, position)
            values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10) returning *
            """,
            tenant, t["id"], name, type, json.dumps(v["config"]), json.dumps(v["filters"]), v["filter_type"],
            json.dumps(v["sorts"]), json.dumps(v["hidden_fields"]), n,
        )

    if conn is not None:
        return _view_out(await run(conn))
    async with pool.acquire() as c, c.transaction():
        return _view_out(await run(c))


async def update_view(tenant: str, table_id: Any, view_id: Any, patch: dict[str, Any]) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id, lock=True)
        vid = _uuid_or_404(view_id)
        cur = await conn.fetchrow("select * from tracker_views where id = $1 and table_id = $2 and user_id = $3", vid, t["id"], tenant)
        if cur is None:
            raise NotFound()
        c = _view_out(cur)
        name = patch.get("name", c["name"])
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise F.FieldError("a view needs a name of at most 80 characters")
        fields = await _fields(conn, tenant, t["id"])
        config = {**c["config"], **(patch.get("config") or {})} if "config" in patch else c["config"]
        v = _validate_view(
            c["type"], fields, config=config,
            filters=patch.get("filters", c["filters"]),
            filter_type=patch.get("filter_type", c["filter_type"]),
            sorts=patch.get("sorts", c["sorts"]),
            hidden=patch.get("hidden_fields", c["hidden_fields"]),
        )
        row = await conn.fetchrow(
            """
            update tracker_views set name = $3, config = $4::jsonb, filters = $5::jsonb, filter_type = $6,
                   sorts = $7::jsonb, hidden_fields = $8::jsonb, position = coalesce($9, position), updated_at = now()
             where id = $1 and user_id = $2 returning *
            """,
            vid, tenant, name.strip(), json.dumps(v["config"]), json.dumps(v["filters"]), v["filter_type"],
            json.dumps(v["sorts"]), json.dumps(v["hidden_fields"]), patch.get("position"),
        )
    return _view_out(row)


async def delete_view(tenant: str, table_id: Any, view_id: Any) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id, lock=True)
        n = await conn.fetchval("select count(*) from tracker_views where table_id = $1 and user_id = $2", t["id"], tenant)
        vid = _uuid_or_404(view_id)
        exists = await conn.fetchval("select 1 from tracker_views where id = $1 and table_id = $2 and user_id = $3", vid, t["id"], tenant)
        if not exists:
            raise NotFound()
        if n <= 1:
            raise F.FieldError("a table keeps at least one view")
        await conn.execute("delete from tracker_views where id = $1 and user_id = $2", vid, tenant)


# --------------------------------------------------------------------------- members and Marketer objects


async def members(tenant: str) -> list[dict[str, str]]:
    """The workspace's people (for person fields): id, name and email."""
    pool = await get_auth_pool()
    try:
        rows = await pool.fetch(
            """
            select u.id, coalesce(nullif(u.name, ''), u.email) as name, u.email
              from auth.organization o
              join auth.member m on m."organizationId" = o.id
              join auth."user" u on u.id = m."userId"
             where o."tenantId" = $1
             order by lower(coalesce(nullif(u.name, ''), u.email))
            """,
            tenant,
        )
    except Exception:  # noqa: BLE001 — no auth schema (a workspace from before 0030): nobody to pick
        return []
    return [{"id": r["id"], "name": r["name"], "email": r["email"]} for r in rows]


_OBJECT_SQL: dict[str, str] = {
    "video": """
        select j.id, coalesce(j.payload->'script'->'idea'->>'hook', 'Video for ' || j.platform) as title,
               j.status::text as status, j.platform, j.scheduled_for as at, j.created_at,
               pm.views, pm.likes, pm.comments, pm.shares
          from jobs j
          left join lateral (
               select views, likes, comments, shares from post_metrics
                where job_id = j.id and user_id = j.user_id order by sampled_at desc limit 1) pm on true
         where j.user_id = $1""",
    "carousel": """
        select id, coalesce(nullif(topic, ''), case kind when 'single' then 'Image post' else 'Carousel' end) as title,
               status, kind as platform, created_at as at, created_at
          from image_posts where user_id = $1""",
    "article": """
        select id, coalesce(title, nullif(topic, ''), 'Article') as title, status::text as status,
               null::text as platform, created_at as at, created_at, word_count, slug
          from articles where user_id = $1""",
    "campaign": """
        select id, name as title, status, null::text as platform, starts_at as at, created_at,
               budget_usd, ends_at
          from campaigns where user_id = $1""",
}

_HREF = {
    "video": "/content/videos/{id}",
    "carousel": "/content/carousels/{id}",
    "article": "/seo/{id}",
    "campaign": "/distribution/campaigns/{id}",
}


def _object_out(kind: str, r: Any) -> dict[str, Any]:
    d = dict(r)
    metrics: dict[str, Any] = {}
    if kind == "video":
        metrics = {k: d.get(k) for k in ("views", "likes", "comments", "shares") if d.get(k) is not None}
    elif kind == "article" and d.get("word_count"):
        metrics = {"words": d["word_count"]}
    elif kind == "campaign":
        budget = d.get("budget_usd")
        metrics = {"budget_usd": str(budget) if isinstance(budget, Decimal) else budget}
        if d.get("ends_at"):
            metrics["ends_at"] = _iso(d["ends_at"])
    return {
        "kind": kind,
        "id": str(d["id"]),
        "title": d["title"],
        "status": d["status"],
        "platform": d.get("platform"),
        "at": _iso(d.get("at")),
        "href": _HREF[kind].format(id=d["id"]),
        "metrics": metrics,
    }


async def search_objects(tenant: str, kind: str, q: str = "", limit: int = 20) -> list[dict[str, Any]]:
    if kind not in F.MARKETER_KINDS:
        raise F.FieldError(f"kind is one of {', '.join(F.MARKETER_KINDS)}")
    pool = await get_pool()
    sql = f"select * from ({_OBJECT_SQL[kind]}) o"
    params: list[Any] = [tenant]
    if q.strip():
        sql += " where o.title ilike $2"
        params.append(Q._like(q.strip()[:100]))
    sql += f" order by o.created_at desc limit {max(1, min(int(limit), 50))}"
    rows = await pool.fetch(sql, *params)
    return [_object_out(kind, r) for r in rows]


async def resolve_objects(tenant: str, refs: dict[str, set[str]]) -> dict[str, dict[str, Any]]:
    """``{"campaign:<id>": {...}}`` for every referenced object this workspace
    owns, read live (status and metrics are current, never copied into rows)."""
    out: dict[str, dict[str, Any]] = {}
    if not any(refs.values()):
        return out
    pool = await get_pool()
    for kind, ids in refs.items():
        if not ids or kind not in _OBJECT_SQL:
            continue
        rows = await pool.fetch(
            f"select * from ({_OBJECT_SQL[kind]}) o where o.id = any($2::uuid[])",
            tenant, [UUID(i) for i in ids],
        )
        for r in rows:
            out[f"{kind}:{r['id']}"] = _object_out(kind, r)
    return out


# --------------------------------------------------------------------------- rows


def _resolve_keys(values: dict[str, Any], fields: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Accept field ids or field names (case-insensitive) as keys."""
    by_name = {f["name"].lower(): fid for fid, f in fields.items()}
    out: dict[str, Any] = {}
    for key, value in (values or {}).items():
        fid = key if key in fields else by_name.get(str(key).strip().lower())
        if fid is None:
            raise F.FieldError(f"there is no field called {key!r} (fields: {', '.join(f['name'] for f in fields.values())})")
        out[fid] = value
    return out


async def _normalize_cells(
    conn: Any, tenant: str, values: dict[str, Any], fields: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    keyed = _resolve_keys(values, fields)
    cells = {fid: F.normalize_value(fields[fid], v) for fid, v in keyed.items()}
    # Checks that need the database: membership, rows in the linked table, owned objects.
    people = {v for fid, v in cells.items() if fields[fid]["type"] == "person" and v}
    if people:
        known = {m["id"] for m in await members(tenant)}
        for fid, v in cells.items():
            if fields[fid]["type"] == "person" and v and v not in known:
                raise F.FieldError(f"{fields[fid]['name']} takes a member of this workspace")
    for fid, v in cells.items():
        f = fields[fid]
        if f["type"] == "link_row" and v:
            found = await conn.fetch(
                "select id from tracker_rows where user_id = $1 and table_id = $2 and id = any($3::uuid[])",
                tenant, UUID(f["options"]["table_id"]), [UUID(x) for x in v],
            )
            if len(found) != len(v):
                raise F.FieldError(f"{f['name']} links to a row that doesn't exist")
        if f["type"] == "marketer_link" and v:
            kind = f["options"]["kind"]
            ok = await conn.fetchval(f"select 1 from ({_OBJECT_SQL[kind]}) o where o.id = $2", tenant, UUID(v))
            if not ok:
                raise F.FieldError(f"{f['name']} links to a {kind} that doesn't exist in this workspace")
    return cells


def _jsonable(v: Any) -> Any:
    return json.loads(json.dumps(v, default=str))


async def _history(conn: Any, tenant: str, table_id: UUID, row_id: UUID, action: str, changes: dict[str, Any], actor: Actor) -> None:
    await conn.execute(
        """
        insert into tracker_row_history (user_id, table_id, row_id, action, changes, actor_id, actor_type)
        values ($1, $2, $3, $4, $5::jsonb, $6, $7)
        """,
        tenant, table_id, row_id, action, json.dumps(_jsonable(changes)), actor.id, actor.type,
    )


async def _position_before(conn: Any, tenant: str, table_id: UUID, before_id: Any, *, exclude: UUID | None = None) -> Decimal:
    """A position that sorts just before ``before_id`` (or at the end when None)."""
    if before_id is None:
        top = await conn.fetchval(
            "select max(position) from tracker_rows where table_id = $1 and user_id = $2 and ($3::uuid is null or id <> $3)",
            table_id, tenant, exclude,
        )
        return (Decimal(top) if top is not None else Decimal(0)) + 1
    bid = _uuid_or_404(before_id)
    target = await conn.fetchrow(
        "select position, created_at from tracker_rows where id = $1 and table_id = $2 and user_id = $3",
        bid, table_id, tenant,
    )
    if target is None:
        raise F.FieldError("the row to place this before doesn't exist")
    prev = await conn.fetchval(
        """
        select max(position) from tracker_rows
         where table_id = $1 and user_id = $2 and position < $3 and ($4::uuid is null or id <> $4)
        """,
        table_id, tenant, target["position"], exclude,
    )
    lo = Decimal(prev) if prev is not None else Decimal(target["position"]) - 1
    return (lo + Decimal(target["position"])) / 2


async def create_row(
    tenant: str, table_id: Any, values: dict[str, Any], actor: Actor, *, before_id: Any = None,
    conn: Any = None,
) -> dict[str, Any]:
    pool = await get_pool()

    async def run(c: Any) -> dict[str, Any]:
        t = await _table_row(c, tenant, table_id, lock=True)
        n = await c.fetchval("select count(*) from tracker_rows where table_id = $1 and user_id = $2", t["id"], tenant)
        if n >= MAX_ROWS:
            raise LimitReached(f"a table has at most {MAX_ROWS:,} rows")
        fields = await _fields(c, tenant, t["id"])
        cells = await _normalize_cells(c, tenant, values, fields)
        data = {k: v for k, v in cells.items() if v is not None}
        pos = await _position_before(c, tenant, t["id"], before_id)
        row = await c.fetchrow(
            """
            insert into tracker_rows (user_id, table_id, position, data, created_by, updated_by)
            values ($1, $2, $3, $4::jsonb, $5, $5) returning *
            """,
            tenant, t["id"], pos, json.dumps(data), actor.id,
        )
        await _history(c, tenant, t["id"], row["id"], "created", {k: {"before": None, "after": v} for k, v in data.items()}, actor)
        await c.execute("update tracker_tables set updated_at = now() where id = $1", t["id"])
        return _row_out(row, fields)

    if conn is not None:
        return await run(conn)
    async with pool.acquire() as c, c.transaction():
        return await run(c)


async def update_row(tenant: str, table_id: Any, row_id: Any, values: dict[str, Any], actor: Actor) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id)
        rid = _uuid_or_404(row_id)
        cur = await conn.fetchrow(
            "select * from tracker_rows where id = $1 and table_id = $2 and user_id = $3 for update", rid, t["id"], tenant
        )
        if cur is None:
            raise NotFound()
        fields = await _fields(conn, tenant, t["id"])
        cells = await _normalize_cells(conn, tenant, values, fields)
        data = dict(_j(cur["data"]) or {})
        changes: dict[str, Any] = {}
        for fid, v in cells.items():
            before = data.get(fid)
            after = None if v is None or (v is False and fields[fid]["type"] == "checkbox" and before is None) else v
            if before == after:
                continue
            changes[fid] = {"before": before, "after": after}
            if after is None:
                data.pop(fid, None)
            else:
                data[fid] = after
        if not changes:
            return _row_out(cur, fields)
        row = await conn.fetchrow(
            """
            update tracker_rows set data = $4::jsonb, updated_by = $5, updated_at = now()
             where id = $1 and table_id = $2 and user_id = $3 returning *
            """,
            rid, t["id"], tenant, json.dumps(data), actor.id,
        )
        await _history(conn, tenant, t["id"], rid, "updated", changes, actor)
        await conn.execute("update tracker_tables set updated_at = now() where id = $1", t["id"])
    return _row_out(row, fields)


async def move_row(tenant: str, table_id: Any, row_id: Any, *, before_id: Any = None) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id, lock=True)
        rid = _uuid_or_404(row_id)
        if before_id is not None and str(before_id) == str(rid):
            raise F.FieldError("a row can't move before itself")
        pos = await _position_before(conn, tenant, t["id"], before_id, exclude=rid)
        row = await conn.fetchrow(
            "update tracker_rows set position = $4 where id = $1 and table_id = $2 and user_id = $3 returning *",
            rid, t["id"], tenant, pos,
        )
        if row is None:
            raise NotFound()
        fields = await _fields(conn, tenant, t["id"])
    return _row_out(row, fields)


async def delete_row(tenant: str, table_id: Any, row_id: Any, actor: Actor) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        t = await _table_row(conn, tenant, table_id)
        rid = _uuid_or_404(row_id)
        row = await conn.fetchrow(
            "delete from tracker_rows where id = $1 and table_id = $2 and user_id = $3 returning *", rid, t["id"], tenant
        )
        if row is None:
            raise NotFound()
        data = _j(row["data"]) or {}
        await _history(conn, tenant, t["id"], rid, "deleted", {k: {"before": v, "after": None} for k, v in data.items()}, actor)
        # Drop the row from link fields that pointed at it.
        links = await conn.fetch(
            "select id, table_id from tracker_fields where user_id = $1 and type = 'link_row' and options->>'table_id' = $2",
            tenant, str(t["id"]),
        )
        for link in links:
            fid = str(link["id"])
            await conn.execute(
                """
                update tracker_rows
                   set data = jsonb_set(data, array[$3], coalesce(
                         (select jsonb_agg(e) from jsonb_array_elements(data->$3) e where e <> to_jsonb($4::text)),
                         '[]'::jsonb))
                 where user_id = $1 and table_id = $2 and data->$3 @> jsonb_build_array($4::text)
                """,
                tenant, link["table_id"], fid, str(rid),
            )


async def get_row(tenant: str, table_id: Any, row_id: Any, *, can_read_campaigns: bool = True) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        t = await _table_row(conn, tenant, table_id)
        rid = _uuid_or_404(row_id)
        row = await conn.fetchrow("select * from tracker_rows where id = $1 and table_id = $2 and user_id = $3", rid, t["id"], tenant)
        if row is None:
            raise NotFound()
        fields = await _fields(conn, tenant, t["id"])
        out = _row_out(row, fields)
        resolved = await _resolve(conn, tenant, [out], fields, can_read_campaigns=can_read_campaigns)
    return {"row": out, "resolved": resolved}


async def _resolve(
    conn: Any, tenant: str, rows: list[dict[str, Any]], fields: dict[str, dict[str, Any]], *, can_read_campaigns: bool
) -> dict[str, Any]:
    """Titles of linked rows and live Marketer objects for a page of rows."""
    link_targets: dict[str, set[str]] = {}
    refs: dict[str, set[str]] = {k: set() for k in F.MARKETER_KINDS}
    for r in rows:
        for fid, f in fields.items():
            v = r["values"].get(fid)
            if not v:
                continue
            if f["type"] == "link_row":
                link_targets.setdefault(f["options"]["table_id"], set()).update(v)
            elif f["type"] == "marketer_link":
                refs[f["options"]["kind"]].add(v)
    if not can_read_campaigns:
        refs["campaign"] = set()
    row_titles: dict[str, str] = {}
    for target, ids in link_targets.items():
        primary = await conn.fetchval(
            "select id::text from tracker_fields where table_id = $1 and user_id = $2 and is_primary", UUID(target), tenant
        )
        found = await conn.fetch(
            "select id, data from tracker_rows where user_id = $1 and table_id = $2 and id = any($3::uuid[])",
            tenant, UUID(target), [UUID(i) for i in ids],
        )
        for fr in found:
            title = (_j(fr["data"]) or {}).get(primary) if primary else None
            row_titles[str(fr["id"])] = str(title) if title else "Untitled"
    # Links to rows deleted since stay out of the page.
    for r in rows:
        for fid, f in fields.items():
            if f["type"] == "link_row" and r["values"].get(fid):
                r["values"][fid] = [i for i in r["values"][fid] if i in row_titles]
    return {"rows": row_titles, "objects": await resolve_objects(tenant, refs)}


async def list_rows(
    tenant: str, table_id: Any, *, view_id: Any = None, filters: Any = None, filter_type: str | None = None,
    sorts: Any = None, search: str = "", limit: int = 100, offset: int = 0, can_read_campaigns: bool = True,
) -> dict[str, Any]:
    """A page of rows. The view's saved filters and sorts apply first; ad hoc
    ``filters`` are added to them (and), ad hoc ``sorts`` replace the view's."""
    limit = max(1, min(int(limit), MAX_PAGE))
    offset = max(0, int(offset))
    pool = await get_pool()
    async with pool.acquire() as conn:
        t = await _table_row(conn, tenant, table_id)
        fields = await _fields(conn, tenant, t["id"])
        view_filters: list[dict[str, Any]] = []
        view_sorts: list[dict[str, Any]] = []
        vtype = "and"
        if view_id is not None:
            v = await conn.fetchrow(
                "select * from tracker_views where id = $1 and table_id = $2 and user_id = $3",
                _uuid_or_404(view_id), t["id"], tenant,
            )
            if v is None:
                raise NotFound()
            vo = _view_out(v)
            view_filters, view_sorts, vtype = vo["filters"], vo["sorts"], vo["filter_type"]
        extra = Q.validate_filters(filters, fields)
        chosen_sorts = Q.validate_sorts(sorts, fields) if sorts is not None else view_sorts
        base = Q.compile_query(fields, filters=view_filters, filter_type=filter_type or vtype, sorts=[], search=search, start=3)
        where = base.where
        params = [t["id"], tenant, *base.params]
        if extra:
            more = Q.compile_query(fields, filters=extra, filter_type="and", sorts=[], start=len(params) + 1)
            where = f"({where}) and {more.where}"
            params += more.params
        # Sort parameters come last so the count can leave them out.
        order = Q.compile_query(fields, filters=[], sorts=chosen_sorts, start=len(params) + 1)
        total = await conn.fetchval(
            f"select count(*) from tracker_rows r where r.table_id = $1 and r.user_id = $2 and {where}", *params
        )
        rows = await conn.fetch(
            f"""
            select r.* from tracker_rows r
             where r.table_id = $1 and r.user_id = $2 and {where}
             order by {order.order}
             limit {limit} offset {offset}
            """,
            *params, *order.params,
        )
        out = [_row_out(r, fields) for r in rows]
        resolved = await _resolve(conn, tenant, out, fields, can_read_campaigns=can_read_campaigns)
    return {"rows": out, "total": total, "limit": limit, "offset": offset, "resolved": resolved}


async def row_history(tenant: str, table_id: Any, row_id: Any, limit: int = 100) -> list[dict[str, Any]]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        t = await _table_row(conn, tenant, table_id)
        rows = await conn.fetch(
            """
            select id, action, changes, actor_id, actor_type, at from tracker_row_history
             where user_id = $1 and table_id = $2 and row_id = $3
             order by at desc, id desc limit $4
            """,
            tenant, t["id"], _uuid_or_404(row_id), max(1, min(limit, 500)),
        )
    return [
        {"id": r["id"], "action": r["action"], "changes": _j(r["changes"]), "actor_id": r["actor_id"],
         "actor_type": r["actor_type"], "at": _iso(r["at"])}
        for r in rows
    ]


# --------------------------------------------------------------------------- templates


async def create_from_template(tenant: str, actor: Actor, key: str, *, name: str | None = None) -> dict[str, Any]:
    tpl = TEMPLATES.get(key)
    if tpl is None:
        raise F.FieldError(f"unknown template {key!r}")
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        table = await create_table(
            tenant, actor, name=(name or tpl["name"]), description=tpl["description"], template=key, conn=conn
        )
        tid = UUID(table["id"])
        by_name: dict[str, str] = {}
        for i, f in enumerate(tpl["fields"]):
            opts = F.validate_options(f["type"], f.get("options"))
            row = await conn.fetchrow(
                """
                insert into tracker_fields (user_id, table_id, name, type, options, position, is_primary)
                values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning id
                """,
                tenant, tid, f["name"], f["type"], json.dumps(opts), i, i == 0,
            )
            by_name[f["name"]] = str(row["id"])
        fields = await _fields(conn, tenant, tid)

        def by_field(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [{**{k: v for k, v in it.items() if k != "field"}, "field_id": by_name[it["field"]]} for it in items]

        for v in tpl["views"]:
            cfg = dict(v.get("config") or {})
            if "group_field" in cfg:
                cfg["group_field_id"] = by_name[cfg.pop("group_field")]
            if "date_field" in cfg:
                cfg["date_field_id"] = by_name[cfg.pop("date_field")]
            await create_view(
                tenant, tid, name=v["name"], type=v["type"], config=cfg,
                filters=by_field(v.get("filters") or []), sorts=by_field(v.get("sorts") or []), conn=conn,
            )
        for values in tpl["rows"]:
            await create_row(tenant, tid, values, actor, conn=conn)
        prefill = tpl.get("prefill")
        if prefill:
            for values in await _PREFILL[prefill](conn, tenant, fields):
                await create_row(tenant, tid, values, actor, conn=conn)
    return await get_table(tenant, tid)


async def _prefill_campaigns(conn: Any, tenant: str, _fields: dict[str, Any]) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "select id, name, objective, status, budget_usd, starts_at, ends_at from campaigns where user_id = $1 order by starts_at desc limit 50",
        tenant,
    )
    stage = {"draft": "Planning", "running": "Live", "paused": "Paused", "completed": "Wrapped"}
    return [
        {
            "Campaign": r["name"],
            "Marketer campaign": str(r["id"]),
            "Stage": stage.get(r["status"], "Planning"),
            "Goal": r["objective"] or None,
            "Budget": float(r["budget_usd"]) if r["budget_usd"] is not None else None,
            "Start": r["starts_at"].date().isoformat() if r["starts_at"] else None,
            "End": r["ends_at"].date().isoformat() if r["ends_at"] else None,
        }
        for r in rows
    ]


async def _prefill_content(conn: Any, tenant: str, _fields: dict[str, Any]) -> list[dict[str, Any]]:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    videos = await conn.fetch(
        f"select * from ({_OBJECT_SQL['video']}) o where coalesce(o.at, o.created_at) >= $2 order by coalesce(o.at, o.created_at) limit 25",
        tenant, since,
    )
    articles = await conn.fetch(
        f"select * from ({_OBJECT_SQL['article']}) o where o.created_at >= $2 order by o.created_at limit 25",
        tenant, since,
    )
    channel = {"tiktok": ["TikTok"], "reels": ["Instagram"], "shorts": ["YouTube"]}

    def status(s: str, scheduled: bool) -> str:
        if s in ("done", "posted", "published"):
            return "Published"
        if s == "awaiting_approval":
            return "In review"
        return "Scheduled" if scheduled else "Drafting"

    out = [
        {
            "Title": (v["title"] or "Video")[: F.MAX_TEXT],
            "Status": status(v["status"], v["at"] is not None),
            "Channel": channel.get(v["platform"] or "", []),
            "Publish date": (v["at"] or v["created_at"]).date().isoformat(),
            "Video": str(v["id"]),
        }
        for v in videos
    ]
    out += [
        {
            "Title": (a["title"] or "Article")[: F.MAX_TEXT],
            "Status": status(a["status"], False),
            "Channel": ["Blog"],
            "Publish date": a["created_at"].date().isoformat(),
            "Article": str(a["id"]),
        }
        for a in articles
    ]
    return sorted(out, key=lambda r: r["Publish date"])


async def _prefill_posts(conn: Any, tenant: str, _fields: dict[str, Any]) -> list[dict[str, Any]]:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    posts = await conn.fetch(
        f"select * from ({_OBJECT_SQL['carousel']}) o where o.created_at >= $2 order by o.created_at limit 25",
        tenant, since,
    )
    state = {"done": "Posted", "failed": "Needs a fix", "awaiting_approval": "Draft"}
    return [
        {
            "Post": (p["title"] or "Carousel")[: F.MAX_TEXT],
            "Status": state.get(p["status"], "Scheduled"),
            "Platform": "Instagram",
            "Post date": p["created_at"].strftime("%Y-%m-%dT%H:%M"),
            "Carousel": str(p["id"]),
        }
        for p in posts
    ]


_PREFILL = {"campaigns": _prefill_campaigns, "content": _prefill_content, "posts": _prefill_posts}


# --------------------------------------------------------------------------- A/B tests (the agent's log)


async def ab_test_table(tenant: str) -> str | None:
    """The workspace's A/B test log (the oldest table made from that template)."""
    pool = await get_pool()
    tid = await pool.fetchval(
        "select id from tracker_tables where user_id = $1 and template = 'ab_tests' order by created_at limit 1", tenant
    )
    return str(tid) if tid else None


async def log_ab_test(tenant: str, actor: Actor, values: dict[str, Any], *, may_create_table: bool) -> dict[str, Any]:
    """Append a row to the A/B test log, creating the log from its template
    first when the workspace has none and the caller may create tables."""
    tid = await ab_test_table(tenant)
    created = False
    if tid is None:
        if not may_create_table:
            raise NotFound()
        tid = (await create_from_template(tenant, actor, "ab_tests"))["id"]
        created = True
    row = await create_row(tenant, tid, values, actor)
    return {"table_id": tid, "table_created": created, "row": row}
