/**
 * Multi-agent dispatch contract (fix round 3), with the Flue dispatch and the platform stubbed:
 *  - every server-side dispatch that can create a conversation (room summon, bus delivery, delegation) carries the
 *    tenant's config from dispatchInitialData, so its first turn never renders on the secure default;
 *  - the bus is two-way: specialists and the background worker can send, only to other dispatch-only agents (SEC-07).
 */
import { createAgentMessage, SECURE_DEFAULT_TENANT_CONFIG, type ToolExecutionContext } from "@agent-starter/core";
import * as v from "valibot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dispatched: [] as Array<{ agent: unknown; request: { id: string; initialData?: Record<string, unknown>; idempotencyKey?: string } }>,
  sent: [] as unknown[],
}));

vi.mock("@flue/runtime", async (original) => ({
  ...(await original<typeof import("@flue/runtime")>()),
  dispatch: vi.fn(async (agent: unknown, request: (typeof h.dispatched)[number]["request"]) => {
    h.dispatched.push({ agent, request });
    return {};
  }),
  useDelivery: () => ({ kind: "message" }),
}));
vi.mock("../src/lib/platform.ts", () => ({
  bindings: () => ({ AGENT_BUS: { send: async (message: unknown) => void h.sent.push(message) } }),
  telemetrySinks: () => [],
  dispatchInitialData: async (tenantId: string, extra: Record<string, unknown> = {}) => ({ userId: "system:dispatch", roles: ["system"], ...extra, tenantId, tenantConfig: { seededFor: tenantId } }),
}));
vi.mock("../src/agents.generated.ts", () => ({
  AGENTS: Object.fromEntries(["orchestrator", "assistant", "strategist", "content-producer", "seo-editor", "media-buyer", "distribution-manager", "analyst-agent", "background-worker"].map((name) => [name, { agentName: name }])),
}));
vi.mock("../src/agents/specialists.ts", () => ({
  StrategistAgent: { agentName: "strategist" },
  ContentProducerAgent: { agentName: "content-producer" },
  SeoEditorAgent: { agentName: "seo-editor" },
  MediaBuyerAgent: { agentName: "media-buyer" },
  DistributionManagerAgent: { agentName: "distribution-manager" },
  AnalystAgent: { agentName: "analyst-agent" },
}));

const { busTools, handleAgentBus } = await import("../src/multi-agent/bus.ts");
const { delegationDispatch } = await import("../src/multi-agent/delegation.ts");
const { SwarmRoom } = await import("../src/multi-agent/room.ts");

beforeEach(() => {
  h.dispatched.length = 0;
  h.sent.length = 0;
});

const ctx = (): ToolExecutionContext => ({
  tenant: { tenantId: "tenant_a", userId: "agent:x", environment: "test", roles: [], scopes: [] },
  tenantConfig: { ...SECURE_DEFAULT_TENANT_CONFIG, features: { ...SECURE_DEFAULT_TENANT_CONFIG.features, multiAgentGroupChat: true } },
  runId: "background-worker--tenant_a---job.order-42",
  toolCallId: "c1",
  idempotencyKey: "idem_0123456789abcdef0123456789abcdef",
  signal: new AbortController().signal,
  mode: "live",
  log: () => {},
  services: {},
});

describe("server dispatches seed the tenant config (finding 11)", () => {
  it("a room summon carries the tenant config with the room identity", async () => {
    const summon = (SwarmRoom.prototype as unknown as { summon: (...args: unknown[]) => Promise<void> }).summon;
    await summon.call({}, { id: "analyst" }, [], { roomId: "room--tenant_a--k1", tenantId: "tenant_a", objective: "Explain churn" }, { seq: 3, batch: [], reminder: false, reason: "numbers needed" });
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]?.request).toMatchObject({
      id: "analyst-agent--tenant_a---room.k1",
      idempotencyKey: "room-turn:room--tenant_a--k1:analyst:3",
      initialData: { tenantId: "tenant_a", userId: "room:room--tenant_a--k1", roles: ["agent"], objective: "Explain churn", tenantConfig: { seededFor: "tenant_a" } },
    });
  });

  it("a bus delivery carries the tenant config and the sender identity", async () => {
    const message = createAgentMessage({ type: "billing.discrepancy", tenantId: "tenant_a", from: { agent: "background-worker", instanceId: "background-worker--tenant_a---job.order-42" }, to: { agent: "analyst-agent", routingKey: "billing" }, payload: "Invoice 7 is double-charged" });
    const ack = vi.fn();
    await handleAgentBus({ messages: [{ id: "q1", body: message, attempts: 1, ack, retry: vi.fn() }] } as never, {} as never, {} as never);
    expect(ack).toHaveBeenCalled();
    expect(h.dispatched[0]?.request).toMatchObject({ id: "analyst-agent--tenant_a---bus.billing", initialData: { tenantId: "tenant_a", userId: "agent:background-worker", roles: ["agent"], tenantConfig: { seededFor: "tenant_a" } } });
  });

  it("a new delegated task carries the tenant config; a result back to the requester adds nothing", async () => {
    const message = { kind: "signal", type: "delegation", body: "brief" } as never;
    await delegationDispatch({ agent: "analyst-agent", conversationId: "analyst-agent--tenant_a---dlg.abc" } as never, { message, initialData: { tenantId: "tenant_a", userId: "agent:orchestrator", roles: ["agent"], objective: "Q3 revenue" }, idempotencyKey: "dlg:1" });
    expect(h.dispatched[0]?.request.initialData).toEqual({ tenantId: "tenant_a", userId: "agent:orchestrator", roles: ["agent"], objective: "Q3 revenue", tenantConfig: { seededFor: "tenant_a" } });
    await delegationDispatch({ agent: "orchestrator", conversationId: "orchestrator--tenant_a--alice.main" } as never, { message, idempotencyKey: "dlg:1:result" });
    expect(h.dispatched[1]?.request.initialData).toBeUndefined();
  });
});

describe("two-way agent bus (finding 6, SEC-07)", () => {
  it("specialists and the background worker can send, only to other dispatch-only specialists", async () => {
    const [fromWorker] = busTools("background-worker", "background-worker--tenant_a---job.order-42");
    const [fromAnalyst] = busTools("analyst-agent", "analyst-agent--tenant_a---room.k1");
    expect(fromWorker?.name).toBe("send_agent_message");
    const accepts = (tool: typeof fromWorker, toAgent: string) => v.safeParse(tool?.input as v.GenericSchema, { toAgent, topic: "billing.discrepancy", payload: "x" }).success;
    expect(["strategist", "content-producer", "seo-editor", "media-buyer", "distribution-manager", "analyst-agent"].every((agent) => accepts(fromWorker, agent))).toBe(true);
    expect(accepts(fromAnalyst, "analyst-agent")).toBe(false); // never itself
    expect(accepts(fromAnalyst, "content-producer")).toBe(true);
    // HTTP-mounted (and retired) agents are never bus targets.
    for (const target of ["orchestrator", "assistant", "background-worker", "writer-agent", "security-auditor-agent"]) expect(accepts(fromWorker, target)).toBe(false);

    const result = await fromAnalyst?.execute({ toAgent: "strategist", topic: "performance.drop", payload: "Views fell 30% week over week", sessionKey: "bus" } as never, ctx());
    expect(result).toMatchObject({ sent: true, hops: 0 });
    expect(h.sent[0]).toMatchObject({ tenantId: "tenant_a", from: { agent: "analyst-agent" }, to: { agent: "strategist", routingKey: "bus" } });
  });
});

describe("Marketer rooms", () => {
  it("summons every department by its own agent, in a harness conversation", async () => {
    const summon = (SwarmRoom.prototype as unknown as { summon: (...args: unknown[]) => Promise<void> }).summon;
    for (const [participant, agent] of [["strategist", "strategist"], ["media-buyer", "media-buyer"], ["analyst", "analyst-agent"]] as const) {
      h.dispatched.length = 0;
      await summon.call({}, { id: participant }, [], { roomId: "room--tenant_a--k9", tenantId: "tenant_a", objective: "Plan a launch" }, { seq: 1, batch: [], reminder: false, reason: "owner" });
      expect(h.dispatched[0]?.request.id).toBe(`${agent}--tenant_a---room.k9`);
    }
  });
});
