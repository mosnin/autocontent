/**
 * Persistent module tests (Node): the dispatch glue (server-only heartbeat signal, idempotent per turn, the agent's
 * own principal), the instance id no user can own, initialData that no client can seed, the credential broker and
 * managed egress built from Worker vars, the sandbox control port, and the control routes' auth.
 */
import {
  agentIdentity,
  createEgressGuard,
  createSessionToken,
  DEFAULT_PERSISTENT_CONFIG,
  parseAgentInstanceId,
  parseConversationInstanceId,
  type PersistentAgentConfig,
  type PersistentTrigger,
} from "@agent-starter/core";
import { agentAuth } from "@agent-starter/flue";
import type { AgentDispatchRequest } from "@flue/runtime";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatched: AgentDispatchRequest[] = [];
vi.mock("../src/lib/submissions.ts", () => ({
  trackedDispatch: vi.fn(async (_env: unknown, _agent: unknown, request: AgentDispatchRequest) => {
    dispatched.push(request);
    return { submissionId: "sub_1", deduplicated: false };
  }),
}));

const { dispatchPersistentTurn } = await import("../src/persistent/dispatch.ts");
const { persistentInstanceId, PERSISTENT_AGENT_NAME } = await import("../src/persistent/instance.ts");
const { credentialBroker, managedEgress, platformBrokeredFetch } = await import("../src/persistent/credentials.ts");
const { readAutopilotState } = await import("../src/marketer/heartbeat.ts");
const { sandboxControlPort } = await import("../src/persistent/sandbox.ts");
const { persistentRoutes } = await import("../src/persistent/routes.ts");

const SECRET = "test-session-secret-0123456789";
const config: PersistentAgentConfig = { ...DEFAULT_PERSISTENT_CONFIG, agentId: "inbox-watcher", name: "Inbox watcher", ownerUserId: "u1" };
const identity = agentIdentity("tenant_a", "inbox-watcher", "u1");
const env = (vars: Record<string, unknown> = {}) => ({ AGENT_CACHE: { put: async () => undefined }, ...vars }) as never;

beforeEach(() => {
  dispatched.length = 0;
});

describe("dispatch glue", () => {
  it("turns a heartbeat tick into one server-only signal, idempotent per turn, as the agent's own principal", async () => {
    const trigger: PersistentTrigger = { turnId: "turn_1", kind: "heartbeat", prompt: "- check the inbox", config, identity };
    await dispatchPersistentTurn(env(), trigger);
    await dispatchPersistentTurn(env(), trigger);
    const [first, second] = dispatched;
    expect(first?.id).toBe(persistentInstanceId("tenant_a", "inbox-watcher"));
    expect(first?.message).toMatchObject({ kind: "signal", type: "heartbeat", attributes: { turnId: "turn_1", trigger: "heartbeat", configVersion: "1" } });
    expect((first?.message as { body: string }).body).toContain("- check the inbox");
    expect((first?.message as { body: string }).body).toContain("HEARTBEAT_OK");
    expect(first?.idempotencyKey).toBe("persistent:turn_1");
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(first?.initialData).toMatchObject({ tenantId: "tenant_a", userId: "agent:tenant_a/inbox-watcher", roles: ["agent"], persistent: { agentId: "inbox-watcher", ownerUserId: "u1" } });
  });

  it("labels schedule ticks with their name", async () => {
    await dispatchPersistentTurn(env(), { turnId: "turn_2", kind: "schedule", name: "daily-digest", prompt: "Send the digest", config, identity });
    expect(dispatched[0]?.message).toMatchObject({ type: "schedule", attributes: { trigger: "schedule:daily-digest" } });
  });
});

describe("identity and initialData", () => {
  it("names the instance with a harness key the run registry can parse and no user conversation can own", () => {
    const id = persistentInstanceId("tenant_a", "inbox-watcher");
    expect(parseAgentInstanceId(id)).toMatchObject({ agent: PERSISTENT_AGENT_NAME, tenantId: "tenant_a" });
    expect(parseConversationInstanceId(id)?.userId ?? null).toBeNull();
  });

  it("a client request through agentAuth can neither open the agent's instance nor seed `persistent` in initialData", async () => {
    const mount = "/agents/persistent-agent";
    const app = new Hono();
    // Even if someone mounted the agent over HTTP, agentAuth decides initialData server-side.
    app.use(`${mount}/*`, agentAuth({ secret: () => SECRET, agentName: PERSISTENT_AGENT_NAME, mount }));
    app.post(`${mount}/:id`, async (c) => c.json(await c.req.json()));
    const authorization = `Bearer ${await createSessionToken(SECRET, { tid: "tenant_a", sub: "u1", roles: ["admin"] })}`;
    const owned = await app.request(`${mount}/${PERSISTENT_AGENT_NAME}--tenant_a--u1.s1`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ message: "hi", initialData: { persistent: { agentId: "inbox-watcher", ownerUserId: "attacker" }, userId: "agent:tenant_a/inbox-watcher", roles: ["agent"] } }),
    });
    const body = (await owned.json()) as { initialData: Record<string, unknown> };
    expect(body.initialData.persistent).toBeUndefined();
    expect(body.initialData).toMatchObject({ tenantId: "tenant_a", userId: "u1" });
    const agentInstance = await app.request(`${mount}/${persistentInstanceId("tenant_a", "inbox-watcher")}`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
    expect(agentInstance.status).toBe(403);
  });
});

describe("credentials and egress", () => {
  it("injects a credential only for hosts both the platform and the agent's config bind it to", async () => {
    const vars = env({ GITHUB_TOKEN: "ghp_secret_value", PRIMARY_SAAS_API_URL: "https://api.saas.test/v1", SAAS_SERVICE_TOKEN: "svc_secret" });
    const broker = credentialBroker(vars, [{ name: "github", hosts: ["api.github.com", "evil.example.com"] }]);
    expect(await broker.resolve("github", "https://api.github.com/repos")).toEqual({ authorization: "Bearer ghp_secret_value" });
    await expect(broker.resolve("github", "https://evil.example.com/")).rejects.toThrow(/not bound/);
    // Bound in the platform map but not in the agent's approved config.
    await expect(broker.resolve("saas", "https://api.saas.test/v1/x")).rejects.toThrow(/unknown credential/);
    expect(broker.scrub("token=ghp_secret_value")).not.toContain("ghp_secret_value");
    expect(credentialBroker(vars, [{ name: "saas", hosts: ["api.saas.test"] }]).names()).toEqual(["saas"]);
  });

  it("builds a managed allowlist the agent can only narrow, with the default deny list on top", () => {
    const vars = env({ PERSISTENT_EGRESS_ALLOW: "api.github.com, *.example.com pastebin.com", PERSISTENT_EGRESS_DENY: "bad.example.com" });
    const guard = createEgressGuard({ ...managedEgress(vars), agentAllow: ["api.github.com", "docs.example.com", "widened.test"] });
    expect(guard.isAllowed("https://api.github.com/x")).toBe(true);
    expect(guard.isAllowed("https://docs.example.com/")).toBe(true);
    expect(guard.isAllowed("https://other.example.com/")).toBe(false);
    expect(guard.isAllowed("https://widened.test/")).toBe(false);
    expect(guard.isAllowed("https://pastebin.com/raw/x")).toBe(false);
    expect(createEgressGuard({ ...managedEgress(vars) }).isAllowed("https://bad.example.com/")).toBe(false);
    expect(createEgressGuard({ ...managedEgress(env()) }).isAllowed("https://api.github.com/")).toBe(false);
  });
});

describe("platform-side reads for a persistent agent (decision point 12)", () => {
  const vars = (over: Record<string, unknown> = {}) => env({ PRIMARY_SAAS_API_URL: "https://api.saas.test", SAAS_SERVICE_TOKEN: "svc_secret", PERSISTENT_EGRESS_ALLOW: "api.saas.test", ...over });
  const cfg = { egress: { allow: ["api.saas.test"], deny: [] }, credentials: [{ name: "saas", hosts: ["api.saas.test"] }] };
  const recorder = (reply: (url: string) => Response) => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return reply(url);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it("sends the service token to the API host only", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ ok: true }));
    const response = await platformBrokeredFetch(vars(), cfg, { fetch: fetchImpl })("https://api.saas.test/api/v1/workspace/inbox", { credential: "saas" });
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ url: "https://api.saas.test/api/v1/workspace/inbox", authorization: "Bearer svc_secret" }]);
  });

  it("never carries the token across a redirect, and refuses a hop the egress policy does not allow", async () => {
    const off = recorder((url) => (url.startsWith("https://api.saas.test") ? new Response(null, { status: 302, headers: { location: "https://evil.example.com/collect" } }) : Response.json({ leaked: true })));
    await expect(platformBrokeredFetch(vars(), cfg, { fetch: off.fetchImpl })("https://api.saas.test/api/v1/spend/today", { credential: "saas" })).rejects.toThrow();
    expect(off.calls.map((c) => c.url)).toEqual(["https://api.saas.test/api/v1/spend/today"]);
    // Even when the platform allows the second host, the credential is bound to the API host and is dropped.
    const allowed = recorder((url) => (url.startsWith("https://api.saas.test") ? new Response(null, { status: 302, headers: { location: "https://cdn.saas.test/x" } }) : Response.json({ ok: true })));
    const wide = { egress: { allow: ["api.saas.test", "cdn.saas.test"], deny: [] }, credentials: cfg.credentials };
    await platformBrokeredFetch(vars({ PERSISTENT_EGRESS_ALLOW: "api.saas.test, cdn.saas.test" }), wide, { fetch: allowed.fetchImpl })("https://api.saas.test/api/v1/niches", { credential: "saas" });
    expect(allowed.calls).toEqual([
      { url: "https://api.saas.test/api/v1/niches", authorization: "Bearer svc_secret" },
      { url: "https://cdn.saas.test/x", authorization: null },
    ]);
  });

  it("fails closed without the platform allowlist or the agent's own binding: nothing is sent", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ ok: true }));
    await expect(platformBrokeredFetch(vars({ PERSISTENT_EGRESS_ALLOW: "" }), cfg, { fetch: fetchImpl })("https://api.saas.test/api/v1/niches", { credential: "saas" })).rejects.toThrow();
    await expect(platformBrokeredFetch(vars(), { ...cfg, credentials: [] }, { fetch: fetchImpl })("https://api.saas.test/api/v1/niches", { credential: "saas" })).rejects.toThrow();
    await expect(platformBrokeredFetch(vars(), { ...cfg, egress: { allow: ["other.test"], deny: [] } }, { fetch: fetchImpl })("https://api.saas.test/api/v1/niches", { credential: "saas" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("times out instead of holding the tick", async () => {
    const hang = ((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))))) as unknown as typeof fetch;
    await expect(platformBrokeredFetch(vars(), cfg, { fetch: hang, timeoutMs: 20 })("https://api.saas.test/api/v1/niches", { credential: "saas" })).rejects.toThrow();
  });

  it("feeds the autopilot readings through the same walls, and a blocked read just leaves the reading out", async () => {
    const { calls, fetchImpl } = recorder((url) => Response.json(url.includes("/spend/today") ? { total_usd: "4.50" } : url.includes("/niches") ? [{ daily_spend_cap_usd: 10 }] : { items: [] }));
    const ctx = (v: never) => ({ tenant: { tenantId: "tenant_a" }, services: { env: { PRIMARY_SAAS_API_URL: "https://api.saas.test" }, fetch: platformBrokeredFetch(v, cfg, { fetch: fetchImpl }), marketerClient: { sleep: async () => undefined } } });
    const readings = await readAutopilotState(ctx(vars()), 9);
    expect(readings.spendToday).toEqual({ spentUsd: 4.5, dailyCapUsd: 10 });
    expect(calls.every((c) => c.authorization === "Bearer svc_secret" && c.url.startsWith("https://api.saas.test/api/v1/"))).toBe(true);
    calls.length = 0;
    const blocked = await readAutopilotState(ctx(vars({ PERSISTENT_EGRESS_ALLOW: "" })), 9);
    expect(blocked).toEqual({ overview: undefined, inbox: undefined, hour: 9 });
    expect(calls).toEqual([]);
  });
});

describe("sandbox control port", () => {
  it("stores nothing, applies nothing and keeps agent notes untrusted", async () => {
    const port = sandboxControlPort();
    expect(await port.propose({ patch: { egress: { allow: ["x.test"], deny: [] } }, reason: "need it", source: "agent", actor: identity.principal })).toMatchObject({ status: "pending", review: "human" });
    const entry = await port.memoryWrite({ text: "owner likes Fridays", source: "agent", derivedFromUntrusted: true });
    expect(entry.trust).toBe("untrusted");
    expect(entry.expiresAt).toBeGreaterThan(Date.now());
    expect(await port.memoryRecall("x")).toMatch(/No memories/);
  });
});

describe("control routes", () => {
  it("require a session token and derive the control plane from the session's tenant", async () => {
    const names: string[] = [];
    const namespace = {
      idFromName: (name: string) => {
        names.push(name);
        return name;
      },
      get: () => ({ getState: async () => ({ config, status: { enabled: true, killed: false, inFlight: false, nextTickAt: null, lastTickAt: null }, turns: [] }), getConfig: async () => config }),
    };
    const bindings = { SESSION_SIGNING_SECRET: SECRET, PERSISTENT_CONTROL: namespace } as never;
    expect((await persistentRoutes.request("/api/persistent/inbox-watcher", {}, bindings)).status).toBe(401);
    const authorization = `Bearer ${await createSessionToken(SECRET, { tid: "tenant_a", sub: "u1", roles: [] })}`;
    await persistentRoutes.request("/api/persistent/inbox-watcher?tenant=tenant_b", { headers: { authorization } }, bindings);
    expect(names.every((n) => n === "tenant_a/inbox-watcher")).toBe(true);
    expect((await persistentRoutes.request("/api/persistent/bad%20id", { headers: { authorization } }, bindings)).status).toBe(400);
  });
});
