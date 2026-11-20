---
name: agent-starter-background-jobs
description: Build and change the no-chat, background-only path of an Agent Starter project — signed webhook ingestion (method+path+body signatures, per-tenant secrets, Stripe, tenant rate limits, event-id dedupe), Queue coalescing, job routing (src/background/jobs.ts: open or closed jobs, racing consumers, turn deferral by re-enqueue), the flagship chain (job → utility-model router → analyst query or computer operator → report), recipient-bound approvals, shadow forking with diffs in R2, DLQ drain/replay, crons (heartbeat sentinel, efficiency report), long tools that keep beating, the run registry and stalled-run recovery, ops alerts as telemetry, tenant config sync, operator job controls and live progress. Use when adding an event source or webhook, writing a background/job agent, touching src/background/*, src/lib/cron.ts, src/lib/run-status.ts, src/lib/registry.ts, queue or cron config in wrangler.jsonc, or debugging stuck, duplicated or dropped jobs.
---

# Background jobs (event-driven agents, no chat)

A project with **only** the `background` module (plus base) is a first-class Agent Starter app: events in,
durable agent turns, artifacts and signed webhooks out, humans approving by email link. Nothing in this path
needs a chat UI.

```
POST /events/<source>/:tenantId, /webhooks/manychat/:tenantId ─▶ createIngestionHandler (signedDeliveryVerifier: method+path+body with the
POST /webhooks/stripe/:tenantId (Stripe-Signature, tenant's own secret)   tenant's secret → zod → tenant EVENT bucket (429) → KV nonce from
                                         │                                signed data (replay → 200 duplicate) → Queue.send → 202)
                                         │  EventEnvelope { id: `${source}:${providerId}`, tenantId, source, type, sessionKey, payload }
                                         ▼
  Queue "<project>-events" (batch 10 / 10 s, max_retries 5, DLQ <project>-events-dlq)
                                         ▼
src/cloudflare.ts queue() → handleEventsQueue → processEventBatch → dispatchJobTurn (src/background/jobs.ts)
      coalesce per tenant+session → drop already-dispatched event ids (KV evt:*) → tenant TURN bucket (deny → re-enqueue with delay, ack)
      → job id (open job of the session, else next job of the session pointer) → utility model classifies the turn (route SIMPLE|COMPLEX)
      → trackedDispatch(BackgroundWorker, { id, idempotencyKey, initialData: dispatchInitialData(tenant) }) → ack / retry
      → sampled jobs (SHADOW_SAMPLE_RATE): same turn to a shadow twin (mode "shadow")
                                         ▼
BackgroundWorker DO (Flue, one per JOB): FSM INGEST→EVALUATE→EXECUTE→REPORT→DONE, model per stamped route, guarded tools,
      config budget/autonomy, recipient-bound approvals; delegate_task → analyst-agent / computer-operator; send_agent_message (bus)
      └─ save_artifact (R2) + notify_saas (signed webhook + artifact link; outbox on failure)   heartbeats + run status + wf:* marker → registry DO / KV
Queue "<project>-events-dlq" → handleEventsDlq → R2 dlq/agent-events/<tenant>/… + ops alert → GET /api/dlq, POST /api/dlq/replay
cron "* * * * *"  → sweepHeartbeats (drain webhook outbox; stalled RUNNING runs → abort head, recovery hooks, recovery signal, re-admit)
cron "17 6 * * *" → dailyEfficiencyReport (registry ledger vs config budget → SaaS webhook / ops email)
```

## When to use
- Adding a webhook/event source, a new background agent, or a new queue consumer.
- Changing coalescing, retries, DLQ, cron schedules, recovery or the run registry.
- Building operator controls (start/pause a job, live trajectory) or debugging duplicate/stuck/dropped jobs.

## Mental model — who owns what

| Concern | File (generated project) | Library source |
|---|---|---|
| Webhook → envelope → Queue (signed requests, Stripe) | `src/background/routes.ts`; helpers in `src/background/webhooks.ts` (`webhookSecrets`, `stripeWebhookSecrets`, `manychatEventId`, `stripeSessionKey`) | `packages/cloudflare/src/ingestion.ts` `createIngestionHandler`, `signedDeliveryVerifier`; `packages/integrations/src/webhooks.ts` `verifyStripeSignature`, `StripeWebhookEventSchema` |
| Tenant rate limiters (`TenantConfig.rateLimit`): events at the edge, turns in the consumer | `src/lib/platform.ts` `TenantRateLimiter(env, configs, "events" \| "turns")`, prefixes `src/lib/policy.ts` `RATE_LIMIT_PREFIXES` | `TokenBucketRateLimiter` (core) |
| Envelope, coalescing, ids, harness session keys, token bucket | — | `packages/core/src/ingestion/events.ts` |
| Queue consumer (wiring) | `src/background/queue.ts` `handleEventsQueue`, `jobDispatchDeps` | `processEventBatch`, `renderTurn` |
| Job routing (pure, unit-tested) | `src/background/jobs.ts` `dispatchJobTurn`, `jobIdFor`, `isOpenJob`, `rerouteTarget`, `jobWorkflow` | `harnessSessionKey`, `createJobStateMachineDefinition` (core) |
| Delegation from jobs (flagship chain) | `src/background/delegation.ts` `BACKGROUND_DELEGATES`; transport `src/lib/delegation.ts` `delegationDispatch`, `composedRoster` | `packages/flue/src/delegation.ts` `createDelegationTools`, `useDelegation` |
| Shadow forking (R-EVAL-10) | `src/background/shadow.ts` | `diffTrajectories` (`@agent-starter/evals`) |
| DLQ consumer + drain/replay | `src/background/dlq.ts`, `scripts/replay-dlq.mjs` (`pnpm dlq:replay`) | — |
| Submission ledger (what an abort would cancel) | `src/lib/submissions.ts` `trackedDispatch` | — |
| Compute cleanup on recovery/teardown | `src/lib/recovery.ts` `registerRecoveryHook` | — |
| Queue/cron dispatch switch | `src/cloudflare.ts` (generated by `compose.ts` `cloudflareTs`) | — |
| The job agent | `src/agents/background-worker.ts` | `createJobStateMachineDefinition` (core), `useAgentStarter` (flue) |
| Job protocol the model follows | `src/skills/job-execution/SKILL.md` | — |
| Run registry DO (liveness ledger) | `src/lib/registry.ts` (`AgentRunRegistry extends RunRegistry`) | `packages/cloudflare/src/durable-objects.ts`, `packages/core/src/runtime/run-store.ts` |
| Heartbeats + run status + workflow marker | `src/lib/platform.ts` `heartbeat()`, `observerOptions()`; `src/lib/run-status.ts` `createRunStatusObserver`, `createHookHeartbeat` | `packages/flue/src/observer.ts` |
| Ops alerts as telemetry (budget breach, AGENT_CRITICAL_HALT, SHADOW_DIVERGENCE) | `src/lib/alerts.ts`; `src/lib/platform.ts` `emitOpsAlert`, `platform().budgetBreach` | `WebhookRelay` (core), `PusherPublisher` (integrations) |
| Durable webhook outbox (job results, telemetry, alerts, reports) | `src/lib/outbox.ts`; table in `src/lib/registry.ts` (`outboxEnqueue`, `drainOutbox`); `platform.ts` `sendToSaas`, `telemetrySinks`; drained by `src/lib/cron.ts` | `WebhookRelay.drainOutbox` (core) |
| Signed artifact download links | `src/lib/artifacts.ts` (`GET /artifacts/:tenantId/*`); `platform.ts` `artifactUrl`, `artifactRoutes` | `hmacSha256Hex` (core) |
| Config accessors and server-dispatch seed | `src/lib/platform.ts` `dispatchInitialData`, `budgetLimits`, `autonomyPolicy`, `tenantBudget`, `integrationEnabled`, `classifyDelivery` | `applyPlatformPolicy` (`src/lib/policy.ts`) |
| Custom skills + domain line; message bus link | `src/lib/custom-skills.ts` `useCustomSkills`; generated `src/skills/custom.generated.ts`, `src/lib/bus.generated.ts` | `busTools` (multi-agent module) |
| Heartbeat sentinel cron | `src/lib/cron.ts` `sweepHeartbeats` | `packages/cloudflare/src/sentinel.ts` `sweepStalledRuns` |
| Daily efficiency report cron | `src/background/report.ts` | `packages/core/src/analytics/analytics.ts` `generateEfficiencyReport` |
| Tenant config sync (SaaS → KV) | mounted in `src/app.ts` | `packages/cloudflare/src/tenant-sync.ts`, `TenantConfigProvider` (core) |
| Operator dashboard | `web/JobControlPanel.tsx` (pause / resume / teardown, approve / reject by id) | `AgentControlPanel`, `useAgentChat` (react) |
| Queue/cron/DLQ config | `wrangler.jsonc` (from `templates/modules/background/module.json`) | — |

Template sources live in `packages/create-agent-starter/templates/modules/background/files/` and
`templates/base/files/` — edit those (not `examples/full`) when changing what new projects get.

## API reference
Full signatures (ingestion, consumer, sentinel, registry RPC, base helpers, job routing, shadow, DLQ):
[references/api-reference.md](references/api-reference.md). The ones you touch most:
```ts
dispatchJobTurn(deps, turn)   // deps: kv, registry, dispatch, render, limiter?, requeue?, shadow?, classify? (→ route), initialData? (→ tenantConfig)
dispatchInitialData(tenantId, extra?) · budgetLimits() · autonomyPolicy(agentCap?) · tenantBudget(tenantId) · classifyDelivery(text)
sendToSaas(payload, meta) · artifactUrl(tenantId, key) · emitOpsAlert({ code, tenantId, runId, agent, content, data? })
trackedDispatch(env, agent, request) · registerRecoveryHook(name, hook) · jobWorkflow(delegation, bus?) · handoffSignal(input)
```

Durability inside tools: `useAgentStarter` mounts every `write`/`external`/`destructive` tool with Flue
`durable: true`, and the core `ToolExecutor` runs the side effect inside `ctx.step("tool:<name>", …)`
(`packages/core/src/tools/executor.ts`). Without a Flue step (Node `AgentRuntime`), the
`SqlIdempotencyStore` dedupes by `ctx.idempotencyKey` and a mid-flight crash of a non-idempotent tool
returns `UNKNOWN_OUTCOME` instead of re-running it.

Long tools stay alive: the run-status observer beats every 60 s while one tool call is in flight (up to 15 min per call),
and tools that run long work (VM commands, coder tests, repo import/push) also call `ctx.services.heartbeat` on an interval,
so the 180 s sentinel threshold only catches real stalls.

## Recipes

### 1. Add a webhook source
Built in: `/events/:source/:tenantId` (ChatMessageEventSchema), `/webhooks/manychat/:tenantId` and `/webhooks/stripe/:tenantId`.
For your own provider, chain a route next to them in `src/background/routes.ts`:
```ts
  .post("/webhooks/acme/:tenantId", (c) => {
    const tenantId = c.req.param("tenantId");
    if (!TENANT.test(tenantId)) return c.json({ error: "INVALID_TENANT" }, 400);
    return createIngestionHandler({
      source: "acme",
      schema: AcmeEventSchema,                  // zod: bound every field, cleanse free text with untrustedString()
      // The sender signs method + path + body (signRequest), so the tenant and source in the URL are covered.
      verify: signedDeliveryVerifier(() => webhookSecrets(c.env.TENANT_CONFIG, tenantId, [c.env.WEBHOOK_SIGNING_SECRET])),
      tenantId: () => tenantId,                 // from the (signed) route, never from the payload
      sessionKey: (p) => `account-${p.accountId}`,
      eventType: (p) => p.type,
      eventId: (p) => p.id,                     // signed provider id → envelope id; never an unsigned header
      queue: c.env.EVENTS_QUEUE as Queue,
      rateLimiter: new TenantRateLimiter(c.env), // event bucket: 429 + retry-after
      nonceCache: nonceCache(c.env),
    })(c.req.raw);
  })
```
A provider with its own body-only scheme (Stripe, GitHub, Shopify) cannot sign the path: accept ONLY the tenant's own
secret for that route (copy the Stripe route: `stripeWebhookSecrets` → 404 when missing, `verifyStripeSignature(secrets, …)`
with rotation arrays, nonce `stripe:<tenant>:<body hash>`), and render only a bounded, cleansed summary to the agent
(`StripeWebhookEventSchema` keeps ids, amounts, statuses and cleansed metadata, never the raw `data.object`).
Then add a test in `test/background.test.ts` (signature binding + id derivation).

### 2. Tenant rate limits and per-tenant webhook secrets (wired by default)
Two token buckets per tenant over AGENT_CACHE, both reading `TenantConfig.rateLimit` (`eventsPerMinute`, `burst`;
defaults 60/20), so one event is never charged twice:
- events at the edge (`new TenantRateLimiter(env)`, `rl:tenant:`): `429` with `retry-after`;
- turns in the consumer (`new TenantRateLimiter(env, undefined, "turns")`, `rl:tenant-turns:`): a denied turn is
  re-enqueued with `sendBatch(…, { delaySeconds })` and the message is acked, so deferrals never count toward
  `max_retries` / the DLQ. A limiter outage dispatches anyway (the edge already limited the events).

Signed-request secrets resolve per tenant with `webhookSecrets(kv, tenantId, [shared...])`; the shared one is
`signingSecret(env, "inbound")` (`INBOUND_WEBHOOK_SECRET`, else `WEBHOOK_SIGNING_SECRET`), and outbound relays use
`signingSecret(env, "outbound")`, so one leaked secret never covers inbound events, tenant sync and outbound webhooks at once:
```bash
# a tenant's own secret(s) (JSON array during rotation); tenants without one use the shared WEBHOOK_SIGNING_SECRET
npx wrangler kv key put --binding TENANT_CONFIG 'webhook-secrets:tenant_alpha' '["<new-secret>","<old-secret>"]'
# Stripe: the tenant's own endpoint secret(s), required (no shared fallback)
npx wrangler kv key put --binding TENANT_CONFIG 'stripe-webhook-secrets:tenant_alpha' '["whsec_..."]'
```
A tenant with its own secret no longer accepts the shared one; the shared one is bound to the tenant by the signed path.
Senders sign with `signRequest(secret, { method: "POST", path: "/events/<source>/<tenant>", body })` and send the
`x-agent-signature` header. Routes pass `nonceCache` (KV, 900 s, nonce from signed data) so a replayed delivery is
answered `200 { duplicate: true }` without being queued again. Session keys come from the event's own identity
(`contact-<id>`, `<channel>:<conversationId>`, `stripe:<customer>`) and `eventId` from signed data (provider id; Manychat:
contact + hash of the signed body), so redeliveries collapse onto one envelope id and the consumer's KV event ledger
(`evt:<tenant>:<eventId>`, 24 h) drops them even across batches.

### 3. A new background agent
Copy `src/agents/background-worker.ts`. Keep: `"use agent"`, `useAgentStarter({...platform(name, id), tools, workflow, budget, autonomy, firewall,
approvals: approvals({ bindToRecipient: true, approverId: tenantApprover })})` (register app-specific signal types that carry outside
text with `deliveredSignalTypes` so the injection screen sees them), `useSkill(jobExecution)`, a static `agentName`, and `durability = { maxAttempts, timeoutMs }`.
Route events to it with the pure `dispatchJobTurn(deps, turn)` from `src/background/jobs.ts` (copy `jobDispatchDeps` and point
`dispatch` at your agent): job ids are **job-scoped** and harness-owned (`agentInstanceId(name, tenantId, harnessSessionKey("job", …))`).
A per-session id would reuse a finished FSM (DONE has no tools) and one budget forever. Then follow `agent-starter-scaffold`
(export, `AGENTS` registry is generated, new migration tag `Flue<Pascal>Agent`).

### 3b. The flagship chain: delegate from a job to the analyst or the computer operator
`webhook → queue → job → cheap router → analyst query or browser VM → report`. The cheap router: the events queue (and
`POST /api/jobs`) asks the Workers AI utility model (`classifyDelivery`, `models.firstLine`) whether the turn is SIMPLE or
COMPLEX and stamps it as the signal's `route` attribute; the hook runs SIMPLE on the first-line model and COMPLEX on the
frontier model (a classifier failure stamps COMPLEX). When the multi-agent module is composed, `analyst-agent` is reachable
(read-only `query_tenant_metrics_factory`; e.g. consult it for `active_manychat_subscribers` over a date range, metrics in
`src/multi-agent/metrics.ts`); with computer-use, `computer-operator`
(browser tools in a VM; `browser_submit` waits for a human on the operator's side). `composedRoster(BACKGROUND_DELEGATES)` drops
delegates whose module is absent, so a background-only project has no `delegate_task` and keeps working alone.
```ts
const delegates = composedRoster(BACKGROUND_DELEGATES);
const delegation = delegates.length ? createDelegationTools({ self: "background-worker", roster: delegates, dispatch: delegationDispatch, grant: () => [...own.map((t) => t.name), ...DELEGABLE_TOOLS] }) : [];
useAgentStarter({ ...platform("background-worker", id), tools: [...own, ...delegation], workflow: jobWorkflow(delegates.length > 0), /* … */ });
if (delegates.length) useDelegation({ id, self: "background-worker", dispatch: delegationDispatch });
```
Each worker's grant is `requester grant ∩ its roster tools` (enforced on the worker at execution time); shell and file VM tools
are never handed on. While a delegated task with `reply: "resume"` is out, the job is `QUEUED` (open: new events join it, the
sentinel ignores it); the `delegation-result` signal wakes it. Delegation needs `features.multiAgentGroupChat`; the operator also
needs `computerUse` + `autonomousBrowserUse`. To add a delegate, add a roster entry (its `tools` must be names the worker mounts)
and add those names to `DELEGABLE_TOOLS`. With multi-agent composed the worker also mounts `send_agent_message`
(`busTools("background-worker", id)` from the generated `src/lib/bus.generated.ts`; a no-op stub otherwise) in EXECUTE and
REPORT: permitted dispatch-only targets, hop limits and TTLs come from the multi-agent bus (SEC-07).

### 3c. Shadow forking of live events (R-EVAL-10)
Set `SHADOW_SAMPLE_RATE` (wrangler var, e.g. `"0.05"`). A deterministic share of jobs (by job id) gets a shadow twin
(`shadowTwinId(jobId)`, created with `mode: "shadow"`: every mutating tool simulated) that receives the same turns
(idempotency key `shadow:<turn>`); a failing twin never affects production. `SHADOW_MODEL` runs the twin on a candidate
model. When each side finishes a turn it writes `tenants/<tenant>/shadow/<turn>/{production,shadow}.json`; the second writes
`diff.json` (`diffTrajectories`: tool sequence, status, cost; verdict equivalent / diverged / regressed / improved). A
regressed or diverged turn raises a `SHADOW_DIVERGENCE` ops alert on the production job (telemetry: signed webhook, Pusher;
`logType: "warning"`, no status change) with the diff's R2 key. Shadow twins spend real model budget; keep the rate low.

### 3d. Results out: durable webhooks and artifact links; blue/green handoff
`notify_saas` sends `job.result` through `sendToSaas`: a signed webhook that, after its immediate retries, is parked in the
registry DO's outbox (`as_outbox`) and retried by the minute cron (backoff to 1 h, DEAD after 12 attempts). The same outbox
backs the telemetry webhook sink and the daily report. With an `artifactKey` from `save_artifact`, the result carries
`artifactUrl`: a signed link (`GET /artifacts/:tenantId/<path>?exp&sig`, 7 days) that serves only that tenant's
`tenants/<tenant>/artifacts/` objects; any other key gets `null`. On a deploy with another major `CODE_VERSION`, the hook
locks the old job and the worker's `version.onHandoff` re-dispatches the wake to a fresh job (events → the session's next
job; anything else → `handoffJobId(jobId, version)`) with the old state in a `<handoff>` block.

### 4. A cron job
Add `{ "cron": "...", "handler": "fn", "from": "./path.ts" }` to the module's `module.json` `scheduled` (new
projects) or, in an existing project, add the cron to `wrangler.jsonc` `triggers.crons` **and** an
`if (controller.cron === "...")` line in `src/cloudflare.ts`. Crons must be idempotent and finish fast;
fan heavy work out with `dispatch`.

### 5. A long-running durable tool
```ts
defineAgentTool({
  name: "export_report", description: "Export and upload a large report.",
  input: v.object({ reportId: v.string() }), risk: "MEDIUM", sideEffect: "external", idempotent: true, timeoutMs: 120_000,
  execute: async ({ reportId }, ctx) => {
    // Runs inside Flue step.do("tool:export_report") — recorded once, but re-executed if the DO dies mid-call.
    const key = `exports/${ctx.tenant.tenantId}/${reportId}.csv`;          // deterministic → re-runs overwrite, never duplicate
    const csv = await renderReport(reportId, ctx.signal);                  // honour ctx.signal (abort/timeout)
    await uploadToSaas(key, csv, { idempotencyKey: ctx.idempotencyKey });  // downstream dedupes on the key
    return { key, bytes: csv.length };                                     // small, JSON-serializable result
  },
});
```
`renderReport`/`uploadToSaas` are your helpers. The executor (not your code) wraps mutating calls in
`ctx.step("tool:<name>", …)`; do not call `ctx.step` again inside `execute` (nesting is untested). If a job has
several expensive phases, make each phase its own tool call so each is recorded separately. Calls longer than a minute
keep the run alive (the observer beats while a call is in flight, up to 15 min); for longer work also call
`await ctx.services.heartbeat?.()` on an interval (`packages/core/src/workspace/coding-tools.ts` shows the pattern). Pass
`ctx.idempotencyKey` to every external API.

### 6. Operator controls
All routes need an operator session (`admin`/`operator` role) and only accept job ids of the caller's tenant.
- `POST /api/jobs` dispatches a job-scoped instance (routed and config-seeded) and returns 202 + `jobId`; `GET /api/jobs/:id` returns
  the registry record (`status: null` before the first beat) plus `budgetUsd` / `maxTurns` (`tenantBudget`) and `vmSeconds` when the run used VMs.
- Approvals: parked calls are recipient-bound (email link via SendRaven to `tenantApprover`). The signed telemetry webhook carries
  `approvalId` + `conversationId` (the job id), so the SaaS or the panel decides with an admin / operator session:
  `POST /approvals/by-id/:conversationId/:approvalId` `{ decision: "approve" | "reject", note? }` (`createApprovalRoutes`, mounted
  wherever it gets `sessionSecret`; Bearer session with an admin / operator role in the conversation's tenant, cookie only on
  same-origin JSON; `202`, `409 ALREADY_DECIDED`, `401` no session, `403` wrong role / tenant; pass `operatorRoles` only if your
  role names differ). Masking: the worker keeps `save_artifact`, `notify_saas`, `check_delegation` and `send_agent_message` in
  `toolMasking.alwaysInclude` (built-ins such as `transition_state` are always mounted), so the chain survives the 4-tool mask.
- `POST /api/jobs/:id/pause`: status `HALTED`, then `abort()` (resumable).
- `POST /api/jobs/:id/resume` (`{ note? }`): only from `HALTED`/`FAILED`; dispatches a `resume` signal, status `RUNNING`. `409` for `TERMINATED`.
- `POST /api/jobs/:id/teardown`: emergency stop: status `TERMINATED` first (late heartbeats cannot revive it), `abort()`,
  then `runRecoveryHooks({ reason: "teardown" })` so modules stop VMs/compute; returns the hook results.

The dashboard (`web/JobControlPanel.tsx`) wires pause / resume / teardown and approve / reject to these routes and streams the
conversation with `useAgentChat({ client })` (operator token; `agentAuth` lets admins open tenant jobs).

### 6b. Dead letters: inspect, replay, purge
After `max_retries` the message lands in `<project>-events-dlq`; `handleEventsDlq` parks it in R2
(`dlq/agent-events/<tenantId>/<deadAt>-<messageId>.json`), acks it and emails `OPS_ALERT_EMAIL`. Per tenant:
```bash
AGENT_BASE_URL=https://agents.example.com AGENT_OPERATOR_TOKEN=... pnpm dlq:replay              # list
AGENT_BASE_URL=... AGENT_OPERATOR_TOKEN=... pnpm dlq:replay --replay [--key dlq/...]            # re-enqueue (envelope ids kept → deduped)
AGENT_BASE_URL=... AGENT_OPERATOR_TOKEN=... pnpm dlq:replay --purge --key dlq/...               # drop
```
(`GET /api/dlq`, `POST /api/dlq/replay`, `POST /api/dlq/purge` with `{ keys? }`.) Fix the cause first (look at
`attempts` and the envelope), then replay.

### 6c. Stop compute when a run is recovered or torn down
```ts
// e.g. src/computer-use/vm.ts (module scope); src/lib/recovery.ts imports no agents, so no import cycles
import { registerRecoveryHook } from "../lib/recovery.ts";
registerRecoveryHook("computer-use:vm", async ({ runId, reason, env }) => {
  await stopVmForRun(runId, env, { force: reason === "teardown" });   // your VM lookup + provider.stop
});
```

### 7. Live progress and alerts outside the conversation stream
`telemetrySinks()` in `src/lib/platform.ts` fans every `TelemetryEvent` to the signed webhook (`PRIMARY_SAAS_WEBHOOK_URL`, durable
outbox behind it) and, when `integrations.pusher` is on and `PUSHER_*` are set, `PusherPublisher` (channel `private-tenant-{tenant}-room-{runId}`, event
`agent-turn-executed`). Ops alerts ride the same sinks: a budget breach publishes `{ type: "budget", logType: "error",
status: "HALTED", data: { alert: "BUDGET_LIMIT_BREACHED" } }` (plus the R2 snapshot and an email when `OPS_ALERT_EMAIL` +
SendRaven are set), and modules call `emitOpsAlert({ code: "AGENT_CRITICAL_HALT", … })` for VM teardowns. Langfuse / OTLP get
the per-step traces (`traceExporters()`), not the telemetry events. In the browser: `useAgentTelemetry({ source: { type: "pusher", channel } })`
(default event name `agent-turn-executed`, the same as `PUSHER_TELEMETRY_EVENT`). Pusher-js authorizes against the Worker's
`POST /api/pusher/auth` (`src/lib/pusher-auth.ts`: 400 missing params / malformed channel, 401 no session, 403 other tenant or
someone else's run unless admin / operator; 404 until configured) or the host's `web/host-routes.example.ts` `pusherAuth`.

## Checklist — spec requirements for this topic

- [ ] **202, then async.** Webhooks and `POST /api/jobs` return 202 before any model work. Verify: `pnpm --filter @agent-starter/cloudflare test` ("accepts valid signed payloads with 202"); in an app, a signed webhook and `curl -i -X POST .../api/jobs` (operator token) both return `202`.
- [ ] **Zero-AI ingestion worker.** The ingestion path only verifies the signature on the raw body, validates/sanitizes with zod and enqueues an envelope with `tenantId` + `sessionKey`. Verify: `grep -n "dispatch\|useAgentStarter" src/background/routes.ts` shows dispatch only in `/api/jobs`; unsigned → 401, bad contract → 400 (`packages/cloudflare/test/cloudflare.test.ts`).
- [ ] **Tenant from a verified source.** Tenant comes from the route param / verified header, never the payload. Verify: every `createIngestionHandler` has `tenantId: () => tenantId` from `c.req.param` and a `TENANT` regex check.
- [ ] **Batching consumer.** Rapid events for one tenant+session become one turn; wrangler consumer `max_batch_size: 10`, `max_batch_timeout: 10` (the spec's 10 s window). Verify: "coalesces per session" test; `grep -n max_batch wrangler.jsonc`; compose test "wires background DLQ tooling, job control and tenant rate limits".
- [ ] **Tenant-level rate limits before waking the agent, in separate buckets (R7).** Event bucket at the edge (429), turn bucket in the consumer; a denied turn is re-enqueued with a delay and acked (no queue retry burned). Verify: `grep -n "new TenantRateLimiter" src/background/queue.ts src/background/routes.ts`; template `test/background.test.ts` › "defers a tenant over its turn rate by re-enqueueing with a delay (acked: no queue retry is burned) (R7)" and "gives a tenant its full rate at the edge and in the consumer (separate buckets) (R7 probe)".
- [ ] **Session from the event's own identity + redelivery dedupe.** Session keys `contact-<id>` / `<channel>:<conversationId>` / `stripe:<customer>`, `eventId` from signed data (provider id, Manychat body hash), KV event ledger in the consumer. Verify: `grep -n "sessionKey:\|eventId:" src/background/routes.ts`; `test/background.test.ts` › "dispatches one idempotent turn, records the event ledger and drops redeliveries".
- [ ] **Signed requests bind tenant, source and route (SEC-06).** `/events/*` and `/webhooks/manychat/*` verify method + path + body (`signedDeliveryVerifier`); nonces and event ids come from signed data only; per-tenant secrets replace the shared one. Verify: `grep -n signedDeliveryVerifier src/background/routes.ts`; `test/background.test.ts` › "binds a signed delivery to its method, tenant and source: it never replays into another route" and "resolves per-tenant secrets: own secrets replace the shared one; Stripe has no shared fallback".
- [ ] **Stripe webhooks (R-EVT-09).** `POST /webhooks/stripe/:tenantId` verifies `Stripe-Signature` with the tenant's own endpoint secret(s) (404 when none), dedupes by `evt_…` id, sessions per customer, and the agent sees only `StripeWebhookEventSchema`'s cleansed summary. Verify: `grep -n "webhooks/stripe" src/background/routes.ts`; integrations test "keeps ids, amounts and statuses, cleanses free text and drops the raw object"; `test/background.test.ts` › "derives Manychat event ids from the signed body only, and Stripe sessions per customer".
- [ ] **Job-scoped, harness-owned instance mapping (R13, SEC-20).** Events join the session's open job; a job whose workflow reached REPORT / DONE / FAILED or whose submission settled is never reused; racing consumers converge on one job; events that reach a closed job are re-routed once. Verify: `test/background.test.ts` › "joins the session's open job and starts a fresh job once the workflow reached REPORT, DONE or FAILED", "racing consumers pick the same next job instead of creating two (non-atomic KV pointer)", "end to end: transition_state REPORT seen by the observer closes the job for the next batch", "uses harness-owned job ids no user can ever own (SEC-20)".
- [ ] **Sequential processing per instance.** Events arriving mid-run are queued and handled at the next turn boundary (Flue serializes deliveries per instance; never fan one session out in parallel). Verify: no `Promise.all` over turns of the same `sessionKey` in consumers.
- [ ] **Idempotency keys end to end.** `dispatch` carries `idempotencyKey` (event-id hash); mutating tools pass `ctx.idempotencyKey` downstream; replays never double-execute. Verify: `grep -n idempotencyKey src/background/queue.ts src/agents/background-worker.ts`; harness test "parks HIGH-risk tools for human approval and runs them exactly once"; core test "does not re-run a non-idempotent side effect whose outcome is unknown after a crash".
- [ ] **Per-message ack/retry, DLQ.** Failed dispatches retry with backoff; after `max_retries` (5) messages land in `<project>-events-dlq`; poison pills are acked and logged. Verify: `grep -n "dead_letter_queue\|max_retries" wrangler.jsonc`; consumer test asserts `["acked","acked","retried","acked"]`.
- [ ] **DLQ is consumed and drainable.** `<project>-events-dlq` (queue names carry the project name) has a consumer (`handleEventsDlq` → R2 + ops alert); operators list/replay/purge per tenant. Verify: `grep -n 'events-dlq' wrangler.jsonc` shows the DLQ as a consumer `queue`; `pnpm dlq:replay` lists dead letters.
- [ ] **Deterministic validation of every action.** No SaaS call outside a `defineAgentTool` with a schema. Verify: `grep -n "fetch(" src/agents/background-worker.ts` appears only inside tool helpers called from `execute`.
- [ ] **FSM-locked workflow.** INGEST → EVALUATE → EXECUTE → REPORT → DONE; only the active state's tools are mounted. Verify: `createJobStateMachineDefinition` in the agent; core test "locks the model into FSM states".
- [ ] **Turn & cost accounting each loop + hard ceilings from the config** (spec: 25 turns / $1.50). The worker uses `budget: budgetLimits()` and `autonomy: autonomyPolicy("MEDIUM")` (a tighter config wins; a looser one stays at MEDIUM); the report and `GET /api/jobs/:id` use the same config. Verify: `grep -n "budgetLimits()\|autonomyPolicy(" src/agents/background-worker.ts`; template `test/delivery.test.ts` › "never lets an agent's own cap loosen the config, and a tighter config always wins"; `test/background.test.ts` › "measures report anomalies against the config's budget ceilings"; promptfoo `defaultTest` caps (1.5 / 25).
- [ ] **Cheap router on every background turn (finding 12).** The queue and `POST /api/jobs` stamp `route` from the utility model. Verify: `test/background.test.ts` › "routes each turn with the utility model: SIMPLE / COMPLEX stamped as the job signal's route (finding 12)"; `test/ingestion.e2e.test.ts` (route `SIMPLE` on the dispatched signal).
- [ ] **No server dispatch renders on the secure default (finding 11).** Job, `/api/jobs`, reroute, handoff and delegation dispatches carry `tenantConfig` (`dispatchInitialData`). Verify: `test/background.test.ts` › "seeds the job's first submission with the tenant's config, also for its shadow twin (finding 11)"; e2e "accepts a signed event with 202, …".
- [ ] **On budget breach: graceful fail + R2 snapshot + alert as telemetry.** Breach yields `BUDGET EXHAUSTED` instructions (no tools); the first breach of a scope stashes a tenant-scoped R2 snapshot and publishes a `BUDGET_LIMIT_BREACHED` alert to the telemetry sinks (signed webhook to the SaaS, Pusher), plus an email when `OPS_ALERT_EMAIL` + SendRaven are set. Verify: `grep -n alertingNotifier src/lib/platform.ts`; template `test/platform.test.ts` › "publishes budget breaches to every sink with data.alert and emails only real addresses".
- [ ] **Headless HITL, approved by someone else (SEC-17).** HIGH-risk/customer-facing tools park with a signed token bound to the approver (`approvals({ bindToRecipient: true, approverId: tenantApprover })`: replace `tenantApprover` in `src/lib/platform.ts` with your tenant-admin lookup; default the ops inbox subject), never written into the job's own stream, notify out of band (SendRaven when `integrations.sendraven` and `SENDRAVEN_API_KEY` are set; the signed webhook carries `approvalId` + `conversationId` for `POST /approvals/by-id/:conversationId/:approvalId` with an operator session), the `/approvals/:token` POST verifies the approver's session and wakes the DO with a `tool-approval` signal; GET never mutates. Verify: `grep -n bindToRecipient src/agents/background-worker.ts`; harness test "parks HIGH-risk tools for human approval and runs them exactly once"; `test/security.test.ts` "rejects malformed approval tokens and never mutates on GET".
- [ ] **Flagship chain (R-APP-12).** With multi-agent and/or computer-use composed, the worker routes steps with the utility model and can `delegate_task` to the analyst (read-only metrics query) or the computer operator (browser tools); composed alone it has no delegation tools. Verify: `grep -n "composedRoster" src/agents/background-worker.ts`; `test/background.test.ts` › "names tools the analyst and operator really mount, and grants each delegate only its own" and "mounts delegation only in EVALUATE and EXECUTE, and only when delegates are composed"; compose background alone and background + multi-agent + computer-use and run `pnpm typecheck && pnpm test` in both.
- [ ] **Shadow forking of sampled production events (R-EVAL-10), regressions flagged.** `SHADOW_SAMPLE_RATE` > 0 forks a deterministic share of jobs into shadow twins (mutations simulated); both trajectories and the diff land in `tenants/<tenant>/shadow/<turn>/`; a regressed / diverged turn emits `SHADOW_DIVERGENCE`. Verify: `test/background.test.ts` › "forks a sampled job into a shadow twin that never affects production (R-EVAL-10)", "stores both trajectories and the diff in the tenant's R2 prefix", "raises SHADOW_DIVERGENCE on the production job for regressed or diverged turns only".
- [ ] **Artifacts to R2 + durable webhooks out with a signed link (R-EVT-11).** REPORT calls `save_artifact` then `notify_saas` (`sendToSaas`: signed, outbox on failure, `artifactUrl` signed for 7 days). Verify: template `test/delivery.test.ts` › "parks a delivery that failed its retries and the cron drain delivers it later, re-signed", "serves the tenant's artifact to a valid link, and nothing else", "never signs another tenant's key or a non-artifact object, and links expire"; compose test "mounts signed artifact downloads and Pusher channel auth, and drains the webhook outbox from the minute cron".
- [ ] **Hibernation.** No timers/polling in agents or tools; waits are approvals/signals. Verify: `grep -rn "setInterval\|setTimeout" src/agents src/background` returns nothing.
- [ ] **Tenant config at the edge.** SaaS PUTs signed config to `/internal/tenants/:tenantId/config`; agents read KV via `TenantConfigProvider` (secure defaults when missing). Verify: `curl` with a bad signature → 401; core test "falls back to secure defaults and locks down corrupted config".
- [ ] **Run registry + heartbeats + counters, off the hot path (R16).** The hook's heartbeat records the counters and beats the `AgentRunRegistry` DO at most every 15 s per run, fire-and-forget (one beat in flight); the observer beats on turn/tool events (throttled 10 s); on settle it calls `complete(runId, status, latestCounters)` and drops the run's cached counters (R21); a run waiting for a human is `PENDING_APPROVAL`, one waiting for a delegated task `QUEUED` (never swept). Verify: `GET /api/jobs/:id` returns a recent `lastHeartbeatAt` while running; template `test/platform.test.ts` › "never waits for the registry, throttles per run, keeps one beat in flight and swallows errors", "beats on turn and tool events (throttled) and marks PENDING_APPROVAL while a human is asked", "marks a run that waits for a delegated task QUEUED (open, never swept as stalled)", "drops per-run state on settle so long-lived isolates do not grow (R21)".
- [ ] **Heartbeat sentinel every 60 s, 180 s threshold, long tools respected, bounded recovery.** One long tool call keeps beating (observer interval, `ctx.services.heartbeat`), so only real stalls are swept; the recovery counter resets when the run completes real work again (R20). Verify: `wrangler.jsonc` `triggers.crons` contains `* * * * *`; `src/lib/cron.ts` uses `thresholdMs: 180_000`, `maxRecoveries: 3`; template `test/platform.test.ts` › "keeps a run alive while one long tool call runs, and stops beating once it ends or hangs (R3)" and "resets after the run completes real work, not when only the recovery signal completes"; sentinel unit test "recovers stalled runs and fails runs that exhausted recovery".
- [ ] **Recovery purges stuck compute and restarts from the last checkpoint, without losing acked work.** `recoverStalledRun` aborts only when the stalled head is known (or nothing acked is queued), runs `registerRecoveryHook` hooks (VM stop), sends the recovery signal and re-admits queued tracked dispatches. Verify: `grep -n "runRecoveryHooks\|pendingDispatches" src/lib/cron.ts`; template test "runs every registered hook and isolates failures".
- [ ] **Efficiency report** (cost, turns, routing density, VM seconds, anomalies: rogue loop / budget breach / stalled). Verify: `17 6 * * *` cron → `dailyEfficiencyReport`; `EfficiencyReportSchema.parse(report)` in a test (registry side: `agent-starter-multi-agent`).
- [ ] **Manual overrides: pause, resume and emergency teardown.** `POST /api/jobs/:id/{pause,resume,teardown}`; teardown sets `TERMINATED`, aborts and runs recovery hooks with `reason: "teardown"`; `JobControlPanel` wires all three. Verify: `grep -n "teardown\|resume" src/background/routes.ts web/JobControlPanel.tsx`.
- [ ] **Live progress over authenticated private channels.** Verify: `PusherPublisher` in `telemetrySinks()`; template `test/delivery.test.ts` › "answers 400 / 401 / 400 / 403 like the spec and authorizes owners and operators" and "mounts as POST /api/pusher/auth: 404 until configured, session from the bearer token, form bodies".
- [ ] **Survive restarts.** Agent `durability` set; durable tools use `step.do`. Verify: `grep -n "durability" src/agents/background-worker.ts`.
- [ ] **Blue/green code versions for in-flight runs, with payload handoff.** `platform()` passes `version: { current: () => CODE_VERSION }`: a conversation or job started on another major version is locked; the background worker adds `onHandoff`, which re-dispatches the in-flight wake to a fresh job. Verify: `grep -n "onHandoff" src/agents/background-worker.ts`; `test/background.test.ts` › "re-dispatches an events turn with its original body and attributes plus the old job's state as data", "turns any other wake into a job signal for a fresh, deterministic job of the same tenant".
- [ ] **Buffered warehouse sync** (≤50 rows / batch, mark synced only after 2xx). The background worker flushes `WarehouseSync` after each response when `WAREHOUSE_SYNC_URL` + `SAAS_SERVICE_TOKEN` are set. Verify: `grep -n WarehouseSync src/agents/background-worker.ts`. (Library behaviour has no unit test yet.)

## Pitfalls
- **Never trust `tenantId` from a payload.** Use the route/verified header; the consumer re-validates envelopes (`EventEnvelopeSchema`).
- **`initialData` seeds only on creation.** Later dispatches to the same id ignore it. Job-scoped ids give every job its own `objective`.
- **Idempotency key ≠ outcome.** A Flue key names the delivery; a submission that failed stays failed. Retry with a new key (the sentinel re-admits with `<key>:readmit:<n>`).
- **`abort()` aborts queued submissions too.** Flue has no per-submission abort. Dispatch programmatic work with `trackedDispatch` so the sentinel can re-admit it; plain `dispatch()` work queued behind a stalled head is lost on recovery. Chat messages queued over HTTP get an `aborted` settlement the client sees.
- **Budgets are per job.** The worker keeps the default `budgetScope` ("conversation"): instances are job-scoped, so approval wakes and late events share one job budget. `budgetScope: "submission"` would reset the budget on every wake.
- **The submission ledger is KV.** It is eventually consistent (list can lag ~60 s; the sentinel threshold is 180 s) and costs ~3 KV writes per submission (running put + 2 deletes, + 1 put per tracked dispatch).
- **Registry status:** `beat()` revives a run to `RUNNING` except `TERMINATED`; an abort settlement only marks `HALTED` when the status is still `RUNNING`, so pause (`HALTED`), teardown (`TERMINATED`) and sentinel recovery keep the status they set.
- **Per-tenant webhook secrets replace the shared one** for that tenant. Roll out by adding the tenant secret to the KV key and the provider at the same time (list two secrets during rotation).
- **Harness-owned ids:** build job / worker instance ids with `agentInstanceId(agent, tenant, harnessSessionKey("job", key))`, never a user-shaped `<owner>.<session>` key: a provider session like `x:41` would otherwise parse as the conversation of user `xA` (SEC-20). `agentInstanceId` hashes long or unusual keys injectively, so nothing is truncated.
- **Signal attributes reach the model.** Put only harness values there (hashes, counts, ids you minted); provider text belongs in the wrapped body (`renderTurn`). The events signal carries `turn`, `session` (hashes) and `events` (count).
- **Workflow marker lag.** The `wf:<jobId>` marker is written by the observer after `transition_state` returns; events dispatched in that instant reach a closed job, which re-routes them once (`job-routing` signal). Do not remove `useClosedJobReroute`.
- **Delegation keeps a job open.** A job waiting on `delegate_task` (`reply: "resume"`) is `QUEUED`, so new events for the contact join it. The worker's reply guard auto-returns `no_report`, so a silent delegate cannot hold the job forever.
- **Never read env at module scope** — use `bindings()` inside tools/handlers.

## Verify
```bash
# generated project
pnpm typecheck && pnpm test           # harness, platform wiring, background routing/webhooks/shadow (test/background.test.ts)
pnpm evals                             # promptfoo (needs pnpm dev + EVAL_HARNESS_SECRET; see evals-and-ops)
# monorepo
pnpm --filter @agent-starter/cloudflare test   # ingestion, consumer, sentinel, room engine
pnpm --filter @agent-starter/core test         # executor idempotency/UNKNOWN_OUTCOME, FSM, budget
pnpm --filter create-agent-starter test        # "wires queue consumers and crons for background + multi-agent"
```
Local smoke: `AGENT_STARTER_LOCAL_ONLY=1 pnpm dev`, then the generated README's "Background jobs" snippet (the
`signRequest(WEBHOOK_SIGNING_SECRET, { method: "POST", path, body })` scheme with `node:crypto`, POSTed with `x-agent-signature`) → expect 202 (the same
signature on another tenant's path → 401). `test/ingestion.e2e.test.ts` runs the same path in Node. Queue names are
project-scoped (`grep -n '"queue"' wrangler.jsonc` shows `<project>-events`, `<project>-events-dlq`).

## Related skills
`agent-starter-tools-and-firewall` (tool contracts, approvals) · `agent-starter-security` (signatures, tenancy) ·
`agent-starter-planning-and-cognition` (FSM, goal tree) · `agent-starter-models-and-cost` (budgets) ·
`agent-starter-multi-agent` (bus, subagents) · `agent-starter-evals-and-ops` (runbooks, reports) ·
`agent-starter-definition-of-done`.

## Not yet implemented
- Sentinel recovery does not roll back state; it relies on the agent re-checking state from the recovery signal.
- Per-tenant webhook and Stripe secrets are provisioned with `wrangler kv`; the signed tenant-sync route only carries `TenantConfig`.
- Shadow diffs are best effort: if both sides finish a turn at the same instant, neither may see the other and no `diff.json` is
  written for that turn (the side files remain). Twins run the same code; only `SHADOW_MODEL` varies the model.
- A job's `vmSeconds` counts only VMs the job itself ran; browser work delegated to the computer operator is metered on the
  operator's run. A handed-off job re-requests approvals that were pending on the old version.
- The job pointer, event ledger and rate limiters live in Workers KV (eventually consistent, ~1 write/s per key). Racing
  consumers converge on one job id by construction, but strict once-only semantics would need a Durable Object.
