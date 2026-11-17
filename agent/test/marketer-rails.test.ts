/**
 * Execution rails, agent side (src/marketer/rails/*, docs/rails/*): the reviewed table covers exactly the HIGH and
 * CRITICAL tools, writeTool refuses unregistered or loosened tools, the truth table holds row by row, the canonical
 * hash matches the backend's vectors, and through the real ToolExecutor: an approved call runs once, the kill switch
 * stops spend but never a pause, approvals stay bound to their arguments, and an unknown outcome is never retried.
 */
import { AgentError, type AnyAgentTool, ApprovalStore, CORE_MIGRATIONS, HttpError, MigrationRunner, SECURE_DEFAULT_TENANT_CONFIG, SqlIdempotencyStore, ToolExecutor } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import * as v from "valibot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalHash, canonicalJson, evaluateAgentDispatch, isDefiniteRejection, parseKillSwitch, RAILS_MAX_DAILY_BUDGET_USD, RAILS_TOOLS, railsEntry } from "../src/marketer/rails/index.ts";
import { adsTools, MAX_DAILY_BUDGET_USD } from "../src/marketer/tools/ads.ts";
import { writeTool } from "../src/marketer/tools/define.ts";
import { DEPARTMENT_TOOLS } from "../src/marketer/tools/index.ts";

const UUID = "3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b";
const BASE_ENV = { PRIMARY_SAAS_API_URL: "https://api.marketer.test", SAAS_SERVICE_TOKEN: "svc-token-0123456789" };
let fetchImpl: () => Promise<Response>;
const fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls.length = 0;
  fetchImpl = async () => Response.json({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetchCalls.push(url);
      return fetchImpl();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const allTools = (): AnyAgentTool[] => {
  const byName = new Map<string, AnyAgentTool>();
  for (const tools of Object.values(DEPARTMENT_TOOLS)) for (const tool of tools()) byName.set(tool.name, tool);
  return [...byName.values()];
};

describe("rails table", () => {
  it("covers exactly the HIGH and CRITICAL tools, with the same tiers", () => {
    const railed = Object.fromEntries(allTools().filter((t) => t.risk === "HIGH" || t.risk === "CRITICAL").map((t) => [t.name, t.risk]));
    expect(Object.fromEntries(Object.entries(RAILS_TOOLS).map(([name, e]) => [name, e.tier]))).toEqual(railed);
  });

  it("keeps the agent ceiling equal to the ads tools' ceiling, and every CRITICAL tool approval-gated", () => {
    expect(RAILS_MAX_DAILY_BUDGET_USD).toBe(MAX_DAILY_BUDGET_USD);
    for (const tool of allTools().filter((t) => t.risk === "CRITICAL")) expect(tool.requiresApproval, tool.name).toBe(true);
  });

  it("never retries a HIGH/CRITICAL tool automatically", () => {
    for (const tool of allTools().filter((t) => t.risk === "HIGH" || t.risk === "CRITICAL")) expect(tool.retry?.maxAttempts, tool.name).toBe(1);
    for (const tool of allTools().filter((t) => t.risk === "MEDIUM")) expect(tool.retry, tool.name).toBeUndefined();
  });

  it("refuses to define an unregistered, loosened or unapproved HIGH/CRITICAL tool", () => {
    const base = { description: "x", input: v.object({}), request: () => ({ method: "POST" as const, path: "/x" }) };
    expect(() => writeTool({ ...base, name: "publish_everything", risk: "HIGH" })).toThrow(/not in the rails table/);
    expect(() => writeTool({ ...base, name: "set_ad_budget", risk: "HIGH" })).toThrow(/reviews it as CRITICAL/);
    expect(() => writeTool({ ...base, name: "set_ad_budget", risk: "CRITICAL" })).toThrow(/requiresApproval/);
    expect(() => writeTool({ ...base, name: "draft_something", risk: "MEDIUM" })).not.toThrow();
  });
});

describe("canonical hash", () => {
  // The same vectors live in tests/test_rails_core.py (backend).
  const VECTORS: Array<[unknown, string, string]> = [
    [{ b: 1, a: "x" }, '{"a":"x","b":1}', "cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246"],
    [
      { tool: "set_ad_budget", args: { campaignId: UUID, dailyBudgetUsd: 35, reason: "Scale the winner" } },
      `{"args":{"campaignId":"${UUID}","dailyBudgetUsd":35,"reason":"Scale the winner"},"tool":"set_ad_budget"}`,
      "5d326874c4f85b147c2a653fb0e034146b2264320fc64a439a560c687b9686e9",
    ],
    [{ z: [3, { y: null, x: true }], name: "café ✓", n: -2 }, '{"n":-2,"name":"café ✓","z":[3,{"x":true,"y":null}]}', "b46e777014dafe5d0a3ef7f8d2e10663206ea21ed42ba8a60fcd540ad36dc63c"],
  ];
  it.each(VECTORS)("serialises %j like the backend", async (value, text, digest) => {
    expect(canonicalJson(value)).toBe(text);
    expect(await canonicalHash(value)).toBe(digest);
  });
});

describe("truth table", () => {
  const none = new Set<never>();
  const row = (tool: string, args: Record<string, unknown>, extra: Partial<Parameters<typeof evaluateAgentDispatch>[0]> = {}) =>
    evaluateAgentDispatch({ tool, declaredRisk: railsEntry(tool)?.tier ?? "HIGH", args, mode: "live", killSwitch: none, entry: railsEntry(tool), ...extra }).code;

  it.each([
    ["unregistered tool", row("publish_everything", {}), "unregistered"],
    ["declared below the reviewed tier", row("set_ad_budget", { dailyBudgetUsd: 1 }, { declaredRisk: "HIGH" }), "tier_mismatch"],
    ["declared above is fine", row("approve_video", {}, { declaredRisk: "CRITICAL" }), "ok"],
    ["shadow mode never dispatches", row("approve_video", {}, { mode: "shadow" }), "not_live"],
    ["kill switch all stops publishing", row("approve_video", {}, { killSwitch: parseKillSwitch("all") }), "kill_switch"],
    ["publish switch stops publishing", row("approve_video", {}, { killSwitch: parseKillSwitch("publish") }), "kill_switch"],
    ["spend switch leaves publishing", row("approve_video", {}, { killSwitch: parseKillSwitch("spend") }), "ok"],
    ["spend switch stops a budget change", row("set_ad_budget", { dailyBudgetUsd: 10 }, { killSwitch: parseKillSwitch("spend") }), "kill_switch"],
    ["no switch stops a pause", row("pause_ad_campaign", { status: "paused" }, { killSwitch: parseKillSwitch("all") }), "ok"],
    ["no switch stops a rejection", row("reject_video", {}, { killSwitch: parseKillSwitch("all") }), "ok"],
    ["inbox reject is allowed under the switch", row("decide_inbox_item", { decision: "reject" }, { killSwitch: parseKillSwitch("publish") }), "ok"],
    ["inbox approve is stopped by the switch", row("decide_inbox_item", { decision: "approve" }, { killSwitch: parseKillSwitch("publish") }), "kill_switch"],
    ["ad rejection is allowed under the switch", row("decide_ad_approval", { decision: "rejected" }, { killSwitch: parseKillSwitch("spend") }), "ok"],
    ["ad approval is stopped by the switch", row("decide_ad_approval", { decision: "approved" }, { killSwitch: parseKillSwitch("spend") }), "kill_switch"],
    ["cap above the ceiling", row("set_ad_budget", { dailyBudgetUsd: RAILS_MAX_DAILY_BUDGET_USD + 1 }), "cap_exceeded"],
    ["cap with a non-number", row("activate_ad_campaign", { dailyBudgetUsd: "10" }), "cap_exceeded"],
    ["cap at the ceiling", row("activate_ad_campaign", { dailyBudgetUsd: RAILS_MAX_DAILY_BUDGET_USD }), "ok"],
  ])("%s", (_label, actual, expected) => expect(actual).toBe(expected));

  it.each([
    [undefined, []],
    ["", []],
    ["off", []],
    ["publish", ["publish"]],
    [" Spend , publish ", ["publish", "spend"]],
    ["all", ["all"]],
    ["pause-everything", ["all"]],
    [42, ["all"]],
  ])("parses kill switch %j", (raw, expected) => expect([...parseKillSwitch(raw)].sort()).toEqual(expected));

  it("classifies definite rejections and unknown outcomes", () => {
    expect(isDefiniteRejection(new HttpError(402, "cap"))).toBe(true);
    expect(isDefiniteRejection(new HttpError(409, "duplicate"))).toBe(true);
    expect(isDefiniteRejection(new HttpError(408, "timeout"))).toBe(false);
    expect(isDefiniteRejection(new HttpError(502, "outcome_unknown"))).toBe(false);
    expect(isDefiniteRejection(new AgentError("CONFIG_INVALID", "no url"))).toBe(true);
    expect(isDefiniteRejection(new AgentError("TIMEOUT", "slow"))).toBe(false);
    expect(isDefiniteRejection(new TypeError("fetch failed"))).toBe(false);
  });
});

describe("through the executor", () => {
  function harness(env: Record<string, string> = {}) {
    const sql = new NodeSqlStore();
    new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
    const approvals = new ApprovalStore(sql, "test-approval-secret");
    const executor = new ToolExecutor({ tools: adsTools(), approvals, idempotency: new SqlIdempotencyStore(sql) });
    const logs: Array<{ message: string; attributes?: Record<string, unknown> }> = [];
    const context = {
      tenant: { tenantId: "user_2abcTenant", userId: "user_2abcTenant", environment: "test" as const, roles: [], scopes: [] },
      tenantConfig: SECURE_DEFAULT_TENANT_CONFIG,
      runId: "run_rails",
      signal: new AbortController().signal,
      mode: "live" as const,
      log: (_level: string, message: string, attributes?: Record<string, unknown>) => void logs.push({ message, ...(attributes ? { attributes } : {}) }),
      services: { env: { ...BASE_ENV, ...env } },
    };
    /** Request, approve as the person, run again with the same call id. */
    async function approveAndRun(id: string, name: string, args: Record<string, unknown>) {
      const parked = await executor.execute({ id, name, arguments: JSON.stringify(args) }, context);
      if (parked.status !== "approval_required") throw new Error(`expected approval_required, got ${parked.status}`);
      approvals.decide(parked.approval.approvalId, "approve", "user_2abcTenant");
      return executor.execute({ id, name, arguments: JSON.stringify(args) }, context);
    }
    return { executor, approvals, context, approveAndRun, logs };
  }
  const budget = { campaignId: UUID, dailyBudgetUsd: 40, currentDailyBudgetUsd: 35, reason: "CPA under target" };

  it("runs an approved CRITICAL call exactly once and logs its argument hash", async () => {
    const h = harness();
    const outcome = await h.approveAndRun("call_ok", "set_ad_budget", budget);
    expect(outcome.status).toBe("ok");
    expect(fetchCalls).toEqual([`https://api.marketer.test/api/v1/ads/campaigns/${UUID}/budget`]);
    const dispatch = h.logs.find((l) => l.message === "rails.dispatch");
    expect(dispatch?.attributes).toMatchObject({ tool: "set_ad_budget", tier: "CRITICAL", backendAction: "ads.budget.change" });
    expect(dispatch?.attributes?.argsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the approval bound to its arguments", async () => {
    const h = harness();
    const parked = await h.executor.execute({ id: "call_bound", name: "set_ad_budget", arguments: JSON.stringify(budget) }, h.context);
    if (parked.status !== "approval_required") throw new Error("expected approval");
    h.approvals.decide(parked.approval.approvalId, "approve", "user_2abcTenant");
    const changed = await h.executor.execute({ id: "call_bound", name: "set_ad_budget", arguments: JSON.stringify({ ...budget, dailyBudgetUsd: 400 }) }, h.context);
    expect(changed.status).toBe("approval_required");
    expect(fetchCalls).toHaveLength(0);
  });

  it("stops spend under the kill switch even after approval, but never a pause", async () => {
    const h = harness({ MARKETER_RAILS_KILL_SWITCH: "spend" });
    const blocked = await h.approveAndRun("call_ks", "set_ad_budget", budget);
    expect(blocked.status).toBe("error");
    expect(blocked.status === "error" && blocked.message).toMatch(/RAILS_KILL_SWITCH/);
    expect(fetchCalls).toHaveLength(0);
    const paused = await h.approveAndRun("call_pause", "pause_ad_campaign", { campaignId: UUID, status: "paused", reason: "Stop the bleed" });
    expect(paused.status).toBe("ok");
    expect(fetchCalls).toHaveLength(1);
  });

  it("turns a timeout after sending into OUTCOME_UNKNOWN, sends once, and never replays it", async () => {
    const h = harness();
    fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    const first = await h.approveAndRun("call_unknown", "set_ad_budget", budget);
    expect(first.status).toBe("error");
    expect(first.status === "error" && first.message).toMatch(/OUTCOME_UNKNOWN/);
    expect(fetchCalls).toHaveLength(1);
    const replay = await h.executor.execute({ id: "call_unknown", name: "set_ad_budget", arguments: JSON.stringify(budget) }, h.context);
    expect(replay.status === "error" && replay.code).toBe("UNKNOWN_OUTCOME");
    expect(fetchCalls).toHaveLength(1);
  });

  it("does not auto-retry an idempotent HIGH tool on a 5xx", async () => {
    const h = harness();
    fetchImpl = async () => new Response(JSON.stringify({ detail: "outcome_unknown: spawn timed out" }), { status: 502 });
    const outcome = await h.approveAndRun("call_502", "pause_ad_campaign", { campaignId: UUID, status: "paused", reason: "Stop the bleed" });
    expect(outcome.status === "error" && outcome.message).toMatch(/OUTCOME_UNKNOWN/);
    expect(fetchCalls).toHaveLength(1);
  });

  it("passes a definite rejection through unchanged", async () => {
    const h = harness();
    fetchImpl = async () => new Response(JSON.stringify({ detail: "kill_switch: kill switch engaged (spend)" }), { status: 402 });
    const outcome = await h.approveAndRun("call_402", "set_ad_budget", budget);
    expect(outcome.status === "error" && outcome.message).toMatch(/HTTP 402.*kill_switch/);
  });
});
