"""Tracker field types: what each type's options and cell values may be.

Pure functions, no database. The service calls ``validate_options`` when a
field is created or changed and ``normalize_value`` for every cell a person or
the agent writes; anything that needs the database (is this person a member,
does this linked row exist) is checked by the service after normalisation.

A value that fails raises ``FieldError`` with a sentence a person can act on;
the route turns it into a 422.
"""
from __future__ import annotations

import math
import re
import secrets
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

FIELD_TYPES: tuple[str, ...] = (
    "text",
    "long_text",
    "number",
    "single_select",
    "multi_select",
    "date",
    "checkbox",
    "url",
    "person",
    "link_row",
    "marketer_link",
)

# The Marketer objects a marketer_link field can point at.
MARKETER_KINDS: tuple[str, ...] = ("video", "carousel", "article", "campaign")

# Select colours: names, not hex, so both themes map them to tokens.
COLORS: tuple[str, ...] = ("gray", "blue", "green", "orange", "red", "purple", "pink", "teal", "yellow")

MAX_TEXT = 500
MAX_LONG_TEXT = 20_000
MAX_URL = 2_000
MAX_CHOICES = 100
MAX_CHOICE_LABEL = 60
MAX_MULTI = 50
MAX_LINKS = 100
MAX_NUMBER = 1e15

# Types whose value changes shape when converted are refused; these convert.
COMPATIBLE: dict[str, frozenset[str]] = {
    "text": frozenset({"long_text", "url"}),
    "long_text": frozenset({"text"}),
    "url": frozenset({"text", "long_text"}),
    "single_select": frozenset({"multi_select"}),
    "multi_select": frozenset({"single_select"}),
}

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class FieldError(ValueError):
    """A field option or cell value that is not allowed. The message is for a person."""


def new_choice_id() -> str:
    return secrets.token_hex(4)


# --------------------------------------------------------------------------- options


def validate_options(field_type: str, options: dict[str, Any] | None) -> dict[str, Any]:
    """The cleaned options for ``field_type``. Unknown keys are dropped."""
    if field_type not in FIELD_TYPES:
        raise FieldError(f"unknown field type {field_type!r}")
    opts = dict(options or {})
    if field_type in ("single_select", "multi_select"):
        return {"choices": _clean_choices(opts.get("choices") or [])}
    if field_type == "number":
        decimals = opts.get("decimals", 0)
        if not isinstance(decimals, int) or isinstance(decimals, bool) or not 0 <= decimals <= 6:
            raise FieldError("decimals must be a whole number from 0 to 6")
        prefix = str(opts.get("prefix") or "")[:4]
        suffix = str(opts.get("suffix") or "")[:4]
        return {"decimals": decimals, "prefix": prefix, "suffix": suffix}
    if field_type == "date":
        return {"include_time": bool(opts.get("include_time", False))}
    if field_type == "link_row":
        table_id = opts.get("table_id")
        try:
            return {"table_id": str(UUID(str(table_id)))}
        except (TypeError, ValueError) as e:
            raise FieldError("a link field needs the table it links to") from e
    if field_type == "marketer_link":
        kind = opts.get("kind")
        if kind not in MARKETER_KINDS:
            raise FieldError(f"kind must be one of {', '.join(MARKETER_KINDS)}")
        return {"kind": kind}
    return {}


def _clean_choices(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        raise FieldError("choices must be a list")
    if len(raw) > MAX_CHOICES:
        raise FieldError(f"a select field has at most {MAX_CHOICES} options")
    out: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    seen_labels: set[str] = set()
    for i, c in enumerate(raw):
        if isinstance(c, str):
            c = {"label": c}
        if not isinstance(c, dict):
            raise FieldError("each option needs a label")
        label = str(c.get("label") or "").strip()
        if not label:
            raise FieldError("each option needs a label")
        if len(label) > MAX_CHOICE_LABEL:
            raise FieldError(f"option labels are at most {MAX_CHOICE_LABEL} characters")
        if label.lower() in seen_labels:
            raise FieldError(f"option {label!r} is listed twice")
        cid = str(c.get("id") or "") or new_choice_id()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", cid) or cid in seen_ids:
            cid = new_choice_id()
        color = c.get("color") if c.get("color") in COLORS else COLORS[i % len(COLORS)]
        seen_ids.add(cid)
        seen_labels.add(label.lower())
        out.append({"id": cid, "label": label, "color": color})
    return out


def choice_ids(options: dict[str, Any]) -> list[str]:
    return [c["id"] for c in options.get("choices") or []]


def choice_by_label(options: dict[str, Any], label: str) -> str | None:
    want = label.strip().lower()
    for c in options.get("choices") or []:
        if c["label"].lower() == want:
            return c["id"]
    return None


# --------------------------------------------------------------------------- values


def normalize_value(field: dict[str, Any], value: Any) -> Any:
    """The stored form of ``value`` for ``field`` (``{"type", "options", "name"}``).

    ``None`` (and an empty string or list) clears a cell. Select values may be
    given as choice ids or labels (the agent writes labels); they are stored as
    ids. Raises ``FieldError``."""
    ftype = field["type"]
    opts = field.get("options") or {}
    name = field.get("name") or "field"
    if value is None or value == "" or value == []:
        return False if ftype == "checkbox" else None

    if ftype in ("text", "long_text"):
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise FieldError(f"{name} takes text")
        text = str(value)
        if ftype == "text":
            text = text.replace("\r", " ").replace("\n", " ")
        limit = MAX_TEXT if ftype == "text" else MAX_LONG_TEXT
        if len(text) > limit:
            raise FieldError(f"{name} is at most {limit:,} characters")
        return text

    if ftype == "number":
        if isinstance(value, bool):
            raise FieldError(f"{name} takes a number")
        if isinstance(value, str):
            try:
                value = float(value.replace(",", "").strip())
            except ValueError as e:
                raise FieldError(f"{name} takes a number") from e
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise FieldError(f"{name} takes a number")
        if abs(value) >= MAX_NUMBER:
            raise FieldError(f"{name} is too large")
        decimals = int(opts.get("decimals", 0))
        rounded = round(float(value), decimals)
        return int(rounded) if decimals == 0 else rounded

    if ftype == "checkbox":
        if isinstance(value, bool):
            return value
        if value in ("true", "1", 1):
            return True
        if value in ("false", "0", 0):
            return False
        raise FieldError(f"{name} is checked or not")

    if ftype == "date":
        return _normalize_date(name, value, bool(opts.get("include_time")))

    if ftype == "url":
        if not isinstance(value, str):
            raise FieldError(f"{name} takes a link")
        url = value.strip()
        if "://" not in url:
            # "mailto:x", "javascript:x": a scheme that isn't a web link
            if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", url, re.I):
                raise FieldError(f"{name} takes an http or https link")
            url = f"https://{url}"
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or " " in url:
            raise FieldError(f"{name} takes an http or https link")
        if len(url) > MAX_URL:
            raise FieldError(f"{name} is at most {MAX_URL:,} characters")
        return url

    if ftype == "single_select":
        return _choice(name, opts, value)

    if ftype == "multi_select":
        values = value if isinstance(value, list) else [value]
        if len(values) > MAX_MULTI:
            raise FieldError(f"{name} takes at most {MAX_MULTI} options")
        out: list[str] = []
        for v in values:
            cid = _choice(name, opts, v)
            if cid not in out:
                out.append(cid)
        return out

    if ftype == "person":
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value):
            raise FieldError(f"{name} takes a workspace member")
        return value

    if ftype == "link_row":
        values = value if isinstance(value, list) else [value]
        if len(values) > MAX_LINKS:
            raise FieldError(f"{name} links at most {MAX_LINKS} rows")
        out_ids: list[str] = []
        for v in values:
            rid = _uuid(name, v, "row")
            if rid not in out_ids:
                out_ids.append(rid)
        return out_ids

    if ftype == "marketer_link":
        return _uuid(name, value, opts.get("kind") or "item")

    raise FieldError(f"unknown field type {ftype!r}")


def _choice(name: str, opts: dict[str, Any], value: Any) -> str:
    if not isinstance(value, str):
        raise FieldError(f"{name} takes one of its options")
    if value in choice_ids(opts):
        return value
    by_label = choice_by_label(opts, value)
    if by_label is None:
        labels = ", ".join(c["label"] for c in opts.get("choices") or []) or "none yet"
        raise FieldError(f"{value!r} is not an option of {name} (options: {labels})")
    return by_label


def _uuid(name: str, value: Any, what: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError) as e:
        raise FieldError(f"{name} takes a {what} id") from e


def _normalize_date(name: str, value: Any, include_time: bool) -> str:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        return value.isoformat()
    elif isinstance(value, str):
        text = value.strip()
        if _DATE_RE.match(text):
            try:
                date.fromisoformat(text)
            except ValueError as e:
                raise FieldError(f"{name} takes a date (YYYY-MM-DD)") from e
            return f"{text}T00:00" if include_time else text
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as e:
            raise FieldError(f"{name} takes a date (YYYY-MM-DD)") from e
    else:
        raise FieldError(f"{name} takes a date (YYYY-MM-DD)")
    if not 1900 <= dt.year <= 2200:
        raise FieldError(f"{name} is out of range")
    # Stored without a zone: a tracker date is a calendar day (and wall time).
    return dt.strftime("%Y-%m-%dT%H:%M") if include_time else dt.date().isoformat()


def clean_for_read(field: dict[str, Any], value: Any) -> Any:
    """Drop parts of a stored value that no longer fit the field (a removed
    select option). Never raises: reads must not fail on old data."""
    ftype = field["type"]
    if value is None:
        return False if ftype == "checkbox" else None
    if ftype == "single_select":
        return value if value in choice_ids(field.get("options") or {}) else None
    if ftype == "multi_select":
        ids = set(choice_ids(field.get("options") or {}))
        return [v for v in value if v in ids] if isinstance(value, list) else []
    if ftype == "link_row":
        return value if isinstance(value, list) else []
    return value


def convert_value(old_type: str, new_type: str, value: Any, new_options: dict[str, Any]) -> Any:
    """A stored value carried across a compatible type change (``COMPATIBLE``)."""
    if value is None:
        return None
    if new_type == "multi_select" and old_type == "single_select":
        return [value]
    if new_type == "single_select" and old_type == "multi_select":
        return value[0] if isinstance(value, list) and value else None
    if new_type == "text":
        return str(value).replace("\n", " ")[:MAX_TEXT]
    if new_type == "url":
        try:
            return normalize_value({"type": "url", "options": new_options, "name": "url"}, value)
        except FieldError:
            return None
    return value
