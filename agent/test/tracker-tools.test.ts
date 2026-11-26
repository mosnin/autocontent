/**
 * Tracker tools (src/marketer/tools/tracker.ts): request shapes, input validation before any request, the risk tier,
 * which departments hold them, and the same permissions as the backend routes (docs/tracker.md).
 */
import { type AnyAgentTool, ApprovalStore, CORE_MIGRATIONS, MigrationRunner, SECURE_DEFAULT_TENANT_CONFIG, SqlIdempotencyStore, ToolExecutor } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personRolesAndScopes } from "../src/lib/permissions.ts";
import { type Actor, personActor, toolDenial } from "../src/marketer/actor.ts";
import { DEPARTMENT_TOOLS, marketerReadTools } from "../src/marketer/tools/index.ts";
import { TOOL_PERMISSIONS } from "../src/marketer/tools/permissions.ts";
import { trackerTools } from "../src/marketer/tools/tracker.ts";

const TABLE = "3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b";
const ROW = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ENV = { PRIMARY_SAAS_API_URL: "https://api.marketer.test", SAAS_SERVICE_TOKEN: "svc-token-0123456789" };
const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

let seq = 0;
async function run(name: string, args: Record<string, unknown>, tools: AnyAgentTool[] = trackerTools()) {
  const sql = new NodeSqlStore();
  new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
  const executor = new ToolExecutor({ tools, approvals: new ApprovalStore(sql, "test-approval-secret"), idempotency: new SqlIdempotencyStore(sql) });
  seq++;
  return executor.execute(
    { id: `trk_${seq}`, name, arguments: JSON.stringify(args) },
    {
      tenant: { tenantId: "tenant_a", userId: "tenant_a", environment: "test", roles: [], scopes: [] },
      tenantConfig: SECURE_DEFAULT_TENANT_CONFIG,
      runId: "run_1",
      signal: new AbortController().signal,
      mode: "live",
      log: () => {},
      services: { env: ENV },
    },
  );
}

describe("tracker tools", () => {
  it("reads are LOW, row writes and the A/B log are MEDIUM, and nothing deletes or reshapes a table", () => {
    const tiers = Object.fromEntries(trackerTools().map((t) => [t.name, t.risk]));
    expect(tiers).toEqual({ list_trackers: "LOW", get_tracker: "LOW", list_tracker_rows: "LOW", add_tracker_row: "MEDIUM", update_tracker_row: "MEDIUM", log_ab_test: "MEDIUM" });
    expect(trackerTools().some((t) => /delete|field|view/.test(t.name))).toBe(false);
  });

  it("needs the same permissions as the backend routes", () => {
    expect(Object.fromEntries(trackerTools().map((t) => [t.name, TOOL_PERMISSIONS[t.name]]))).toEqual({
      list_trackers: "content:read",
      get_tracker: "content:read",
      list_tracker_rows: "content:read",
      add_tracker_row: "content:update",
      update_tracker_row: "content:update",
      log_ab_test: "content:update",
    });
    const actor = (role: string): Actor => personActor({ userId: `person_${role}`, ...personRolesAndScopes([role]), roles: [role] }) as Actor;
    // An analyst's session can read trackers but not write to them; billing can't read them.
    expect(toolDenial("list_tracker_rows", actor("analyst"))).toBeNull();
    expect(toolDenial("add_tracker_row", actor("analyst"))).toContain("DENIED");
    expect(toolDenial("log_ab_test", actor("marketer"))).toBeNull();
    expect(toolDenial("list_trackers", actor("billing"))).toContain("DENIED");
  });

  it("is held by the departments that make and plan work; the analyst only reads", () => {
    const holders = (name: string) => Object.entries(DEPARTMENT_TOOLS).filter(([, tools]) => tools().some((t) => t.name === name)).map(([d]) => d);
    expect(holders("add_tracker_row")).toEqual(["strategist", "content-producer", "seo-editor", "distribution-manager"]);
    expect(holders("log_ab_test")).toEqual(["strategist", "content-producer", "seo-editor", "media-buyer", "distribution-manager"]);
    expect(holders("list_tracker_rows")).toHaveLength(6);
    expect(marketerReadTools().map((t) => t.name)).toContain("list_trackers");
  });

  it("reads rows through a view with the tenant from the context", async () => {
    const outcome = await run("list_tracker_rows", { tableId: TABLE, search: "hook", limit: 20 });
    expect(outcome.status).toBe("ok");
    expect(calls[0]?.url).toBe(`https://api.marketer.test/api/v1/tracker/tables/${TABLE}/rows?q=hook&limit=20`);
    expect(calls[0]?.headers["x-tenant-id"]).toBe("tenant_a");
  });

  it("adds and updates rows with the idempotency key and values by field name", async () => {
    expect((await run("add_tracker_row", { tableId: TABLE, values: { Title: "Spring reel", Status: "Drafting", Channel: ["TikTok"], Views: 1200, Done: false } })).status).toBe("ok");
    expect(calls[0]).toMatchObject({ method: "POST", url: `https://api.marketer.test/api/v1/tracker/tables/${TABLE}/rows`, body: { values: { Title: "Spring reel", Status: "Drafting" } } });
    expect(calls[0]?.headers["idempotency-key"]).toMatch(/.+/);
    expect((await run("update_tracker_row", { tableId: TABLE, rowId: ROW, values: { Status: null } })).status).toBe("ok");
    expect(calls[1]).toMatchObject({ method: "PATCH", url: `https://api.marketer.test/api/v1/tracker/tables/${TABLE}/rows/${ROW}`, body: { values: { Status: null } } });
  });

  it("logs an A/B test under the template's field names", async () => {
    const outcome = await run("log_ab_test", { test: "Question vs number hook", hypothesis: "A question hook lifts 3s retention", variantA: "Ever wondered…", variantB: "3 ways to…", metric: "Watch time", startDate: "2026-11-26" });
    expect(outcome.status).toBe("ok");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.marketer.test/api/v1/tracker/ab-tests",
      body: { values: { Test: "Question vs number hook", Hypothesis: "A question hook lifts 3s retention", "Variant A": "Ever wondered…", "Variant B": "3 ways to…", Metric: "Watch time", Status: "Planned", "Start date": "2026-11-26" } },
    });
    expect(Object.keys((calls[0]?.body as { values: object }).values)).not.toContain("Winner");
  });

  it("refuses bad input before any request", async () => {
    for (const [name, args] of [
      ["get_tracker", { tableId: "../../admin" }],
      ["add_tracker_row", { tableId: TABLE, values: {} }],
      ["add_tracker_row", { tableId: TABLE, values: { Title: { nested: true } } }],
      ["update_tracker_row", { tableId: TABLE, rowId: "x", values: { Title: "a" } }],
      ["log_ab_test", { test: "t", hypothesis: "short", variantA: "a", variantB: "b", metric: "Vibes" }],
      ["log_ab_test", { test: "Hook test", hypothesis: "Long enough", variantA: "a", variantB: "b", metric: "Watch time", startDate: "next week" }],
    ] as const) {
      const outcome = await run(name, args as Record<string, unknown>);
      expect(outcome.status, name).not.toBe("ok");
    }
    expect(calls).toHaveLength(0);
  });
});
