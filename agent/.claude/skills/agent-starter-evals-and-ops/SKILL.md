---
name: agent-starter-evals-and-ops
description: Evaluate, observe, deploy and operate an Agent Starter project — @agent-starter/evals (eval harness handler with the final workflow state, adversarial, tool-selection, structured-output, idempotency, sandbox-escape and gold datasets, Promptfoo tests, shadow trajectory diffs), the generated eval route (src/lib/evals.ts, POST /api/test-eval-harness), promptfoo.config.yaml, evals/module-*.yaml suites and CI gating, the workerd sandbox test, the generated end-to-end ingestion test, ESLint and the dependency audit, coverage, the dev tenant seed, telemetry events and the Flue observer, per-step tracing (ObserverOptions.tracing, recordDbDelta) to Langfuse/OTLP, signed WebhookRelay, efficiency reports, warehouse sync, model health, plus a deploy checklist (infra script, secrets, migrations, canary) and an incident runbook. Use when adding or running evals, changing CI/CD, lint or deploy scripts, wiring tracing or alerts, shipping a release, or handling a production incident.
---

# Evals and operations

```
Promptfoo (local / CI) ──HTTP provider──▶ POST /api/test-eval-harness?agent={{agent}}  (X-Eval-Secret, body {tenantId,userId,eventPayload,mode,replay})
   promptfoo.config.yaml + evals/*.yaml       src/lib/evals.ts → createEvalHarnessHandler → fresh conversation, mode "shadow", replay N deliveries
                                              → { output: { executionStatus, finalState?, finalText, turnCount, accumulatedCost, toolCalls, trajectory, deliveries, deduplicatedDeliveries, errorCode?, summary } }
@agent-starter/evals: datasets (injection, tenant isolation, budget, tool selection, structured output, idempotency, sandbox escape)
                      · evaluateCase · toPromptfooTests · runSandboxEscapeSuite · diffTrajectories / runShadowComparison · loadGoldDataset (R2) · runRegression
Runtime telemetry: useAgentStarter emitter + installAgentStarterObserver(observerOptions())
                   → TelemetryEvent → data-telemetry parts (UI) + telemetrySinks(): OutboxWebhookSink (signed, durable outbox) · PusherPublisher
                   → tracing (FlueTraceRecorder): one trace per submission → traceExporters(): LangfuseSpanExporter · OtlpHttpSpanExporter
Ops: scripts/init-cloudflare-infra.sh (re-runnable) · scripts/deploy.sh (canary.sh preflight → typecheck → test → build → deploy → canary.sh verify)
     .github/workflows/ci.yml (typecheck, typecheck:web, lint, pnpm audit --prod --audit-level high, coverage, evals → deploy)
     crons: heartbeat sentinel (* * * * *) · daily efficiency report (17 6 * * *)
```

## When to use
Writing or running evals; changing `promptfoo.config.yaml`, CI or deploy scripts; adding tracing, alerts,
reports or dashboards; preparing a release; responding to an incident.

## Mental model — who owns what

| Concern | File (generated project) | Library source |
|---|---|---|
| Harness HTTP contract, datasets, assertions, shadow diff, gold datasets | — | `packages/evals/src/index.ts` |
| Harness route (agent selection, fresh id, tool-call capture) | `src/lib/evals.ts` `evalHarness`, mounted in `src/app.ts` | — |
| Promptfoo suite | `promptfoo.config.yaml`, `evals/security.yaml`, `evals/module-<module>.yaml` (only selected modules are kept by `compose.ts` `pruneEvalSuites`), `evals/README.md` | template `templates/base/files/evals/` |
| Node acceptance + unit tests, coverage | `test/harness.test.ts` (Flue Node runtime + faux model), `test/security.test.ts`, `test/platform.test.ts`, module tests, `test/ingestion.e2e.test.ts` (background: signed event → 202 → queue consumer → dispatch); `vitest.config.ts` coverage (`pnpm test:coverage`), `cloudflare:*` stand-ins and Flue's markdown plugin | — |
| Lint + dependency audit | `eslint.config.js` (`pnpm lint`), CI step `pnpm audit --prod --audit-level high` | template `templates/base/files/eslint.config.js`; monorepo `eslint.config.js` |
| Sandbox escape under workerd | — | `packages/cloudflare/test/sandbox-workerd.test.ts` (miniflare + `workerLoaders`, real `createCodeExecutionTool`) |
| Dev tenant seed (fresh installs) | `scripts/seed-dev-tenant.mjs` (`pnpm seed:dev`) | — |
| CI/CD | `.github/workflows/ci.yml` | template `templates/base/files/_dot_github/workflows/ci.yml` |
| Deploy + canary | `scripts/deploy.sh` (`pnpm run deploy`), `scripts/canary.sh preflight \| verify` (also run by the CI deploy job) | — |
| Infra bootstrap | `scripts/init-cloudflare-infra.sh` (`pnpm infra:init`) | `compose.ts` `infraScript` + module `infra` lines |
| Telemetry contract | — | `packages/core/src/observability/telemetry.ts` (`TelemetryEventSchema`, `RunStatusSchema`) |
| Observer (Flue observations → telemetry, model health) | `src/lib/platform.ts` `observerOptions()` | `packages/flue/src/observer.ts` (`installAgentStarterObserver`, `mapObservation`) |
| Signed webhooks out + durable outbox | `telemetrySinks()`, `sendToSaas()`; `src/lib/outbox.ts`; outbox table in `src/lib/registry.ts`, drained by `src/lib/cron.ts` `drainWebhookOutbox` | `packages/core/src/messaging/relay.ts` `WebhookRelay` (`drainOutbox`), `signing.ts` |
| Per-step tracing (R-OBS-01) | `observerOptions()` passes `tracing: { exporters: (env) => traceExporters(env) }`; `traceExporters()` adds `LangfuseSpanExporter` (`integrations.langfuse` on + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`) and `OtlpHttpSpanExporter` (`OTLP_TRACES_ENDPOINT`, bearer `OTLP_TRACES_TOKEN`) | `packages/flue/src/observer.ts` (`ObserverOptions.tracing`, `FlueTraceRecorder`, `recordDbDelta`), `packages/core/src/observability/tracer.ts` (`Tracer`, `SpanAttr`, exporters) |
| Warehouse sync | background worker flushes the cost ledger when `WAREHOUSE_SYNC_URL` is set | `packages/core/src/analytics/analytics.ts` `WarehouseSync` |
| Run status (RUNNING / PENDING_APPROVAL / IDLE / HALTED) + final counters (`complete`) | `src/lib/run-status.ts` via `observerOptions()`; `heartbeat()` forwards the hook's counters | `packages/cloudflare/src/durable-objects.ts` `RunRegistry.complete(runId, status, RunCounters)` |
| Budget breach snapshot + alert | `platform()` `budgetBreach: { snapshots: workspaceBlobs, notifier, recipient }` | `packages/flue/src/use-agent-starter.ts` |
| Efficiency report | `src/background/report.ts` | `packages/cloudflare/src/durable-objects.ts` `aggregateRunReport` / `RunRegistry.efficiencyReport` (from reported run counters, incl. `infrastructureLeakedCostUsd`) |
| Model health | — | `packages/flue/src/runtime.ts` `modelHealth` (CircuitBreaker: 2 failures, 60 s cooldown) |

## API reference (copied from source)

```ts
// packages/evals/src/index.ts
EvalRequestSchema = { tenantId, userId, eventPayload: string | object, message?, mode: "live"|"shadow"|"dry-run" = "shadow", replay?: 1..5 (coerced), idempotencyKey? }
interface EvalRunOutput { executionStatus; finalState?; finalText; turnCount; accumulatedCost; toolCalls: {tool,status}[]; trajectory: string[]; errorCode?; deliveries?; deduplicatedDeliveries? }
  // finalState = the workflow FSM state the run ended in (the spec's ExecutedState); summary line 1 is `ExecutedState: <finalState ?? executionStatus>`
createEvalHarnessHandler({ secret: () => string | undefined, run: (req) => Promise<EvalRunOutput> })
  // secret missing or < 16 chars → 404 EVAL_HARNESS_DISABLED; wrong x-eval-secret → 401; bad body → 400
toEvalOutput(result: RunResult, { finalState? }) · evaluateCase(case, output) → { pass, failures } · toPromptfooTests(cases) → { description, vars, assert: PromptfooAssertion[] }
EvalCase { id; category; description; vars: { tenantId; userId; eventPayload; message?; agent?; replay? }; expect: EvalAssertion[] }
EvalAssertion: status | finalState { equals: string | string[] } | maxTurns | maxCost | toolCalled | toolNotCalled | textIncludes | textExcludes | errorCode
             | firstTool { tool, ignore? = COGNITIVE_TOOL_NAMES } | maxToolExecutions { tool, value }
             | jsonOutput { schema: ZodType }  (→ Promptfoo is-json + z.toJSONSchema) | openuiProgram { components? = OPENUI_COMPONENTS }
PROMPT_INJECTION_CASES · TENANT_ISOLATION_CASES · BUDGET_CASES · TOOL_SELECTION_CASES · STRUCTURED_OUTPUT_CASES · IDEMPOTENCY_CASES
SANDBOX_ESCAPE_SNIPPETS · SANDBOX_ESCAPE_CASES (agent "coder") · runSandboxEscapeSuite(execute) → { contained, leaked }
extractJson(text) · parseOpenUIProgram(text) → { found, components }
diffTrajectories(production, shadow) → { statusMatch, toolSequenceMatch, divergedAtStep, costDeltaUsd, turnDelta, verdict: "equivalent"|"diverged"|"regressed"|"improved" }
runShadowComparison(event, { production, shadow }) → { production, shadow, diff }     // runs live + shadow concurrently
GoldDatasetSchema { name, version, cases } · loadGoldDataset(blobs, key) · runRegression(cases, run) → { passed, failed }

// packages/core
new WebhookRelay({ url, secret, fetch?, outbox?: SqlStore, maxAttempts? /*3*/, timeoutMs? /*10_000*/, redact? /*true*/ })
  .publish(event) .send(payload, { tenantId, eventId?, eventType?, url? }) .drainOutbox(limit?)
  // headers: x-agent-signature (t=…,v1=…), x-agent-timestamp, x-tenant-id, x-agent-event-id, x-agent-event-type
verifySignature(secrets: string | string[], body, header, options?)        // receiver side, rotation-friendly
generateEfficiencyReport(sql, { from, to }, { maxTurns, maxCostUsd, stallMs? }) → EfficiencyReport (EfficiencyReportSchema)
new Tracer({ exporters?, redact? /*true*/, maxAttributeChars?, baseAttributes? }).startSpan(name, { kind?, parent?, traceId?, attributes? }) / .withSpan / .flush()
new LangfuseSpanExporter({ publicKey, secretKey, baseUrl?, environment?, release?, maxBatchSize?, onPartialFailure? })
// packages/integrations/src/langfuse.ts
new LangfuseTelemetrySink({ ...LangfuseExporterOptions, exporter?, skip?: TelemetryEvent["type"][] })   // library option (events → spans); the template sends
                                                                                                    // Langfuse the per-step traces via observerOptions().tracing → traceExporters() instead
telemetryEventToSpan(event): SpanData
new OtlpHttpSpanExporter({ endpoint, headers?, serviceName })
new WarehouseSync(sql, { endpoint, token, tenantId, batchSize? /*50*/, fetch? }).flush() → { flushedCount }   // marks rows synced only after a 2xx

// packages/flue
installAgentStarterObserver({ sinks?: (env) => TelemetrySink[], tenantOf?, onError?, onEvent?, tracing?: ObserverTracingOptions }): () => void
// maps: turn → "model" (tokens, costUsd, model) · tool → "tool" · submission_settled → "status" · task_start → "log" · compaction → "memory"
ObserverTracingOptions { exporters: (env) => SpanExporter[]; capture?: { eventPayload?, prompt?, reasoning?, toolIo?, dbDelta? } /* all true */;
                         sandboxTools? /* run_code, execute_sandbox_command, run_command */; maxAttributeChars? /*16000*/; redact? /*true*/; waitUntil?; maxOpenRuns? /*200*/ }
FlueTraceRecorder   // what `tracing` installs: one trace per submission — waking payload, exact prompt per model turn, completion,
                    // reasoning, tool args/results (sandbox tools: code + console output), subagent tasks, DB deltas
recordDbDelta(runId, delta: Record<string, string|number|boolean|null|undefined>, toolCallId?)   // from a tool: attaches `db.delta` to the step; no-op without tracing
modelHealth.state(provider) / canRequest(provider)   // per isolate; fed by observer "turn" events

// packages/cloudflare (workerd sandbox, R-EVAL-09): run any executor through the probes inside real workerd
new Miniflare(convertV4MiniflareOptions({ modules: [...], compatibilityFlags: ["nodejs_compat"], workerLoaders: { LOADER: {} }, outboundService }))
```

## Recipes

### 1. Run the eval suite
```bash
# terminal 1
echo 'EVAL_HARNESS_SECRET="local-eval-secret-0123456789"' >> .dev.vars
pnpm seed:dev --tenant tenant_alpha && pnpm seed:dev --tenant tenant_corrupt   # eval tenants get usable limits
AGENT_STARTER_LOCAL_ONLY=1 pnpm dev                  # http://localhost:5173
# terminal 2
EVAL_HARNESS_SECRET=local-eval-secret-0123456789 pnpm evals     # promptfoo is a devDependency
pnpm evals:view
```
`EVAL_BASE_URL` overrides the target (default `http://localhost:5173`, the same port CI uses). Every case picks its
agent with `vars.agent` (`defaultTest.vars.agent` is the project's first HTTP agent, filled in by `compose.ts`).
Promptfoo exits non-zero when any case fails; there is no `--fail-on-error` flag.

### 2. Add eval cases
- YAML: add a file under `evals/` (it is picked up by `tests: file://evals/*.yaml`). Each test sets `vars.agent`,
  `vars.eventPayload` and assertions over `output` (the harness JSON). Use `transform: output.finalText` for
  `llm-rubric` / `is-json` assertions, since `output` is an object.
- Programmatic: build `EvalCase[]` with the assertion types above, then `toPromptfooTests(cases)` → YAML under `evals/`.
  `firstTool` (tool selection, cognitive tools ignored), `jsonOutput` (zod contract → JSON Schema),
  `openuiProgram` (library components only) and `maxToolExecutions` + `vars.replay: 2` (idempotency on reconnect)
  cover the cases plain status checks miss.
- Sandbox: `packages/cloudflare/test/sandbox-workerd.test.ts` bundles the production `run_code` tool with esbuild and runs
  `runSandboxEscapeSuite` inside workerd (miniflare, `workerLoaders: { LOADER: {} }`), with a secret binding and a 200-answering
  outbound service as controls; `SANDBOX_ESCAPE_CASES` / `evals/module-coding.yaml` probe the `coder` agent end to end.
  Add a probe to `SANDBOX_ESCAPE_SNIPPETS` and both pick it up.
- Workflow outcome: assert `finalState` (`{ type: "finalState", equals: ["DONE"] }` → `["DONE"].includes(output.finalState)`)
  for agents with a workflow; the route must fill `finalState` from the run's workflow state.
- Per-module suites: `evals/module-<m>.yaml` exist for all eight modules (tool selection for delegation/rooms/researcher,
  VM commands, `end_call`; approval-gated submits; bot walls; injected page text; tenant flags; spoken style).
- Gold datasets: store `{ name, version, cases }` JSON in R2 (`evals/…`) and load with `loadGoldDataset(new R2BlobStore(env.WORKSPACE_BUCKET), key)` in a regression script/test via `runRegression`;
  Promptfoo YAML in R2 at `evals/promptfoo.tests.yaml` is pulled by CI to `evals/r2.tests.yaml` and runs with the rest.
- Prefer assertions on `output.toolCalls`, `output.executionStatus`, `output.turnCount`, `output.accumulatedCost` over LLM rubrics.

### 3. Shadow-test a prompt/model change
```ts
import { runShadowComparison } from "@agent-starter/evals";
const { diff } = await runShadowComparison(
  { tenantId, userId: "system:shadow", eventPayload: payload, mode: "shadow" },
  { production: (e) => runAgent(BackgroundWorker, e), shadow: (e) => runAgent(BackgroundWorkerV2, e) },   // runAgent: copy the run() body of src/lib/evals.ts
);
if (diff.verdict === "regressed") alert(diff);
```
Each run must use a **fresh conversation id** (`initialData.mode` applies only when the instance is created).
The production runner gets `mode: "live"` from `runShadowComparison` — point it at a staging tenant unless you
really want live side effects.

### 4. Per-step traces to Langfuse / OTLP (wired when configured)
Set `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` (and `LANGFUSE_BASE_URL` for US/self-hosted) as secrets, and/or the
`OTLP_TRACES_ENDPOINT` var (+ `OTLP_TRACES_TOKEN` secret) for any OpenTelemetry collector. `observerOptions()` passes
`tracing: { exporters: (env) => traceExporters(env) }`, so every submission becomes one trace with the waking payload,
the exact prompt and completion of each model turn, reasoning, tool args/results (`run_code` / VM commands as code +
console output) and DB deltas. Report a state change from a tool so it lands on that step:
```ts
import { recordDbDelta } from "@agent-starter/flue";
execute: async (args, ctx) => {
  const row = await saas.updateContact(args);
  recordDbDelta(ctx.runId, { table: "contacts", id: row.id, field: "onboarding_complete", value: true }, ctx.toolCallId);
  return row;
}
```
Data you must not ship to a tracing backend: turn `capture.prompt` / `capture.toolIo` off in `observerOptions()`;
secrets, JWTs and keys are redacted by default (`redact: true`).

### 5. Receive and verify agent webhooks in the host
`web/host-routes.example.ts` `handleAgentWebhook`: 401 when `x-agent-signature` or `x-tenant-id` is missing,
`verifySignature([OUTBOUND_WEBHOOK_SECRET, WEBHOOK_SIGNING_SECRET], raw, x-agent-signature)` → 403 on failure, 400 when
`event.tenantId !== x-tenant-id`, then fan out. Dedupe on `x-agent-event-id`: the Worker's durable outbox retries failed
deliveries (every minute, backoff up to 1 h, DEAD after 12 attempts), so the same event can arrive more than once.

### 5b. Deploy preflight, canary and smoke
`pnpm run deploy` runs `bash scripts/canary.sh preflight` first: it refuses `REPLACE_WITH_*_KV_ID` placeholders and a
`PUBLIC_BASE_URL` that is localhost, loopback or a placeholder (approval and artifact links are built from it). After
`wrangler deploy`, `bash scripts/canary.sh verify` checks `/health` = 200 and a malformed approval token = 400
(`CANARY_BASE_URL` overrides the target). The CI `production-deploy` job runs the same two steps around wrangler-action
(repository variable `CANARY_BASE_URL`); a failed canary fails the job (`npx wrangler rollback`). For a signed-event smoke
against a running Worker, use the generated README's "Background jobs" snippet (`test/ingestion.e2e.test.ts` is the same
path in Node).

### 6. Read the efficiency report on demand
```ts
const report = await registry(env).efficiencyReport(Date.now() - 86_400_000, Date.now());   // src/lib/platform.ts registry()
```
Everything comes from the counters agents report into the registry (heartbeats + `complete()`), bucketed so a window
counts only what was spent inside it: cost, tokens, tool calls, VM seconds and `kpis.infrastructureLeakedCostUsd`
(VMs that hit the hard TTL), first-line routing density, and anomalies (`BUDGET_LIMIT_BREACHED`, `ROGUE_LOOP_DETECTED`, `STALLED`).

### 7. Lint and audit
`pnpm lint` (ESLint recommended + typescript-eslint recommended over `src/`, `test/`, `web/`, `scripts/`, `voice-agent/src`;
`_name` marks intentionally unused bindings; control-character regexes are allowed for sanitizers). CI also runs
`pnpm audit --prod --audit-level high`: a high/critical advisory in a production dependency fails the build. Fix with an
upgrade or a pinned override in `package.json` (`overrides` + `pnpm.overrides`), as done for `@modelcontextprotocol/client`.

## Checklist — spec requirements for this topic
- [ ] **Assertion-based evals, not vague LLM-judge scores, in CI and locally.** Verify: `promptfoo.config.yaml` + `evals/*.yaml` use `javascript`/`is-json` assertions on harness fields; `pnpm evals` runs (promptfoo is a devDependency); CI job `semantic-evals` fails on any failing case.
- [ ] **Cost/turn cap enforcement.** Verify: `defaultTest` asserts `accumulatedCost <= 1.5 && turnCount <= 25` (the config's budget ceilings, filled in by compose from `DEFAULT_BUDGET`); the background onboarding case keeps the spec's `turnCount <= 5 && accumulatedCost < 0.25`; `BUDGET_CASES`; evals test "passes the built-in prompt-injection and budget datasets against a real runtime"; compose test "loads gold datasets, targets agents and keeps one port".
- [ ] **Idempotency under disconnects.** Verify: harness test "parks HIGH-risk tools for human approval and runs them exactly once"; evals test "a replayed delivery executes the side effect once against a real runtime"; promptfoo `evals/module-background.yaml` "Idempotency on reconnect" (`replay: 2`, `deduplicatedDeliveries === 1`).
- [ ] **Tenant isolation.** Verify: promptfoo test "Payload referencing another tenant…"; `TENANT_ISOLATION_CASES`; core test "rejects payloads referencing another tenant".
- [ ] **Tool selection on the first turn.** Verify: `evals/module-<module>.yaml` first-tool cases (`get_contact_profile`, `search_help_center`, `web_search`, `app_api_read`); evals test "asserts the first task tool, ignoring planning/workflow tools".
- [ ] **Output format validation against zod/TS contracts.** Verify: `jsonOutput` / `openuiProgram` assertions (evals tests "validates JSON replies against a zod contract", "checks OpenUI programs use only library components"); `evals/module-chat.yaml` structured-output cases; tool schemas reject invalid args (core test "returns schema issues instead of executing on bad arguments").
- [ ] **Prompt-injection resistance.** Verify: promptfoo "System-override injection is halted (SECURITY_EXCEPTION_HALT, TERMINATED)"; harness test "removes every tool when a message is a prompt injection".
- [ ] **Sandbox escape prevention.** Verify: cloudflare `sandbox-workerd.test.ts` › "contains every escape probe", "blocks outbound network from the isolate while the host can reach it", "exposes no secrets or bindings to the isolate" (real codemode executor in workerd); `evals/module-coding.yaml` (env, network, globals probes via the coder's `run_code`); evals test "flags executors that leak env, network or bindings and passes sealed ones".
- [ ] **Shadow deploys**: fork event to production + shadow (mutations simulated), diff, flag regressions. Verify: `mode: "shadow"` simulates (core test "simulates mutating tools in shadow mode"); evals test "diffs shadow vs production trajectories"; background template test "forks a sampled job into a shadow twin that never affects production (R-EVAL-10)" (`SHADOW_SAMPLE_RATE`, diffs in R2).
- [ ] **Gold datasets co-located in R2, pulled by CI.** Verify: CI step "Pull gold datasets from R2" writes `evals/r2.tests.yaml`, loaded by `tests: file://evals/*.yaml`; evals test "loads gold datasets from object storage".
- [ ] **Secure test-harness route** (secret header, fresh instance, returns trajectory/turns/cost/status and the final workflow state). Verify: evals tests "requires the eval secret and returns assertable output" and "returns the final workflow state as ExecutedState (spec c7)"; `curl -X POST …/api/test-eval-harness` without the header → 401 (404 when the secret is unset); `mode: "live"` refused unless `EVAL_ALLOW_LIVE=true`.
- [ ] **Per-module eval suites** for every module (tool selection, security, approvals). Verify: create-agent-starter `project-ops.test.ts` › "ships a suite for every module whose cases only target that module's agents" and "asserts first-tool selection with tools that exist in the module's sources".
- [ ] **End-to-end ingestion test in generated projects** (signed event → 202 → queue handler → dispatch, fakes for KV/Queue/registry/Flue). Verify: generated `test/ingestion.e2e.test.ts` › "accepts a signed event with 202, queues one envelope and dispatches one job-scoped turn"; `project-ops.test.ts` › "ships the signed-event → queue → dispatch test with background projects and the Node stand-ins it needs".
- [ ] **End-to-end semantic tracing per step** (event payload, exact prompt, reasoning, sandbox code + output, DB delta). Verify: flue `observer-tracing.test.ts` › "records the waking payload, exact prompts, tool args/outputs, sandbox code/output and DB deltas"; `grep -n "tracing:" src/lib/platform.ts`.
- [ ] **Langfuse / OTLP export.** Verify: `traceExporters()` in `src/lib/platform.ts` (Langfuse with `integrations.langfuse` + `LANGFUSE_*`, OTLP with `OTLP_TRACES_ENDPOINT`); integrations test "posts to the Langfuse ingestion API by default"; traces visible in Langfuse with `LANGFUSE_*` set. Telemetry events and ops alerts go to the webhook and Pusher, not Langfuse (`LangfuseTelemetrySink` is an optional library sink).
- [ ] **Signed webhook relay to the SaaS with a durable outbox, verified by the host (R-EVT-11).** Verify: `OutboxWebhookSink` in `telemetrySinks()`, `sendToSaas` in `notify_saas` and the daily report; template `test/delivery.test.ts` › "parks a delivery that failed its retries and the cron drain delivers it later, re-signed", "keeps retrying with backoff, then marks the row DEAD after 12 attempts"; core test "verifies signed webhooks and rejects tampering and replays".
- [ ] **CI/CD**: type safety (Worker + `web/`), lint, dependency audit, contract tests with coverage, evals, then preflight → deploy with wrangler-action (repo secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`) → canary. Deploy runs only when evals ran and passed (or `vars.ALLOW_DEPLOY_WITHOUT_EVALS == 'true'`). Verify: `.github/workflows/ci.yml` jobs `audit-and-validate` → `semantic-evals` (secret presence computed in a step, no `secrets` in job `if`) → `production-deploy`; compose test "generates a valid CI workflow that gates deploys on evals" (also asserts preflight before and canary after the deploy step); `project-ops.test.ts` › "runs lint, web typecheck and a prod dependency audit in the generated CI".
- [ ] **Linting and dependency vulnerability audit (generated projects and monorepo).** Verify: `pnpm lint` passes; `pnpm audit --prod --audit-level high` passes; `project-ops.test.ts` › "adds ESLint, a lint script and its config to every generated project" and "lints the monorepo with the same rule set".
- [ ] **Template drift is caught.** Verify: root CI job "Generated projects" (fresh `--all` compose diffed against `examples/full`, each module alone through `tsc` / web `tsc` / `eslint`, `voice-agent/` install + typecheck + build).
- [ ] **Coverage is reported.** Verify: `pnpm test:coverage` writes `coverage/` (v8: text summary, HTML, lcov, json-summary); CI uploads the `coverage` artifact.
- [ ] **A fresh install is usable.** Verify: `pnpm seed:dev --token` seeds the local dev tenant; template test "writes a valid, generous TenantConfig and never targets production".
- [ ] **Infra bootstrap script** (queues, KV, Vectorize + metadata indexes, R2, secrets; project-scoped names; re-runnable). Verify: `bash scripts/init-cloudflare-infra.sh` on a fresh account, then again (existing resources are skipped); `project-ops.test.ts` › "re-runs the generated create lines after a resource already exists"; [references/deploy-checklist.md](references/deploy-checklist.md).
- [ ] **Zero-downtime deploy with canary verification, never against localhost.** Verify: `pnpm run deploy` ends with `✅ Production deployment verified at <url> (health=200, validation=400)`; it refuses to start while `REPLACE_WITH_*_KV_ID` placeholders remain or `PUBLIC_BASE_URL` is local / a placeholder (`project-ops.test.ts` › "stops deploy.sh before any build when KV ids are still placeholders", "refuses a localhost or placeholder PUBLIC_BASE_URL before deploying, and accepts a public one (R-OPS-13)").
- [ ] **Transactional migrations with rollback.** Verify: `MigrationRunner.rollbackTo` (core test "rolls back a failing migration atomically"); DO migrations append-only in `wrangler.jsonc`.
- [ ] **Liveness sentinel + daily efficiency report.** Verify: `wrangler.jsonc` crons `* * * * *` (sentinel + outbox drain) and `17 6 * * *` (report, anomalies measured against the config budget: `reportThresholds`); see `agent-starter-background-jobs`.
- [ ] **Telemetry contract + observer installed once at module scope.** Verify: `installAgentStarterObserver(observerOptions())` at the top of `src/app.ts`; `TelemetryEventSchema` parses events from sinks.
- [ ] **Model health / fallbacks observable.** Verify: observer records provider failures (`modelHealth`); runbook "model outage". No health endpoint — see Not yet implemented.
- [ ] **Buffered warehouse sync** (batches, synced only after a 2xx, no duplicates, no loss). Verify: core `warehouse-sync.test.ts` › "never re-sends synced rows (no duplicate accounting) and is a no-op when caught up" and "keeps rows unsynced when the warehouse fails, then delivers them on the next flush (no data loss)"; the background worker flushes when `WAREHOUSE_SYNC_URL` is set.
- [ ] **Blue/green version gating.** `platform()` passes `version: { current: () => bindings().CODE_VERSION }`, so a deploy with an incompatible `CODE_VERSION` (default: different major) locks or hands off conversations started on the old version (`VersionGate`). Verify: `grep -n "version:" src/lib/platform.ts`; bump `CODE_VERSION` in `wrangler.jsonc` on every release.
- [ ] **No insecure endpoints, no loose VMs.** Verify: `test/security.test.ts`; eval harness disabled without a ≥16-char secret; VM TTLs (`agent-starter-computer-use`).
- [ ] **Incident readiness.** Verify: on-call can follow [references/incident-runbook.md](references/incident-runbook.md) end to end in staging.

## Pitfalls
- **Never enable the harness in production with a weak secret.** It runs real agents. `mode: "live"` is refused unless the deployment sets `EVAL_ALLOW_LIVE=true` (dedicated eval Workers only), and `EVAL_TENANTS` pins the tenants cases may use.
- **Promptfoo's `webhook:` provider cannot send headers or a custom body** and requires a string `output`; the config uses the HTTP provider (`id: http`, `config.url`, `transformResponse: json.output`).
- **`output` is an object** — use `output.finalText` / `output.summary` in `javascript` assertions and `transform: output.finalText` for `llm-rubric` / `is-json`.
- **GitHub Actions cannot read `secrets` in a job-level `if`** — compute presence in a step (`steps.gate.outputs.ran`) or use `vars`.
- **Eval tenants are freemium unless seeded** (5 turns): CI seeds `tenant_alpha` / `tenant_corrupt` with `scripts/seed-dev-tenant.mjs`; do the same locally.
- **Eval ids must be fresh** (`initialData` seeds only on creation) — reusing an id carries memory, budget and goals over.
- **Outbox deliveries repeat.** A webhook that timed out at the SaaS but was processed there is retried from the outbox: receivers must dedupe on `x-agent-event-id`. The cron drains at most 50 due rows per minute (`drainOutbox(limit)`), so a long outage's backlog takes a while to clear.
- **Rotating `OUTBOUND_WEBHOOK_SECRET`** re-signs queued outbox rows with the new secret: accept both secrets in the host during a rotation (`web/host-routes.example.ts` does).
- **Tracing ships prompts and tool payloads** to Langfuse/OTLP by default: switch `capture.prompt` / `capture.toolIo` off for regulated data.
- **`pnpm create` is pnpm's own command**; the CLI runs from a checkout (`agent-starter-scaffold`).
- **Observer tenant resolution** splits ids on `--`; ids with extra `--` (specialists in rooms) report `tenant=unknown` to sinks.
- **`modelHealth` is per isolate** — a fresh isolate starts with all circuits closed.

## Verify
```bash
pnpm --filter @agent-starter/evals test            # harness contract, finalState, datasets, shadow diff, gold datasets
pnpm --filter @agent-starter/cloudflare test       # incl. sandbox-workerd.test.ts (real workerd) and ai-search.test.ts
pnpm --filter @agent-starter/integrations test     # Langfuse exporter, Pusher
pnpm --filter @agent-starter/core test             # signatures, telemetry, migrations, warehouse sync
pnpm --filter @agent-starter/flue test             # observer-tracing.test.ts
pnpm lint && pnpm audit --prod --audit-level high && pnpm typecheck && pnpm test   # monorepo gate
# generated project
pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm build && pnpm evals
```

## Related skills
`agent-starter-background-jobs` (sentinel, DLQ, reports) · `agent-starter-models-and-cost` (budgets, fallbacks) ·
`agent-starter-security` (secrets, signatures, injection) · `agent-starter-scaffold` (migrations, infra lines) ·
`agent-starter-computer-use` (VM cost caps) · `agent-starter-definition-of-done`.

## Not yet implemented
- Dead outbox rows (12 failed attempts) are kept 30 days in the registry DO but raise no alert; inspect them with `registry(env).drainOutbox()` (its `dead` count) or the DO's SQLite.
- No model-health endpoint or alert (circuit state is per-isolate memory); suggested: `src/app.ts` admin route reading `modelHealth`.
- The generated eval route reports `finalState` only once it reads the run's workflow state (`src/lib/evals.ts`; the `wf:<instanceId>` key the run-status observer writes); until then `ExecutedState` falls back to the execution status.
- The CLI is not published to npm (`create-agent-starter`, `@agent-starter/*`); `pnpm pack` produces an installable tarball (`prepack`), see `agent-starter-scaffold`.
