// Tests for the Tracker's pure helpers (lib/tracker.ts): display text, the
// board's columns, the calendar grid, filters, and the request path. Run with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { AB, CAL, FX_AB, FX_AB_ROWS, FX_CALENDAR, FX_CALENDAR_ROWS, FX_TRACKER_MEMBERS, FX_TRACKER_OBJECTS } from "../lib/fixtures-tracker.ts";
import { boardColumns, cellText, completeFilters, describeFilter, formatDate, formatNumber, matchesFilter, monthGrid, moveToDay, rowsByDay, rowsPath, rowTitle, visibleFields, type TrackerField } from "../lib/tracker.ts";

const f = (name: string) => FX_CALENDAR.fields.find((x) => x.name === name)!;
const ab = (name: string) => FX_AB.fields.find((x) => x.name === name)!;
const resolved = { rows: {}, objects: Object.fromEntries(FX_TRACKER_OBJECTS.map((o) => [`${o.kind}:${o.id}`, o])) };

test("cells read as plain text for every type", () => {
  const r = FX_CALENDAR_ROWS[0]!;
  assert.equal(cellText(f("Status"), r.values[f("Status").id]!), "Published");
  assert.equal(cellText(f("Channel"), r.values[f("Channel").id]!), "TikTok, Instagram");
  assert.equal(cellText(f("Publish date"), r.values[f("Publish date").id]!), "Nov 24, 2026");
  assert.equal(cellText(f("Owner"), r.values[f("Owner").id]!, { members: FX_TRACKER_MEMBERS }), "Ana Okafor");
  assert.equal(cellText(f("Video"), r.values[f("Video").id]!, { resolved }), "Cacio e pepe in 60 seconds");
  assert.equal(cellText(ab("Lift"), 18.4), "18.4%");
  assert.equal(cellText(f("Notes"), null), "");
  assert.equal(rowTitle(FX_CALENDAR, r), "Cacio e pepe in 60 seconds");
});

test("numbers and dates format without shifting the day", () => {
  const budget: TrackerField = { id: "b", table_id: "t", name: "Budget", type: "number", options: { decimals: 2, prefix: "$" }, position: 0, is_primary: false };
  assert.equal(formatNumber(budget, 1200), "$1,200.00");
  assert.equal(formatNumber(budget, "x"), "");
  assert.equal(formatDate("2026-01-01"), "Jan 1, 2026");
  assert.equal(formatDate("2026-12-31T23:30", true), "Dec 31, 2026 23:30");
  assert.equal(formatDate("soon"), "");
});

test("a board has a column per option, in option order, and a no-value column only when needed", () => {
  const cols = boardColumns(f("Status"), FX_CALENDAR_ROWS);
  assert.deepEqual(cols.map((c) => c.label), ["Idea", "Drafting", "In review", "Scheduled", "Published"]);
  assert.equal(cols.find((c) => c.label === "Published")!.rows.length, 3);
  const withBlank = boardColumns(f("Status"), [...FX_CALENDAR_ROWS, { ...FX_CALENDAR_ROWS[0]!, id: "x", values: {} }]);
  assert.equal(withBlank[0]!.label, "No status");
  assert.equal(withBlank[0]!.id, null);
  const people = boardColumns(f("Owner"), FX_CALENDAR_ROWS, FX_TRACKER_MEMBERS);
  assert.deepEqual(people.map((c) => c.label), ["Sam Rivera", "Ana Okafor", "Lee Chen"]);
});

test("the month grid starts on Monday and covers six weeks", () => {
  const days = monthGrid(2026, 11); // December 2026 starts on a Tuesday
  assert.equal(days.length, 42);
  assert.equal(days[0], "2026-11-30");
  assert.equal(days[1], "2026-12-01");
  const byDay = rowsByDay(f("Publish date"), FX_CALENDAR_ROWS);
  assert.equal(byDay.get("2026-11-24")!.length, 1);
  assert.equal([...byDay.values()].flat().length, 8); // one row has no date
});

test("moving to another day keeps the time of day", () => {
  const timed: TrackerField = { ...f("Publish date"), options: { include_time: true } };
  assert.equal(moveToDay(timed, "2026-11-24T17:30", "2026-11-26"), "2026-11-26T17:30");
  assert.equal(moveToDay(timed, null, "2026-11-26"), "2026-11-26T09:00");
  assert.equal(moveToDay(f("Publish date"), "2026-11-24", "2026-11-26"), "2026-11-26");
});

test("client-side filters match the server's meaning", () => {
  const status = ab("Status");
  const lift = ab("Lift");
  const running = FX_AB_ROWS.filter((r) => matchesFilter(status, { field_id: status.id, op: "is", value: "a2" }, r.values[status.id] ?? null));
  assert.equal(running.length, 1);
  assert.equal(FX_AB_ROWS.filter((r) => matchesFilter(lift, { field_id: lift.id, op: "gt", value: 0 }, r.values[lift.id] ?? null)).length, 1);
  assert.equal(FX_AB_ROWS.filter((r) => matchesFilter(lift, { field_id: lift.id, op: "empty", value: null }, r.values[lift.id] ?? null)).length, 2);
  const channel = f("Channel");
  assert.equal(FX_CALENDAR_ROWS.filter((r) => matchesFilter(channel, { field_id: channel.id, op: "has", value: "c4" }, r.values[channel.id] ?? null)).length, 2);
  assert.equal(describeFilter(FX_AB.fields, { field_id: status.id, op: "is", value: "a2" }), "Status is Running");
  assert.equal(completeFilters([{ field_id: lift.id, op: "gt", value: "" }, { field_id: lift.id, op: "empty", value: null }]).length, 1);
});

test("hidden fields drop out, the primary field always shows first", () => {
  const hidden = [f("Notes").id, f("Title").id];
  const shown = visibleFields(FX_CALENDAR, { hidden_fields: hidden, config: { field_order: [f("Owner").id] } });
  assert.equal(shown[0]!.name, "Title");
  assert.equal(shown[1]!.name, "Owner");
  assert.ok(!shown.some((x) => x.name === "Notes"));
});

test("the rows path carries filters, sorts and search as query parameters", () => {
  const path = rowsPath(CAL, { filters: [{ field_id: "f1", op: "is", value: "x" }], filterType: "or", sorts: [{ field_id: "f1", direction: "desc" }], q: "pasta & co", limit: 50 });
  const url = new URL(`https://x${path}`);
  assert.equal(url.pathname, `/api/v1/tracker/tables/${CAL}/rows`);
  assert.deepEqual(JSON.parse(url.searchParams.get("filters")!), [{ field_id: "f1", op: "is", value: "x" }]);
  assert.equal(url.searchParams.get("filter_type"), "or");
  assert.equal(url.searchParams.get("q"), "pasta & co");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.ok(!rowsPath(AB).includes("filters="));
});
