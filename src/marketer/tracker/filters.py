"""View filters and sorts: validation, and the SQL they compile to.

A filter is ``{"field_id", "op", "value"}`` and a sort ``{"field_id",
"direction"}``. Both are checked against the table's fields before they are
saved on a view or applied to a query. Compiling never interpolates a value
or a field id into SQL text: field ids and values are bind parameters, so a
saved view cannot inject anything.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from uuid import UUID

from .fields import FieldError, choice_by_label, choice_ids

MAX_FILTERS = 20
MAX_SORTS = 5
MAX_FILTER_TEXT = 200

_TEXT_OPS = ("contains", "not_contains", "is", "is_not", "empty", "not_empty")
OPS: dict[str, tuple[str, ...]] = {
    "text": _TEXT_OPS,
    "long_text": _TEXT_OPS,
    "url": _TEXT_OPS,
    "number": ("eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"),
    "date": ("is", "before", "after", "on_or_before", "on_or_after", "empty", "not_empty"),
    "checkbox": ("is",),
    "single_select": ("is", "is_not", "is_any_of", "empty", "not_empty"),
    "multi_select": ("has", "has_not", "empty", "not_empty"),
    "person": ("is", "is_not", "empty", "not_empty"),
    "link_row": ("has", "empty", "not_empty"),
    "marketer_link": ("is", "empty", "not_empty"),
}
_NO_VALUE = ("empty", "not_empty")
_ARRAY_TYPES = ("multi_select", "link_row")


def _field_id(raw: Any, fields: dict[str, dict[str, Any]]) -> str:
    try:
        fid = str(UUID(str(raw)))
    except (TypeError, ValueError) as e:
        raise FieldError("a filter or sort names a field that does not exist") from e
    if fid not in fields:
        raise FieldError("a filter or sort names a field that does not exist")
    return fid


def validate_filters(raw: Any, fields: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Cleaned filters. ``fields`` maps field id → field dict."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise FieldError("filters must be a list")
    if len(raw) > MAX_FILTERS:
        raise FieldError(f"a view has at most {MAX_FILTERS} filters")
    out = []
    for f in raw:
        if not isinstance(f, dict):
            raise FieldError("each filter needs a field and an operator")
        fid = _field_id(f.get("field_id"), fields)
        fld = fields[fid]
        op = f.get("op")
        if op not in OPS[fld["type"]]:
            raise FieldError(f"{fld['name']} can't be filtered with {op!r} (use {', '.join(OPS[fld['type']])})")
        value = None if op in _NO_VALUE else _filter_value(fld, op, f.get("value"))
        out.append({"field_id": fid, "op": op, "value": value})
    return out


def _filter_value(fld: dict[str, Any], op: str, value: Any) -> Any:
    ftype, name, opts = fld["type"], fld["name"], fld.get("options") or {}
    if ftype in ("text", "long_text", "url"):
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise FieldError(f"filter on {name} needs text")
        return str(value)[:MAX_FILTER_TEXT]
    if ftype == "number":
        try:
            number = float(value)
        except (TypeError, ValueError) as e:
            raise FieldError(f"filter on {name} needs a number") from e
        if isinstance(value, bool) or not math.isfinite(number):
            raise FieldError(f"filter on {name} needs a number")
        return number
    if ftype == "date":
        text = str(value or "")[:10]
        try:
            date.fromisoformat(text)
        except ValueError as e:
            raise FieldError(f"filter on {name} needs a date (YYYY-MM-DD)") from e
        return text
    if ftype == "checkbox":
        return value in (True, "true", 1, "1")
    if ftype in ("single_select", "multi_select"):
        if op == "is_any_of":
            values = value if isinstance(value, list) else [value]
            return [_choice(name, opts, v) for v in values][:50]
        return _choice(name, opts, value)
    if ftype == "person":
        if not isinstance(value, str) or not value or len(value) > 128:
            raise FieldError(f"filter on {name} needs a member")
        return value
    if ftype in ("link_row", "marketer_link"):
        try:
            return str(UUID(str(value)))
        except (TypeError, ValueError) as e:
            raise FieldError(f"filter on {name} needs an id") from e
    raise FieldError(f"{name} can't be filtered")


def _choice(name: str, opts: dict[str, Any], value: Any) -> str:
    if isinstance(value, str):
        if value in choice_ids(opts):
            return value
        cid = choice_by_label(opts, value)
        if cid:
            return cid
    raise FieldError(f"filter on {name} needs one of its options")


def validate_sorts(raw: Any, fields: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise FieldError("sorts must be a list")
    if len(raw) > MAX_SORTS:
        raise FieldError(f"a view sorts by at most {MAX_SORTS} fields")
    out, seen = [], set()
    for s in raw:
        if not isinstance(s, dict):
            raise FieldError("each sort needs a field")
        fid = _field_id(s.get("field_id"), fields)
        if fid in seen:
            continue
        direction = s.get("direction", "asc")
        if direction not in ("asc", "desc"):
            raise FieldError("sort direction is asc or desc")
        seen.add(fid)
        out.append({"field_id": fid, "direction": direction})
    return out


# --------------------------------------------------------------------------- SQL


@dataclass
class Compiled:
    where: str = "true"
    order: str = "r.position, r.created_at, r.id"
    params: list[Any] = field(default_factory=list)


class _Params:
    def __init__(self, start: int) -> None:
        self.start = start
        self.values: list[Any] = []

    def add(self, value: Any) -> str:
        self.values.append(value)
        return f"${self.start + len(self.values) - 1}"


def _like(text: str) -> str:
    return "%" + re.sub(r"([\\%_])", r"\\\1", text) + "%"


def _empty_sql(ftype: str, key: str) -> str:
    if ftype in _ARRAY_TYPES:
        return (
            f"coalesce(jsonb_array_length(case when jsonb_typeof(r.data->{key}) = 'array' "
            f"then r.data->{key} end), 0) = 0"
        )
    if ftype == "checkbox":
        return f"coalesce((r.data->>{key})::boolean, false) = false"
    return f"coalesce(r.data->>{key}, '') = ''"


def _filter_sql(f: dict[str, Any], fld: dict[str, Any], p: _Params) -> str:
    ftype, op, value = fld["type"], f["op"], f["value"]
    key = p.add(f["field_id"])
    txt = f"(r.data->>{key})"
    if op == "empty":
        return _empty_sql(ftype, key)
    if op == "not_empty":
        return f"not ({_empty_sql(ftype, key)})"
    if ftype in ("text", "long_text", "url"):
        if op == "contains":
            return f"coalesce({txt}, '') ilike {p.add(_like(value))}"
        if op == "not_contains":
            return f"coalesce({txt}, '') not ilike {p.add(_like(value))}"
        if op == "is":
            return f"lower(coalesce({txt}, '')) = lower({p.add(value)})"
        return f"lower(coalesce({txt}, '')) <> lower({p.add(value)})"
    if ftype == "number":
        sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
        expr = f"({txt})::numeric {sym} {p.add(value)}::numeric"
        return f"coalesce({expr}, false)" if op != "neq" else f"({txt} is null or {expr})"
    if ftype == "date":
        day = f"left({txt}, 10)"
        sym = {"is": "=", "before": "<", "after": ">", "on_or_before": "<=", "on_or_after": ">="}[op]
        return f"coalesce({day} {sym} {p.add(value)}, false)"
    if ftype == "checkbox":
        return f"coalesce(({txt})::boolean, false) = {p.add(bool(value))}"
    if ftype in ("single_select", "person", "marketer_link"):
        if op == "is":
            return f"coalesce({txt} = {p.add(value)}, false)"
        if op == "is_not":
            return f"coalesce({txt} <> {p.add(value)}, true)"
        return f"coalesce({txt} = any({p.add(list(value))}::text[]), false)"
    if ftype in _ARRAY_TYPES:
        has = f"coalesce(r.data->{key} @> jsonb_build_array({p.add(value)}::text), false)"
        return has if op == "has" else f"not {has}"
    raise FieldError(f"{fld['name']} can't be filtered")


def _sort_sql(s: dict[str, Any], fld: dict[str, Any], p: _Params) -> str:
    key = p.add(s["field_id"])
    ftype = fld["type"]
    txt = f"(r.data->>{key})"
    if ftype == "number":
        expr = f"({txt})::numeric"
    elif ftype == "checkbox":
        expr = f"coalesce(({txt})::boolean, false)"
    elif ftype == "single_select":
        expr = f"array_position({p.add(choice_ids(fld.get('options') or {}))}::text[], {txt})"
    elif ftype == "multi_select":
        expr = f"array_position({p.add(choice_ids(fld.get('options') or {}))}::text[], r.data->{key}->>0)"
    elif ftype == "link_row":
        expr = (
            f"coalesce(jsonb_array_length(case when jsonb_typeof(r.data->{key}) = 'array' "
            f"then r.data->{key} end), 0)"
        )
    elif ftype == "date":
        expr = txt
    else:
        expr = f"lower(nullif({txt}, ''))"
    direction = "desc" if s["direction"] == "desc" else "asc"
    return f"{expr} {direction} nulls last"


def compile_query(
    fields: dict[str, dict[str, Any]],
    *,
    filters: list[dict[str, Any]],
    filter_type: str = "and",
    sorts: list[dict[str, Any]],
    search: str = "",
    start: int = 1,
) -> Compiled:
    """WHERE and ORDER BY for rows aliased ``r``. ``start`` is the first free
    bind parameter number. Filters and sorts on fields that no longer exist
    are skipped (a field was deleted after the view was saved)."""
    p = _Params(start)
    clauses = [_filter_sql(f, fields[f["field_id"]], p) for f in filters if f["field_id"] in fields]
    joiner = " or " if filter_type == "or" else " and "
    where = f"({joiner.join(clauses)})" if clauses else "true"
    if search.strip():
        text_fields = [fid for fid, f in fields.items() if f["type"] in ("text", "long_text", "url")]
        if text_fields:
            pattern = p.add(_like(search.strip()[:MAX_FILTER_TEXT]))
            ors = " or ".join(f"coalesce(r.data->>{p.add(fid)}, '') ilike {pattern}" for fid in text_fields)
            where = f"{where} and ({ors})"
        else:
            where = f"{where} and false"
    orders = [_sort_sql(s, fields[s["field_id"]], p) for s in sorts if s["field_id"] in fields]
    order = ", ".join([*orders, "r.position", "r.created_at", "r.id"])
    return Compiled(where=where, order=order, params=p.values)
