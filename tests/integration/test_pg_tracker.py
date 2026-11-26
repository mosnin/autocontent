"""Tracker against a real Postgres: tenant isolation, field validation, links to
rows and to Marketer objects, views with filters and sorts, ordering, history,
templates with prefill, and limits (docs/tracker.md)."""
from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)

ACTOR = None


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    db._auth_pool = None
    p = await db.get_pool()
    yield p
    async with p.acquire() as conn:
        await conn.execute("delete from users")
        await conn.execute("delete from auth.organization where id like 'trk_%'")
        await conn.execute("""delete from auth."user" where id like 'trk_%'""")


async def _mkuser(pool) -> str:
    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return uid


async def _mkmember(pool, tenant: str, name: str) -> str:
    pid = f"trk_{uuid4().hex[:10]}"
    org = f"trk_org_{tenant}"
    await pool.execute(
        """insert into auth.organization (id, name, slug, "createdAt", "tenantId") values ($1, 'W', $1, now(), $2)
           on conflict (id) do nothing""",
        org, tenant,
    )
    await pool.execute(
        """insert into auth."user" (id, name, email, "emailVerified") values ($1, $2, $3, true)""",
        pid, name, f"{pid}@t.com",
    )
    await pool.execute(
        """insert into auth.member (id, "organizationId", "userId", role, "createdAt") values ($1, $2, $3, 'marketer', now())""",
        f"m_{pid}", org, pid,
    )
    return pid


def _actor():
    from marketer.tracker.service import Actor

    return Actor(id="person_1", type="user")


def _fid(table, name):
    return next(f["id"] for f in table["fields"] if f["name"] == name)


async def test_tenant_isolation(pool):
    from marketer.tracker import service as svc

    a, b = await _mkuser(pool), await _mkuser(pool)
    t = await svc.create_table(a, _actor(), name="Ideas")
    row = await svc.create_row(a, t["id"], {"Name": "secret plan"}, _actor())

    assert await svc.list_tables(b) == []
    for call in (
        svc.get_table(b, t["id"]),
        svc.list_rows(b, t["id"]),
        svc.get_row(b, t["id"], row["id"]),
        svc.update_row(b, t["id"], row["id"], {"Name": "x"}, _actor()),
        svc.delete_row(b, t["id"], row["id"], _actor()),
        svc.row_history(b, t["id"], row["id"]),
        svc.create_field(b, t["id"], name="Owner", type="text"),
        svc.create_view(b, t["id"], name="v", type="grid"),
        svc.delete_table(b, t["id"]),
        svc.create_row(b, t["id"], {"Name": "intrude"}, _actor()),
    ):
        with pytest.raises(svc.NotFound):
            await call
    # B's own table can't link to A's table, rows or campaign either.
    tb = await svc.create_table(b, _actor(), name="Mine")
    with pytest.raises(svc.F.FieldError):
        await svc.create_field(b, tb["id"], name="Link", type="link_row", options={"table_id": t["id"]})
    camp = await pool.fetchval(
        "insert into campaigns (user_id, name, budget_usd) values ($1, 'A launch', 10) returning id", a
    )
    link = await svc.create_field(b, tb["id"], name="Campaign", type="marketer_link", options={"kind": "campaign"})
    with pytest.raises(svc.F.FieldError, match="doesn't exist"):
        await svc.create_row(b, tb["id"], {link["id"]: str(camp)}, _actor())
    assert await svc.search_objects(b, "campaign") == []
    # And A's data is untouched.
    page = await svc.list_rows(a, t["id"])
    assert [r["values"][_fid(await svc.get_table(a, t["id"]), "Name")] for r in page["rows"]] == ["secret plan"]


async def test_fields_values_and_validation(pool):
    from marketer.tracker import service as svc

    uid = await _mkuser(pool)
    sam = await _mkmember(pool, uid, "Sam Rivera")
    other_tenant = await _mkuser(pool)
    stranger = await _mkmember(pool, other_tenant, "Not Here")

    t = await svc.create_table(uid, _actor(), name="Posts")
    await svc.create_field(uid, t["id"], name="Status", type="single_select", options={"choices": ["Draft", {"label": "Live", "color": "green"}]})
    await svc.create_field(uid, t["id"], name="Tags", type="multi_select", options={"choices": ["a", "b"]})
    await svc.create_field(uid, t["id"], name="Views", type="number", options={"decimals": 0})
    await svc.create_field(uid, t["id"], name="Due", type="date")
    await svc.create_field(uid, t["id"], name="Done", type="checkbox")
    await svc.create_field(uid, t["id"], name="Link", type="url")
    await svc.create_field(uid, t["id"], name="Owner", type="person")
    with pytest.raises(svc.F.FieldError, match="already"):
        await svc.create_field(uid, t["id"], name="status", type="text")
    with pytest.raises(svc.F.FieldError):
        await svc.create_field(uid, t["id"], name="Bad", type="formula")

    row = await svc.create_row(
        uid, t["id"],
        {"Name": "Spring reel", "Status": "Live", "Tags": ["a", "b", "a"], "Views": "1,204", "Due": "2026-12-01",
         "Done": True, "Link": "example.com/x", "Owner": sam},
        _actor(),
    )
    table = await svc.get_table(uid, t["id"])
    v = row["values"]
    status_choices = next(f for f in table["fields"] if f["name"] == "Status")["options"]["choices"]
    assert v[_fid(table, "Status")] == next(c["id"] for c in status_choices if c["label"] == "Live")
    assert len(v[_fid(table, "Tags")]) == 2
    assert v[_fid(table, "Views")] == 1204
    assert v[_fid(table, "Link")] == "https://example.com/x"
    assert v[_fid(table, "Owner")] == sam

    for bad in ({"Status": "Nope"}, {"Views": "lots"}, {"Due": "2026-13-40"}, {"Link": "javascript:alert(1)"},
                {"Owner": stranger}, {"Missing": 1}):
        with pytest.raises(svc.F.FieldError):
            await svc.update_row(uid, t["id"], row["id"], bad, _actor())

    # Removing an option hides it on read without rewriting rows.
    await svc.update_field(uid, t["id"], _fid(table, "Status"), options={"choices": [c for c in status_choices if c["label"] == "Draft"]})
    got = await svc.get_row(uid, t["id"], row["id"])
    assert got["row"]["values"][_fid(table, "Status")] is None

    # Compatible type change converts; incompatible is refused.
    await svc.update_field(uid, t["id"], _fid(table, "Tags"), type="single_select")
    got = await svc.get_row(uid, t["id"], row["id"])
    assert isinstance(got["row"]["values"][_fid(table, "Tags")], str)
    with pytest.raises(svc.F.FieldError, match="can't become"):
        await svc.update_field(uid, t["id"], _fid(table, "Views"), type="date")
    with pytest.raises(svc.F.FieldError):
        await svc.delete_field(uid, t["id"], _fid(table, "Name"))

    # Deleting a field removes its data and its view references.
    view = await svc.create_view(uid, t["id"], name="Done", type="grid",
                                 filters=[{"field_id": _fid(table, "Done"), "op": "is", "value": True}],
                                 hidden_fields=[_fid(table, "Done")])
    await svc.delete_field(uid, t["id"], _fid(table, "Done"))
    after = await svc.get_table(uid, t["id"])
    saved = next(x for x in after["views"] if x["id"] == view["id"])
    assert saved["filters"] == [] and saved["hidden_fields"] == []
    data = await pool.fetchval("select data from tracker_rows where id = $1", __import__("uuid").UUID(row["id"]))
    assert _fid(table, "Done") not in str(data)


async def test_links_rows_and_marketer_objects(pool):
    from marketer.tracker import service as svc

    uid = await _mkuser(pool)
    niche = await pool.fetchval(
        """insert into niches (user_id, title, description, target_audience, visual_style, voice,
             target_duration_sec, scene_count, posting_windows, platforms, daily_spend_cap_usd)
           values ($1,'t','d','a','v','onyx',30,2,'[]'::jsonb,'{tiktok}',5.0) returning id""", uid)
    camp = await pool.fetchval(
        "insert into campaigns (user_id, name, status, budget_usd) values ($1, 'Spring', 'running', 250) returning id", uid)
    job = await pool.fetchval(
        """insert into jobs (user_id, niche_id, platform, status, payload)
           values ($1, $2, 'tiktok', 'done', '{"script": {"idea": {"hook": "Pasta in 60s"}}}') returning id""", uid, niche)
    await pool.execute(
        """insert into post_metrics (user_id, job_id, provider_post_id, platform, views, likes, raw)
           values ($1, $2, 'p1', 'tiktok', 1200, 80, '{}')""", uid, job)

    briefs = await svc.create_table(uid, _actor(), name="Briefs")
    b1 = await svc.create_row(uid, briefs["id"], {"Name": "Spring brief"}, _actor())
    t = await svc.create_table(uid, _actor(), name="Content")
    rel = await svc.create_field(uid, t["id"], name="Brief", type="link_row", options={"table_id": briefs["id"]})
    cf = await svc.create_field(uid, t["id"], name="Campaign", type="marketer_link", options={"kind": "campaign"})
    vf = await svc.create_field(uid, t["id"], name="Video", type="marketer_link", options={"kind": "video"})
    row = await svc.create_row(uid, t["id"], {"Name": "Reel", "Brief": [b1["id"]], "Campaign": str(camp), "Video": str(job)}, _actor())

    page = await svc.list_rows(uid, t["id"])
    res = page["resolved"]
    assert res["rows"][b1["id"]] == "Spring brief"
    assert res["objects"][f"campaign:{camp}"]["status"] == "running"
    assert res["objects"][f"campaign:{camp}"]["metrics"]["budget_usd"] == "250.00"
    video = res["objects"][f"video:{job}"]
    assert video["title"] == "Pasta in 60s" and video["metrics"]["views"] == 1200
    # Live: a status change in Marketer shows on the next read.
    await pool.execute("update campaigns set status = 'paused' where id = $1", camp)
    page = await svc.list_rows(uid, t["id"])
    assert page["resolved"]["objects"][f"campaign:{camp}"]["status"] == "paused"
    # Without campaign:read the campaign isn't resolved.
    hidden = await svc.list_rows(uid, t["id"], can_read_campaigns=False)
    assert f"campaign:{camp}" not in hidden["resolved"]["objects"]
    # Filter by link.
    hit = await svc.list_rows(uid, t["id"], filters=[{"field_id": cf["id"], "op": "is", "value": str(camp)}])
    assert hit["total"] == 1
    assert (await svc.list_rows(uid, t["id"], filters=[{"field_id": vf["id"], "op": "empty"}]))["total"] == 0
    # Deleting the linked row removes it from the link.
    await svc.delete_row(uid, briefs["id"], b1["id"], _actor())
    got = await svc.get_row(uid, t["id"], row["id"])
    assert got["row"]["values"][rel["id"]] == []
    # Deleting the target table drops the link field.
    await svc.delete_table(uid, briefs["id"])
    assert rel["id"] not in [f["id"] for f in (await svc.get_table(uid, t["id"]))["fields"]]
    # Object search for the link picker.
    found = await svc.search_objects(uid, "video", "pasta")
    assert [o["id"] for o in found] == [str(job)]


async def test_views_filters_sorts_search_and_paging(pool):
    from marketer.tracker import service as svc

    uid = await _mkuser(pool)
    t = await svc.create_table(uid, _actor(), name="Tests")
    st = await svc.create_field(uid, t["id"], name="Status", type="single_select", options={"choices": ["Planned", "Running", "Concluded"]})
    n = await svc.create_field(uid, t["id"], name="Lift", type="number", options={"decimals": 1})
    d = await svc.create_field(uid, t["id"], name="Start", type="date")
    for i, (status, lift, start) in enumerate([("Running", 2.5, "2026-11-01"), ("Concluded", -1.0, "2026-10-01"),
                                                ("Running", 7.5, "2026-11-20"), ("Planned", None, None)]):
        await svc.create_row(uid, t["id"], {"Name": f"Test {i} hook", "Status": status, "Lift": lift, "Start": start}, _actor())

    running = await svc.create_view(uid, t["id"], name="Running", type="grid",
                                    filters=[{"field_id": st["id"], "op": "is", "value": "Running"}],
                                    sorts=[{"field_id": n["id"], "direction": "desc"}])
    page = await svc.list_rows(uid, t["id"], view_id=running["id"])
    assert page["total"] == 2
    assert [r["values"][n["id"]] for r in page["rows"]] == [7.5, 2.5]

    after = await svc.list_rows(uid, t["id"], filters=[{"field_id": d["id"], "op": "on_or_after", "value": "2026-11-01"}])
    assert after["total"] == 2
    gt = await svc.list_rows(uid, t["id"], filters=[{"field_id": n["id"], "op": "gt", "value": 0}])
    assert gt["total"] == 2
    empty = await svc.list_rows(uid, t["id"], filters=[{"field_id": n["id"], "op": "empty"}])
    assert empty["total"] == 1
    either = await svc.list_rows(uid, t["id"], filter_type="or", view_id=None,
                                 filters=None, sorts=[{"field_id": d["id"], "direction": "asc"}])
    assert either["rows"][-1]["values"][d["id"]] is None  # nulls last
    assert (await svc.list_rows(uid, t["id"], search="2 HOOK"))["total"] == 1
    paged = await svc.list_rows(uid, t["id"], limit=3, offset=3)
    assert paged["total"] == 4 and len(paged["rows"]) == 1

    # Board needs a select field; calendar picks the date field.
    board = await svc.create_view(uid, t["id"], name="Board", type="board")
    assert board["config"]["group_field_id"] == st["id"]
    cal = await svc.create_view(uid, t["id"], name="Cal", type="calendar")
    assert cal["config"]["date_field_id"] == d["id"]
    with pytest.raises(svc.F.FieldError):
        await svc.create_view(uid, t["id"], name="Bad", type="calendar", config={"date_field_id": st["id"]})
    with pytest.raises(svc.F.FieldError):
        await svc.create_view(uid, t["id"], name="Bad", type="grid", filters=[{"field_id": n["id"], "op": "contains", "value": "x"}])
    updated = await svc.update_view(uid, t["id"], running["id"], {"filter_type": "or", "hidden_fields": [d["id"]]})
    assert updated["hidden_fields"] == [d["id"]] and updated["filters"]


async def test_ordering_and_history(pool):
    from marketer.tracker import service as svc

    uid = await _mkuser(pool)
    t = await svc.create_table(uid, _actor(), name="Order")
    a = await svc.create_row(uid, t["id"], {"Name": "a"}, _actor())
    b = await svc.create_row(uid, t["id"], {"Name": "b"}, _actor())
    c = await svc.create_row(uid, t["id"], {"Name": "c"}, _actor())
    await svc.move_row(uid, t["id"], c["id"], before_id=a["id"])
    await svc.create_row(uid, t["id"], {"Name": "z"}, _actor(), before_id=b["id"])
    table = await svc.get_table(uid, t["id"])
    name = _fid(table, "Name")
    page = await svc.list_rows(uid, t["id"])
    assert [r["values"][name] for r in page["rows"]] == ["c", "a", "z", "b"]

    await svc.update_row(uid, t["id"], a["id"], {"Name": "a2"}, _actor())
    await svc.update_row(uid, t["id"], a["id"], {"Name": "a2"}, _actor())  # no-op: no history
    hist = await svc.row_history(uid, t["id"], a["id"])
    assert [h["action"] for h in hist] == ["updated", "created"]
    assert hist[0]["changes"][name] == {"before": "a", "after": "a2"}
    assert hist[0]["actor_id"] == "person_1"
    await svc.delete_row(uid, t["id"], a["id"], _actor())
    assert (await svc.row_history(uid, t["id"], a["id"]))[0]["action"] == "deleted"
    with pytest.raises(Exception, match="append-only"):
        await pool.execute("update tracker_row_history set action = 'created'")


async def test_templates_prefill_and_ab_log(pool):
    from marketer.tracker import service as svc
    from marketer.tracker.templates import TEMPLATES

    uid = await _mkuser(pool)
    await pool.execute(
        "insert into campaigns (user_id, name, objective, status, budget_usd) values ($1, 'Holiday', 'Sell gift boxes', 'running', $2)",
        uid, Decimal("500"),
    )
    for key in TEMPLATES:
        table = await svc.create_from_template(uid, _actor(), key)
        assert table["template"] == key
        assert table["fields"][0]["is_primary"]
        assert len(table["views"]) == len(TEMPLATES[key]["views"])
    tables = {t["template"]: t for t in await svc.list_tables(uid)}
    assert tables["campaigns"]["row_count"] == 1
    assert tables["launch_checklist"]["row_count"] == 8
    camp = await svc.list_rows(uid, tables["campaigns"]["id"])
    objs = camp["resolved"]["objects"]
    assert any(o["title"] == "Holiday" for o in objs.values())

    out = await svc.log_ab_test(uid, _actor(), {"Test": "Hook A vs B", "Metric": "Watch time", "Status": "Running",
                                                "Variant A": "Question hook", "Variant B": "Number hook"}, may_create_table=False)
    assert out["table_id"] == tables["ab_tests"]["id"] and not out["table_created"]

    fresh = await _mkuser(pool)
    with pytest.raises(svc.NotFound):
        await svc.log_ab_test(fresh, _actor(), {"Test": "x"}, may_create_table=False)
    made = await svc.log_ab_test(fresh, _actor(), {"Test": "x"}, may_create_table=True)
    assert made["table_created"]


async def test_limits(pool, monkeypatch):
    from marketer.tracker import service as svc

    uid = await _mkuser(pool)
    monkeypatch.setattr(svc, "MAX_ROWS", 2)
    monkeypatch.setattr(svc, "MAX_FIELDS", 2)
    monkeypatch.setattr(svc, "MAX_TABLES", 1)
    t = await svc.create_table(uid, _actor(), name="Small")
    await svc.create_row(uid, t["id"], {}, _actor())
    await svc.create_row(uid, t["id"], {}, _actor())
    with pytest.raises(svc.LimitReached):
        await svc.create_row(uid, t["id"], {}, _actor())
    await svc.create_field(uid, t["id"], name="Two", type="text")
    with pytest.raises(svc.LimitReached):
        await svc.create_field(uid, t["id"], name="Three", type="text")
    with pytest.raises(svc.LimitReached):
        await svc.create_table(uid, _actor(), name="Another")
