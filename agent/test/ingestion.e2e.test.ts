/**
 * End-to-end ingestion (spec: src/__tests__/integration.test.ts; R-EVAL-13 / R-EVT-07): a signed event hits the real
 * HTTP route → 202 + queued envelope → the real queue consumer (handleEventsQueue) → one job-scoped dispatch of
 * the background worker. Cloudflare bindings (KV, Queue, the run-registry Durable Object) and Flue's
 * `dispatch` are in-memory fakes, so this runs in Node without an account or API keys.
 */
import { agentInstanceId, createSessionToken, harnessSessionKey, parseAgentInstanceId, SECURE_DEFAULT_TENANT_CONFIG, signRequest } from "@agent-starter/core";
import type { AgentDispatchRequest } from "@flue/runtime";
import { env as workerEnv } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dispatched: [] as Array<{ agent: unknown; request: AgentDispatchRequest }> }));

// The fake harness: record each dispatch instead of starting a Flue agent.
vi.mock("@flue/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flue/runtime")>()),
  dispatch: vi.fn(async (agent: unknown, request: AgentDispatchRequest) => {
    state.dispatched.push({ agent, request });
    return { submissionId: `sub_${state.dispatched.length}`, deduplicated: false };
  }),
}));

// Bindings platform.ts reads at use time (`bindings()`): the Workers AI step router answers SIMPLE, and the
// tenant's stored config is what a job's first submission must carry.
const tenantConfig = { ...SECURE_DEFAULT_TENANT_CONFIG, maxTurnsPerSession: 12, maxBudgetUsd: 0.9, allowedModelProfiles: ["*"] };
const platformKv = new Map<string, string>([["config:tenant_alpha", JSON.stringify(tenantConfig)]]);
Object.assign(workerEnv as Record<string, unknown>, {
  AI: { run: async () => ({ response: "SIMPLE" }) },
  TENANT_CONFIG: { get: async (key: string) => platformKv.get(key) ?? null, put: async () => undefined },
});

const { backgroundRoutes } = await import("../src/background/routes.ts");
const { handleEventsQueue } = await import("../src/background/queue.ts");
const { BackgroundWorker } = await import("../src/agents/background-worker.ts");

const SECRET = "test-webhook-signing-secret-0123456789";

class FakeKv {
  readonly data = new Map<string, string>();
  async get(key: string, options?: unknown): Promise<unknown> {
    const value = this.data.get(key) ?? null;
    const type = typeof options === "string" ? options : (options as { type?: string } | undefined)?.type;
    return value !== null && type === "json" ? JSON.parse(value) : value;
  }
  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async list(options: { prefix?: string } = {}) {
    return { keys: [...this.data.keys()].filter((name) => name.startsWith(options.prefix ?? "")).map((name) => ({ name })), list_complete: true, cursor: "" };
  }
}

class FakeQueue {
  readonly sent: unknown[] = [];
  async send(body: unknown): Promise<void> {
    this.sent.push(structuredClone(body));
  }
  async sendBatch(messages: Array<{ body: unknown }>): Promise<void> {
    for (const message of messages) this.sent.push(structuredClone(message.body));
  }
}

function fakeEnv() {
  const beats: unknown[] = [];
  const registryStub = {
    get: async (runId: string) => (runId.includes("known") ? { runId, status: "RUNNING", turnCount: 3, costUsd: 0.02 } : null),
    beat: async (run: unknown) => void beats.push(run),
    complete: async () => undefined,
    setStatus: async () => undefined,
    runCounters: async (runId: string) => (runId.includes("known") ? { tokens: 900, toolCalls: 4, vmSeconds: 42, vmCostUsd: 0.01 } : null),
  };
  const namespace = { idFromName: (name: string) => name, get: () => registryStub, jurisdiction: () => namespace };
  return {
    beats,
    env: {
      TENANT_CONFIG: new FakeKv(),
      AGENT_CACHE: new FakeKv(),
      EVENTS_QUEUE: new FakeQueue(),
      EVENTS_QUEUE_NAME: "app-events",
      RUN_REGISTRY: namespace,
      WEBHOOK_SIGNING_SECRET: SECRET,
      SESSION_SIGNING_SECRET: "test-session-secret-0123456789",
    },
  };
}

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

async function post(env: ReturnType<typeof fakeEnv>["env"], path: string, body: string, secret = SECRET) {
  const { header } = await signRequest(secret, { method: "POST", path, body });
  const app = new Hono().route("/", backgroundRoutes);
  return app.request(path, { method: "POST", body, headers: { "content-type": "application/json", "x-agent-signature": header } }, env, ctx);
}

function batchOf(env: ReturnType<typeof fakeEnv>["env"], bodies: unknown[]) {
  const messages = bodies.map((body, i) => ({ id: `msg_${i}`, timestamp: new Date(), body, attempts: 1, ack: vi.fn(), retry: vi.fn() }));
  return { queue: env.EVENTS_QUEUE_NAME, messages, ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch<unknown> & { messages: typeof messages };
}

const chatEvent = (id: string, text: string) => JSON.stringify({ type: "chat.message", id, channel: "whatsapp", conversationId: "conv-42", sender: { id: "cust-7", name: "Preston" }, text, timestamp: "2026-11-10T12:00:00Z" });

beforeEach(() => {
  state.dispatched.length = 0;
});

describe("signed event → queue → job dispatch (end to end)", () => {
  it("accepts a signed event with 202, queues one envelope and dispatches one job-scoped turn", async () => {
    const { env, beats } = fakeEnv();
    const response = await post(env, "/events/chat/tenant_alpha", chatEvent("wamid.1", "Hi, I want to upgrade my plan"));
    expect(response.status).toBe(202);
    expect(env.EVENTS_QUEUE.sent).toHaveLength(1);
    expect(env.EVENTS_QUEUE.sent[0]).toMatchObject({ tenantId: "tenant_alpha", source: "chat", type: "chat.message", sessionKey: "whatsapp:conv-42", signatureVerified: true });

    const batch = batchOf(env, env.EVENTS_QUEUE.sent);
    await handleEventsQueue(batch, env as never, ctx);
    expect(batch.messages[0]?.ack).toHaveBeenCalledTimes(1);
    expect(batch.messages[0]?.retry).not.toHaveBeenCalled();

    expect(state.dispatched).toHaveLength(1);
    const { agent, request } = state.dispatched[0] as { agent: unknown; request: AgentDispatchRequest };
    expect(agent).toBe(BackgroundWorker);
    expect(parseAgentInstanceId(request.id)).toMatchObject({ agent: "background-worker", tenantId: "tenant_alpha" });
    expect(request.idempotencyKey).toBeTruthy();
    expect(request.message).toMatchObject({ kind: "signal", type: "events" });
    expect(JSON.stringify(request.message)).toContain("upgrade my plan");
    expect(request.initialData).toMatchObject({ tenantId: "tenant_alpha", roles: ["system"] });
    // The first submission renders on the tenant's real config (not the secure default) and on the routed model.
    expect((request.initialData as { tenantConfig?: unknown }).tenantConfig).toMatchObject({ maxTurnsPerSession: 12, maxBudgetUsd: 0.9 });
    expect(request.message).toMatchObject({ attributes: { route: "SIMPLE" } });
    expect(beats.length).toBeGreaterThan(0);
  });

  it("reports a job's status with its budget (config and tenant, the stricter wins) and VM seconds", async () => {
    const { env } = fakeEnv();
    const app = new Hono().route("/", backgroundRoutes);
    const token = await createSessionToken(env.SESSION_SIGNING_SECRET, { sub: "ops@tenant", tid: "tenant_alpha", roles: ["operator"] }, 600);
    const job = agentInstanceId("background-worker", "tenant_alpha", harnessSessionKey("job", "known.1"));
    const res = await app.request(`/api/jobs/${encodeURIComponent(job)}`, { headers: { authorization: `Bearer ${token}` } }, env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: job, status: "RUNNING", budgetUsd: 0.9, maxTurns: 12, vmSeconds: 42 });
    const fresh = agentInstanceId("background-worker", "tenant_alpha", harnessSessionKey("job", "new.1"));
    const pending = await (await app.request(`/api/jobs/${encodeURIComponent(fresh)}`, { headers: { authorization: `Bearer ${token}` } }, env, ctx)).json();
    expect(pending).toEqual({ runId: fresh, status: null, budgetUsd: 0.9, maxTurns: 12 });
    // Another tenant's operator never reads it.
    const other = await createSessionToken(env.SESSION_SIGNING_SECRET, { sub: "ops@beta", tid: "tenant_beta", roles: ["operator"] }, 600);
    expect((await app.request(`/api/jobs/${encodeURIComponent(job)}`, { headers: { authorization: `Bearer ${other}` } }, env, ctx)).status).toBe(403);
  });

  it("drops a replayed request at the edge and a redelivered message in the consumer", async () => {
    const { env } = fakeEnv();
    const body = chatEvent("wamid.2", "Where is my order?");
    const { header } = await signRequest(SECRET, { method: "POST", path: "/events/chat/tenant_alpha", body });
    const app = new Hono().route("/", backgroundRoutes);
    const send = () => app.request("/events/chat/tenant_alpha", { method: "POST", body, headers: { "content-type": "application/json", "x-agent-signature": header } }, env, ctx);
    expect((await send()).status).toBe(202);
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(env.EVENTS_QUEUE.sent).toHaveLength(1);

    await handleEventsQueue(batchOf(env, env.EVENTS_QUEUE.sent), env as never, ctx);
    // Queue redelivery of the same envelope: the event ledger collapses it, nothing is dispatched twice.
    await handleEventsQueue(batchOf(env, env.EVENTS_QUEUE.sent), env as never, ctx);
    expect(state.dispatched).toHaveLength(1);
  });

  it("rejects a bad signature, or a signature for another tenant's route, before anything is queued", async () => {
    const { env } = fakeEnv();
    expect((await post(env, "/events/chat/tenant_alpha", chatEvent("wamid.3", "hi"), "not-the-real-secret-0123456789")).status).toBe(401);
    // Signed for tenant_alpha, replayed against tenant_beta's route.
    const body = chatEvent("wamid.4", "hi");
    const { header } = await signRequest(SECRET, { method: "POST", path: "/events/chat/tenant_alpha", body });
    const app = new Hono().route("/", backgroundRoutes);
    const crossTenant = await app.request("/events/chat/tenant_beta", { method: "POST", body, headers: { "content-type": "application/json", "x-agent-signature": header } }, env, ctx);
    expect(crossTenant.status).toBe(401);
    expect(env.EVENTS_QUEUE.sent).toEqual([]);
    expect(state.dispatched).toEqual([]);
  });

  it("rejects a signed but malformed payload with 400 and queues nothing", async () => {
    const { env } = fakeEnv();
    const response = await post(env, "/events/chat/tenant_alpha", JSON.stringify({ type: "chat.message", id: "x" }));
    expect(response.status).toBe(400);
    expect(env.EVENTS_QUEUE.sent).toEqual([]);
  });
});
