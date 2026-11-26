"""Tracker field types and view filters, without a database (docs/tracker.md)."""
from __future__ import annotations

import pytest

from marketer.tracker import fields as F
from marketer.tracker import filters as Q

FID = "11111111-1111-1111-1111-111111111111"
NUM = "22222222-2222-2222-2222-222222222222"
SEL = "33333333-3333-3333-3333-333333333333"
MUL = "44444444-4444-4444-4444-444444444444"
DAT = "55555555-5555-5555-5555-555555555555"


def _f(ftype, options=None, name="Field"):
    return {"type": ftype, "options": F.validate_options(ftype, options), "name": name}


def test_select_options_get_ids_colours_and_reject_duplicates():
    opts = F.validate_options("single_select", {"choices": ["Draft", {"label": "Live", "color": "green"}]})
    assert [c["label"] for c in opts["choices"]] == ["Draft", "Live"]
    assert opts["choices"][1]["color"] == "green"
    assert all(c["color"] in F.COLORS and c["id"] for c in opts["choices"])
    with pytest.raises(F.FieldError, match="twice"):
        F.validate_options("single_select", {"choices": ["A", "a"]})
    with pytest.raises(F.FieldError):
        F.validate_options("single_select", {"choices": ["x"] * 0 + [""]})
    # A colour that isn't one of ours falls back to the palette.
    odd = F.validate_options("multi_select", {"choices": [{"label": "X", "color": "#ff0000"}]})
    assert odd["choices"][0]["color"] in F.COLORS


def test_options_for_each_type():
    assert F.validate_options("number", {"decimals": 2, "prefix": "$"}) == {"decimals": 2, "prefix": "$", "suffix": ""}
    with pytest.raises(F.FieldError):
        F.validate_options("number", {"decimals": 9})
    assert F.validate_options("date", {"include_time": 1}) == {"include_time": True}
    with pytest.raises(F.FieldError):
        F.validate_options("link_row", {})
    with pytest.raises(F.FieldError):
        F.validate_options("marketer_link", {"kind": "tweet"})
    assert F.validate_options("marketer_link", {"kind": "campaign"}) == {"kind": "campaign"}
    with pytest.raises(F.FieldError):
        F.validate_options("formula", {})


@pytest.mark.parametrize(
    ("ftype", "options", "value", "stored"),
    [
        ("text", None, "a\nb", "a b"),
        ("long_text", None, "a\nb", "a\nb"),
        ("number", {"decimals": 0}, "1,204", 1204),
        ("number", {"decimals": 2}, 3.14159, 3.14),
        ("checkbox", None, None, False),
        ("checkbox", None, "true", True),
        ("date", None, "2026-12-01", "2026-12-01"),
        ("date", None, "2026-12-01T10:30:00Z", "2026-12-01"),
        ("date", {"include_time": True}, "2026-12-01T10:30:00", "2026-12-01T10:30"),
        ("url", None, "example.com/a", "https://example.com/a"),
        ("url", None, "http://localhost:3000/x", "http://localhost:3000/x"),
        ("person", None, "person_123", "person_123"),
        ("link_row", {"table_id": FID}, [FID, FID], [FID]),
        ("marketer_link", {"kind": "video"}, FID, FID),
        ("text", None, "", None),
    ],
)
def test_values_normalize(ftype, options, value, stored):
    assert F.normalize_value(_f(ftype, options), value) == stored


@pytest.mark.parametrize(
    ("ftype", "options", "value"),
    [
        ("text", None, "x" * (F.MAX_TEXT + 1)),
        ("text", None, {"a": 1}),
        ("number", None, "many"),
        ("number", None, True),
        ("number", None, float("inf")),
        ("number", None, 1e16),
        ("checkbox", None, "maybe"),
        ("date", None, "2026-02-30"),
        ("date", None, "next week"),
        ("url", None, "javascript:alert(1)"),
        ("url", None, "ftp://x.com"),
        ("url", None, "mailto:a@b.co"),
        ("single_select", {"choices": ["A"]}, "B"),
        ("multi_select", {"choices": ["A"]}, ["A", "Z"]),
        ("person", None, "<script>"),
        ("link_row", {"table_id": FID}, ["not-a-uuid"]),
        ("marketer_link", {"kind": "campaign"}, "nope"),
    ],
)
def test_bad_values_raise(ftype, options, value):
    with pytest.raises(F.FieldError):
        F.normalize_value(_f(ftype, options), value)


def test_select_values_by_label_or_id_and_read_cleanup():
    field = _f("multi_select", {"choices": ["Reels", "Shorts"]})
    ids = F.choice_ids(field["options"])
    assert F.normalize_value(field, ["shorts", ids[0], "Shorts"]) == [ids[1], ids[0]]
    assert F.clean_for_read(field, [ids[0], "gone"]) == [ids[0]]
    single = _f("single_select", {"choices": ["A"]})
    assert F.clean_for_read(single, "gone") is None


def test_type_conversion():
    assert F.convert_value("single_select", "multi_select", "x", {}) == ["x"]
    assert F.convert_value("multi_select", "single_select", ["x", "y"], {}) == "x"
    assert F.convert_value("long_text", "text", "a\nb", {}) == "a b"
    assert F.convert_value("text", "url", "not a url at all", {}) is None


# --------------------------------------------------------------------------- filters

FIELDS = {
    FID: {"type": "text", "name": "Title", "options": {}, "is_primary": True},
    NUM: {"type": "number", "name": "Views", "options": {"decimals": 0}, "is_primary": False},
    SEL: {"type": "single_select", "name": "Status", "options": {"choices": [{"id": "s1", "label": "Live", "color": "green"}, {"id": "s2", "label": "Draft", "color": "gray"}]}, "is_primary": False},
    MUL: {"type": "multi_select", "name": "Tags", "options": {"choices": [{"id": "t1", "label": "A", "color": "blue"}]}, "is_primary": False},
    DAT: {"type": "date", "name": "Due", "options": {}, "is_primary": False},
}


def test_filters_validate_against_fields():
    out = Q.validate_filters(
        [{"field_id": SEL, "op": "is", "value": "Live"}, {"field_id": NUM, "op": "gt", "value": "10"},
         {"field_id": DAT, "op": "empty", "value": "ignored"}],
        FIELDS,
    )
    assert out[0]["value"] == "s1" and out[1]["value"] == 10.0 and out[2]["value"] is None
    for bad in (
        [{"field_id": NUM, "op": "contains", "value": "x"}],
        [{"field_id": "66666666-6666-6666-6666-666666666666", "op": "is", "value": "x"}],
        [{"field_id": SEL, "op": "is", "value": "Nope"}],
        [{"field_id": DAT, "op": "is", "value": "tomorrow"}],
        "not a list",
        [{"field_id": FID, "op": "is", "value": "x"}] * (Q.MAX_FILTERS + 1),
    ):
        with pytest.raises(F.FieldError):
            Q.validate_filters(bad, FIELDS)
    assert Q.validate_sorts([{"field_id": NUM, "direction": "desc"}, {"field_id": NUM}], FIELDS) == [{"field_id": NUM, "direction": "desc"}]
    with pytest.raises(F.FieldError):
        Q.validate_sorts([{"field_id": NUM, "direction": "sideways"}], FIELDS)


def test_compiled_sql_binds_every_value_and_field_id():
    filters = Q.validate_filters(
        [{"field_id": FID, "op": "contains", "value": "50%_off'; drop table x;--"},
         {"field_id": MUL, "op": "has", "value": "A"}],
        FIELDS,
    )
    sorts = Q.validate_sorts([{"field_id": SEL, "direction": "asc"}], FIELDS)
    c = Q.compile_query(FIELDS, filters=filters, filter_type="or", sorts=sorts, search="hook", start=3)
    sql = c.where + c.order
    assert "drop table" not in sql and FID not in sql and "50%" not in sql
    assert " or " in c.where
    assert r"%50\%\_off'; drop table x;--%" in c.params
    assert c.order.startswith("array_position(")
    assert c.order.endswith("r.position, r.created_at, r.id")
    # Placeholders start where asked and are all bound.
    import re

    nums = sorted({int(n) for n in re.findall(r"\$(\d+)", sql)})
    assert nums[0] == 3 and nums[-1] == 2 + len(c.params)


def test_filters_on_deleted_fields_are_skipped():
    c = Q.compile_query({}, filters=[{"field_id": FID, "op": "is", "value": "x"}], sorts=[{"field_id": FID, "direction": "asc"}])
    assert c.where == "true" and c.params == []
