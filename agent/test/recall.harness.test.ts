/**
 * Recall through the real Flue runtime (scripted model), wired exactly as src/agents/* do with `useRecall`:
 *  - a person's conversation reads personal + team before the model answers, and afterwards writes that turn (with the
 *    reply) into the person's own personal namespace;
 *  - a run with no person reads team only and writes nothing;
 *  - with the workspace setting off, nothing reaches Supermemory.
 */
import { conversationInstanceId } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import { useAgentStarter } from "@agent-starter/flue";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { type AgentProps, init } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  SUPERMEMORY_API_KEY: `sm_test_${"k".repeat(24)}`,
  MEMORY_NAMESPACE_SECRET: "test-only-namespace-secret-0123456789abcdef",
  SUPERMEMORY_BASE_URL: "https://sm.test",
  PRIMARY_SAAS_API_URL: "https://api.marketer.test",
  SAAS_SERVICE_TOKEN: "svc-token-0123456789",
}));
vi.mock("../src/lib/platform.ts", () => ({ bindings: () => env }));

const { personRolesAndScopes } = await import("../src/lib/permissions.ts");
const { usePersonActor } = await import("../src/marketer/actor-hooks.ts");
const { clearRecallSessionCache, deriveNamespace } = await import("../src/marketer/recall/index.ts");
const { useRecall } = await import("../src/marketer/recall/wiring.ts");

const sql = new NodeSqlStore();
const common = { model: { primary: "faux/faux-1", firstLine: "faux/faux-1", compaction: false as const }, toolMasking: false as const, confidence: false, sql: () => sql };

function PersonAgent({ id }: AgentProps) {
  const actor = usePersonActor();
  const ctx = useAgentStarter({ id, agentName: "recall-person", ...common, tools: [] });
  useRecall({ id, tenantId: ctx.tenant.tenantId, actor, write: true });
  return "You help with marketing.";
}
PersonAgent.agentName = "recall-person";

function JobAgent({ id }: AgentProps) {
  const ctx = useAgentStarter({ id, agentName: "recall-job", ...common, tools: [] });
  useRecall({ id, tenantId: ctx.tenant.tenantId, actor: null, write: true });
  return "You run jobs.";
}
JobAgent.agentName = "recall-job";

const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
let flue: Awaited<ReturnType<typeof start>>;
let sm: Array<{ url: string; body: Record<string, unknown> }> = [];
let backend: Array<{ url: string; headers: Record<string, string> }> = [];
let setting = { enabled: true, personal: true };
const memories = new Map<string, string[]>();

beforeAll(async () => {
  flue = await start({ agents: [PersonAgent, JobAgent], providers: [faux.provider] });
});
afterAll(async () => {
  await flue.stop();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  sm = [];
  backend = [];
  setting = { enabled: true, personal: true };
  memories.clear();
  clearRecallSessionCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      if (url.startsWith("https://api.marketer.test")) {
        backend.push({ url, headers: init.headers as Record<string, string> });
        return Response.json({ enabled: setting.enabled, personal: setting.enabled && setting.personal && Boolean((init.headers as Record<string, string>)["x-actor-id"]) });
      }
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      sm.push({ url, body });
      const ns = decodeURIComponent(/\/ns\/([^/]+)/.exec(url)?.[1] ?? "");
      if (url.endsWith("/document")) {
        memories.set(ns, [...(memories.get(ns) ?? []), String(body.content)]);
        return Response.json({ id: body.id, status: "queued" });
      }
      const list = memories.get(ns) ?? [];
      if (url.endsWith("/profile")) return Response.json({ profile: { static: list.map((m, i) => ({ id: `p${i}`, memory: m })), dynamic: [] } });
      return Response.json({ results: list.map((m, i) => ({ id: `m${i}`, memory: m, similarity: 0.9 })) });
    }),
  );
});

const person = (userId: string) => ({ tenantId: "tenant_a", userId, environment: "test" as const, ...personRolesAndScopes(["marketer"]) });
const nsOf = (url: string) => decodeURIComponent(/\/ns\/([^/]+)/.exec(url)?.[1] ?? "");

describe("recall in the Flue runtime", () => {
  it("a person's turn reads personal + team, then writes that turn to their own namespace", async () => {
    const mine = await deriveNamespace("personal", "tenant_a", "usr_alice", env.MEMORY_NAMESPACE_SECRET);
    const team = await deriveNamespace("team", "tenant_a", null, env.MEMORY_NAMESPACE_SECRET);
    memories.set(mine, ["Prefers short captions"]);
    memories.set(team, ["Brand voice is warm"]);
    faux.setResponses([fauxAssistantMessage(fauxText("Here are three short captions."))]);
    const agent = init(PersonAgent, { id: conversationInstanceId("recall-person", "tenant_a", "usr_alice", "s1") });
    await agent.read(await agent.dispatch({ message: "Write captions for the launch", initialData: person("usr_alice") }));
    expect(backend[0]?.headers).toMatchObject({ "x-tenant-id": "tenant_a", "x-actor-id": "usr_alice" });
    const reads = sm.filter((r) => !r.url.endsWith("/document"));
    expect(new Set(reads.map((r) => nsOf(r.url)))).toEqual(new Set([mine, team]));
    await vi.waitFor(() => expect(sm.filter((r) => r.url.endsWith("/document"))).toHaveLength(1));
    const write = sm.find((r) => r.url.endsWith("/document"))!;
    expect(nsOf(write.url)).toBe(mine);
    expect(write.body.content).toBe("Person: Write captions for the launch\nMarketer: Here are three short captions.");
    expect(write.body.metadata).toMatchObject({ scope: "personal", kind: "chat" });
  });

  it("a run with no person reads team only and writes nothing", async () => {
    const team = await deriveNamespace("team", "tenant_a", null, env.MEMORY_NAMESPACE_SECRET);
    memories.set(team, ["Brand voice is warm"]);
    faux.setResponses([fauxAssistantMessage(fauxText("Job summary."))]);
    const agent = init(JobAgent, { id: conversationInstanceId("recall-job", "tenant_a", "system", "j1") });
    await agent.read(await agent.dispatch({ message: "New comments arrived on the launch post", initialData: { tenantId: "tenant_a", userId: "system", roles: ["system"], environment: "test" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(backend[0]?.headers["x-actor-id"]).toBeUndefined();
    expect(sm.length).toBeGreaterThan(0);
    expect(sm.every((r) => nsOf(r.url) === team && !r.url.endsWith("/document"))).toBe(true);
  });

  it("with the workspace setting off, nothing reaches Supermemory", async () => {
    setting = { enabled: false, personal: false };
    faux.setResponses([fauxAssistantMessage(fauxText("Sure."))]);
    const agent = init(PersonAgent, { id: conversationInstanceId("recall-person", "tenant_a", "usr_bob", "s1") });
    await agent.read(await agent.dispatch({ message: "Remember that I like blue", initialData: person("usr_bob") }));
    await new Promise((r) => setTimeout(r, 50));
    expect(backend).toHaveLength(1);
    expect(sm).toEqual([]);
  });
});
