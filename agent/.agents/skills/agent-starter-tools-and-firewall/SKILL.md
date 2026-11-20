---
name: agent-starter-tools-and-firewall
description: Define, guard and ship agent tools in an Agent Starter project — defineAgentTool contracts (risk tiers, sideEffect, idempotent, requiresApproval, timeoutMs, outputTrust, simulate), the ToolExecutor pipeline and its policy hook, the agent firewall (allow/deny globs, per-tenant lists, quotas, argument rules), human-in-the-loop approvals end to end (pending output, signed links, notifier, createApprovalRoutes, the tool-approval signal, idempotent replay), live/shadow/dry-run modes, Composio, MCP client connections, codemode run_code, web/browse tools, and how useAgentStarter mounts guarded tools on Flue. Use when adding or changing any tool or integration, wiring approvals or notifications, running shadow evals, or debugging a tool that was denied, parked, simulated or executed twice.
---

# Tools, firewall and approvals

## When to use
- Adding a capability (a `defineAgentTool`) to any agent, or changing its risk, schema or side effects.
- Wiring Composio actions, an MCP server's tools, web reading, or the `run_code` sandbox into an agent.
- Anything that sends, pays, deletes, deploys or messages: approvals, notifier, approval routes.
- A tool was `denied`, `invalid_arguments`, `approval_required`, `simulated`, or ran twice.

## Mental model

Flue has no tool-call interception hook and no approval API. So **every** tool goes through
`useAgentStarter`, which mounts a wrapper whose `run` calls the core `ToolExecutor`. The executor is the only
path to a side effect.

```
model tool call ─▶ pi + Flue validate the mounted (lenient) Valibot input ─▶ guarded run (bounded heartbeat before/after)
  → security lock for this delivery? (start-hook verdict, halt_job, cleansed marker) → SECURITY_EXCEPTION_HALT
  → tenant config loaded NOW (lockdown → TENANT_METADATA_CORRUPTED_HALT; feature flags re-checked)
  → ToolExecutor.execute:
  empty call id → random id → lookup → heal+validate (original schema; utilityModel repairs) → firewall (durable
  quotas) → policy hook (FSM state + your `policy`) → assertPayloadTenant → budget.check (ledger metered per model
  turn; breach → R2 snapshot + alert) → authorize (approval for THIS id + tool + args hash? gateway: allow / deny /
  require_approval → ApprovalStore + notifier) → mode ≠ live and mutating? → simulate → idempotency (SQL ledger;
  Flue durable step only for idempotent writes) → timeout + retry
  → render (redact secrets → truncate head+tail → wrap <untrusted_content>) → audit row + telemetry event
  → output has [CLEANSED_INJECTION_ATTEMPT]? → lock every other tool, tell the model to call halt_job
  → fold the result into the working-memory scratchpad
  → failed? append the critic's critique to this result (in-response reflection)
  → long (> 4000 chars)? store raw behind a handle, show a compact form (+ expand_tool_output)
  → drift check due? append the sentinel's anchor
```
Tool closures are fixed at render, and Flue renders the first model call of every submission BEFORE
`useAgentStart` loads the tenant config. That is why tenant config, feature flags and lockdown are
re-checked inside the guarded run, not only at render.

| Concern | Owner |
|---|---|
| Tool contract, `ToolExecutionContext`, `RISK_ORDER` | `packages/core/src/tools/define.ts` |
| Pipeline, outcomes, `maskTools` | `packages/core/src/tools/executor.ts` |
| Firewall | `packages/core/src/tools/firewall.ts` |
| Idempotency keys and ledger (`as_idempotency`) | `packages/core/src/tools/idempotency.ts` |
| JSON repair and coercion | `packages/core/src/tools/healer.ts` |
| Model-picked tool subset | `packages/core/src/tools/masker.ts` (`selectRelevantTools`) |
| Long-output store, compaction, `expand_tool_output` (`as_tool_outputs`) | `packages/core/src/tools/output-store.ts` |
| Risk gateway | `packages/core/src/autonomy/gateway.ts` |
| Signed approvals (`as_approvals`) | `packages/core/src/autonomy/approvals.ts` |
| Mounting on Flue, approval resume | `packages/flue/src/use-agent-starter.ts` (`mountGuardedTool`, `useAgentStart`) |
| Approval HTTP routes | `packages/flue/src/http.ts` (`createApprovalRoutes`) |
| zod → Valibot bridge, lenient healing twin, confidence field | `packages/flue/src/schema-bridge.ts` (`toFlueToolInput`, `toLenientFlueToolInput`, `withConfidenceField`) |
| MCP client behind the firewall | `packages/flue/src/mcp-client.ts` (`McpServerOptions`, `assessMcpTool`, `createMcpHttpClient`, `createMcpTools`) |
| Composio, web tools | `packages/integrations/src/composio.ts`, `packages/integrations/src/web.ts` |
| Codemode sandbox, Browser Rendering, MCP server | `packages/cloudflare/src/codemode.ts`, `browser.ts`, `mcp.ts` |
| Generated-app wiring | `src/lib/platform.ts` (`approvals()`, `notifier()`), `src/app.ts` (`createApprovalRoutes`) |

In a generated project, the `packages/<pkg>/src/...` paths live under `node_modules/@agent-starter/<pkg>/src/...`.

## The tool contract (`defineAgentTool`)

| Field | Meaning and default |
|---|---|
| `name` | `/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`. Any other name throws at definition time. |
| `description` | What the model sees. HIGH/CRITICAL get ` [requires human approval]` appended when mounted. |
| `input` | Any Standard Schema. **Valibot** is native to Flue. zod is bridged by `toFlueToolInput`, and the original schema stays authoritative because the executor re-validates. Non-object schemas (`z.array(...)`, a union) are mounted as `{ value }` and unwrapped before the executor sees them. |
| `risk` | `LOW` · `MEDIUM` · `HIGH` · `CRITICAL`. A `destructive` tool cannot be `LOW`: `defineAgentTool` throws. |
| `sideEffect` | `none` · `read` · `write` · `external` · `destructive`. `write`/`external`/`destructive` count as **mutating**: they are simulated outside live mode, idempotency-tracked and not retried unless `idempotent`. Only mutating tools that are also `idempotent: true` are mounted `durable: true` (Flue re-executes an interrupted durable call); the others use the SQL ledger, so an interrupted call settles as unknown-outcome and is never run twice. |
| `idempotent` | The tool is safe to retry (up to 3 attempts by default). Only set this when the downstream API dedupes on `ctx.idempotencyKey`. |
| `requiresApproval` | Forces approval (`TOOL_REQUIRES_CONSENT`) at any tier. |
| `timeoutMs` | Default 60 000 (`defaultTimeoutMs`). The Flue wrapper adds +5 000 so the executor times out first. |
| `retry` | `Partial<RetryPolicy>` merged over `{ maxAttempts: 3 }`. Only applies when retry is allowed. |
| `maxOutputChars` | Default 12 000. Longer output keeps the head and tail (`truncateMiddle`). In Flue agents an output above 4 000 characters is compacted anyway (see "Long outputs" below). |
| `outputTrust` | `untrusted` output gets wrapped in `<untrusted_content source="tool:<name>">`. **Default: untrusted for `read`/`external`, trusted otherwise.** |
| `simulate(args, ctx)` | What shadow/dry-run returns. Default: `{ simulated: true, wouldHaveExecuted: { tool, args } }`. It must return the **same type** as `execute`: TypeScript infers the output type from both. |
| `execute(args, ctx)` | `ctx`: `tenant`, `tenantConfig`, `runId`, `toolCallId`, `idempotencyKey`, `signal`, `mode`, `log`, `step?`, `services` (`services.env` = Worker env, `services.telemetry` = the run's emitter, `services.heartbeat` = a throttled registry beat that never throws: call it on an interval in tools that run longer than a minute). |

Risk guide (spec risk matrix): reading = `LOW`, patching data/code = `MEDIUM`, charging a card or messaging
customers = `HIGH`, irreversible deletion = `CRITICAL`.

Gateway order (`AutonomyGateway.evaluate`):
1. `forbidden` → deny.
2. `CRITICAL` → approval.
3. `requiresApproval` → approval.
4. Non-LOW with confidence < threshold (0.85) → approval. `useAgentStarter` adds the optional `_confidence` argument to every non-LOW tool by default (`confidence: false` opts out).
5. Name in `autonomousAllowlist` → allow.
6. `HIGH` → approval.
7. Tier above `maxAutonomousTier` (`MEDIUM`) → approval.
8. Otherwise allow.

`forTenant()` takes the stricter of the agent's policy and `TenantConfig.autonomy`. Confidence and autonomy
tuning are covered in `agent-starter-planning-and-cognition`.

### Outcomes → what the model sees (`mountGuardedTool.toEnvelope`)
| `ToolOutcome.status` | Flue result |
|---|---|
| `ok`, `simulated` | `{ output: text }` |
| `approval_required`, `budget_exceeded` | `{ output: text, terminate: true }`: the turn ends, the model is told not to retry |
| `ok` from a `terminates-turn` tool (`ask_person`, `halt_job`) | `{ output: text, terminate: true }` |
| `denied`, `invalid_arguments`, `error` | thrown → tool error (`isError`). The critic's critique is appended to that error text, so the model reads it before its next attempt in the same response (at most `maxReflectionsPerResponse`, default 2, per response; never for `SECURITY_EXCEPTION_HALT`, `VERSION_HANDOFF` or `TENANT_METADATA_CORRUPTED_HALT`) |

Error JSON codes seen by the model: `TOOL_NOT_FOUND`, `TOOL_NOT_ALLOWED`, `TOOL_VALIDATION_FAILED`,
`ERROR_UNAUTHORIZED_TENANT`, `BUDGET_LIMIT_EXCEEDED`, `APPROVAL_REJECTED`, `UNKNOWN_OUTCOME`,
`SECURITY_EXCEPTION_HALT`, `VERSION_HANDOFF`, `TENANT_METADATA_CORRUPTED_HALT`.

**Idempotency ledger states** (`as_idempotency`, non-durable mutating calls): `STARTED` → `COMPLETED` (replay returns
the recorded result, `cached: true`), `FAILED` (a definite rejection: `HttpError` 4xx or a non-retryable typed
`AgentError`; the same call may run again) or `UNKNOWN` (timeout, abort, network error, 5xx: the side effect may
have landed, so a replay of a non-idempotent call returns `UNKNOWN_OUTCOME`). `isDefiniteFailure(error)` decides.

**Safety fallback** (`safetyFallback`, default on): `halt_job({ reason })` is mounted next to the guarded tools
(directly, not through the executor, so no firewall, quota or budget can hide it). Calling it, or any input or tool
result containing `[CLEANSED_INJECTION_ATTEMPT]`, locks every other tool for the rest of the delivery (render and
execution), audits `safety.halt` and emits a `SECURITY_EXCEPTION_HALT` telemetry log. While locked by the marker,
only `halt_job` stays mounted. Outside Flue, `createHaltJobTool({ onHalt })` gives the same tool.

## Firewall (`ToolFirewallPolicy`, passed as `useAgentStarter({ firewall })`)
- `allow` / `deny`: case-insensitive globs (`*`, `?`) such as `"GMAIL_*"` or `"mcp__linear__*"`. Deny always wins. A non-empty `allow` list turns the firewall into an allowlist.
- Per tenant: `TenantConfig.deniedTools` is always checked. When `TenantConfig.allowedTools` is set, it is also an allowlist.
- `maxCallsPerTool` and `maxTotalCalls` cap calls per **run**. In Flue agents the counters live in SQLite (`SqlFirewallCounters`, table `as_firewall_counters`, keyed by the budget scope), so they hold across tool calls, renders, restarts and hibernation. In-flight calls hold a slot (`ToolFirewall.reserve`), so a parallel batch cannot overshoot. Elsewhere: `new ToolFirewall(policy, { counters: new SqlFirewallCounters(sql, runId) })`.
- `argumentRules: [{ tool, path, allow?, deny?, message }]`:
  - `path` is a dot path with `*` wildcards.
  - Values are stringified, then tested.
  - Example: emails may only go to `@customer.com`.
- `visible()` filters what is mounted at render (`useAgentStarter` applies it with the render-time tenant config). Hidden tools are still evaluated at
  execution time, because a model can call a name it was never shown.

`useAgentStarter({ policy: (toolName, args) => ({ allowed, reason? }) })` is the executor's policy hook. It runs
**after** the firewall for every call and a denial is final. With `workflow`, FSM state gating runs first: the
machine is re-read from SQL on every call, and a workflow agent runs a batch's calls in order, so a tool of the
old state is denied right after `transition_state`, even in the same batch. With `planning`, the planner's per-goal
tool lists run next: while every actionable goal names its tools, only their union may perform a side effect
(read-only tools, built-ins, `halt_job` and `terminates-turn` tools always may; an approved call resumed by
`tool-approval` is not re-gated). See
`agent-starter-planning-and-cognition`.

**Tool masking** (`toolMasking`, default `{ maxTools: 4 }`, spec "only the 3 or 4 tools strictly necessary"): once
more than `maxTools` maskable tools are visible, each delivered message (a person's turn, or an `events`/`job`/
`delegation`/… signal) mounts only the `maxTools` most relevant. The start hook asks `utilityModel`
(`selectRelevantTools`) and anchors the pick to that delivery; the first model call of a submission renders before the
start hook, so it uses keyword scoring (`maskTools`) on the message. Always mounted on top: the built-ins (planning,
workflow, memory, `expand_tool_output`), `halt_job`, `terminates-turn` tools (`ask_person`), tools tagged
`always-mounted` (`ALWAYS_MOUNTED_TAG`) and `toolMasking.alwaysInclude`. Approval and answer signals keep the selection
of the work they resume. `toolMasking: false` turns it off.

**Long outputs** (`toolOutputCompaction`, default on, threshold 4 000 characters; spec checklist item 2): a successful
output longer than the threshold is stored whole (redacted) in `as_tool_outputs` behind a handle (`ToolOutputStore`,
scoped to run + tenant, last 100 per run). The model reads `[TOOL OUTPUT COMPACTED]` with a `utilityModel` summary
(instruction-like lines dropped, untrusted outputs stay wrapped) or, without a model, head + tail, plus the handle.
`expand_tool_output({ handle, range?: { start, end } })` (LOW, read) returns exact slices (≤ threshold chars, with
`nextStart`); it is mounted once the run has a stored output. Exempt: tools tagged `verbatim-output`
(`VERBATIM_OUTPUT_TAG`: `view_lines`, `search_files`) and `exempt` globs (default `view_lines`, `search_files`,
`branch_diff`). Approved results resumed by `tool-approval` are compacted the same way.

**Feature flags** (`TenantConfig.features`): tools tagged `"memory"` (`remember_fact`, `recall_entity`,
`remember_note`, `search_notes`, `forget_note`) need `longTermMemory`; tools tagged `"email"`, `"outbound-email"`,
`"notifier"` (or a Composio `toolkit:gmail|outlook|sendgrid|…` tag, or a name matching `emailTools` globs) need
`outboundEmail` (off in the secure default). They are unmounted at render and denied at execution.

## Modes: live, shadow, dry-run
- The mode comes from `initialData.mode` (`AgentStarterInitialData`, default `live`). Only trusted server code should set it: the eval harness defaults to `shadow`. Flue applies `initialData` **only when it creates the instance**, so use a fresh conversation id for each shadow run.
- `shadow` and `dry-run` behave identically in the executor. Mutating tools return `simulate()` output with status `simulated`. `none`/`read` tools still execute, so shadow runs see real data.
- Production fan-out of one event to a live and a shadow agent: `runShadowComparison` / `diffTrajectories` in `@agent-starter/evals` (see `agent-starter-evals-and-ops`).

## Human-in-the-loop approvals (summary; full sequence in [references/approvals.md](references/approvals.md))
1. The gateway returns `require_approval`. `ApprovalStore.create` writes a `PENDING_APPROVAL` row. The row has a nonce, expires in 72 h, and carries two HMAC tokens (approve and reject) signed with `APPROVAL_SIGNING_SECRET` (`[new, old]` while rotating). A record authorises exactly one call: same run, same non-empty call id, same tool and same argument hash (`findMatching`, `approvalArgsHash`). Providers that omit ids get a random one, so one approval can never unlock a different call.
2. `onApprovalRequested` writes an `approval` data part (`approveUrl`/`rejectUrl` = `${PUBLIC_BASE_URL}/approvals/<token>`). It also calls the `Notifier` (SendRaven in `platform.ts`) with Approve/Reject actions, `threadKey: approvals:<runId>` and `idempotencyKey: approval-notify:<id>`.
   - With `approvals.bindToRecipient: true` the tokens carry `r` = `approverId(tenant)` (default `recipient(tenant)`, which must then be the approver's session `sub`), the approval route requires that signed-in user, and the data part has **no** URLs (`sentToApprover: true`). Use it whenever someone other than the requester decides (background jobs: the tenant admin).
   - Without it (chat: the user is the human in the loop) the in-app oversight card gets the links, except for `visitor` identities, which never see working links.
   - `ctx.awaitingHuman` (live) and the response metadata (`isAwaitingHuman(metadata)`) are true while an unexpired approval or an `ask_person` question is open.
3. The tool returns `{"status":"PENDING_APPROVAL",...}` with `terminate: true`, and the conversation goes dormant.
4. `GET /approvals/:token` shows a confirmation page and **never mutates**. `POST` verifies the token and calls `dispatch()` with a `tool-approval` signal (`idempotencyKey approval:<aid>:<decision>`). It answers 202.
   - **Decide by id (operators):** `POST /approvals/by-id/:conversationId/:approvalId` with `{ "decision": "approve" | "reject", "note"? }`. It needs a session (Bearer, or a same-origin JSON cookie request) whose roles include one of `operatorRoles` (default `admin`, `operator`) in the conversation's tenant (401 without a session, 403 for another role or tenant, 404 for an unknown agent, 400 for a bad decision or id). It mints a short-lived (10 min) operator token bound to that user (`createOperatorDecisionToken`, `k: "operator"`, no record nonce) and dispatches the same `tool-approval` signal with the same idempotency key, so a link and an operator can never both win (409 `ALREADY_DECIDED`). This is how a dashboard or the SaaS unblocks recipient-bound background approvals without email.
5. In `useAgentStart`, `decideWithToken` runs.
   - If the approval is `APPROVED` (whether this delivery decided it or a retried delivery finds it already decided), the original `{toolCallId, tool, args}` goes through the guarded path and the idempotency store: it executes exactly once, and a later replay returns the recorded result (`cached`). A `tool-approval-result` signal tells the model the result.
   - Rejected or expired: a signal tells the model not to retry.
   - Approval telemetry events carry `data.status: "PENDING_APPROVAL"`, `riskTier`, `reason`, `approvalId`, `conversationId` and masked `args` (`maskArgs`), so dashboards can render approval cards from events alone and decide them by id.

## Persistent agents: auto-review, egress and brokered fetch
With `useAgentStarter({ persistent })` (see `agent-starter-persistent-agents`), every guarded call also passes these gates, in order:
1. The kill switch, read live (a throw counts as disabled): `PERSISTENT_AGENT_DISABLED`.
2. Config, re-read when stale. With no config known the call fails closed: `PERSISTENT_CONFIG_UNAVAILABLE`.
3. Egress on every http(s) argument whose key contains `url`: `EGRESS_BLOCKED`.
4. `maxToolCallsPerTick`: `TICK_TOOL_LIMIT`.
5. The executor's `review` hook, which runs after the gateway's deny check and before approval:
   - `block` gives `AUTO_REVIEW_BLOCKED`;
   - `escalate` goes to the normal approval flow, with reason `AUTO_REVIEW_ESCALATED: …`;
   - `approve` continues, but HIGH/CRITICAL and `requiresApproval` tools still need a human;
   - an already human-approved call is never re-reviewed;
   - a reviewer with no model, or one that errors, escalates.

Fetching: the hook mounts `fetch_url` (`createGuardedFetchTool`) and passes `services.fetch` (`brokeredFetch`: egress policy on every hop, named `credential` injected only for bound hosts) and `services.egress` to tools. Persistent-agent tools must use those, never the global `fetch`. Outputs are scrubbed of brokered secrets.

## Recipes

**Read tool (tenant from context, never from arguments):**
```ts
// src/agents/support.ts
import { defineAgentTool, HttpError } from "@agent-starter/core";
import * as v from "valibot";
import { bindings } from "../lib/platform.ts";

export const lookupOrder = defineAgentTool({
  name: "lookup_order",
  description: "Look up one order's status for the current customer account.",
  input: v.object({ orderId: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/)) }),
  risk: "LOW",
  sideEffect: "read",
  idempotent: true,
  timeoutMs: 10_000,
  execute: async ({ orderId }, ctx) => {
    const b = bindings();
    if (!b.PRIMARY_SAAS_API_URL || !b.SAAS_SERVICE_TOKEN) throw new Error("PRIMARY_SAAS_API_URL / SAAS_SERVICE_TOKEN are not configured.");
    const res = await fetch(`${b.PRIMARY_SAAS_API_URL}/api/orders/${orderId}`, {
      signal: ctx.signal,
      headers: { authorization: `Bearer ${b.SAAS_SERVICE_TOKEN}`, "x-tenant-id": ctx.tenant.tenantId, "x-acting-user": ctx.tenant.userId },
    });
    if (!res.ok) throw await HttpError.fromResponse(res, "Order lookup");
    return (await res.json()) as unknown; // read tool → wrapped as untrusted by default
  },
});
```

**Customer-facing mutation (HIGH: approval, idempotency key, shadow simulation):**
```ts
export const issueRefund = defineAgentTool({
  name: "issue_refund",
  description: "Refund an order in full (moves money; customer-facing).",
  input: v.object({ orderId: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/)), reason: v.pipe(v.string(), v.minLength(5), v.maxLength(500)) }),
  risk: "HIGH",
  sideEffect: "external",
  idempotent: true, // only because the billing API dedupes on the Idempotency-Key header
  timeoutMs: 15_000,
  simulate: ({ orderId }) => ({ refundId: `simulated_${orderId}` }), // must return the same type as execute
  execute: async ({ orderId, reason }, ctx) => {
    const b = bindings();
    if (!b.PRIMARY_SAAS_API_URL || !b.SAAS_SERVICE_TOKEN) throw new Error("SaaS API not configured.");
    const res = await fetch(`${b.PRIMARY_SAAS_API_URL}/api/refunds`, {
      method: "POST",
      signal: ctx.signal,
      headers: { authorization: `Bearer ${b.SAAS_SERVICE_TOKEN}`, "content-type": "application/json", "x-tenant-id": ctx.tenant.tenantId, "idempotency-key": ctx.idempotencyKey },
      body: JSON.stringify({ orderId, reason }),
    });
    if (!res.ok) throw await HttpError.fromResponse(res, "Refund");
    return (await res.json()) as { refundId: string };
  },
});
```

**Mount with firewall rules and an approval-capable platform:**
```ts
export function SupportAgent({ id }: AgentProps) {
  const ctx = useAgentStarter({
    ...platform("support-agent", id), // includes approvals(): secret, baseUrl, notifier, recipient
    tools: [lookupOrder, issueRefund],
    firewall: {
      deny: ["*_delete_*"],
      argumentRules: [{ tool: "issue_refund", path: "orderId", deny: /^test_/i, message: "Test orders cannot be refunded." }],
    },
    autonomy: { forbidden: ["drop_tenant"] },
    budget: { maxToolCalls: 40 }, // persistent per-conversation cap (works in Flue, unlike maxTotalCalls)
  });
  return `You support ${ctx.tenant.tenantId}'s customers...`;
}
```
The approval routes are already mounted in `src/app.ts`, which passes every agent to `createApprovalRoutes`.
**When you add an agent, add it to that list too.**

**Business rule (confidence and lenient healing are on by default):**
```ts
useAgentStarter({
  ...platform("support-agent", id),
  tools: [lookupOrder, issueRefund],
  policy: (tool, args) => (tool === "issue_refund" && (args as { orderId: string }).orderId.startsWith("vip_") ? { allowed: false, reason: "VIP refunds go through account managers." } : { allowed: true }),
  // Defaults: confidence: true (non-LOW tools get an optional _confidence; below the tenant threshold → approval),
  // argumentHealing: "lenient" (constraint violations reach the ArgumentHealer + utilityModel before failing).
  // Opt out per agent with confidence: false / argumentHealing: "strict".
});
```

**Approvals decided by someone else (background job → tenant admin):**
```ts
useAgentStarter({
  ...platform("background-worker", id),
  approvals: { ...approvals(), recipient: (t) => adminEmailFor(t.tenantId), approverId: (t) => adminSubFor(t.tenantId), bindToRecipient: true },
});
```

**A long tool that keeps the run alive (sentinel threshold 180 s):**
```ts
execute: async (args, ctx) => {
  const beat = ctx.services.heartbeat as (() => Promise<void>) | undefined;
  const timer = beat ? setInterval(() => void beat(), 30_000) : undefined;
  try { return await runLongBuild(args, ctx.signal); } finally { if (timer) clearInterval(timer); }
},
```

**Integrations** (Composio `composio: { toolset }`, MCP client `mcp: [...]`, codemode `run_code`,
`fetch_url_markdown`, `browse_page`): copy the recipes in [references/integrations.md](references/integrations.md).

**Unit-test a tool without Flue** (Node; pattern from `packages/core/test/tools.test.ts`). Modules that
import `src/lib/platform.ts` (`cloudflare:workers`) can't load under Node. Test pure tools, or define a test
double as shown here:
```ts
// test/refund.test.ts
import { ApprovalStore, CORE_MIGRATIONS, defineAgentTool, MigrationRunner, SECURE_DEFAULT_TENANT_CONFIG, SqlIdempotencyStore, ToolExecutor } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import * as v from "valibot";
import { expect, it } from "vitest";

it("parks refunds for approval", async () => {
  let refunds = 0;
  const refund = defineAgentTool({ name: "issue_refund", description: "Refund an order.", input: v.object({ orderId: v.string() }), risk: "HIGH", sideEffect: "external", execute: async () => ++refunds });
  const sql = new NodeSqlStore();
  new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
  const executor = new ToolExecutor({ tools: [refund], approvals: new ApprovalStore(sql, "test-secret"), idempotency: new SqlIdempotencyStore(sql) });
  const outcome = await executor.execute(
    { id: "call_1", name: "issue_refund", arguments: '{"orderId":"A1"}' },
    { tenant: { tenantId: "t1", userId: "u1", environment: "test", roles: [], scopes: [] }, tenantConfig: SECURE_DEFAULT_TENANT_CONFIG, runId: "run_1", signal: new AbortController().signal, mode: "live", log: () => {}, services: {} },
  );
  expect(outcome.status).toBe("approval_required");
  expect(refunds).toBe(0);
});
```
To test the whole Flue path, use `packages/flue/test/flue-e2e.test.ts` or `test/harness.test.ts` in a generated
app. Both use a faux model and `NodeSqlStore`.

## Checklist (spec requirements; each needs its proof)
- [ ] **Deterministic validation:** no tool reaches a SaaS endpoint without passing its schema. Verify: invalid args return `TOOL_VALIDATION_FAILED` and `execute` never runs (`tools.test.ts` "returns schema issues instead of executing on bad arguments").
- [ ] **No direct SaaS calls from the model:** every outbound call lives inside a `defineAgentTool` that is mounted through `useAgentStarter`. Verify: `grep -rn "useTool(" src/` returns nothing.
- [ ] **Idempotency keys from the run:** mutating tools forward `ctx.idempotencyKey`, a value derived from run, call, tool and args. Verify with a replay test: same `runId` plus `toolCallId` gives one downstream call, `cached: true` on replay, and `UNKNOWN_OUTCOME` for an interrupted non-idempotent tool (`tools.test.ts`).
- [ ] **No blind re-execution:** non-idempotent writes are not durable steps (flue `hook-guarantees.test.ts` "runs non-idempotent writes through the SQL idempotency guard…"), and a timed-out non-idempotent call is `UNKNOWN`, never re-run (core `c2-guarantees.test.ts` "a timed-out non-idempotent call is never executed again on replay").
- [ ] **Honest risk tiers:** irreversible or customer-facing tools are `HIGH`/`CRITICAL`, and destructive tools are never `LOW`. Verify by reviewing each tool. `defineAgentTool` throws for a destructive `LOW` tool.
- [ ] **Destructive tool interceptors:** `CRITICAL` always parks for approval, and shadow mode simulates every mutation. Verify: the "parks HIGH-risk tools…" and "simulates mutating tools in shadow mode" tests pass.
- [ ] **HITL interrupt and resume:**
  - parked runs show `PENDING_APPROVAL`;
  - the notifier email carries Approve/Reject links;
  - GET does not mutate;
  - POST resumes the run;
  - the action executes exactly once, and replaying the link is harmless.

  Verify: `flue-e2e.test.ts` "parks HIGH-risk tools for approval and executes exactly once after a signed approval", plus `test/security.test.ts` "never mutates on GET".
- [ ] **Approval bound to the call:** an approval never authorises another tool, other arguments or an empty id. Verify: core `c2-guarantees.test.ts` "an approved call never authorises another tool or other arguments…".
- [ ] **Approver, not requester:** with `bindToRecipient` the links are bound to the approver and absent from the requester's stream; visitors never get links. Verify: flue `hook-guarantees.test.ts` "binds approval links to the approver…" and "never writes working approve links into a visitor's stream".
- [ ] **Operators decide by id:** an admin/operator session of the tenant approves or rejects a parked call from its telemetry event (`approvalId` + `conversationId`), idempotently. Verify: flue `decide-by-id.test.ts` "unblocks a recipient-bound background approval end to end from the telemetry event alone" and "requires an operator or admin session in the conversation's tenant".
- [ ] **Parked runs are visible:** `awaitingHuman` is true while an approval or question is open. Verify: `hook-guarantees.test.ts` "reports awaitingHuman while an approval or a question is open".
- [ ] **Agent-threaded notifications:** approval emails thread per run (`threadKey approvals:<runId>`) and dedupe (`approval-notify:<id>`). Verify: `ConsoleNotifier.sent` in a test, or the SendRaven thread view.
- [ ] **Tenant isolation at the tool layer:** arguments that reference another tenant return `ERROR_UNAUTHORIZED_TENANT`, and blob or vector access goes through tenant-scoped stores. Verify: `tools.test.ts` "blocks cross-tenant arguments".
- [ ] **Agent firewall:** deny/allow globs, per-tenant lists and argument rules all hold, and per-run quotas survive renders and restarts. Verify: core "enforces firewall deny lists…", `fix-round-c.test.ts` "keeps per-run quotas across fresh firewall and executor instances", flue `hook-guards.test.ts` "enforces per-run firewall quotas across tool calls, renders and submissions".
- [ ] **Tenant config applies from the first call:** deny lists, autonomy and lockdown are enforced at execution time. Verify: `hook-guards.test.ts` "applies the tenant's deny list and autonomy from the very first submission" and "halts with TENANT_METADATA_CORRUPTED_HALT…".
- [ ] **Execution-time policy and FSM gating:** `policy` and workflow state deny hidden or stale tools. Verify: `hook-guards.test.ts` "denies old-state tools at execution time right after transition_state in the same batch".
- [ ] **Feature flags:** memory tools need `longTermMemory`, email tools need `outboundEmail`. Verify: `hook-guards.test.ts` "gates memory and outbound email tools on tenant feature flags".
- [ ] **Argument auto-healer (default lenient):** malformed arguments are repaired (programmatically, then by `utilityModel`) before failing. Verify: `hook-capabilities.test.ts` "heals constraint violations with the utility model before failing (lenient mounting)" and `hook-guarantees.test.ts` "plans, heals leniently, routes with the utility model…" (no opt-in).
- [ ] **Untrusted tool output:** web, email and third-party output reaches the model inside `<untrusted_content>`. Verify: a tool test asserts `outcome.text` starts with `<untrusted_content`.
- [ ] **Timeouts on every external call:** `timeoutMs` is set, or you consciously accept the 60 s default, and `ctx.signal` is forwarded to `fetch`. Verify: code review.
- [ ] **Shadow deploys:** mutations are mocked and logged as "would have executed". Verify: an eval-harness run with `mode: "shadow"` reports `simulated` tool calls.
- [ ] **Composio behind the firewall:** meta tools are off by default, slugs are risk-classified, and Flue agents mount them via `composio: { toolset }`. Verify: `composio.test.ts`, `composio-descriptors.test.ts`, flue `hook-capabilities.test.ts` "preloads Composio tools at submission start and mounts them guarded".
- [ ] **MCP:** exposed tools go through `ToolExecutor` (see `agent-starter-security`); consumed MCP tools are mounted with `mcp: [...]` (never raw `useMcpConnection`). Verify: `hook-capabilities.test.ts` "mounts allowlisted MCP tools as guarded tools…".
- [ ] **Code sandbox escape prevention:** `run_code` has no network and no env, and inner tool calls are re-gated. Verify: `createCodeExecutionTool` passes `globalOutbound: null`, plus an adversarial eval.
- [ ] **Scraping and proxied headless fetching:** SSRF guard on every URL. Verify: `web.test.ts` and `cloudflare.test.ts` "SSRF guard".
- [ ] **Tool masking:** above `toolMasking.maxTools` (default 4) only the relevant tools are mounted, plus the always-included safety/planning tools, for user turns and delivered signals alike. Verify: flue `hook-round3.test.ts` "mounts at most four relevant tools by default, plus the safety fallback and always-mounted tools" and "lets the utility model pick the tools for a delivered job signal", `hook-capabilities.test.ts` "masks a large tool set down to the relevant tools", core `round3.test.ts` "utility selection caps the model's picks…".
- [ ] **Raw outputs compacted before the frontier model:** outputs above 4 000 characters reach the model as a summary (or head + tail) with a handle; `expand_tool_output` returns exact slices. Verify: flue `hook-round3.test.ts` "summarises a long output with the utility model and serves exact slices through expand_tool_output" and "falls back to head and tail plus the handle without a utility model".
- [ ] **Critique before the next attempt:** a failed call's result carries the critic's pivot in the same response. Verify: flue `hook-round3.test.ts` "appends the critic's pivot to the failed call before the model's next attempt, in the same response".
- [ ] **Confidence-based autonomy (default on):** a low self-reported `_confidence` parks non-LOW tools. Verify: `hook-capabilities.test.ts` "pauses a risky call for approval when the model reports low confidence"; the field is mounted without opt-in (`hook-guarantees.test.ts` mandated defaults).
- [ ] **Execution-time security lock:** a message the classifier flags cannot run tools even in the first model turn, and signals are screened like user text. Verify: `hook-guarantees.test.ts` "denies tool calls in the very first model turn…" and "assesses signals too…".
- [ ] **Safety fallback:** `[CLEANSED_INJECTION_ATTEMPT]` in an input or a tool result stops the job (`halt_job` only). Verify: `hook-guarantees.test.ts` "stops on [CLEANSED_INJECTION_ATTEMPT] in a delivered event…" and "locks every other tool once a tool result carries the cleansed marker".
- [ ] **Long tools beat:** tools running past a minute call `ctx.services.heartbeat` on an interval. Verify: `hook-guarantees.test.ts` "hands long tools a throttled heartbeat service that never throws".

- [ ] **Auto-review gates every persistent tool call and fails closed.** Verify: `packages/core/test/persistent.test.ts` "blocks, escalates to approval, or lets approved LOW calls run (HIGH still needs a human)", "fails closed: no model, errors and garbage all escalate"; `packages/flue/test/hook-persistent.test.ts` "auto-reviews every call: approve runs, block denies, escalate parks for a human".
- [ ] **Persistent egress and tick cap at execution time.** Verify: `hook-persistent.test.ts` "caps tool calls per tick and blocks URL arguments outside the egress policy".

## Pitfalls
- pi and Flue validate the mounted input **before** `run`. The default `argumentHealing: "lenient"` mounts a twin with constraints moved into descriptions so the healer (and `utilityModel`) can repair them; the original schema still decides. With `"strict"` only arguments that pass Flue's check reach the healer.
- The first model call of a submission uses the render made before `useAgentStart`: tool *visibility* there uses the stored/seeded config (`initialData.tenantConfig`, else the secure default). Enforcement is always current; visibility catches up on the next render.
- MCP and Composio tools are listed in `useAgentStart` and cached in persistent state (`as:externalTools`, refreshed every 10 min): a brand-new conversation sees them from its second model call on.
- Firewall quotas count per **budget scope**: `budgetScope: "submission"` also resets quotas per delivered message.
- Never put `tenantId`/`orgId`/`workspaceId` fields in tool inputs to "choose" a tenant: `assertPayloadTenant` denies any value that differs from the executing tenant. Read `ctx.tenant`.
- `idempotent: true` on a tool whose API ignores idempotency keys turns retries into duplicates.
- Only `idempotent: true` mutating tools are mounted `durable: true` (their side effect runs inside `step.do` and may be re-executed on recovery, which is safe only because the downstream dedupes on `ctx.idempotencyKey`). Every other mutating tool, and the approval-resume path, uses `SqlIdempotencyStore`.
- `terminate: true` ends the turn after `approval_required`. Don't tell the model to "try again". `pendingText` already says not to retry.
- **Unbound approval links are bearer tokens.** Without `bindToRecipient`, anyone holding the link can decide (`decidedBy` is the signed-in session user when there is one, else "approval-link"). Bind links whenever the requester is not the approver, and keep the TTL short. Rotate the signing secret by passing `[new, old]`.
- The security lock is anchored to the delivery: it covers every turn and lifecycle append of that message, and the next delivery is judged on its own content. A custom delivered signal type should be registered with `deliveredSignalTypes`, or its first render keeps a previous lock until its start hook clears it.
- `halt_job` is always mounted while tools are enabled (it is not counted by `toolMasking`). Opt out with `safetyFallback: false` only if the agent has its own stop path.
- With the default `maxTools: 4`, an agent with more tools sees only four of them per message. The delegation and room tools (`delegate_task`, `check_delegation`, `report_delegation`, `spawn_collaboration_room`, `post_to_room`) are tagged `always-mounted` already; tag your own coordination tools the same way, or list them in `toolMasking.alwaysInclude`; raise `maxTools` only for agents that genuinely need more at once.
- Tools whose exact text the model must quote or patch (file views, diffs) must carry the `verbatim-output` tag or be listed in `toolOutputCompaction.exempt`, otherwise long outputs reach the model summarised.
- The decide-by-id route trusts the session's roles: only mint `admin`/`operator` session tokens for people allowed to approve any parked action in their tenant. Restricted (visitor, voice) tokens are refused.
- `createApprovalRoutes({ agents })` returns 404 `AGENT_NOT_FOUND` for an agent missing from the list. Every new agent must be added there.
- Output redaction (`redactOutputs`, default on) masks API keys, JWTs, private keys, card numbers and SSNs in tool output. Don't rely on the model to scrub them.
- Raw `useMcpConnection()` tools bypass the whole pipeline: no firewall, approvals, budget or idempotency. Use the `mcp` option.
- MCP `destructiveHint` always raises a tool to CRITICAL; `readOnlyHint`/`idempotentHint` only lower risk with `trustAnnotations: true`. Prefer explicit `readOnly` globs.

## Verify
```bash
pnpm --filter @agent-starter/core test          # tools.test.ts: pipeline, firewall, approvals, shadow, idempotency
pnpm --filter @agent-starter/flue test          # flue-e2e.test.ts: guarded tools + approval resume in real Flue
pnpm --filter @agent-starter/integrations test  # composio, web (SSRF), webhooks
# generated app
pnpm typecheck && pnpm test                     # test/harness.test.ts + test/security.test.ts
```

## Related skills
`agent-starter-security` (MCP server, webhooks, injection defense) · `agent-starter-planning-and-cognition`
(autonomy and confidence, FSM gating) · `agent-starter-models-and-cost` (budget ceilings, retries) ·
`agent-starter-generative-ui` (`HumanOversightCard`, `useApprovals`) · `agent-starter-evals-and-ops` (shadow
diffing) · `agent-starter-definition-of-done`.

## Not yet implemented
- **Resumable approvals for MCP-server and codemode calls:** they use random tool-call ids and have no replay path, so a parked call can never complete.
- **MCP client transports:** `createMcpHttpClient` speaks Streamable HTTP (JSON or SSE replies) only: no legacy SSE transport, OAuth discovery, server-initiated requests or task-based tools. Pass a custom `client` for those.
