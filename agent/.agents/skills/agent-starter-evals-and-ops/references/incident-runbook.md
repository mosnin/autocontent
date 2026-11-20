# Incident runbook

First moves for any incident: `npx wrangler tail` (live logs), open the run's transcript with an admin
session token (`GET /agents/<agent>/<conversationId>?view=history`), and check the run registry
(`GET /api/jobs/:id` for background jobs, or `registry(env).get(runId)` / `.active()` from a script).
Never paste secrets or customer payloads into tickets; ids and timestamps are enough.

## 1. Security lock (prompt injection / tenant violation)
**Signals:** response metadata `securityLocked: true`; telemetry `log` event "Input halt|block: …" (logType `error`);
agent replies with a refusal and no tool calls; eval/harness `errorCode: SECURITY_EXCEPTION_HALT`;
tool results `ERROR_UNAUTHORIZED_TENANT`.

1. Confirm in the transcript what tripped it (the flagged user message; the agent stays locked for that message only).
2. **True positive from an external source** (webhook, widget, email): identify the source (`EventEnvelope.source`,
   widget key, sender) and cut it off — remove the widget key (`npx wrangler kv key delete --binding WIDGET_KEYS "widget:<pk>"`),
   rotate the provider webhook secret (handlers accept `[new, old]` arrays during rotation), or block the tenant's
   ingestion at the route.
3. **Cross-tenant attempts** (`ERROR_UNAUTHORIZED_TENANT`): treat as a security incident; verify no data left the
   tenant (tool results are tenant-checked before execution); rotate `SESSION_SIGNING_SECRET` via
   `SESSION_SIGNING_SECRET_PREVIOUS` if a token may have leaked.
4. **False positive:** add the message to an eval case first, then tune `guardrails` (`haltThreshold`, default 0.6) on
   that agent's `useAgentStarter` options. Never remove the lock or the `UNTRUSTED_CONTENT_POLICY` instruction.
5. Close with a regression case in `promptfoo.config.yaml` / `PROMPT_INJECTION_CASES`.

## 2. Budget exhaustion
**Signals:** tool result `BUDGET_LIMIT_EXCEEDED`; response metadata `budget.exhausted: true`; agent says the limit was
reached (it switches to the first-line model with no tools); efficiency report anomalies `BUDGET_LIMIT_BREACHED` /
`ROGUE_LOOP_DETECTED`; VM alert email `AGENT_CRITICAL_HALT: VM … torn down`.

1. Decide: runaway loop or legitimately large job? Look for repeated identical tool calls or critic/drift signals in
   the transcript.
2. Runaway: leave it halted; pause the job (`POST /api/jobs/:id/pause`); for VMs confirm the VM stopped on boat.dev
   (`provider.stop(id, { force: true })` if not). File a bug with the trajectory.
3. Legitimate: raise the tenant ceiling via signed `PUT /internal/tenants/:tenantId/config` (`maxBudgetUsd`,
   `maxTurnsPerSession`) or the agent's `budget` override, then continue in a **new conversation** (budgets are per run id).
4. The breach snapshot (budget, objective, workflow state, recent tool errors) is already in R2 under the tenant's
   prefix (`useAgentStarter({ budgetBreach })`, wired in `platform()`), and the breach went out as an ops alert
   (email to `OPS_ALERT_EMAIL` plus a telemetry event to the SaaS webhook / Pusher).

## 3. Stalled runs (silent deadlock)
**Signals:** `[sentinel] silent deadlock: <runId> (<n>s since heartbeat)` and
`[sentinel] inspected=… recovered=… failed=…` in logs; registry status `FAILED` with
`SILENT_DEADLOCK: recovery attempts exhausted`; operator dashboard stuck in `RUNNING`.

1. The sentinel already aborted the stuck submission and dispatched a `recovery` signal (up to 3 times; counter in
   `AGENT_CACHE` key `recoveries:<runId>`, 24 h TTL).
2. Find the cause: provider outage (see 5), a hung external API (tool timeouts), a VM command longer than the 180 s
   threshold, or a DO crash loop (`wrangler tail` exceptions).
3. Clean up compute: the sentinel runs every registered recovery hook (`registerRecoveryHook` in `src/lib/recovery.ts`;
   the computer-use and coding modules register VM stops). Check `[sentinel] recovery hooks failed` log lines; to force a
   stop, call `POST /api/jobs/:id/teardown` (background jobs) or stop the VM with the provider.
4. Retry once the cause is fixed: reset the counter (`npx wrangler kv key delete --binding AGENT_CACHE "recoveries:<runId>"`)
   and dispatch a recovery signal from a script/route:
   ```ts
   await init(AGENTS[agentName], { id: runId }).dispatch({ message: { kind: "signal", type: "recovery", body: "Operator retry: re-check state, then continue." }, idempotencyKey: `recovery:${runId}:manual-${Date.now()}` });
   await registry(env).setStatus(runId, "RUNNING");
   ```
5. Recovery aborts only when the stalled submission is known from the submission ledger (`sub:running:<runId>:*` in
   `AGENT_CACHE`) or nothing acked is queued behind it, and re-admits queued `trackedDispatch` work afterwards. Work
   dispatched with plain `dispatch()` that was queued behind the stalled head is lost: re-dispatch it from the source.
   Runs waiting for a human are `PENDING_APPROVAL` and are never swept.

## 4. DLQ drain (`<name>-events-dlq`, `<name>-bus-dlq`)
**Signals:** dashboard → Queues shows messages in a DLQ; consumer logs `[queue] … retried=…` repeating; events missing
downstream.

1. Fix the root cause first (agent throwing at admission, bad deploy, provider down) — replaying into a broken
   consumer just refills the DLQ.
2. The background module consumes `<name>-events-dlq` (`src/background/dlq.ts` `handleEventsDlq`): each dead letter is
   parked in R2 at `dlq/agent-events/<tenantId>/<deadAt>-<messageId>.json`, acked, and `OPS_ALERT_EMAIL` is notified.
   Inspect and replay per tenant with an operator token for that tenant:
   ```bash
   AGENT_BASE_URL=https://agents.example.com AGENT_OPERATOR_TOKEN=... pnpm dlq:replay                     # list
   AGENT_BASE_URL=https://agents.example.com AGENT_OPERATOR_TOKEN=... pnpm dlq:replay --replay            # re-enqueue all
   AGENT_BASE_URL=https://agents.example.com AGENT_OPERATOR_TOKEN=... pnpm dlq:replay --purge --key dlq/agent-events/...
   ```
   (`GET /api/dlq`, `POST /api/dlq/replay`, `POST /api/dlq/purge` with `{ "keys": [...] }`.)
3. Replays are safe: envelopes keep their ids, the consumer's event ledger (`evt:<tenant>:<eventId>`, 24 h) drops events
   that were already dispatched, and the dispatch idempotency key is derived from event ids.
4. `<name>-bus-dlq` (multi-agent) is consumed by `src/multi-agent/bus-dlq.ts` `handleAgentBusDlq`: dead bus messages are
   parked in R2 under `dlq/agent-bus/<tenantId>/` and alerted. Re-publish one with `QueueMessageBus` only if
   `validateDeliverable` still passes (its TTL may have expired).

## 5. Model provider outage
**Signals:** telemetry `model` events with logType `error` ("Model call failed (…)"); rising latency; fallback model ids
in response metadata `model`.

1. The observer opens the provider circuit after 2 failures (60 s cooldown, per isolate); new submissions use the
   fallbacks (`models.fallbacks` in `agent-starter.config.ts`, or the `AGENT_FALLBACK_MODELS` var), then the first-line model.
2. Extended outage: set the `AGENT_MODEL` / `AGENT_FALLBACK_MODELS` vars (they override the config) and redeploy;
   budgets keep costs bounded.
3. Afterwards check the efficiency report for anomalies created during the outage.

## 6. Webhook delivery to the SaaS failing
**Signals:** `[telemetry] sink failed` errors; SaaS missing job results.

1. `WebhookRelay` retries 3 times (300 ms base); a delivery that still fails is parked in the durable outbox (run registry
   DO, `as_outbox`) and the minute cron retries it (`[outbox] delivered=… failed=… pending=… dead=…` in the logs), backing
   off up to an hour, DEAD after 12 attempts (~5 h).
2. Restore the endpoint; pending rows drain on their own (receivers dedupe on `x-agent-event-id`). Rows already DEAD are not
   retried: reconcile them from transcripts / the registry.

## 7. After every incident
- Add an eval or test that reproduces it.
- Record cost impact (efficiency report, boat.dev usage) and update ceilings if needed.
- Update this runbook when a step was wrong or missing.
