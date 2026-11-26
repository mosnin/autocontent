# Background jobs: API reference (copied from source)

Part of `agent-starter-background-jobs`. Signatures as they are in the packages and in a generated project.

```ts
// packages/cloudflare/src/ingestion.ts
createIngestionHandler<S extends z.ZodType>(o: {
  source: string; schema: S;
  verify: (rawBody: string, request: Request) => Promise<void | { nonce?: string; pathSigned?: boolean }>;  // throw → 401
  tenantId: (payload, request) => string | Promise<string>;               // throw → 401 MISSING_TENANT_ISOLATION_CONTEXT
  sessionKey: (payload) => string; eventType: (payload) => string;
  eventId?: (payload) => string | undefined;                              // provider id → envelope id `${source}:${id}` when the path is signed, else `evt:${id}`
  queue: QueueProducer<EventEnvelope>; rateLimiter?: TokenBucketRateLimiter; maxBodyBytes?: number; // default 256_000
  nonceCache?: { store: KeyValueStore; ttlSeconds?: number /*900*/; key?: (raw, request, payload) => string; prefix? };  // default nonce: signed data only
}): (request: Request) => Promise<Response>   // 405 | 413 | 401 | 400 INVALID_JSON | 400 CONTRACT_VALIDATION_FAILED | 429 | 200 {duplicate} | 202 {accepted,eventId,sessionKey}
signedDeliveryVerifier(secrets | (request) => secrets, { header?, toleranceSeconds?, path? })   // verifySignedRequest(method, path, body); returns { nonce, pathSigned: true }

processEventBatch(batch: QueueBatchLike<unknown>, o: {
  dispatchTurn: (turn: CoalescedTurn) => Promise<void>;
  rateLimiter?: TokenBucketRateLimiter; maxEventsPerTurn?: number;        // default 25 (the template does NOT pass rateLimiter: retry() would burn attempts)
  onDrop?: (message, reason: string) => void;
}): Promise<{ turns; acked; retried; dropped }>
// invalid envelope → ack + drop (poison pill); dispatch ok → ack; dispatch throws → retry(min(300, 2^attempts) s)
renderTurn(turn: CoalescedTurn): string                                   // the signal body the agent reads (provider data wrapped as untrusted)

// packages/core/src/ingestion/events.ts
agentInstanceId(agent, tenantId, sessionKey): string                      // tenant validated; session key injective (long/unsafe keys → `prefix:h<sha256>`)
harnessSessionKey("dlg" | "room" | "job" | "bus", key): string            // `-job.<key>`: never a user-owned conversation (SEC-20)
parseAgentInstanceId(id): { agent; tenantId; sessionKey } | null          // splits on the first two `--`
coalesceEvents(events, { maxEventsPerTurn? }): CoalescedTurn[]            // group tenant+session, dedupe id, chronological
new TokenBucketRateLimiter(store: KeyValueStore, { ratePerMinute, burst, prefix? }).take(key, cost?, override?)
new Inbox(sql, runKey).enqueue(e) / peek(n) / ack(ids) / pendingCount()   // durable inbox (not used by the template; Flue queues deliveries)

// packages/cloudflare/src/sentinel.ts
sweepStalledRuns(registry: { stalled(ms); setStatus(id, status, error?) }, o: {
  thresholdMs?: number /*180_000*/; recover: (run: RunRecord) => Promise<void>;
  recoveries?: (runId) => Promise<number>; maxRecoveries?: number /*3*/; log?: (m) => void;
}): Promise<{ inspected; recovered: string[]; failed: Array<{ runId; error }> }>

// packages/cloudflare/src/durable-objects.ts — RunRegistry DO RPC (+ src/lib/registry.ts AgentRunRegistry extensions)
register(run) · heartbeat(runId, counters?) · beat(run, counters?) · setStatus(runId, status, error?)
complete(runId, status?) · stalled(thresholdMs) · active() · get(runId) · efficiencyReport(from, to, thresholds?)
outboxEnqueue(entry) · drainOutbox(limit?) → { delivered, failed, pending, dead } · runCounters(runId) → { tokens, toolCalls, vmSeconds, vmCostUsd } | null

// @flue/runtime
dispatch(agent, { id, message, initialData?, uid?, idempotencyKey? }): Promise<DispatchReceipt>  // key ≤256 chars, scoped to (agent,id)
init(agent, { id }).dispatch(req) / .read(receipt, { onEvent? }) / .abort()                      // abort = running head AND queued submissions
ToolStep.do<T>(name, fn): Promise<T>   // once per name per tool call; exactly-once recorded, at-least-once executed

// generated project: base (templates/base/files/src/lib)
new TenantRateLimiter(env?, configs?, scope: "events" | "turns" = "events")   // rl:tenant: (edge) | rl:tenant-turns: (consumer); TenantConfig.rateLimit
trackedDispatch(env, agent, request): Promise<DispatchReceipt>   // dispatch + ledger entry sub:pending:<runId>:<submissionId>
recordSubmissionEvent(env, instanceId, { type, submissionId, outcome })   // ledger; a completed non-recovery submission resets recoveries:<runId>
runningSubmission(env, runId) · pendingDispatches(env, runId) · forgetDispatch(env, runId, sid) · recoveriesKey(runId) · recoverySubmissionKey(runId)
registerRecoveryHook(name, (ctx: { runId; tenantId; agent; reason: "recovery" | "teardown"; attempt; env }) => Promise<void>)
runRecoveryHooks(ctx): Promise<Array<{ name; ok; error? }>>      // failures isolated
recoverStalledRun(env, run): Promise<{ aborted; readmitted; hookFailures }>   // src/lib/cron.ts; records the recovery signal's submission id
createRunStatusObserver({ registry, counters?, onSubmission?, onWorkflowState?, onSettled?, beatIntervalMs? /*10 s*/,
  toolBeatIntervalMs? /*60 s*/, maxToolBeatMs? /*15 min*/, clock?, timers? })
  // RUNNING beats on turn/tool (throttled) and on an interval while ONE tool call runs; PENDING_APPROVAL (human), QUEUED (delegate_task
  // with reply "resume"); transition_state results → onWorkflowState(state); on settle complete(id, status, counters) then IDLE / PENDING_APPROVAL / QUEUED / FAILED / HALTED
createHookHeartbeat({ registry, agent, tenantOf, onCounters?, intervalMs? /*15 s*/, staleAfterMs? /*5 s*/ })  // useAgentStarter heartbeat: fire-and-forget, throttled, one in flight per run
toolResultAwaitsHuman(result) · toolResultAwaitsAgent(result) · workflowStateOf(result) · workflowStateKey(id) /* wf:<id> */ · CLOSED_WORKFLOW_STATES
emitOpsAlert({ code: "AGENT_CRITICAL_HALT" | "BUDGET_LIMIT_BREACHED" | "SHADOW_DIVERGENCE", tenantId, runId, agent, content, data? })   // telemetry sinks, never throws
dispatchInitialData(tenantId, extra?) → { userId: "system:dispatch", roles: ["system"], ...extra, tenantId, tenantConfig? }   // every server dispatch
budgetLimits() → { maxCostUsd, maxTurns } · autonomyPolicy(agentCap?) (stricter tier wins) · tenantBudget(tenantId) → { budgetUsd, maxTurns } · integrationEnabled(name)
classifyDelivery(text) → "SIMPLE" | "COMPLEX"   // Workers AI utility model (models.firstLine); edge agentAuth + events queue + POST /api/jobs
sendToSaas(payload, { tenantId, eventId?, eventType? })   // signed webhook, durable outbox on failure · artifactUrl(tenantId, key) → signed 7-day link | null
alertingNotifier({ code, agent, sinks, email?, runIdOf? }): Notifier       // publishes the alert event + emails real addresses
delegationDispatch: DelegationDispatch · composedRoster(entries)         // src/lib/delegation.ts (AGENTS registry, tracked)
evalRunPolicy(input, env)                                                 // eval harness: no live mode unless EVAL_ALLOW_LIVE=true, EVAL_TENANTS, eval:<user>
signingSecret(env, "inbound" | "outbound" | "tenantSync" | "artifacts")   // INBOUND_ / OUTBOUND_WEBHOOK_SECRET, TENANT_SYNC_SECRET, ARTIFACT_SIGNING_SECRET; each falls back to WEBHOOK_SIGNING_SECRET
tenantApprover(tenant)                                                    // session subject allowed to decide bound approvals (replace with your tenant-admin lookup)

// generated project: background module (templates/modules/background/files/src/background)
dispatchJobTurn(deps: DispatchJobDeps, turn): Promise<{ status: "dispatched"; jobId; turn; shadowId? } | { status: "deferred"; delaySeconds } | { status: "duplicate" }>
  // deps: { kv, registry: { get }, dispatch, beat?, render, limiter?, requeue?, shadow?: { rate, twinId, sampled }, classify?, initialData?, log?, clock? }
  // classify → attributes.route (failure → COMPLEX; omitted → no stamp); initialData(base) → base + tenantConfig (failure → base)
jobIdFor(deps, tenantId, sessionRef, { exclude? }) · sessionRef(sessionKey) → { hash, label } · isOpenJob(deps, jobId) · rerouteTarget(deps, { jobId, tenantId, sessionHash })
  // pointer job:<tenant>:<sha(session)> = { id, base, seq, label }; open = no registry record yet, or RUNNING/QUEUED/PROVISIONING/PENDING_APPROVAL/PAUSED_OVERSIGHT, and wf:<id> not REPORT/DONE/FAILED
jobWorkflow(delegation: boolean, bus = false)                             // job FSM; delegate_task/check_delegation in EVALUATE + EXECUTE; send_agent_message in EXECUTE + REPORT
handoffSignal({ jobId, startedOn, current, state, objective?, delivery }) · handoffJobId(jobId, current)   // blue/green: re-dispatch to a fresh job
jobDispatchDeps(env) · handleEventsQueue(batch, env, ctx)                 // src/background/queue.ts
BACKGROUND_DELEGATES · DELEGABLE_TOOLS · ANALYST_QUERY_TOOL · OPERATOR_BROWSER_TOOLS   // src/background/delegation.ts
parseSampleRate(raw) · shadowSampled(jobId, rate) · shadowTwinId(jobId) · isShadowTwin(id) · recordShadowSide(blobs, { side, jobId, turn, output }) → { diff?, productionJob?, shadowJob? }
shadowDivergenceAlert({ tenantId, turn, productionJob, shadowJob, diff }) → OpsAlert | null   // regressed / diverged only · reportThresholds(limits?)
webhookSecrets(kv, tenantId, shared) · stripeWebhookSecrets(kv, tenantId) · signedBodyHash(raw) · manychatEventId(payload, bodyHash) · stripeSessionKey(summary)
handleEventsDlq(batch, env, ctx) · listDeadLetters(env, tenantId, limit?) · replayDeadLetters(env, tenantId, keys?) · purgeDeadLetters(env, tenantId, keys?)
```

