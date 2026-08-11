"""Bulk CSV import for the scheduled-post queue.

Contract: **every row is validated before any row is written.** If one row
is bad, nothing is created and the caller gets a per-row error report.

Why all-or-nothing rather than "create the good ones, report the bad ones":
the only sane thing a user can do with a partial import is fix the file and
upload it again — and a re-upload of a file whose good rows were already
committed duplicates every one of them. There is no dedup key on a
hand-authored post that would save them. Refusing the whole file makes
re-upload the obviously correct action.

Expected columns (header row required, case/space insensitive):

    content        the post copy
    media_urls     optional; space- or pipe-separated http(s) URLs
    platforms      required; comma/pipe/space-separated
    scheduled_at   required; ISO-8601. Bare (no offset) values are read in
                   the row's `timezone` column — that is what a human
                   filling a spreadsheet means by "2026-03-09 09:00".
    timezone       optional IANA zone, default UTC
    variant_<p>    optional per-platform copy override, e.g.
                   `variant_instagram`

Multipart is parsed here with the stdlib `email` package rather than
`python-multipart`: this project deliberately ships without that
dependency (see backend/routes/templates.py), and adding one for a single
CSV upload is not worth it.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import datetime
from email import message_from_bytes
from email.policy import default as email_default
from zoneinfo import ZoneInfo

from .schemas import (
    ScheduledPostCreate,
    VariantOverride,
    normalize_platform,
)

MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_ROWS = 500

_VARIANT_PREFIX = "variant_"
_LIST_SEPARATORS = ",|;"


@dataclass
class RowError:
    row: int  # 1-based, counting the header as row 1 (what a spreadsheet shows)
    message: str


@dataclass
class ImportResult:
    posts: list[ScheduledPostCreate] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


class ImportFormatError(ValueError):
    """The upload itself is unusable (not the individual rows)."""


def extract_csv(body: bytes, content_type: str | None) -> bytes:
    """Pull the CSV payload out of a multipart body, or pass it through.

    Accepts a raw `text/csv` body too, so the endpoint is usable from curl
    and from an agent SDK without constructing a multipart envelope.
    """
    if len(body) > MAX_CSV_BYTES:
        raise ImportFormatError(f"csv larger than {MAX_CSV_BYTES} bytes")
    ctype = (content_type or "").lower()
    if not ctype.startswith("multipart/"):
        return body

    # Synthesise a minimal MIME document so the stdlib parser can find the
    # boundary (and handle quoting/CRLF) instead of us splitting by hand.
    msg = message_from_bytes(
        b"Content-Type: " + (content_type or "").encode("latin-1") + b"\r\n\r\n" + body,
        policy=email_default,
    )
    if not msg.is_multipart():
        raise ImportFormatError("malformed multipart body")
    for part in msg.iter_parts():
        disposition = part.get("content-disposition", "")
        if "filename" in disposition or 'name="file"' in disposition:
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            if len(payload) > MAX_CSV_BYTES:
                raise ImportFormatError(f"csv larger than {MAX_CSV_BYTES} bytes")
            return payload
    raise ImportFormatError("no file part in multipart body")


def _norm_header(name: str) -> str:
    return (name or "").strip().lower().replace(" ", "_").replace("-", "_")


def _split_list(raw: str) -> list[str]:
    value = raw or ""
    for sep in _LIST_SEPARATORS:
        value = value.replace(sep, " ")
    return [chunk for chunk in value.split() if chunk]


def _parse_when(raw: str, tz_name: str) -> datetime:
    text = (raw or "").strip()
    if not text:
        raise ValueError("scheduled_at is required")
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as e:
        raise ValueError(f"scheduled_at {raw!r} is not ISO-8601") from e
    if parsed.tzinfo is None:
        # A spreadsheet cell with no offset means local time in the row's
        # zone. Attaching the zone here (rather than defaulting to UTC in
        # the schema) is what makes an imported 09:00 actually 09:00 to the
        # person who typed it.
        parsed = parsed.replace(tzinfo=ZoneInfo(tz_name))
    return parsed


def parse_csv(data: bytes | str) -> ImportResult:
    """Validate an entire CSV into ScheduledPostCreate models."""
    text = data.decode("utf-8-sig") if isinstance(data, bytes) else data
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        return ImportResult(errors=[RowError(row=1, message="empty file")])

    headers = [_norm_header(h) for h in reader.fieldnames]
    missing = [c for c in ("platforms", "scheduled_at") if c not in headers]
    if missing:
        return ImportResult(
            errors=[RowError(row=1, message=f"missing required column(s): {', '.join(missing)}")]
        )

    result = ImportResult()
    for index, raw_row in enumerate(reader, start=2):  # row 1 is the header
        if len(result.posts) + len(result.errors) >= MAX_ROWS:
            result.errors.append(RowError(row=index, message=f"more than {MAX_ROWS} rows"))
            break
        row = {_norm_header(k): (v or "") for k, v in raw_row.items() if k is not None}
        if not any(v.strip() for v in row.values()):
            continue  # blank trailing line
        try:
            result.posts.append(_row_to_post(row))
        except ValueError as e:
            result.errors.append(RowError(row=index, message=_first_message(e)))
    if not result.posts and not result.errors:
        result.errors.append(RowError(row=1, message="no data rows"))
    return result


def _row_to_post(row: dict[str, str]) -> ScheduledPostCreate:
    tz_name = (row.get("timezone") or "UTC").strip() or "UTC"
    try:
        ZoneInfo(tz_name)
    except Exception as e:  # noqa: BLE001 - zoneinfo raises several types
        raise ValueError(f"unknown IANA timezone {tz_name!r}") from e

    platforms = [normalize_platform(p) for p in _split_list(row.get("platforms", ""))]
    if not platforms:
        raise ValueError("platforms is required")

    variants: dict[str, VariantOverride] = {}
    for key, value in row.items():
        if not key.startswith(_VARIANT_PREFIX) or not value.strip():
            continue
        variants[normalize_platform(key[len(_VARIANT_PREFIX):])] = VariantOverride(
            content=value
        )

    return ScheduledPostCreate(
        content=(row.get("content") or "").strip(),
        media_urls=_split_list(row.get("media_urls", "")),
        platforms=platforms,
        scheduled_at=_parse_when(row.get("scheduled_at", ""), tz_name),
        timezone=tz_name,
        variants=variants,
    )


def _first_message(exc: Exception) -> str:
    """Flatten pydantic's multi-error text to one line for the row report."""
    from pydantic import ValidationError

    if isinstance(exc, ValidationError):
        errs = exc.errors()
        if errs:
            msg = errs[0].get("msg", "invalid row")
            return msg.removeprefix("Value error, ")
    return str(exc).splitlines()[0]
