import type { AnyAgentTool } from "@agent-starter/core";
import * as v from "valibot";
import { limit, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";

/**
 * Tracker: the workspace's own tables (content calendar, social posts, A/B test log, campaigns, launch checklist,
 * creative briefs). docs/tracker.md, backend/routes/tracker.py.
 *   GET   /tracker/tables                              tables with row counts
 *   GET   /tracker/tables/{id}                         fields (names, types, select options) and views
 *   GET   /tracker/tables/{id}/rows?q=&view_id=&limit= a page of rows, with linked rows and live Marketer objects
 *   POST  /tracker/tables/{id}/rows {values}           add a row (values keyed by field name or id)
 *   PATCH /tracker/tables/{id}/rows/{row} {values}     change cells
 *   POST  /tracker/ab-tests {values}                   append to the A/B test log (created from its template if missing)
 *
 * Rows are the team's own records: nothing is published and no money moves, so writes are MEDIUM (the lowest write
 * tier). The agent never deletes rows or tables, and never changes a table's fields or views: those stay with people.
 */

/** One cell: text, a number, checked or not, a date string, option labels, ids, or null to clear it. */
const cell = v.union([
  v.pipe(v.string(), v.maxLength(20_000)),
  v.pipe(v.number(), v.finite()),
  v.boolean(),
  v.null(),
  v.pipe(v.array(v.pipe(v.string(), v.maxLength(128))), v.maxLength(100)),
]);

const values = v.pipe(
  v.record(v.pipe(v.string(), v.minLength(1), v.maxLength(80)), cell),
  v.check((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 60, "values needs 1 to 60 fields"),
);

export const listTrackers = readTool({
  name: "list_trackers",
  description: "List the workspace's tracker tables (content calendar, social posts, A/B test log, campaigns, launch checklist, creative briefs, or the team's own) with their ids and row counts.",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/tracker/tables" }),
});

export const getTracker = readTool({
  name: "get_tracker",
  description: "Read one tracker table's fields (name, type, select options with their labels) and saved views. Read this before adding or changing rows so values use the right field names and option labels.",
  input: v.object({ tableId: uuid("tableId") }),
  request: ({ tableId }) => ({ method: "GET", path: `/tracker/tables/${seg(tableId)}` }),
});

export const listTrackerRows = readTool({
  name: "list_tracker_rows",
  description: "Read rows of a tracker table, optionally through a saved view (its filters and sorts) or a text search. Cell values are keyed by field id (see get_tracker); select cells hold option ids, linked Marketer objects come back live under resolved.objects (status and metrics).",
  input: v.object({ tableId: uuid("tableId"), viewId: v.optional(uuid("viewId")), search: v.optional(v.pipe(v.string(), v.maxLength(200))), limit: limit(200, 50) }),
  maxOutputChars: 30_000,
  request: ({ tableId, viewId, search, limit: n }) => ({ method: "GET", path: `/tracker/tables/${seg(tableId)}/rows`, query: { view_id: viewId, q: search, limit: n } }),
});

export const addTrackerRow = writeTool({
  name: "add_tracker_row",
  description: "Add a row to a tracker table. `values` maps field names (or ids) to values: text, numbers, true/false, dates as YYYY-MM-DD, select options by label, people by member id, Marketer links by the object's id. Unknown fields or options are refused with the valid ones listed.",
  input: v.object({ tableId: uuid("tableId"), values }),
  risk: "MEDIUM",
  request: ({ tableId, values: cells }) => ({ method: "POST", path: `/tracker/tables/${seg(tableId)}/rows`, body: { values: cells } }),
});

export const updateTrackerRow = writeTool({
  name: "update_tracker_row",
  description: "Change cells of one tracker row (only the fields you pass; null clears a cell). Same value rules as add_tracker_row. Every change is kept in the row's history with who made it.",
  input: v.object({ tableId: uuid("tableId"), rowId: uuid("rowId"), values }),
  risk: "MEDIUM",
  // A PATCH of the same cells is a full replace of those cells: a replay changes nothing.
  idempotent: true,
  request: ({ tableId, rowId, values: cells }) => ({ method: "PATCH", path: `/tracker/tables/${seg(tableId)}/rows/${seg(rowId)}`, body: { values: cells } }),
});

export const logAbTest = writeTool({
  name: "log_ab_test",
  description: "Log an A/B test in the workspace's A/B test log (created from its template the first time). Fields: Test, Hypothesis, Variant A, Variant B, Metric (Click-through rate, Conversion rate, Watch time, Engagement rate, Cost per acquisition, Open rate), Status (Planned, Running, Concluded), Result, Winner (A, B, No difference), Decision (Ship A, Ship B, Iterate, Drop), Start date, End date, Campaign (a campaign id). Log a test when you plan it, then update_tracker_row with the result.",
  input: v.object({
    test: v.pipe(v.string(), v.minLength(3), v.maxLength(500)),
    hypothesis: v.pipe(v.string(), v.minLength(5), v.maxLength(2_000)),
    variantA: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
    variantB: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
    metric: v.picklist(["Click-through rate", "Conversion rate", "Watch time", "Engagement rate", "Cost per acquisition", "Open rate"]),
    status: v.optional(v.picklist(["Planned", "Running", "Concluded"]), "Planned"),
    result: v.optional(v.pipe(v.string(), v.maxLength(2_000))),
    winner: v.optional(v.picklist(["A", "B", "No difference"])),
    decision: v.optional(v.picklist(["Ship A", "Ship B", "Iterate", "Drop"])),
    startDate: v.optional(v.pipe(v.string(), v.isoDate())),
    endDate: v.optional(v.pipe(v.string(), v.isoDate())),
    campaignId: v.optional(uuid("campaignId")),
  }),
  risk: "MEDIUM",
  request: (a) => ({
    method: "POST",
    path: "/tracker/ab-tests",
    body: {
      values: Object.fromEntries(
        Object.entries({
          Test: a.test,
          Hypothesis: a.hypothesis,
          "Variant A": a.variantA,
          "Variant B": a.variantB,
          Metric: a.metric,
          Status: a.status,
          Result: a.result,
          Winner: a.winner,
          Decision: a.decision,
          "Start date": a.startDate,
          "End date": a.endDate,
          Campaign: a.campaignId,
        }).filter(([, value]) => value !== undefined),
      ),
    },
  }),
});

/** Read-only tracker tools (any department may look at the team's trackers). */
export function trackerReadTools(): AnyAgentTool[] {
  return [listTrackers, getTracker, listTrackerRows];
}

/** Reads plus adding and changing rows and logging A/B tests. */
export function trackerTools(): AnyAgentTool[] {
  return [...trackerReadTools(), addTrackerRow, updateTrackerRow, logAbTest];
}
