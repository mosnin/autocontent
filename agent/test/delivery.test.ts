/**
 * Deliveries out of the Worker and config-driven runtime (pure modules, Node): the durable webhook outbox (R-EVT-11),
 * signed artifact download links, the Pusher channel auth route (spec checklist item 6), shadow / ops alert events,
 * the config accessors' policy helpers (autonomy, budget, first-line model) and the domain line of useCustomSkills.
 */
import { CORE_MIGRATIONS, createSessionToken, defineAgentStarterConfig, MemoryBlobStore, MigrationRunner, SECURE_DEFAULT_TENANT_CONFIG, type TelemetryEvent, verifySignature, WebhookRelay } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import { tenantChannelName } from "@agent-starter/integrations";
import { describe, expect, it } from "vitest";
import { opsAlertEvent } from "../src/lib/alerts.ts";
import { createArtifactRoutes, parseArtifactKey, signArtifactUrl, verifyArtifactLink } from "../src/lib/artifacts.ts";
import { domainInstruction, PLACEHOLDER_TARGET_DOMAIN } from "../src/lib/custom-skills.ts";
import { deliverWithOutbox, drainWebhookOutbox, insertOutboxRow, type OutboxEntry, OutboxWebhookSink, outboxBacklog } from "../src/lib/outbox.ts";
import { effectiveBudget, signingSecret, stricterTier, workersAiModel } from "../src/lib/policy.ts";
import { canWatchChannel, createPusherAuthRoute, decidePusherAuth } from "../src/lib/pusher-auth.ts";
import { CUSTOM_SKILLS } from "../src/skills/custom.generated.ts";

const SECRET = "outbound-webhook-secret-0123456789";

function outboxSql() {
  const sql = new NodeSqlStore();
  new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
  return sql;
}

function scriptedFetch(statuses: number[]) {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const event = (id: string): TelemetryEvent => ({ id, type: "turn", runId: "background-worker--tenant_a--x", tenantId: "tenant_a", senderId: "a", senderRole: "a", content: "turn done, card 4242 4242 4242 4242", logType: "info", turnCount: 1, accumulatedCost: 0.01, runtimeSeconds: 1, timestamp: 1 });

describe("durable webhook outbox (R-EVT-11)", () => {
  it("parks a delivery that failed its retries and the cron drain delivers it later, re-signed", async () => {
    const sql = outboxSql();
    const queued: OutboxEntry[] = [];
    const down = scriptedFetch([503]);
    const relay = new WebhookRelay({ url: "https://saas.test/hooks", secret: SECRET, fetch: down.fetch, maxAttempts: 1 });
    const result = await deliverWithOutbox(relay, { enqueue: async (entry) => void queued.push(entry) }, "https://saas.test/hooks", { type: "job.result", tenantId: "tenant_a", note: "token sk-live-abcdefghijklmnopqrstuvwx" }, { tenantId: "tenant_a", eventId: "evt_1", eventType: "job.result" });
    expect(result).toMatchObject({ delivered: false, queued: true });
    expect(queued).toHaveLength(1);
    // Stored exactly as it would have been sent: redacted.
    expect(queued[0]?.body).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
    insertOutboxRow(sql, queued[0] as OutboxEntry, Date.now() - 60_000);
    expect(outboxBacklog(sql)).toEqual({ pending: 1, dead: 0 });

    const up = scriptedFetch([200]);
    expect(await drainWebhookOutbox(sql, SECRET, { fetch: up.fetch })).toMatchObject({ delivered: 1, failed: 0, pending: 0 });
    expect(up.calls[0]?.url).toBe("https://saas.test/hooks");
    expect(up.calls[0]?.headers["x-agent-event-id"]).toBe("evt_1");
    await expect(verifySignature(SECRET, up.calls[0]?.body ?? "", up.calls[0]?.headers["x-agent-signature"] ?? null)).resolves.toBeUndefined();
    // Nothing left to retry.
    expect(await drainWebhookOutbox(sql, SECRET, { fetch: scriptedFetch([]).fetch })).toMatchObject({ delivered: 0, pending: 0 });
  });

  it("keeps retrying with backoff, then marks the row DEAD after 12 attempts", async () => {
    const sql = outboxSql();
    insertOutboxRow(sql, { destination: "https://saas.test/hooks", body: "{}", tenantId: "t", eventId: "e" }, 0);
    for (let i = 0; i < 12; i++) {
      sql.exec(`UPDATE as_outbox SET next_attempt_at = 0`);
      await drainWebhookOutbox(sql, SECRET, { fetch: scriptedFetch([500]).fetch, now: 0 });
    }
    expect(outboxBacklog(sql)).toEqual({ pending: 0, dead: 1 });
  });

  it("delivers directly when the SaaS answers, and the telemetry sink never throws into the agent", async () => {
    const ok = scriptedFetch([200]);
    const queued: OutboxEntry[] = [];
    const outbox = { enqueue: async (entry: OutboxEntry) => void queued.push(entry) };
    await new OutboxWebhookSink(new WebhookRelay({ url: "https://saas.test/hooks", secret: SECRET, fetch: ok.fetch }), "https://saas.test/hooks", () => outbox).publish(event("e1"));
    expect(ok.calls).toHaveLength(1);
    expect(queued).toEqual([]);
    const down = scriptedFetch([500]);
    const failing = { enqueue: async () => Promise.reject(new Error("registry down")) };
    await expect(new OutboxWebhookSink(new WebhookRelay({ url: "https://saas.test/hooks", secret: SECRET, fetch: down.fetch, maxAttempts: 1 }), "https://saas.test/hooks", () => failing).publish(event("e2"))).resolves.toBeUndefined();
  });
});

describe("signed artifact links (R-EVT-11)", () => {
  const key = "tenants/tenant_a/artifacts/2026-11-10/report.md";
  const routes = (blobs: MemoryBlobStore) => createArtifactRoutes<object>({ secrets: () => ["old-artifact-secret-0123456789", SECRET], blobs: () => blobs });

  it("serves the tenant's artifact to a valid link, and nothing else", async () => {
    const blobs = new MemoryBlobStore();
    await blobs.put(key, "# Report", { contentType: "text/markdown" });
    await blobs.put("tenants/tenant_a/workspace/secret.txt", "private");
    const url = (await signArtifactUrl({ baseUrl: "https://agents.example.org/", secret: SECRET, tenantId: "tenant_a", key })) as string;
    expect(url).toMatch(/^https:\/\/agents\.example\.org\/artifacts\/tenant_a\/2026-11-10\/report\.md\?exp=\d+&sig=[0-9a-f]{64}$/);
    const path = new URL(url).pathname + new URL(url).search;
    // Flip the signature's last hex digit to a different one (a fixed replacement would be a no-op 1 time in 16).
    const sig = new URL(url).searchParams.get("sig") as string;
    const tampered = path.replace(sig, `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`);
    expect(tampered).not.toBe(path);
    const ok = await routes(blobs).request(path);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("# Report");
    expect(ok.headers.get("content-type")).toBe("text/markdown");
    // Tampered signature, another object, another tenant, traversal: all refused.
    expect((await routes(blobs).request(tampered)).status).toBe(403);
    expect((await routes(blobs).request(path.replace("report.md", "other.md"))).status).toBe(403);
    expect((await routes(blobs).request(path.replace("/tenant_a/", "/tenant_b/"))).status).toBe(403);
    expect((await routes(blobs).request(path.replace("2026-11-10/report.md", "..%2Fworkspace%2Fsecret.txt"))).status).toBe(403);
    // A deleted artifact is a 404 for a valid link.
    await blobs.delete(key);
    expect((await routes(blobs).request(path)).status).toBe(404);
  });

  it("never signs another tenant's key or a non-artifact object, and links expire", async () => {
    expect(await signArtifactUrl({ baseUrl: "https://a.test", secret: SECRET, tenantId: "tenant_b", key })).toBeNull();
    expect(await signArtifactUrl({ baseUrl: "https://a.test", secret: SECRET, tenantId: "tenant_a", key: "tenants/tenant_a/shadow/abc/diff.json" })).toBeNull();
    expect(await signArtifactUrl({ baseUrl: "https://a.test", secret: SECRET, tenantId: "tenant_a", key: "tenants/tenant_a/artifacts/../workspace/x" })).toBeNull();
    expect(parseArtifactKey(key)).toEqual({ tenantId: "tenant_a", path: "2026-11-10/report.md" });
    const url = new URL((await signArtifactUrl({ baseUrl: "https://a.test", secret: SECRET, tenantId: "tenant_a", key, ttlSeconds: 60, now: 0 })) as string);
    const input = { tenantId: "tenant_a", path: "2026-11-10/report.md", exp: Number(url.searchParams.get("exp")), sig: url.searchParams.get("sig") ?? "" };
    expect(await verifyArtifactLink([SECRET], { ...input, now: 30_000 })).toBe(true);
    expect(await verifyArtifactLink([SECRET], { ...input, now: 61_000 })).toBe(false);
    expect(signingSecret({ WEBHOOK_SIGNING_SECRET: "shared" }, "artifacts")).toBe("shared");
    expect(signingSecret({ WEBHOOK_SIGNING_SECRET: "shared", ARTIFACT_SIGNING_SECRET: "own" }, "artifacts")).toBe("own");
  });
});

describe("Pusher channel auth (spec checklist item 6)", () => {
  const SESSION = "session-secret-for-tests-0123456789";
  const keys = { key: "app-key", secret: "pusher-secret" };
  const own = "assistant--tenant_a--user_1.main";
  const channel = (tenantId: string, room: string) => tenantChannelName(tenantId, room);
  const claims = (roles: string[] = ["member"], sub = "user_1", tid = "tenant_a") => ({ sub, tid, roles, scopes: [], env: "production" as const, iat: 0, exp: 9_999_999_999 });

  it("answers 400 / 401 / 400 / 403 like the spec and authorizes owners and operators", async () => {
    expect((await decidePusherAuth({ socketId: "1.2", channelName: null, claims: claims(), ...keys })).status).toBe(400);
    expect((await decidePusherAuth({ socketId: "1.2", channelName: channel("tenant_a", own), claims: null, ...keys })).status).toBe(401);
    expect((await decidePusherAuth({ socketId: "1.2", channelName: "presence-anything", claims: claims(), ...keys })).status).toBe(400);
    expect((await decidePusherAuth({ socketId: "bad", channelName: channel("tenant_a", own), claims: claims(), ...keys })).status).toBe(400);
    // Another tenant's channel, or another user's run in the same tenant.
    expect((await decidePusherAuth({ socketId: "1.2", channelName: channel("tenant_b", own), claims: claims(), ...keys })).status).toBe(403);
    expect((await decidePusherAuth({ socketId: "1.2", channelName: channel("tenant_a", "assistant--tenant_a--user_2.main"), claims: claims(), ...keys })).status).toBe(403);
    const mine = await decidePusherAuth({ socketId: "1.2", channelName: channel("tenant_a", own), claims: claims(), ...keys });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ auth: expect.stringMatching(/^app-key:[0-9a-f]{64}$/) });
    // Operators watch every run and room of their tenant (jobs, swarms), never another tenant's.
    expect(canWatchChannel(claims(["operator"]), { tenantId: "tenant_a", roomId: "background-worker--tenant_a---job.x" })).toBe(true);
    expect(canWatchChannel(claims(["admin"]), { tenantId: "tenant_b", roomId: "x" })).toBe(false);
    // A conversation-bound token (cid) watches only that conversation, whatever its roles.
    expect(canWatchChannel({ ...claims(["operator"]), cid: own }, { tenantId: "tenant_a", roomId: "background-worker--tenant_a---job.x" })).toBe(false);
    expect(canWatchChannel({ ...claims(), cid: own }, { tenantId: "tenant_a", roomId: own })).toBe(true);
  });

  it("mounts as POST /api/pusher/auth: 404 until configured, session from the bearer token, form bodies", async () => {
    const off = createPusherAuthRoute<object>({ keys: () => undefined, sessionSecrets: () => [SESSION] });
    expect((await off.request("/api/pusher/auth", { method: "POST" })).status).toBe(404);
    const on = createPusherAuthRoute<object>({ keys: () => keys, sessionSecrets: () => [SESSION] });
    const form = (room: string) => new URLSearchParams({ socket_id: "123.456", channel_name: channel("tenant_a", room) });
    expect((await on.request("/api/pusher/auth", { method: "POST", body: form(own) })).status).toBe(401);
    const token = await createSessionToken(SESSION, { sub: "user_1", tid: "tenant_a", roles: ["member"] }, 600);
    const ok = await on.request("/api/pusher/auth", { method: "POST", body: form(own), headers: { authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ auth: expect.stringContaining("app-key:") });
    expect((await on.request("/api/pusher/auth", { method: "POST", body: new URLSearchParams({ socket_id: "1.2" }), headers: { authorization: `Bearer ${token}` } })).status).toBe(400);
  });
});

describe("config-driven runtime (contract 5, finding 24/26)", () => {
  it("never lets an agent's own cap loosen the config, and a tighter config always wins", () => {
    expect(stricterTier("HIGH", "MEDIUM")).toBe("MEDIUM");
    expect(stricterTier("LOW", "MEDIUM")).toBe("LOW");
    expect(stricterTier("MEDIUM", undefined)).toBe("MEDIUM");
  });

  it("reports the stricter of config and tenant budgets", () => {
    const config = defineAgentStarterConfig({ name: "app", targetDomain: "Testing domain", modules: ["background"], budget: { hardCeilingUsd: 1.5, maxReasoningTurnsPerJob: 25 } });
    expect(effectiveBudget(config)).toEqual({ budgetUsd: 1.5, maxTurns: 25 });
    expect(effectiveBudget(config, SECURE_DEFAULT_TENANT_CONFIG)).toEqual({ budgetUsd: SECURE_DEFAULT_TENANT_CONFIG.maxBudgetUsd, maxTurns: SECURE_DEFAULT_TENANT_CONFIG.maxTurnsPerSession });
    expect(effectiveBudget(config, { maxBudgetUsd: 10, maxTurnsPerSession: 200 })).toEqual({ budgetUsd: 1.5, maxTurns: 25 });
  });

  it("runs the utility model on the configured Workers AI first-line model", () => {
    expect(workersAiModel("cloudflare/@cf/meta/llama-3.1-8b-instruct")).toBe("@cf/meta/llama-3.1-8b-instruct");
    expect(workersAiModel("@cf/qwen/qwen3-30b-a3b-fp8")).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
    expect(workersAiModel("openai/gpt-5-nano")).toBeUndefined();
  });

  it("gives every agent the domain line from targetDomain / primaryDatabase, never the scaffold placeholder", () => {
    expect(domainInstruction({ targetDomain: "Manychat CRM customer engagement", primaryDatabase: "PostgreSQL via Hyperdrive" })).toBe("Domain: Manychat CRM customer engagement. System of record: PostgreSQL via Hyperdrive (reach it only through your tools).");
    expect(domainInstruction({ targetDomain: PLACEHOLDER_TARGET_DOMAIN, primaryDatabase: "x" })).toBe("");
    expect(Array.isArray(CUSTOM_SKILLS)).toBe(true);
  });

  it("flags shadow divergences as warnings that never change the production run's status", () => {
    const shadow = opsAlertEvent({ code: "SHADOW_DIVERGENCE", tenantId: "t", runId: "job", agent: "background-worker", content: "diverged" });
    expect(shadow).toMatchObject({ type: "log", logType: "warning", data: { alert: "SHADOW_DIVERGENCE" } });
    expect(shadow.status).toBeUndefined();
    expect(opsAlertEvent({ code: "AGENT_CRITICAL_HALT", tenantId: "t", runId: "r", agent: "a", content: "x" }).status).toBe("HALTED");
  });
});
