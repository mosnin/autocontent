---
name: agent-starter-computer-use
description: Build and change computer-use agents in an Agent Starter project — boat.dev Ubuntu VMs (BoatDevVmProvider, region, golden snapshots via the plain-node scripts/build-golden-vm.mjs, hard TTLs), the per-run VmRunManager (SqlVmRunStore meter, VmCostMeter budget teardown, end reasons and leaked hard-TTL cost, RecoveryManager with linear VM_UNREACHABLE backoff, heartbeats during long commands, stop during approval waits with a bounded browser_submit grace, PROVISIONING/RUNNING/STOPPING telemetry), operator teardown and sentinel recovery (emergencyStopRunVm, registerRecoveryHook), AGENT_CRITICAL_HALT alerts, tools (createBoatDevTools shell/files/run_browser_automation with live output, createBrowserActionTools navigate/click/type/scroll/screenshot/extract and approval-gated browser_submit), the computerUse / autonomousBrowserUse flags, Browser Rendering, codemode. Use when touching src/agents/operator.ts, src/computer-use/*, scripts/build-golden-vm.mjs, browser or sandbox tools, or VM cost/teardown behaviour.
---

# Computer use (boat.dev VMs, browsers, sandboxes)

Pick the **lightest** executor that can do the job:

| Need | Use | Isolation | Cost |
|---|---|---|---|
| Read a JS-heavy public page as markdown | `createBrowsePageTool(new BrowserRenderingClient(…))` (`browse_page`) | Cloudflare Browser Rendering REST, SSRF-guarded | per render, KV-cached |
| Read simple pages | `createWebTools({ jina })` (`fetch_url_markdown`, integrations) | fetch, SSRF-guarded | ~free |
| Run model-written JS over your own tools | `createCodeExecutionTool({ loader, tools })` (`run_code`) | Dynamic Worker isolate, **no network, no env** | ms |
| Shell, Docker, Python, real Chrome, interactive browsing | `createBoatDevTools` + `createBrowserActionTools` with a `VmRunManager` | dedicated Ubuntu VM per run | per VM-second |

`@cloudflare/sandbox` 1.0 dropped `exec`, so full machines are boat.dev (`BoatDevVmProvider`).

## When to use
Adding VM/browser/sandbox capabilities, changing the golden image, VM lifecycle, budgets or teardown,
reviewing a computer-use agent for safety, or debugging leaked/expensive VMs.

## Mental model — who owns what

| Concern | File (generated project) | Library source |
|---|---|---|
| Operator agent (tools gated on `integrations.boatdev` + key, budget, hibernate on every finish, `useCustomSkills()`) | `src/agents/operator.ts` (`ComputerOperator`, `/agents/computer-operator`) | — |
| VM per run: manager, telemetry (with `data.vmSeconds`), lifecycle events, hibernate / approval grace, leaked-cost report, alerts, out-of-band stop, recovery hook | `src/computer-use/vm.ts` (`vmManager`, `vmProvider`, `vmIndex`, `vmTelemetry`, `emitVmLifecycle`, `hibernateVm`, `reportVmEnd`, `stopVmForRun`; tested in `test/vm-approval-wait.test.ts`) | `packages/integrations/src/boatdev.ts` `VmRunManager`, `emergencyStopRunVm`, `vmApprovalWait`, `approvalVmGraceSeconds`, `vmAlertTelemetryEvent` |
| Operator as a delegation worker (grant enforced at execution time, `DONE:` report auto-returned) | `src/computer-use/delegation.ts` (`operatorDelegation`, tested in `test/operator-delegation.test.ts`), used in `src/agents/operator.ts` with `delegationDispatch` from `src/lib/delegation.ts` | flue `createDelegationTools`, `delegationPolicy`, `useDelegation` |
| Operator teardown route | `src/computer-use/routes.ts` (`vmRoutes`: `GET /api/vm/:runId`, `POST /api/vm/:runId/teardown`) | — |
| Sentinel recovery stops the VM (R-CU-14) | `registerRecoveryHook("computer-use:vm", …)` in `src/computer-use/vm.ts` | base `src/lib/recovery.ts`, called by `src/lib/cron.ts` |
| Golden image build (plain Node 22, no packages) | `scripts/build-golden-vm.mjs` + `scripts/golden-vm-provision.sh` → `BOAT_GOLDEN_SNAPSHOT_ID` var | `BOAT_PROVISION_SCRIPT` (the `.sh` is an exact copy, test-enforced); `buildGoldenSnapshot` for TS callers |
| VM API client, TTL clamp, exec / streamed exec, files, resume, snapshots | — | `BoatDevVmProvider` |
| Layer B meter + emergency teardown | — | `VmCostMeter` → core `BudgetGuard.recordVm` |
| Shell/file/bulk-extract tools, guard, live output | — | `createBoatDevTools`, `createVmGuard`, `createOutputStreamer` |
| Interactive browser tools + script | — | `packages/integrations/src/browser-actions.ts` |
| Browser protocol for the model | `src/skills/browser-automation/SKILL.md` | `BROWSER_ACTIONS_PROMPT`, `BROWSER_AUTOMATION_PROMPT` |
| Provisioning recovery state machine | — | core `RecoveryManager` (`as_recovery_state`) via `VmRunManager({ recovery })` |
| Browser Rendering + SSRF guard | — | `packages/cloudflare/src/browser.ts` |
| Codemode sandbox | `wrangler.jsonc` `worker_loaders: [{ binding: "LOADER" }]` | `packages/cloudflare/src/codemode.ts` |
| Config | `integrations.boatdev: true` in `agent-starter.config.ts` (compose sets it with computer-use or coding); vars `BOAT_GOLDEN_SNAPSHOT_ID`, `BOAT_USD_PER_SECOND`, `BOAT_REGION`, `APPROVAL_VM_GRACE_SECONDS` (120); secret `BOAT_DEV_API_KEY`; `OPS_ALERT_EMAIL` + telemetry sinks for halt alerts | `templates/modules/computer-use/module.json` |

## API reference (from source)

```ts
// packages/integrations/src/boatdev.ts — provider
new BoatDevVmProvider({ apiKey?, basePath?, fetch?, api?, defaultTtlSeconds? /*600*/, maxTtlSeconds? /*3600*/, defaultSize?, labels?, region?, noEnv? /*true*/,
                        readyTimeoutMs?, retryWindowMs?, retryDelayMs?, pollIntervalMs? })
  .ttl(requested?)                                        // clamp(60, maxTtl): Layer A can never be disabled
  .region({ region? }?)                                   // per-call override, else the provider's; validated /^[a-z0-9][a-z0-9-]{1,31}$/
  .create(o?) / .forkFromSnapshot(snapshot, o?) / .forkSandbox(id, o?) → VmHandle { id, state, ttlSeconds, billingMultiplier?, autoStopAt?, updatedAt?, labels?, … }
                                                          // region → request field `region` + label `region`
  .resume(id, { ttlSeconds?, waitUntilReady?, signal? })  // revive a stopped VM with a fresh TTL
  .listByLabels({ run: "<label>" }, { limit? })           // boat.dev label=key=value filter
  .exec(id, command, { cwd?, timeoutSeconds?, signal? }) → VmExecResult
  .execStream(id, command, { onOutput(chunk: { stream, data }), mode?: "stream" | "poll", cwd?, timeoutSeconds?, signal?, pollIntervalMs? }) → VmExecResult
  .writeFile / .readFile / .stop(id, { force? }) / .saveSnapshot / .waitForSnapshot / .delete / .buildGoldenSnapshot({ name, setupScript?, … })

// durable per-run lifecycle + metering
interface VmRunRecord { runId; tenantId; sandboxId; status: "running" | "stopped" | "torn_down" | "halted"; billingMultiplier; lastTickAt; generation; updatedAt; reason?;
                        ttlExpiresAt?; endReason?: VmEndReason; leakedSeconds?; leakedCostUsd? }
type VmEndReason = "hibernated" | "ttl" | "approval-grace" | "budget" | "operator" | "recovery" | "unreachable" | "power-cycle"
interface VmRunEnd { runId; tenantId; sandboxId; reason; leakedSeconds; leakedCostUsd; totalLeakedSeconds; totalLeakedCostUsd; at }
new SqlVmRunStore(sql)                 // agent DO SQLite, table as_vm_runs (strongly consistent — meter state lives here; older tables get the new columns)
new KeyValueVmRunStore(kv, { prefix? /*"vm:"*/, ttlSeconds? })   // out-of-band index (KV) for routes/crons; never meter from it
new VmRunManager({ provider, store: () => VmRunStore, index?: () => VmRunStore, budget: (scope) => BudgetGuard, usdPerSecond,
                   goldenSnapshot?, ttlSeconds?, size?, labels?, recovery?: { sql, maxRetries?, backoffMs?, sleep? }, onAlert?,
                   onEnd?: (end: VmRunEnd) => void | Promise<void>, onLifecycle?: (e: VmLifecycleEvent) => void | Promise<void>,
                   heartbeatIntervalMs? /*30_000*/, clock? })
interface VmLifecycleEvent { runId; tenantId; sandboxId; status: "PROVISIONING" | "RUNNING" | "STOPPING"; reason; at }   // listener errors are logged, never thrown
  .ensure(scope) → sandboxId     // halted? refuse · running → reuse (past its TTL deadline: GET it; stopped by the TTL → end "ttl", resume) · stopped → resume · else budget.check() + fork golden / create
  .withVm(scope, fn)             // beats scope.heartbeat every 30 s · ensure → checkpoint (tick + budget check; breach → teardown + alert) → fn → tick; 404/409 → mark stale, retry once
  .checkpoint(scope) · .tick(scope) · .hibernate(runId) → { stopped, sandboxId?, reason? } · .teardown(runId, reason) · .powerCycle(runId, attempt) · .record(runId)
  .holdForApproval(runId, graceSeconds? /*120*/) → { held, stopped, sandboxId?, until? }   // bills to now, shortens boat.dev's TTL to the grace; hibernates if that fails
interface VmRunScope { runId; tenantId; tenantConfig?; signal?; heartbeat?: () => unknown }
emergencyStopRunVm({ provider, runId, reason, index?, halt?, force?, onAlert? }) → { stopped[], failed[], halted }  // index + run= label lookup; endReason operator/recovery
vmRunLabel(runId) · isVmUnreachable(error) · classifyVmFailure(error): FailureState · vmUnreachableBackoffMs(n) = 2000 × n
withHeartbeat(beat, fn, intervalMs? /*30_000*/)   // beats while fn runs; beat failures swallowed
toolHeartbeat(ctx)                     // ctx.services.heartbeat (useAgentStarter's throttled run beat) or undefined
vmApprovalWait({ pendingApprovalTools?, graceSeconds? /*120*/ }) → { action: "hibernate" } | { action: "hold", graceSeconds }   // hold only for a pending browser_submit
approvalVmGraceSeconds(env.APPROVAL_VM_GRACE_SECONDS) → number   // non-negative integer, else 120 · LIVE_PAGE_APPROVAL_TOOLS = ["browser_submit"]
vmAlertTelemetryEvent(alert: VmRunAlert) → { type: "error", logType: "error", content: "AGENT_CRITICAL_HALT: …", data: { code: "AGENT_CRITICAL_HALT", …alert } }
new VmCostMeter({ provider, sandboxId, budget, usdPerSecond, billingMultiplier?, startedAt?, clock?, onAlert?, forceOnFailure?, deleteOnFailure? })
  .tick() · .checkpoint() · .emergencyTeardown(reason) · .release({ stop? /*true*/ }) · .lastTickAt · .tornDown · .totals()

// tools
createBoatDevTools({ provider, vm?: VmRunManager, sandboxId?, meter?: VmCostMeter | ((ctx, sandboxId) => VmCostMeter | undefined),
                     telemetry?: (ctx) => VmTelemetrySink | undefined, streamMode?, maxTimeoutSeconds? /*≤300*/, workspaceDir?, maxStreamChars?, enforceTenantFeatures? /*true*/ })
// execute_sandbox_command MEDIUM/external (≤300 s, streams output) · run_browser_automation MEDIUM/external · write_vm_file MEDIUM/write · read_vm_file LOW/read
createVmGuard({ vm?, sandboxId?, meter?, enforceTenantFeatures?, heartbeatIntervalMs? }) → (ctx, fn, features = VM_TOOL_FEATURES) => Promise   // passes toolHeartbeat(ctx) on
assertVmFeatures(ctx, features) · VM_TOOL_FEATURES = ["computerUse"] · BROWSER_TOOL_FEATURES = ["computerUse", "autonomousBrowserUse"]
resolveVmTelemetry(ctx, option?)       // ctx.services.telemetry (harness emitter) wins, else the option
createOutputStreamer(sink, meta, { flushMs? /*750*/, maxChunkChars? /*4000*/ }) .push(chunk) .end(result)   // redacts secrets; sink errors swallowed
boatSandboxPort(provider, sandboxId, { telemetry?, meta?, streamMode? }) → core SandboxPort (used by the coding agent)

// packages/integrations/src/browser-actions.ts
createBrowserActionTools({ provider, vm?, sandboxId?, meter?, workspaceDir?, saveScreenshot?: (ctx, { base64, bytes, name, pageUrl }) => Promise<{ key, url? }> })
// browser_navigate MEDIUM/external · browser_click MEDIUM (refuses submits/purchases) · browser_type MEDIUM (no Enter) · browser_scroll LOW/read
// browser_screenshot LOW/read · browser_extract LOW/read · browser_submit HIGH + requiresApproval (only on expectedHost) — all output untrusted
// browser_navigate / run_browser_automation URLs pass core assertPublicHttpUrl (packages/core/src/tenancy/egress.ts) first
// clicks: stepped mouse move to a random point in the inner 60% of the element box (element click if it has no box)
// both scripts: page.setUserAgent(desktopUserAgent(browser.version())) = one fixed desktop Chrome UA for the real engine major
// a browser restarted by a VM resume answers { ok: false, browserRestarted: true } instead of acting on about:blank
BROWSER_ACTION_SCRIPT · buildBrowserActionCommand(task) · BROWSER_ACTIONS_PROMPT
```

## Recipes

### 1. Build the golden image (once per dependency change)
```bash
BOAT_DEV_API_KEY=… node scripts/build-golden-vm.mjs golden-2026-11-10   # plain Node 22: fetch + scripts/golden-vm-provision.sh
# optional: BOAT_REGION=eu-central, BOAT_API_URL, BOAT_POLL_MS, BOAT_GOLDEN_TIMEOUT_MS
# then set "BOAT_GOLDEN_SNAPSHOT_ID": "golden-2026-11-10" in wrangler.jsonc vars and deploy
```
The script creates a builder VM running the provision script, waits for `setupStatus: "done"`, saves the
snapshot, waits for `ready`, and always deletes the builder VM. To change what is installed, edit
`BOAT_PROVISION_SCRIPT` in `packages/integrations/src/boatdev.ts` AND copy it to
`templates/modules/computer-use/files/scripts/golden-vm-provision.sh` (a test fails when they differ);
in a generated project, edit `scripts/golden-vm-provision.sh` (idempotent, non-interactive, runs as `user` with sudo).

### 2. VM lifecycle per run (what `src/computer-use/vm.ts` does)
```ts
const vm = vmManager();                      // provider + SqlVmRunStore(resolveSql()) + KV index + BudgetGuard(maxVmSeconds 3600) + recovery + onLifecycle
useAgentStarter({ ...platform("computer-operator", id), tools: [...createBoatDevTools({ provider, vm, telemetry }), ...createBrowserActionTools({ provider, vm, saveScreenshot })], budget: { maxVmSeconds: 3600 } });
useAgentFinish(() => hibernateVm(id));
// bills the last seconds and stops the VM once (next call resumes it), approval and question waits included.
// vmApprovalWait({ pendingApprovalTools: ApprovalStore.pending(id).map((a) => a.tool), graceSeconds }) says "hold"
// only for a pending browser_submit → vm.holdForApproval(id, APPROVAL_VM_GRACE_SECONDS ?? 120)
```
The VM id is never a tool argument: `withVm` resolves it from `ctx.runId`. Because the record (sandbox id,
last billed tick, TTL deadline) is in the agent's SQLite, a new isolate continues the same VM and meter.

Approval waits (spec L4897–4901, contract 8): the spec says stop the VM while a human decides, and the operator
does, for every pending approval and every `ask_person` question. The one deliberate exception is a pending
`browser_submit`: stopping the VM kills Chrome, so the approved click would land on a fresh page. That VM stays up
for at most `APPROVAL_VM_GRACE_SECONDS` (default 120; `0` stops it like any other wait): `holdForApproval` bills up
to now and shortens boat.dev's TTL to the grace. An approval inside the grace acts on the live page and the normal
TTL is restored; a later one finds the VM stopped by the TTL (end reason `approval-grace`, billed, **not** leaked),
the resumed browser reports `browserRestarted: true`, and the agent re-navigates and asks again.

Lifecycle telemetry (finding 32): `onLifecycle` emits `status` TelemetryEvents — `PROVISIONING` (fork golden
snapshot / create VM / resume), `RUNNING` (ready / resumed), `STOPPING` (hibernate, budget breach, in-run teardown) —
to the telemetry sinks, fire-and-forget, each stamped with the run's ledger `data.vmSeconds` (as are the `sandbox`
output events), which `AgentControlPanel` shows as **VM time**.

### 2b. Heartbeats during long commands (R3)
The heartbeat sentinel marks a run stalled after minutes without a beat. `createVmGuard` passes
`ctx.services.heartbeat` (the hook's throttled run beat) into `VmRunManager.withVm`, which beats it every 30 s
while the operation runs, so a 5-minute `npm run build` is never aborted as a deadlock. Your own long work:
`await withHeartbeat(toolHeartbeat(ctx), () => longThing())`.

### 2c. End reasons and leaked VM cost (spec: infrastructureLeakedCostUsd)
Every stop records `endReason`. When boat.dev's hard TTL stopped a VM before the software did, the manager
notices on the next `ensure`/`hibernate` (after the recorded `ttlExpiresAt`, it asks boat.dev), bills the
unattended seconds from the last tick to the stop into the ledger, adds them to `leakedSeconds`/`leakedCostUsd`
and calls `onEnd({ reason: "ttl", … })`. `src/computer-use/vm.ts` `reportVmEnd` puts the run's cumulative
`vmLeakedCostUsd` on its registry counters for the efficiency report. A busy VM whose TTL boat.dev extended
is not counted (the new deadline is recorded instead).

### 2d. Region
`BOAT_REGION` (wrangler var, e.g. `eu-central`) → `new BoatDevVmProvider({ region })`: sent as `region` on every
create/fork and set as the `region` label. boat.dev's v1 reference (SDK 1.13) does not document a placement
field, so check the label and the VM's location in the boat.dev dashboard before relying on it for residency.

### 2e. Delegated browser work (flagship chain: job → operator → report)
A background job (or the orchestrator) calls `delegate_task { agent: "operator", tools: [...] }`. The task runs in
its own operator conversation (`computer-operator--<tenant>---dlg.<hash>`, its own VM). `operatorDelegation({ id,
tools: vmTools, dispatch: delegationDispatch })` gives the operator `check_delegation`/`report_delegation`, a
`policy` for `useAgentStarter` (only requester grant ∩ operator tools run; shell stays off unless granted) and
`use(() => starter.awaitingHuman)` (intake, reply guard that ignores turns parked on an approval, auto-return).
It works with or without the background and multi-agent modules (the transport is the base `src/lib/delegation.ts`).

### 3. Feature flags
VM tools throw `TOOL_NOT_ALLOWED` unless the tenant config has `features.computerUse` (browser tools also
`features.autonomousBrowserUse`). Set them per tenant via the signed tenant-sync route or the dev seed.

### 4. Interactive browsing with approvals
`browser_click` inspects the live target and refuses form submits and buy/pay/order/send/delete/subscribe
buttons (`requiresApproval: true` + hint); the model must call `browser_submit { selector, expectedHost, description }`
(HIGH → parks with a signed approval; on approval it clicks only if the page is still on `expectedHost`).
Input looks human (spec R-CU-10): the click lands on a random point inside the element's box after a stepped
mouse move, delays are randomised, and pages see one fixed desktop Chrome UA for the real engine version.
Blocks (403/429/CAPTCHA) still end the action: no reload, no proxy or identity rotation, no challenge solving.

### 5. Live terminal output
`execute_sandbox_command` streams via `execStream` (boat.dev NDJSON; `streamMode: "poll"` uses detached
commands + byte offsets) into `sandbox` TelemetryEvents (`data: { stream, chunk, seq, toolCallId }`, final
`done: true, exitCode`). Sinks: `ctx.services.telemetry` if the harness provides it, else `vmTelemetry(ctx, agent)`
(webhook relay + Pusher). Render with `useAgentTelemetry` / `AgentControlPanel`.

### 6. Operator teardown and sentinel recovery
```bash
curl -X POST "$ORIGIN/api/vm/$RUN_ID/teardown" -H "authorization: Bearer $OPERATOR_SESSION_TOKEN"
```
Needs an `admin`/`operator` session for the run's tenant (`verifySessionToken` rejects visitor/voice tokens).
It force-stops every VM of the run (index + `run=` label), marks the run `halted` (the agent then refuses to
start a VM), aborts the run and sets the registry status `HALTED`. The heartbeat sentinel calls the
`computer-use:vm` recovery hook (graceful stop, not halted; the agent resumes on its next VM call). From your
own code: `await stopVmForRun(runId, env, { halt, force, reason })`.

Every teardown or budget breach raises `AGENT_CRITICAL_HALT` through `alertOps` in `src/computer-use/vm.ts`:
a TelemetryEvent (`vmAlertTelemetryEvent`) to the app's sinks (signed WebhookRelay to the SaaS, Pusher,
Langfuse) and an email to `OPS_ALERT_EMAIL`.

### 7. Provisioning failures (R-OPS-09)
`VmRunManager({ recovery: { sql } })` runs provisioning through core `RecoveryManager` with `classifyVmFailure`:
unreachable/404/409 → `VM_UNREACHABLE` (heal = `powerCycle`: force-stop, resume, then abandon and re-create;
linear backoff 2000 ms × attempt per spec L1874), timeouts/5xx/429 → backoff, 401/403/400 → `CRITICAL_FAILED` safe-stop (`RECOVERY_EXHAUSTED`). Counters are
checkpointed in `as_recovery_state` (scope `vm:<runId>`).

### 8. Read-only browsing / sandbox code without a VM
`createBrowsePageTool(new BrowserRenderingClient({ accountId, apiToken, cache }))` for pages; `createCodeExecutionTool({ loader, tools })` for computation over your own tools.

## Checklist — spec requirements for this topic
- [ ] **VM per run, reused, created only when missing** (R-CU-01). Verify: integrations test "forks the golden snapshot once with a run label and idempotency key, and keeps using it from a fresh isolate".
- [ ] **Shell tool with a 300 s ceiling** (R-CU-02). Verify: test "execute_sandbox_command is MEDIUM/external with a 300 s ceiling".
- [ ] **Golden snapshot + fast fork** (R-CU-03; image has git, curl, unzip, wget, jq, htop, build-essential, xvfb, Chrome libs, Node 22 and puppeteer, dotenv, axios, zod, dotenv-expand per spec L1537–1572). Verify: tests "ships a provision.sh…", "forks from a golden snapshot…", "installs the spec's OS utilities and workspace packages and checks them".
- [ ] **Layer A TTL on every VM** (R-CU-04). Verify: `ttl()` clamp; `ttlSeconds` on create/fork/resume.
- [ ] **Layer B: VM seconds billed into the run's BudgetGuard, breach → teardown + AGENT_CRITICAL_HALT** (R-CU-05). Verify: tests "meters the first call, persists the last tick across isolates…", "tears the VM down on a maxVmSeconds breach, alerts, and refuses to start another VM".
- [ ] **AGENT_CRITICAL_HALT reaches the SaaS as telemetry, not only email** (R-CU-05, spec L1503–1512). Verify: test "maps a VM alert onto the telemetry contract"; `alertOps` in `src/computer-use/vm.ts` emits through `telemetrySinks()`.
- [ ] **Auto-stop hibernation, one stop, resume next turn** (R-CU-06). Verify: test "hibernates with exactly one stop call and resumes the same VM on the next turn".
- [ ] **VM stopped during approval waits, except a bounded `browser_submit` grace** (spec L4897–4901, contract 8). Verify: integrations tests "hibernates for every wait except a pending browser_submit, which gets a bounded grace", "holds the VM with its TTL shortened to the grace, then the planned stop is billed but not leaked", "an approval inside the grace keeps the live VM and restores the normal TTL", "stops the VM instead when the TTL cannot be shortened"; generated `test/vm-approval-wait.test.ts`.
- [ ] **VM lifecycle as telemetry** (PROVISIONING / RUNNING / STOPPING with `data.vmSeconds`). Verify: test "reports provisioning, readiness and stops with the reason, and never fails on a broken listener"; `emitVmLifecycle` in `src/computer-use/vm.ts`.
- [ ] **Heartbeats while a long VM command runs** (sentinel never aborts a healthy 5-minute build). Verify: tests "a 5-minute execute_sandbox_command beats ctx.services.heartbeat through the VM guard", "VmRunManager.withVm beats scope.heartbeat while the operation runs".
- [ ] **VM end reason + leaked hard-TTL cost** (spec L2836–2840, `infrastructureLeakedCostUsd`). Verify: tests "a VM the hard TTL stopped is billed up to the stop, counted as leaked, reported, and resumed on the next call", "a busy VM whose TTL boat.dev extended is not mistaken for a TTL stop".
- [ ] **VM region option** (spec L1417–1423). Verify: test "sends the region on create and fork and labels the VM; per-call overrides win; bad values are refused"; var `BOAT_REGION`.
- [ ] **Golden image script runs with plain node** (no TS, no packages). Verify: tests "ships the exact provision script the provider uses", "creates the builder VM, waits for setup, saves the snapshot and deletes the builder".
- [ ] **Vetted browser scripts, base64 argv input, JSON-line telemetry** (R-CU-07). Verify: tests "passes user input only as base64 JSON argv…", "passes hostile input only as base64 argv".
- [ ] **Browser guardrails** (≤10 s waits, 1280×720, ≤100 items in slices of 20, blocks end the run) (R-CU-08). Verify: script tests in `boatdev.test.ts` and `browser-actions.test.ts`.
- [ ] **Interactive browsing: navigate, click, type, scroll, screenshot, extract; submits need approval** (R-CU-09). Verify: `browser-actions.test.ts` "clicks ordinary links at a random point inside the element box with human-like timing but refuses submits and purchases", "parks browser_submit for approval…", "R6: a browser restarted by a VM resume reports the lost page instead of acting on about:blank".
- [ ] **Realistic input, no evasion** (R-CU-10: in-box click jitter + one fixed realistic desktop UA; stop on CAPTCHA, no reload, no proxy rotation). Verify: tests "clicks ordinary links at a random point inside the element box…", "extracts ≤100 items in slices of 20…" (UA line), "is free of interpolation, syntactically valid and keeps the guardrails".
- [ ] **Files in/out with path confinement** (R-CU-11). Verify: test "write_vm_file / read_vm_file confine paths and meter VM time".
- [ ] **Live VM output streaming** (R-CU-12). Verify: tests "streams NDJSON command output chunk by chunk", "execute_sandbox_command streams redacted output as sandbox TelemetryEvents…".
- [ ] **Emergency teardown route** (R-CU-13). Verify: `src/computer-use/routes.ts`; test "stops the indexed VM and any labelled VM of the run, marks the run halted…".
- [ ] **Deadlock recovery stops the VM** (R-CU-14). Verify: `registerRecoveryHook("computer-use:vm", …)` in `src/computer-use/vm.ts`; base `recoverStalledRun` runs hooks.
- [ ] **Fault-recovery state machine for VMs** (R-OPS-09; VM_UNREACHABLE backoff linear 2000 ms × attempt, spec L1874). Verify: tests "power-cycles an unreachable VM through the checkpointed RecoveryManager and safe-stops on auth errors", "waits linearly, 2000 ms × attempt, between power-cycled retries".
- [ ] **Operator accepts delegated browser tasks with the grant enforced and reports back** (R-APP-12 operator side). Verify: generated `test/operator-delegation.test.ts` "runs only the granted browser tool and returns its DONE report to the requesting job".
- [ ] **Tenant flags `computerUse` / `autonomousBrowserUse`; app flag `integrations.boatdev`.** Verify: test "requires the tenant feature flags and a trusted sandbox id"; `operatorTools()` in `src/agents/operator.ts` returns no VM tools unless `integrationEnabled("boatdev")` and `BOAT_DEV_API_KEY`.
- [ ] **SSRF guard on browser targets** (`browser_navigate`, `run_browser_automation` call core `assertPublicHttpUrl` before any VM work: no private/loopback/link-local/metadata/CGNAT/multicast hosts incl. IPv6-mapped forms, no URL credentials). Verify: tests "routes navigation through the shared SSRF guard before touching the VM", "run_browser_automation refuses private, metadata and credentialed URLs before provisioning anything".
- [ ] **Untrusted output** from shell, files and pages. Verify: `outputTrust: "untrusted"` on every VM/browser tool (test "declares honest risk tiers…").
- [ ] **Sandbox escape prevention for codemode** (no env, no network). Verify: `globalOutbound: null` in `packages/cloudflare/src/codemode.ts`.

## Pitfalls
- Never accept a sandbox id, snapshot name or absolute VM path from the model; `withVm` resolves from `ctx.runId`.
- Never meter from the KV index (eventually consistent); the SQLite record is the meter.
- `noEnv: true` (default) keeps boat.dev account secrets out of agent VMs — don't turn it off; never pass secrets on command lines.
- An operator halt is sticky for the run (`halted` in the index); a new conversation gets a new VM.
- `force: true` stops lose writes since the last snapshot — teardown routes use it on purpose; hibernation does not.
- Long work outside the VM guard (your own tools) must beat too: wrap it in `withHeartbeat(toolHeartbeat(ctx), …)`.
- Only a pending `browser_submit` keeps a VM through an approval, for `APPROVAL_VM_GRACE_SECONDS`; that grace is billed (end reason `approval-grace`), not counted as leaked. Raising the grace raises the cost of every unanswered submit.
- Hibernation stops Chrome: the page and typed form state are gone after a resume (cookies survive in the profile). Don't spread one form over several responses.
- Stopping compute never depends on `integrations.boatdev`: `hibernateVm` / `stopVmForRun` still stop a VM started before the flag was turned off.
- `browser_click`'s side-effect detection is a heuristic on the live DOM (submit controls + button text); keep risky flows behind `browser_submit` and lower `maxAutonomousTier` for agents that touch production systems.
- `BOAT_USD_PER_SECOND` must match your contract; size multipliers come from `billingMultiplier`.

## Verify
```bash
pnpm --filter @agent-starter/integrations test   # provider, streaming, VmRunManager, teardown, browser scripts (stubbed puppeteer), tools
pnpm --filter @agent-starter/cloudflare test     # SSRF guard, codemode
pnpm typecheck && pnpm test                      # generated project
BOAT_DEV_API_KEY=… node scripts/build-golden-vm.mjs  # real VM smoke (costs money)
```

## Related skills
`agent-starter-tools-and-firewall` (risk tiers, approvals) · `agent-starter-models-and-cost` (BudgetGuard) ·
`agent-starter-security` (SSRF, secrets, untrusted content) · `agent-starter-coding-agent` (workspace + VM tests) ·
`agent-starter-background-jobs` (sentinel, recovery hooks) · `agent-starter-generative-ui` (telemetry UI) · `agent-starter-definition-of-done`.

## Deliberate deviations from the spec
- Approval waits (L4897–4901 say stop the VM): a pending `browser_submit` keeps its VM for up to `APPROVAL_VM_GRACE_SECONDS` (default 120 s) because the approved click needs the live page; every other wait stops the VM. Set the var to `0` for strict spec behaviour.
- Golden image packages are pinned to majors (`puppeteer@24 dotenv@17 axios@1 zod@4 dotenv-expand@12`; the spec installs them unpinned) so a rebuilt snapshot behaves like the last one.

## Not yet implemented
- Region placement is not verifiable here: boat.dev's v1 API reference (SDK 1.13) documents no placement field, so `region` is sent and labelled but its effect depends on your boat.dev account.
- Screenshots are stored (R2 via `saveScreenshot`) and referenced, not sent to the model as images (no vision input through tool results).
- Native desktop (non-browser GUI) control: boat.dev's `desktop` noVNC endpoint is not wired; GUI apps are reachable only through the shell.
- `SANDBOX_ESCAPE_SNIPPETS` (`packages/evals`) are not executed by any automated test.
