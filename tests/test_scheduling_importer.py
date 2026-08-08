"""Bulk CSV import: per-row validation, the all-or-nothing contract, and
the stdlib multipart extraction.

Pure functions over bytes — no DB, no network.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from marketer.scheduling import importer

HEADER = "content,platforms,scheduled_at,timezone\n"


def _rows(result: importer.ImportResult) -> list[tuple[int, str]]:
    return [(e.row, e.message) for e in result.errors]


def _utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


# ------------------------------------------------------------ happy path


def test_parses_a_well_formed_file():
    result = importer.parse_csv(
        HEADER
        + "morning post,tiktok|instagram,2026-01-05T09:00:00Z,UTC\n"
        + "second post,linkedin,2026-01-06T09:00:00Z,UTC\n"
    )
    assert result.ok
    assert [p.content for p in result.posts] == ["morning post", "second post"]
    assert result.posts[0].platforms == ["tiktok", "instagram"]
    assert result.posts[0].scheduled_at == _utc("2026-01-05T09:00:00")


def test_bare_local_time_is_read_in_the_rows_own_timezone():
    """A spreadsheet cell with no offset means local time to whoever typed
    it. 2026-03-09 is after the US spring-forward, so 09:00 New York is
    13:00Z — not 14:00Z and certainly not 09:00Z."""
    result = importer.parse_csv(
        HEADER + "hi,tiktok,2026-03-09 09:00,America/New_York\n"
    )
    assert result.ok
    assert result.posts[0].scheduled_at == _utc("2026-03-09T13:00:00")
    # The authoring zone is retained, not collapsed away.
    assert result.posts[0].timezone == "America/New_York"


def test_bare_local_time_before_the_transition_lands_an_hour_later_in_utc():
    result = importer.parse_csv(
        HEADER + "hi,tiktok,2026-03-02 09:00,America/New_York\n"
    )
    assert result.posts[0].scheduled_at == _utc("2026-03-02T14:00:00")


def test_headers_are_case_and_separator_insensitive():
    result = importer.parse_csv(
        "Content, Platforms ,Scheduled-At,TimeZone\n"
        "hi,tiktok,2026-01-05T09:00:00Z,UTC\n"
    )
    assert result.ok
    assert result.posts[0].content == "hi"


def test_platform_aliases_are_folded_and_deduplicated():
    """`x` and `twitter` are one destination; two variant rows for one
    destination would post twice."""
    result = importer.parse_csv(
        HEADER + "hi,x;twitter shorts,2026-01-05T09:00:00Z,UTC\n"
    )
    assert result.ok
    assert result.posts[0].platforms == ["twitter", "youtube"]


def test_media_urls_split_on_spaces_and_pipes():
    result = importer.parse_csv(
        "content,media_urls,platforms,scheduled_at\n"
        "hi,https://cdn.example.com/a.png|https://cdn.example.com/b.png,"
        "tiktok,2026-01-05T09:00:00Z\n"
    )
    assert result.ok
    assert result.posts[0].media_urls == [
        "https://cdn.example.com/a.png",
        "https://cdn.example.com/b.png",
    ]


def test_variant_columns_become_per_platform_overrides():
    result = importer.parse_csv(
        "content,platforms,scheduled_at,variant_instagram,variant_linkedin\n"
        "default copy,instagram|linkedin,2026-01-05T09:00:00Z,ig copy,\n"
    )
    assert result.ok
    variants = result.posts[0].variants
    # An empty override cell is "no override", not "post empty copy".
    assert set(variants) == {"instagram"}
    assert variants["instagram"].content == "ig copy"


def test_blank_trailing_lines_are_ignored():
    result = importer.parse_csv(
        HEADER + "hi,tiktok,2026-01-05T09:00:00Z,UTC\n,,,\n\n"
    )
    assert result.ok
    assert len(result.posts) == 1


def test_utf8_bom_is_stripped():
    """Excel writes a BOM; without stripping it the first header becomes
    '\\ufeffcontent' and every file from Excel is 'missing columns'."""
    data = ("﻿" + HEADER + "hi,tiktok,2026-01-05T09:00:00Z,UTC\n").encode("utf-8")
    assert importer.parse_csv(data).ok


# --------------------------------------------------------- file-level errors


def test_empty_file_is_reported_on_row_one():
    assert _rows(importer.parse_csv("")) == [(1, "empty file")]


def test_header_only_file_reports_no_data_rows():
    assert _rows(importer.parse_csv(HEADER)) == [(1, "no data rows")]


def test_missing_required_columns_are_reported_once_not_per_row():
    result = importer.parse_csv("content\nhi\nthere\n")
    assert _rows(result) == [(1, "missing required column(s): platforms, scheduled_at")]
    assert result.posts == []


# ----------------------------------------------------------- row errors


@pytest.mark.parametrize(
    "row,fragment",
    [
        ("hi,myspace,2026-01-05T09:00:00Z,UTC", "unsupported platform"),
        ("hi,,2026-01-05T09:00:00Z,UTC", "platforms is required"),
        ("hi,tiktok,,UTC", "scheduled_at is required"),
        ("hi,tiktok,not-a-date,UTC", "not ISO-8601"),
        ("hi,tiktok,2026-01-05T09:00:00Z,Mars/Olympus", "unknown IANA timezone"),
        (",tiktok,2026-01-05T09:00:00Z,UTC", "needs content or media"),
    ],
)
def test_bad_rows_are_reported_with_their_spreadsheet_row_number(row, fragment):
    result = importer.parse_csv(HEADER + row + "\n")
    assert not result.ok
    assert result.errors[0].row == 2  # row 1 is the header, as a spreadsheet shows it
    assert fragment in result.errors[0].message


def test_variant_for_an_untargeted_platform_is_an_error():
    """Silent dead copy is the kind of thing a user only discovers after
    the post goes out wrong."""
    result = importer.parse_csv(
        "content,platforms,scheduled_at,variant_linkedin\n"
        "hi,tiktok,2026-01-05T09:00:00Z,orphan copy\n"
    )
    assert not result.ok
    assert "not in platforms" in result.errors[0].message


def test_error_messages_are_one_line():
    """The row report is a table in the UI; pydantic's multi-line text
    would blow it apart."""
    result = importer.parse_csv(HEADER + "hi,tiktok,nope,UTC\n")
    assert "\n" not in result.errors[0].message


def test_one_bad_row_poisons_the_whole_file():
    """All-or-nothing. Committing the good rows would make a corrected
    re-upload duplicate every one of them, and a hand-authored post has no
    dedup key to save the user."""
    result = importer.parse_csv(
        HEADER
        + "good,tiktok,2026-01-05T09:00:00Z,UTC\n"
        + "bad,myspace,2026-01-06T09:00:00Z,UTC\n"
    )
    assert not result.ok  # `ok` is what the route gates the writes on
    assert len(result.posts) == 1  # parsed, but never written


def test_row_cap_is_enforced():
    body = HEADER + "".join(
        f"post {i},tiktok,2026-01-05T09:00:00Z,UTC\n"
        for i in range(importer.MAX_ROWS + 10)
    )
    result = importer.parse_csv(body)
    assert not result.ok
    assert f"more than {importer.MAX_ROWS} rows" in result.errors[-1].message


# --------------------------------------------------------- multipart / raw


def _multipart(parts: list[tuple[str, bytes]], boundary: str = "BOUND") -> tuple[bytes, str]:
    """Build a minimal multipart/form-data body: [(disposition, payload)]."""
    chunks = []
    for disposition, payload in parts:
        chunks.append(
            f"--{boundary}\r\nContent-Disposition: {disposition}\r\n"
            "Content-Type: text/csv\r\n\r\n".encode() + payload + b"\r\n"
        )
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def test_raw_csv_body_passes_straight_through():
    """curl and the agent SDK post text/csv without a multipart envelope."""
    raw = (HEADER + "hi,tiktok,2026-01-05T09:00:00Z,UTC\n").encode()
    assert importer.extract_csv(raw, "text/csv") == raw
    assert importer.extract_csv(raw, None) == raw


def test_multipart_file_part_is_extracted():
    payload = (HEADER + "hi,tiktok,2026-01-05T09:00:00Z,UTC\n").encode()
    body, ctype = _multipart(
        [('form-data; name="file"; filename="posts.csv"', payload)]
    )
    assert importer.extract_csv(body, ctype) == payload


def test_multipart_ignores_other_fields_and_finds_the_file():
    payload = (HEADER + "hi,tiktok,2026-01-05T09:00:00Z,UTC\n").encode()
    body, ctype = _multipart(
        [
            ('form-data; name="dry_run"', b"true"),
            ('form-data; name="file"; filename="posts.csv"', payload),
        ]
    )
    assert importer.extract_csv(body, ctype) == payload


def test_multipart_without_a_file_part_is_refused():
    body, ctype = _multipart([('form-data; name="dry_run"', b"true")])
    with pytest.raises(importer.ImportFormatError):
        importer.extract_csv(body, ctype)


def test_oversized_upload_is_refused_before_parsing():
    with pytest.raises(importer.ImportFormatError):
        importer.extract_csv(b"x" * (importer.MAX_CSV_BYTES + 1), "text/csv")


def test_multipart_crlf_payload_round_trips():
    """A file authored on Windows arrives with CRLF line endings; csv
    handles them, and the boundary scan must not eat the last row."""
    payload = (HEADER + "hi,tiktok,2026-01-05T09:00:00Z,UTC\r\n").replace(
        "\n", "\r\n"
    ).encode()
    body, ctype = _multipart([('form-data; name="file"; filename="p.csv"', payload)])
    result = importer.parse_csv(importer.extract_csv(body, ctype))
    assert result.ok
    assert len(result.posts) == 1
