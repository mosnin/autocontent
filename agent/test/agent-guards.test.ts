/**
 * Guards added by the agent security audit (docs/security/agent-audit.md), each with its happy, denied and failure
 * path: departments act on their own only inside a delegated task, every department has per-run call quotas, MCP
 * writes are metered per tenant and fail closed, and unbound approval links are never mailed. Plain Node.
 */
import { type AnyAgentTool, ApprovalStore, AutonomyGateway, CORE_MIGRATIONS, MigrationRunner, SECURE_DEFAULT_TENANT_CONFIG, SqlIdempotencyStore, type TenantConfig, ToolExecutor, ToolFirewall } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import { workerConversationId } from "@agent-starter/flue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appApiTools } from "../src/in-app/app-api.ts";
import { guardMcpTool, MCP_WRITE_RATE, type McpWriteLimiter, mcpExposedTools } from "../src/in-app/mcp-guard.ts";
import { outOfBandApprovalNotifier } from "../src/lib/policy.ts";
import { defaultBackendHealth } from "../src/marketer/resilience.ts";
import { contentTools } from "../src/marketer/tools/content.ts";
import { adsFirewall, DEPARTMENT_FIREWALL, DEPARTMENT_TOOLS } from "../src/marketer/tools/index.ts";
import { busConversationId, departmentAutonomyCap, departmentConversationKind, roomConversationId } from "../src/multi-agent/roster.ts";

const UUID = "3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b";
const ENV = { PRIMARY_SAAS_API_URL: "https://api.marketer.test", SAAS_SERVICE_TOKEN: "svc-token-0123456789" };
const TENANT = "user_2abcTenant";
const calls: Array<{ url: string; method: string }> = [];

beforeEach(() => {
  calls.length = 0;
  defaultBackendHealth.reset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method) });
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const generous: TenantConfig = { ...SECURE_DEFAULT_TENANT_CONFIG, autonomy: { ...SECURE_DEFAULT_TENANT_CONFIG.autonomy, maxAutonomousTier: "MEDIUM" } };
const context = (tenantId = TENANT) => ({
  tenant: { tenantId, userId: tenantId, environment: "test" as const, roles: [], scopes: [] },
  tenantConfig: generous,
  runId: "run_guards",
  signal: new AbortController().signal,
  mode: "live" as const,
  log: () => undefined,
  services: { env: ENV },
});
const video = (n = 0) => ({ id: `call_${n}`, name: "create_video", arguments: JSON.stringify({ playbookId: UUID, platform: "tiktok" }) });

describe("a department acts on its own only inside a delegated task", () => {
  let delegated = "";
  beforeEach(async () => {
    delegated = await workerConversationId("content-producer", TENANT, `assistant--${TENANT}--${TENANT}.s1`, "task-1");
  });
  const bus = busConversationId("content-producer", TENANT, "bus");
  const room = roomConversationId("content-producer", { roomId: `room--${TENANT}--launch`, tenantId: TENANT });

  it("reads the conversation kind from the harness instance id", () => {
    expect(departmentConversationKind(delegated)).toBe("delegated");
    expect(departmentConversationKind(bus)).toBe("bus");
    expect(departmentConversationKind(room)).toBe("room");
    // A user-shaped id, a job id, garbage: none of them carries a delegation's authority.
    for (const id of [`content-producer--${TENANT}--alice.thread1`, `content-producer--${TENANT}---job.x`, "nonsense", ""]) expect(departmentConversationKind(id)).toBe("other");
  });

  it("keeps the department's own ceiling in a delegated task and drops to LOW everywhere else (fail closed)", () => {
    expect(departmentAutonomyCap(delegated)).toBeUndefined();
    expect(departmentAutonomyCap(delegated, "LOW")).toBe("LOW");
    for (const id of [bus, room, "nonsense"]) {
      expect(departmentAutonomyCap(id)).toBe("LOW");
      expect(departmentAutonomyCap(id, "MEDIUM")).toBe("LOW");
    }
  });

  function department(conversationId: string) {
    const sql = new NodeSqlStore();
    new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
    const cap = departmentAutonomyCap(conversationId);
    return new ToolExecutor({
      tools: contentTools(),
      approvals: new ApprovalStore(sql, "test-approval-secret"),
      idempotency: new SqlIdempotencyStore(sql),
      gateway: new AutonomyGateway({ confidenceThreshold: 0.85, ...(cap ? { maxAutonomousTier: cap } : {}) }),
    });
  }

  it("delegated task: a MEDIUM maker runs", async () => {
    expect((await department(delegated).execute(video(), context())).status).toBe("ok");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["bus message", bus],
    ["room turn", room],
  ])("%s: the same maker parks for the owner and nothing is sent; reads still run", async (_label, id) => {
    const executor = department(id);
    const parked = await executor.execute(video(), context());
    expect(parked.status).toBe("approval_required");
    expect(calls).toHaveLength(0);
    expect((await executor.execute({ id: "call_read", name: "list_videos", arguments: "{}" }, context())).status).toBe("ok");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
});

describe("per-run quotas for every department", () => {
  it("gives every department a quota (the media buyer's is the same plus its argument rule)", () => {
    expect(DEPARTMENT_FIREWALL).toMatchObject({ maxCallsPerTool: 10, maxTotalCalls: 40 });
    expect(adsFirewall).toMatchObject({ maxCallsPerTool: DEPARTMENT_FIREWALL.maxCallsPerTool, maxTotalCalls: DEPARTMENT_FIREWALL.maxTotalCalls });
    expect(Object.keys(DEPARTMENT_TOOLS).length).toBe(6);
  });

  it("stops a maker loop at the quota: the eleventh call is denied and not sent", async () => {
    const sql = new NodeSqlStore();
    new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
    const executor = new ToolExecutor({ tools: contentTools(), idempotency: new SqlIdempotencyStore(sql), firewall: new ToolFirewall(DEPARTMENT_FIREWALL) });
    const statuses: string[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await executor.execute(video(i), context())).status);
    expect(statuses.slice(0, 10).every((s) => s === "ok")).toBe(true);
    expect(statuses.slice(10)).toEqual(["denied", "denied", "denied", "denied"]);
    expect(calls).toHaveLength(10);
  });

  it("counts failed calls too, so a failing loop cannot spin either", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "daily cap reached" }, { status: 402 })));
    const sql = new NodeSqlStore();
    new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
    const executor = new ToolExecutor({ tools: contentTools(), idempotency: new SqlIdempotencyStore(sql), firewall: new ToolFirewall(DEPARTMENT_FIREWALL) });
    const statuses: string[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await executor.execute(video(i), context())).status);
    expect(statuses.filter((s) => s === "error")).toHaveLength(10);
    expect(statuses.slice(10)).toEqual(["denied", "denied"]);
  });
});

describe("MCP guard", () => {
  const bucket = (burst: number): McpWriteLimiter & { taken: string[] } => {
    const left = new Map<string, number>();
    const taken: string[] = [];
    return {
      taken,
      take: async (key) => {
        taken.push(key);
        const remaining = left.get(key) ?? burst;
        if (remaining <= 0) return { allowed: false, retryAfterMs: 180_000 };
        left.set(key, remaining - 1);
        return { allowed: true, retryAfterMs: 0 };
      },
    };
  };
  const exposed = (limiter: McpWriteLimiter): AnyAgentTool[] => mcpExposedTools(appApiTools()).map((tool) => guardMcpTool(tool, { env: () => ENV, limiter: () => limiter }));
  // The MCP executor passes no host services: the guard must supply the env.
  const mcpContext = (tenantId = TENANT) => ({ ...context(tenantId), services: {} });
  const mcpExecutor = (limiter: McpWriteLimiter) => {
    const sql = new NodeSqlStore();
    new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
    return new ToolExecutor({ tools: exposed(limiter), idempotency: new SqlIdempotencyStore(sql) });
  };

  it("exposes no UI tool and nothing that needs a person's approval", () => {
    const tools = mcpExposedTools(appApiTools());
    expect(tools.map((t) => t.name)).not.toContain("navigate_ui");
    expect(tools.map((t) => t.name)).not.toContain("decide_inbox_item");
    expect(tools.filter((t) => t.risk === "HIGH" || t.risk === "CRITICAL" || t.requiresApproval)).toEqual([]);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_workspace_overview", "create_video"]));
  });

  it("keeps the tool's contract (risk, side effect, schema) and hands it the Worker env", async () => {
    const guarded = exposed(bucket(5));
    const original = mcpExposedTools(appApiTools());
    expect(guarded.map((t) => [t.name, t.risk, t.sideEffect, t.retry?.maxAttempts])).toEqual(original.map((t) => [t.name, t.risk, t.sideEffect, t.retry?.maxAttempts]));
    const outcome = await mcpExecutor(bucket(5)).execute({ id: "c1", name: "get_workspace_overview", arguments: "{}" }, mcpContext());
    expect(outcome.status).toBe("ok");
    expect(calls[0]?.url).toBe("https://api.marketer.test/api/v1/workspace/overview?days=7");
  });

  it("meters writes per tenant: past the burst a write is refused and not sent", async () => {
    const limiter = bucket(MCP_WRITE_RATE.burst);
    const executor = mcpExecutor(limiter);
    const statuses: string[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await executor.execute(video(i), mcpContext())).status);
    expect(statuses).toEqual(["ok", "ok", "ok", "ok", "ok", "error", "error"]);
    expect(calls).toHaveLength(5);
    const refused = await executor.execute(video(99), mcpContext());
    expect(refused.status === "error" && refused.code).toBe("RATE_LIMITED");
    expect(refused.status === "error" && refused.message).toMatch(/^TEMPORARILY_UNAVAILABLE: .*was not sent.*about 180s/);
    expect(new Set(limiter.taken)).toEqual(new Set([TENANT]));
  });

  it("one tenant's writes never use up another's", async () => {
    const limiter = bucket(1);
    const executor = mcpExecutor(limiter);
    expect((await executor.execute(video(1), mcpContext("tenant_a"))).status).toBe("ok");
    expect((await executor.execute(video(2), mcpContext("tenant_a"))).status).toBe("error");
    expect((await executor.execute(video(3), mcpContext("tenant_b"))).status).toBe("ok");
  });

  it("never meters reads", async () => {
    const limiter = bucket(0);
    const executor = mcpExecutor(limiter);
    for (let i = 0; i < 8; i++) expect((await executor.execute({ id: `r${i}`, name: "get_workspace_inbox", arguments: "{}" }, mcpContext())).status).toBe("ok");
    expect(limiter.taken).toEqual([]);
  });

  it("fails closed when the limiter cannot be read: the write is not sent, a read still runs", async () => {
    const broken: McpWriteLimiter = { take: async () => Promise.reject(new Error("KV unavailable")) };
    const executor = mcpExecutor(broken);
    const outcome = await executor.execute(video(), mcpContext());
    expect(outcome.status === "error" && outcome.code).toBe("RATE_LIMITED");
    expect(calls).toHaveLength(0);
    expect((await executor.execute({ id: "r", name: "get_workspace_inbox", arguments: "{}" }, mcpContext())).status).toBe("ok");
  });

  it("uses a bucket that refills slowly: a burst of 5, 20 per hour", () => {
    expect(MCP_WRITE_RATE.burst).toBe(5);
    expect(Math.round(MCP_WRITE_RATE.ratePerMinute * 60)).toBe(20);
  });
});

describe("approval links out of band", () => {
  const mailer = { notify: async () => undefined };

  it("mails recipient-bound links (they only work in the approver's own session)", () => {
    expect(outOfBandApprovalNotifier(true, () => mailer)()).toBe(mailer);
  });

  it("never mails an unbound link: it is a bearer token and stays in the signed-in user's stream", () => {
    expect(outOfBandApprovalNotifier(false, () => mailer)()).toBeUndefined();
    expect(outOfBandApprovalNotifier(undefined, () => mailer)()).toBeUndefined();
  });

  it("stays silent when no mailer is configured", () => {
    expect(outOfBandApprovalNotifier(true, () => undefined)()).toBeUndefined();
  });
});
