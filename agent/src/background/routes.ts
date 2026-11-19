import { createIngestionHandler, KVStore, signedDeliveryVerifier } from "@agent-starter/cloudflare";
import { agentInstanceId, harnessSessionKey, parseAgentInstanceId, randomId, type SessionClaims, sha256Hex, verifySessionToken } from "@agent-starter/core";
import { ChatMessageEventSchema, ManychatWebhookPayloadSchema, STRIPE_SIGNATURE_HEADER, StripeWebhookEventSchema, verifyStripeSignature } from "@agent-starter/integrations";
import { init } from "@flue/runtime";
import { Hono } from "hono";
import { z } from "zod";
import { BackgroundWorker } from "../agents/background-worker.ts";
import type { Env } from "../env.ts";
import { hasScope } from "../lib/permissions.ts";
import { classifyDelivery, dispatchInitialData, registry, tenantBudget, TenantRateLimiter } from "../lib/platform.ts";
import { signingSecret } from "../lib/policy.ts";
import { runRecoveryHooks } from "../lib/recovery.ts";
import { trackedDispatch } from "../lib/submissions.ts";
import { listDeadLetters, purgeDeadLetters, replayDeadLetters } from "./dlq.ts";
import { BACKGROUND_AGENT, classifyStep } from "./jobs.ts";
import { MARKETER_EVENT_SESSION, marketerEventId, MarketerEventSchema } from "./marketer-events.ts";
import { manychatEventId, marketerWebhookSecrets, signedBodyHash, stripeSessionKey, stripeWebhookSecrets, webhookSecrets } from "./webhooks.ts";

const TENANT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/**
 * Operator session: job control, the DLQ and the kill switch need `security:manage` (owner or admin in the catalog,
 * held as role AND scope). Widget visitor and voice tokens are refused (no restricted audience accepted).
 */
async function operator(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<SessionClaims | null> {
  try {
    const claims = await verifySessionToken([c.env.SESSION_SIGNING_SECRET, c.env.SESSION_SIGNING_SECRET_PREVIOUS ?? ""], c.req.header("authorization") ?? null);
    return hasScope(claims, "security:manage") ? claims : null;
  } catch {
    return null;
  }
}

/** Replay cache for signed deliveries (KV): a replayed webhook inside the window is acknowledged and dropped. */
const nonceCache = (env: Env) => ({ store: new KVStore(env.AGENT_CACHE), ttlSeconds: 900, prefix: "nonce:webhook:" });

const ownJob = (claims: SessionClaims | null, id: string): claims is SessionClaims => {
  const parsed = claims ? parseAgentInstanceId(id) : null;
  return claims !== null && parsed !== null && parsed.agent === BACKGROUND_AGENT && parsed.tenantId === claims.tid;
};

/**
 * Event ingestion + job control.
 *   POST /webhooks/manychat/:tenantId   Manychat contact events, signed request (per-tenant secret, else MANYCHAT_WEBHOOK_SECRET / INBOUND_WEBHOOK_SECRET)
 *   POST /events/:source/:tenantId      Generic chat/app events (ChatMessageEventSchema), signed request (per-tenant secret, else INBOUND_WEBHOOK_SECRET)
 *   (INBOUND_WEBHOOK_SECRET falls back to WEBHOOK_SIGNING_SECRET, see src/lib/policy.ts signingSecret)
 *   POST /webhooks/stripe/:tenantId     Stripe events (Stripe-Signature with the tenant's OWN endpoint secret; no shared fallback)
 *   POST /webhooks/marketer/:tenantId   Marketer pipeline events (job/article done or failed, awaiting approval, ad approval
 *                                       pending): X-Marketer-Signature with the tenant's OWN endpoint secret; no shared fallback
 *   POST /api/jobs                      Start a job manually (operator session; utility-model routed, tenant config seeded)
 *   GET  /api/jobs/:id                  Job liveness/status from the run registry + budgetUsd / maxTurns (config and
 *                                       tenant limits, the stricter wins) + vmSeconds when the run used VMs
 *   POST /api/jobs/:id/pause            Abort the running submission (status HALTED, resumable)
 *   POST /api/jobs/:id/resume           Wake a HALTED / FAILED job with a resume signal
 *   POST /api/jobs/:id/teardown         Emergency stop: abort, stop compute (recovery hooks), status TERMINATED
 *   GET  /api/dlq                       Dead letters of the caller's tenant
 *   POST /api/dlq/replay                Re-enqueue dead letters ({ keys?: string[] })
 *   POST /api/dlq/purge                 Drop dead letters ({ keys?: string[] })
 * Signed requests cover method + path + body (`signRequest(secret, { method: "POST", path, body })`), so a
 * delivery for one tenant / source never verifies on another, and nonces and event ids come from signed
 * data only (SEC-06). Ingestion applies the tenant event rate limit (429 + retry-after) and a KV replay
 * cache (duplicate → 200 `{ duplicate: true }`) before anything is queued; the consumer's event ledger
 * catches the rest.
 */
export const backgroundRoutes = new Hono<{ Bindings: Env }>()
  .post("/webhooks/manychat/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    if (!TENANT.test(tenantId)) return c.json({ error: "INVALID_TENANT" }, 400);
    let bodyHash = "";
    return createIngestionHandler({
      source: "manychat",
      schema: ManychatWebhookPayloadSchema,
      verify: async (raw, request) => {
        const verified = await signedDeliveryVerifier(() => webhookSecrets(c.env.TENANT_CONFIG, tenantId, [c.env.MANYCHAT_WEBHOOK_SECRET, signingSecret(c.env, "inbound")]))(raw, request);
        bodyHash = await signedBodyHash(raw);
        return verified;
      },
      tenantId: () => tenantId,
      sessionKey: (p) => `contact-${p.contact.id}`,
      eventType: (p) => p.event,
      // Manychat sends no event id: derive it from the signed body (never from unsigned headers).
      eventId: (p) => manychatEventId(p, bodyHash),
      queue: c.env.EVENTS_QUEUE as Queue,
      rateLimiter: new TenantRateLimiter(c.env),
      nonceCache: nonceCache(c.env),
    })(c.req.raw);
  })
  .post("/events/:source/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const source = c.req.param("source");
    if (!TENANT.test(tenantId) || !/^[a-z0-9-]{1,40}$/.test(source)) return c.json({ error: "INVALID_ROUTE" }, 400);
    return createIngestionHandler({
      source,
      schema: ChatMessageEventSchema,
      verify: signedDeliveryVerifier(() => webhookSecrets(c.env.TENANT_CONFIG, tenantId, [signingSecret(c.env, "inbound")])),
      tenantId: () => tenantId,
      // One agent session per conversation on a channel (never a tenant-wide "default" session).
      sessionKey: (p) => `${p.channel}:${p.conversationId}`,
      eventType: (p) => p.type,
      // The provider's message id (signed body): redeliveries collapse onto one envelope id.
      eventId: (p) => p.id,
      queue: c.env.EVENTS_QUEUE as Queue,
      rateLimiter: new TenantRateLimiter(c.env),
      nonceCache: nonceCache(c.env),
    })(c.req.raw);
  })
  .post("/webhooks/stripe/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    if (!TENANT.test(tenantId)) return c.json({ error: "INVALID_TENANT" }, 400);
    // Stripe signs `t.body` only: the tenant is bound by its own endpoint secret, so there is no shared fallback.
    const secrets = await stripeWebhookSecrets(c.env.TENANT_CONFIG, tenantId);
    if (!secrets.length) return c.json({ error: "STRIPE_NOT_CONFIGURED" }, 404);
    return createIngestionHandler({
      source: "stripe",
      // Only a bounded, cleansed summary of the event reaches the agent (never the raw data.object).
      schema: StripeWebhookEventSchema,
      verify: async (raw, request) => {
        await verifyStripeSignature(secrets, raw, request.headers.get(STRIPE_SIGNATURE_HEADER));
        return { nonce: `stripe:${tenantId}:${(await sha256Hex(raw)).slice(0, 48)}` };
      },
      tenantId: () => tenantId,
      sessionKey: stripeSessionKey,
      eventType: (e) => e.type,
      // Stripe event ids (`evt_…`) are unique and stable across Stripe's retries.
      eventId: (e) => e.id,
      queue: c.env.EVENTS_QUEUE as Queue,
      rateLimiter: new TenantRateLimiter(c.env),
      nonceCache: nonceCache(c.env),
    })(c.req.raw);
  })
  .post("/webhooks/marketer/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    if (!TENANT.test(tenantId)) return c.json({ error: "INVALID_TENANT" }, 400);
    // Marketer signs `t.body` only (the Stripe scheme): the tenant is bound by its own endpoint secret, never a shared one.
    const secrets = await marketerWebhookSecrets(c.env.TENANT_CONFIG, tenantId);
    if (!secrets.length) return c.json({ error: "MARKETER_WEBHOOK_NOT_CONFIGURED" }, 404);
    let signedAt = 0;
    return createIngestionHandler({
      source: "marketer",
      // Bounded, typed fields only; titles and errors stay untrusted data for the agent.
      schema: MarketerEventSchema,
      verify: async (raw, request) => {
        signedAt = (await verifyStripeSignature(secrets, raw, request.headers.get("x-marketer-signature"))).timestamp;
        return { nonce: `marketer:${tenantId}:${(await sha256Hex(raw)).slice(0, 48)}:${signedAt}` };
      },
      tenantId: () => tenantId,
      sessionKey: () => MARKETER_EVENT_SESSION,
      eventType: (e) => e.event,
      eventId: (e) => marketerEventId(e, signedAt),
      queue: c.env.EVENTS_QUEUE as Queue,
      rateLimiter: new TenantRateLimiter(c.env),
      nonceCache: nonceCache(c.env),
    })(c.req.raw);
  })
  .post("/api/jobs", async (c) => {
    const claims = await operator(c);
    if (!claims) return c.json({ error: "FORBIDDEN" }, 403);
    const body = z
      .object({ objective: z.string().min(5).max(2000), sessionKey: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "INVALID_REQUEST", issues: body.error.issues }, 400);
    // Job-scoped, harness-owned instance: every manual job gets its own workflow state and budget.
    const sessionKey = harnessSessionKey("job", `${body.data.sessionKey ?? "manual"}.${(await sha256Hex(`${claims.sub}\u0000${body.data.objective}\u0000${randomId()}`)).slice(0, 16)}`);
    const id = agentInstanceId(BACKGROUND_AGENT, claims.tid, sessionKey);
    // Same cheap router as queued events: the utility model's SIMPLE / COMPLEX verdict steers the job's model.
    const route = await classifyStep({ classify: (text) => classifyDelivery(text), log: (m) => console.warn(m) }, body.data.objective);
    const receipt = await trackedDispatch(c.env, BackgroundWorker, {
      id,
      message: { kind: "signal", type: "job", body: body.data.objective, ...(route ? { attributes: { route } } : {}) },
      initialData: await dispatchInitialData(claims.tid, { userId: claims.sub, roles: claims.roles, objective: body.data.objective }),
    });
    await registry(c.env).beat({ runId: id, tenantId: claims.tid, agent: BACKGROUND_AGENT });
    return c.json({ accepted: true, jobId: id, submissionId: receipt.submissionId, streamUrl: `/agents/background-worker/${id}` }, 202);
  })
  .get("/api/jobs/:id", async (c) => {
    const claims = await operator(c);
    const id = c.req.param("id");
    if (!ownJob(claims, id)) return c.json({ error: "FORBIDDEN" }, 403);
    const reg = registry(c.env);
    const [run, budget, counters] = await Promise.all([reg.get(id), tenantBudget(claims.tid), reg.runCounters(id).catch(() => null)]);
    // Before its first heartbeat a dispatched job has no registry record yet: status null.
    return c.json({ ...(run ?? { runId: id, status: null }), ...budget, ...(counters && counters.vmSeconds > 0 ? { vmSeconds: counters.vmSeconds } : {}) });
  })
  .post("/api/jobs/:id/pause", async (c) => {
    const claims = await operator(c);
    const id = c.req.param("id");
    if (!ownJob(claims, id)) return c.json({ error: "FORBIDDEN" }, 403);
    await registry(c.env).setStatus(id, "HALTED", `Paused by ${claims.sub}`);
    await init(BackgroundWorker, { id }).abort();
    return c.json({ paused: true });
  })
  .post("/api/jobs/:id/resume", async (c) => {
    const claims = await operator(c);
    const id = c.req.param("id");
    if (!ownJob(claims, id)) return c.json({ error: "FORBIDDEN" }, 403);
    const run = await registry(c.env).get(id);
    if (!run) return c.json({ error: "NOT_FOUND" }, 404);
    if (run.status === "TERMINATED") return c.json({ error: "JOB_TERMINATED", message: "Torn-down jobs cannot be resumed; start a new job." }, 409);
    if (run.status !== "HALTED" && run.status !== "FAILED") return c.json({ error: "NOT_PAUSED", status: run.status }, 409);
    const note = z.object({ note: z.string().max(1000).optional() }).safeParse(await c.req.json().catch(() => ({})));
    await trackedDispatch(c.env, BackgroundWorker, {
      id,
      message: {
        kind: "signal",
        type: "resume",
        body: `An operator (${claims.sub}) resumed this job. Re-check the workflow state and goals, verify the outcome of the last action before repeating it, then continue.${note.success && note.data.note ? `\nOperator note: ${note.data.note}` : ""}`,
      },
      idempotencyKey: `resume:${id}:${run.updatedAt}`,
    });
    await registry(c.env).setStatus(id, "RUNNING", `Resumed by ${claims.sub}`);
    return c.json({ resumed: true });
  })
  .post("/api/jobs/:id/teardown", async (c) => {
    const claims = await operator(c);
    const id = c.req.param("id");
    if (!ownJob(claims, id)) return c.json({ error: "FORBIDDEN" }, 403);
    // TERMINATED first so the abort's settlement and late heartbeats never revive it.
    await registry(c.env).setStatus(id, "TERMINATED", `Emergency teardown by ${claims.sub}`);
    await init(BackgroundWorker, { id }).abort();
    const hooks = await runRecoveryHooks({ runId: id, tenantId: claims.tid, agent: BACKGROUND_AGENT, reason: "teardown", attempt: 1, env: c.env });
    return c.json({ terminated: true, compute: hooks });
  })
  .get("/api/dlq", async (c) => {
    const claims = await operator(c);
    if (!claims) return c.json({ error: "FORBIDDEN" }, 403);
    const letters = await listDeadLetters(c.env, claims.tid, Number(c.req.query("limit") ?? 100));
    return c.json({ tenantId: claims.tid, count: letters.length, letters });
  })
  .post("/api/dlq/replay", async (c) => {
    const claims = await operator(c);
    if (!claims) return c.json({ error: "FORBIDDEN" }, 403);
    const body = z.object({ keys: z.array(z.string().max(300)).max(1000).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    return c.json(await replayDeadLetters(c.env, claims.tid, body.data.keys));
  })
  .post("/api/dlq/purge", async (c) => {
    const claims = await operator(c);
    if (!claims) return c.json({ error: "FORBIDDEN" }, 403);
    const body = z.object({ keys: z.array(z.string().max(300)).max(1000).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    return c.json(await purgeDeadLetters(c.env, claims.tid, body.data.keys));
  });
