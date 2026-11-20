---
name: agent-starter-multi-agent
description: Build and change Grok-style multi-agent collaboration in an Agent Starter project — the delegation runtime (delegate_task / check_delegation / report_delegation over a durable DelegationLedger with depth, budget and ring guards, tool grants enforced at execution time, auto-returned results), provenance headers, the AgentGroupChatRoom Durable Object (decider with lead fallback, moderator, NO_RESPONSE silence, flood control, batching, reply guard, completion hook that reports room-result to the orchestrator), stateful specialists and their DONE contract, room tools, the two-way message bus over Queues (hop limits, TTLs, seeded tenant config), the run registry efficiency report, and the SwarmTimeline / RunGantt / AgentTranscript UI. Use when adding a specialist, delegating work between agents, changing turn-taking, wiring room or delegation output to dashboards, or debugging stuck, looping or runaway teams.
---

# Multi-agent collaboration (delegation, rooms, specialists, bus)

Every agent is its own Durable Object. The orchestrator is the one user-facing lead: it answers most things itself
and delegates selectively. There are four ways to involve other agents, lightest first:

```
Orchestrator (Flue, mounted /agents/orchestrator)
  ├─ task tool → ephemeral subagents (researcher, critic) in parallel, each with guarded read-only tools
  │        (search_knowledge; fetch_url_markdown / web_search per integrations.jina|firecrawl)  [useSubagent + useSubagentTools]
  ├─ delegate_task ─▶ DelegationLedger (outgoing row) ─▶ dispatch <signal "delegation"> ─▶ worker `<agent>--<t>---dlg.<hash>`
  │        worker: useDelegation records the incoming row; delegationPolicy enforces the grant;
  │        report_delegation ─▶ dispatch <signal "delegation-result"> (nonce) ─▶ orchestrator ledger (once)
  │        (a worker parked on an approval / ask_person is not reminded or reported failed)
  ├─ spawn_collaboration_room ─▶ SwarmRoom DO (AgentGroupChatRoom + RoomEngine), specialists in `<agent>--<t>---room.<key>`
  │        decide (decider → lead | moderator | round-robin | self-selection) → summon(seq, batch, reminder)
  │        ← post_to_room (costUsd, flood control) … → HALT/COMPLETED → onSettled (retried with backoff) → <signal "room-result">
  └─ send_agent_message (BUS_TARGETS only) ─▶ Queue "agent-bus" ─▶ handleAgentBus ─▶ `<agent>--<t>---bus.<key>` <signal "agent-message">
     (two-way: every specialist and the background worker mount it too; targets are always the other specialists)
Every new conversation a server dispatch creates (room summon, bus delivery, delegated task) carries
`dispatchInitialData(tenantId, { userId, roles, objective })`: the tenant's config with the platform policy applied, so
its first turn never renders on the secure default (first-line model only) while the config cache is cold.
Every delegated, room and bus turn opens with a harness header: [From <agent> · <what> <id> · authority <mode>]
Harness conversations use `harnessSessionKey(kind, key)` (`-dlg.` / `-room.` / `-bus.`): no user can ever own, read or post to them.
```

## When to use
- Delegating a task between agents, adding/removing a specialist, changing who may be reached, grants or caps.
- Changing room turn-taking (decider, moderator, self-selection), flood control, ceilings or outcome reporting.
- Streaming rooms/runs to dashboards; building swarm UIs; debugging stalls, loops, ping-pong or runaway cost.

## Mental model — who owns what

| Concern | File (generated project) | Library source |
|---|---|---|
| Delegation ledger (types, limits, lifecycle, invariants, migrations) | — | `packages/core/src/delegation/{types,ledger,grant}.ts` (`DelegationLedger`, `DELEGATION_MIGRATIONS`, `guardToolsWithGrant`) |
| Delegation tools + hook | `src/agents/orchestrator.ts`, `src/agents/specialists.ts` | `packages/flue/src/delegation.ts` (`createDelegationTools`, `guardDelegatedTools`, `useDelegation`, `workerConversationId`) |
| Delegation transport | `src/multi-agent/delegation.ts` `delegationDispatch` | — |
| Rosters, bus targets, harness conversation ids | `src/multi-agent/roster.ts` `SPECIALISTS`, `DELEGATION_ROSTER`, `BUS_TARGETS`, `busConversationId`, `roomConversationId` | `packages/core/src/ingestion/events.ts` `harnessSessionKey` |
| Subagent read tools (web tools from `webReaders()` / `webSearchProviders()`, gated by `integrations.jina` / `firecrawl`) | `src/multi-agent/research.ts` `researchTools`; `src/agents/orchestrator.ts` | `packages/flue/src/delegation.ts` `useSubagentTools` |
| Custom skills + domain line | `useCustomSkills()` (base `src/lib/custom-skills.ts`) in the orchestrator and every specialist | — |
| Analyst metrics (read-only query factory) | `src/multi-agent/metrics.ts` `TENANT_METRICS`, `tenantMetricsTool` | `packages/core/src/tools/query-factory.ts` `createQueryFactoryTool` |
| Provenance header | — | `packages/core/src/security/provenance.ts` (`withProvenance`, `escapeProvenance`, `PROVENANCE_INSTRUCTION`) |
| Room engine (decide, flood control, silence, batching, reply guard, outcome) | — | `packages/cloudflare/src/room-engine.ts` `RoomEngine`, `ROOM_MIGRATIONS` |
| Room DO base (RPC, alarm, WS history, close codes, `onSettled`) | — | `packages/cloudflare/src/durable-objects.ts` `AgentGroupChatRoom` |
| Concrete room: decider, sinks, summon, room-result | `src/multi-agent/room.ts` `SwarmRoom` | — |
| Room tools + specialist reply guard | specialists / orchestrator | `packages/flue/src/room-tools.ts` (`createRoomTools`, `useRoomTurnGuard`, `unreportedRoomCost`) |
| Run registry, efficiency report, retention, recovery counts | `src/lib/registry.ts` | `durable-objects.ts` `RunRegistry`, `aggregateRunReport`, `pruneRegistry`, `createRegistryBeat`, `REGISTRY_MIGRATIONS`; `sentinel.ts` `sweepStalledRuns` |
| Protocol for the models | `src/skills/group-collaboration/SKILL.md` | — |
| Bus tool + consumer (two-way; other modules get `busTools` from `src/lib/bus.generated.ts`) | `src/multi-agent/bus.ts` (`busTools`, `handleAgentBus`), mounted in `orchestrator.ts`, `specialists.ts` and the background worker | `packages/core/src/messaging/bus.ts`; `packages/cloudflare/src/ingestion.ts` |
| Seeded initialData for server dispatches | `src/multi-agent/{room,bus,delegation}.ts` → base `src/lib/platform.ts` `dispatchInitialData` | — |
| Room HTTP (state + live WS, owner/observer check) | `src/multi-agent/routes.ts` `roomRoutes`, `canObserveRoom` | `AgentGroupChatRoom.describe()` |
| Swarm UI | `web/SwarmView.tsx` | `packages/react/src/components/{SwarmTimeline,RunGantt,AgentTranscript,AgentControlPanel}.tsx` |

## API reference (from source)

```ts
// packages/core/src/delegation — one row per side: requester "outgoing", worker "incoming"
type DelegationMode = "work" | "consult" | "notify";        // notify ⇒ reply "none", no tools
type DelegationReply = "resume" | "poll" | "none";
type DelegationStatus = "queued" | "running" | "needs_input" | "completed" | "failed" | "cancelled";
DEFAULT_DELEGATION_LIMITS = { maxDepth: 3, maxPerRun: 8, maxOpenPerRun: 4, maxBudgetUsdPerRun: 2, defaultBudgetUsd: 0.25, maxReplyGuards: 2, maxBriefChars: 12_000 }
new DelegationLedger(sql, limits?, clock?)
  .plan(request) → { ok, assignment, reused } | { ok: false, refusal: "self"|"ring"|"depth"|"per_run"|"open"|"budget"|"tenant"|"grant"|…, message }
  .receive(wire, { tenantId, workerTools? })   // worker side; tenant-checked; grant narrowed again
  .transition / .settle (terminal once) / .acceptResult(id, nonce, …) / .bumpGuard / .activeIncoming(conv) / .outgoing(conv)
  .invariants(): string[]                       // I1–I8: terminal⇔finished, depth/chain, ring-free, replayable events, settled once…
computeToolGrant(requesterGrant, workerTools?, requested?)   // never widens; requested ∉ requester ⇒ refusal
guardToolsWithGrant(tools, { activeGrant, alwaysAllowed })   // execution-time: outside grant / mutating in consult / budget spent ⇒ TOOL_NOT_ALLOWED

// packages/core/src/security/provenance.ts
withProvenance({ from, what, id?, authority: "work"|"consult"|"notify"|"information" }, body)  // header + escaped body
escapeProvenance(text) · parseProvenance(text) · PROVENANCE_INSTRUCTION

// packages/flue/src/delegation.ts
createDelegationTools({ self, roster?: { id, agent, description, tools? }[], dispatch, grant: () => names, limits?, sql? })
//   delegate_task { agent: roster id, task, mode?, reply?, taskKey?, doneWhen?, tools?, budgetUsd? }  MEDIUM/write
//     needs ctx.tenantConfig.features.multiAgentGroupChat; target + conversation resolved server-side:
//     workerConversationId(agent, tenant, requesterConv, taskKey) = `${agent}--${tenant}---dlg.<sha256(…)[0:24]>`
//     (harnessSessionKey("dlg", hash): never user-owned); idempotencyKey `dlg:<id>`
//   check_delegation { assignmentId? } LOW/read · report_delegation { status: done|failed|needs_input, report } LOW/write
//     → `delegation-result` signal to the requester, idempotencyKey `dlg-result:<id>`, attributes carry the nonce
delegationPolicy({ id, tools?, alwaysAllowed?, sql? })  // useAgentStarter({ policy }) hook: grant enforced for every call, built-ins included
guardDelegatedTools(tools, { sql? })            // same rule by wrapping tools (hosts without the policy hook)
useDelegation({ id, self, dispatch, workerTools?, maxReplyGuards?, awaitingHuman?: () => boolean, parkingTools? = ["ask_person"], limits?, sql? })
//   intake of `delegation` / `delegation-result`, PROVENANCE_INSTRUCTION, reply guard (2 reminders) then auto-return `no_report`;
//   a turn parked on a person (awaitingHuman(), an unexpired PENDING_APPROVAL, or a successful parking tool) is not counted
parkedOnHuman(sql, conversationId, toolCalls?, parkingTools?, now?) → boolean
useSubagentTools(tools, { tenant, tenantConfig, runId, enabled?, firewall?, mode?, services? }) → mounted names
//   inside a useSubagent agent function: LOW-risk read/none tools only (else CONFIG_INVALID); each call runs through a
//   ToolExecutor (schema, firewall + tenant allow/deny lists, tenant isolation, timeouts, untrusted wrapping) as the parent

// packages/cloudflare/src/room-engine.ts
interface RoomConfig { roomId; tenantId; objective; participants; maxTurns; budgetUsd; speakerTimeoutMs; allowFanOut;
  leadId?; requester?: { agent; conversationId }; selection?: "moderator" | "self"; flood?: Partial<RoomFloodLimits> }
DEFAULT_ROOM_FLOOD_LIMITS = { perParticipantPerMinute: 10, duplicateWindowMs: 60_000, ringWindowMs: 120_000,
  breakerCooldownMs: 300_000, replyGuardRetries: 1, maxSilentRounds: 2 }
interface RoomEffects { summon(p, transcript, config, ctx: { seq, batch, reminder, reason }); broadcast(e); scheduleTimeout(at); onSettled?(outcome) }
new RoomEngine(sql, effects, { moderator?, decider?, deciderThreshold = 0.6, deciderTimeoutMs = 2000, clock? })
  .post(msg) → RoomDecision { speakers, halt, reason, refused?: "duplicate"|"ring"|"breaker"|"rate"|"not_participant" } | null
  .recordCost({ key, participantId, costUsd })   // idempotent (max per key); halts at budgetUsd
  .checkTimeouts()                               // reply guard: remind once, then skip (continues from the skipped one); re-arms for the next deadline
  .onAlarm() → next wake time | null             // checkTimeouts + reportOutcome + nextWakeAt (the DO alarm calls this)
  .nextDeadline() · .nextWakeAt()                // earliest pending deadline · that or the outcome retry time
  .reportOutcome()                               // on failure schedules its own retry: 30 s doubling to 15 min (REPORT_RETRY_BASE_MS / _MAX_MS)
  .outcome() · .historyEvents(limit)             // stable ids `<roomId>:m<id>`
NO_RESPONSE = "NO_RESPONSE" · closesRing(senders, candidate) · ROOM_MIGRATIONS v1–v3

// packages/cloudflare/src/durable-objects.ts
abstract class AgentGroupChatRoom { summon(p, t, c, ctx); moderator(); decider(); onSettled(outcome); sinks();
  open (idempotent) · post · recordCost · getState · describe() → { roomId, tenantId, requester, status } | null
  · alarm (engine.onAlarm, then re-arms explicitly for the next deadline / retry) · fetch (WS history frame) }
class RunRegistry { register · beat(run, counters?) /* back to RUNNING except TERMINATED */ · heartbeat
  · complete(runId, status, counters?) /* COMPLETED resets recovery attempts */ · recoveryAttempts(runId) · noteRecovery(runId) → { attempts, total }
  · efficiencyReport(from, to, thresholds?) → RegistryEfficiencyReport · prune(retentionMs?) · stalled /* prunes about hourly */ · active · get · setStatus }
interface RunCounters { turnCount?; costUsd?; tokens?; toolCalls?; vmSeconds?; vmCostUsd?; vmLeakedCostUsd?; routing?: { firstLine?; frontier? } }
//   cumulative per conversation; each beat also snapshots them into a RUN_COUNTER_BUCKET_MS (15 min) bucket
aggregateRunReport(sql, { from, to }, thresholds?, now?)   // per run: snapshot at `to` − snapshot before `from` (window spend, not lifetime);
//   anomalies on window values; kpis.infrastructureLeakedCostUsd + totals.vmLeakedCostUsd (VMs that hit the hard TTL)
pruneRegistry(sql, { retentionMs = REGISTRY_RETENTION_MS (30 d), now? })   // settled runs + their rows; keeps each live run's latest snapshot
createRegistryBeat(() => registry, { timeoutMs = 500, minIntervalMs = 5000, onError? })   // throttled, bounded, never throws
safeCloseCode(code)   // 1005→1000, 1006/1015→1011

// packages/cloudflare/src/sentinel.ts
sweepStalledRuns(registry, { thresholdMs?, recover(run, { attempt, total }), recoveries?, maxRecoveries = 3, log? })
//   counts attempts in the registry (recoveryAttempts / noteRecovery) unless you pass your own `recoveries` counter

// packages/flue/src/room-tools.ts
createRoomTools({ room, participants, tenantId, selfId?, selfRole?, agentName?, leadId?, defaults?, spentUsd?, sql? })
//   spawn_collaboration_room (MEDIUM/write; flag-gated; records requester = ctx.runId) · post_to_room (LOW/write; costUsd delta; refusals)
useRoomTurnGuard({ room, selfId, maxReminders = 2, sql? })   // reminder on a silent room turn + recordCost of the running turn
```

## Recipes

### 1. Delegate a task (shipped in the orchestrator)
```ts
const own = [...createRoomTools({ …, agentName: "orchestrator" }), ...busTools("orchestrator", id)];
const delegation = createDelegationTools({ self: "orchestrator", roster: DELEGATION_ROSTER, dispatch: delegationDispatch, grant: () => own.map((t) => t.name) });
const ctx = useAgentStarter({ ...platform("orchestrator", id), tools: [...own, ...delegation], planning: true });
useDelegation({ id, self: "orchestrator", dispatch: delegationDispatch });
```
Pass `awaitingHuman: () => ctx.awaitingHuman` to `useDelegation` (the hook's live flag) so a turn parked on an approval or
a question is never counted as "no report". Workers (specialists): `tools: [...own, ...createDelegationTools({ self, dispatch, grant })]`,
`policy: delegationPolicy({ id, tools: own, alwaysAllowed: <own LOW read tools> })` in `useAgentStarter`, plus
`useDelegation({ id, self, dispatch, workerTools, awaitingHuman })`. Give a worker a tool that acts by mounting it **and** listing it in its
`DELEGATION_ROSTER` entry's `tools` **and** holding it in the requester — the grant is the intersection. A worker's own
LOW-risk read tools (the analyst's `query_tenant_metrics_factory`) are listed in `alwaysAllowed`, so they work in any delegated task.

### 2. Add a specialist
1. `src/multi-agent/roster.ts`: add `{ id: "finance", agent: "finance-agent", role, description }` (both rosters derive from it).
2. `src/agents/specialists.ts`: `export function FinanceAgent({ id }: AgentProps) { return useSpecialist("finance", id, "You are …"); }` + `FinanceAgent.agentName = "finance-agent";`
3. `src/multi-agent/room.ts`: add `finance: { agent: FinanceAgent, name: "finance-agent" }` to `AGENT_FOR`.
4. Register it (`agent-starter-scaffold`): `src/agents.generated.ts`, approval routes, a **new** migration tag with `new_sqlite_classes`.

### 2b. Give subagents read tools (shipped in the orchestrator)
```ts
// src/agents/orchestrator.ts — only while the conversation is not locked (no subagent ⇒ `task` has no target)
if (!ctx.securityLocked && !ctx.budgetExhausted && !ctx.tenantLocked) {
  const subagentTools = { tenant: ctx.tenant, tenantConfig: ctx.tenantConfig, runId: ctx.runId };
  useSubagent({ name: "researcher", description: "…", agent: researcher(subagentTools) });
}
function researcher(tools: SubagentToolsContext) {
  return function Researcher() { const mounted = useSubagentTools(researchTools(), tools); return `… (${mounted.join(", ")})`; };
}
```
`useAgentStarter` cannot run inside a subagent (no persistent state there); `useSubagentTools` mounts the tools with
`useTool` and runs every call through a `ToolExecutor` as the parent's tenant and user. Only LOW-risk read tools.

### 2c. Analyst metrics (shipped)
`src/multi-agent/metrics.ts`: `TENANT_METRICS` maps metric names to `run(tenantId, range, filters, ctx)` calls of your SaaS
analytics API (`GET /api/analytics/metrics/<metric>`); `tenantMetricsTool()` = `createQueryFactoryTool({ metrics, maxRangeDays: 366 })`
(LOW, read-only, tenant injected from context, date range validated). The shipped keys are the spec's DataAnalyst
contract (L2655–2663): `total_conversions`, `bounce_rate`, `revenue_usd`, `active_manychat_subscribers`. Replace them with yours.

### 3. Turn-taking
```ts
// src/multi-agent/room.ts — decider (shipped): JSON { speaker, confidence }; < 0.6, slow or malformed → lead
protected override decider() { return new WorkersAIProvider(this.env.AI, { model: "@cf/meta/llama-3.1-8b-instruct-fast" }); }
// or the classic moderator: protected override moderator() { … }  (NEXT:/HALT:) — no decider/moderator → round-robin
// self-selection: open the room with selection: "self" → everyone is summoned, NO_RESPONSE = silence,
// ring detection restarts every round, 2 all-silent rounds (NO_RESPONSE or skipped speakers) halt the room as stuck.
```

### 4. Room outcome back to the orchestrator (shipped)
`spawn_collaboration_room` records `requester: { agent, conversationId: ctx.runId }` in `RoomConfig`. On COMPLETED or
HALTED the engine calls `onSettled(outcome)` (on failure it schedules its own retry, 30 s doubling to 15 min, until it succeeds);
`SwarmRoom.onSettled` checks the requester is in the same tenant and dispatches a provenance-wrapped `room-result`
signal with `idempotencyKey: room-result:<roomId>`. `outcome.synthesis` is the last participant message containing `DONE:`.

### 5. Bus hand-offs (two-way)
The orchestrator, every specialist (`useSpecialist` mounts `busTools(spec.agent, id)`) and, when multi-agent is
composed, the background worker (`busTools` re-exported by the generated `src/lib/bus.generated.ts`, an empty stub
otherwise) can send. `busTools(from, id)` offers only `BUS_TARGETS` minus the sender (dispatch-only specialists; add an
agent there only if it has no HTTP mount, so the orchestrator, the background worker and the operator are senders,
never targets) and a routing key `[A-Za-z0-9_-]{1,60}`; `handleAgentBus` drops any other target and delivers to
`busConversationId(agent, tenant, key)` = `<agent>--<tenant>---bus.<key>`, a harness conversation no person owns,
seeded with `dispatchInitialData`. Keep the `busTools(fromAgent, instanceId): AnyAgentTool[]` export stable: the
generated bus re-export depends on it.
When answering an `agent-message`, the new message gets `parent` (from `messageId`/`correlationId`/`hops`
attributes), so hops accumulate and `validateDeliverable` (max 8) stops ping-pong. Delivery is
`withProvenance(... authority "information")`.

### 6. Watch a room
`web/SwarmView.tsx` (shipped): `useAgentTelemetry({ source: { type: "websocket", url } })` (or, with the `pusher` prop — your
pusher-js client authorizing at `POST /api/pusher/auth`, which lets admin/operator sessions watch room channels — the
room's channel `pusherTelemetryChannel(tenant, roomId)`; Pusher carries live events only, no history) → `SwarmTimeline`,
`RunGantt` (one bar per room participant, hand-off edges; pass `runs`/`edges` from the registry or ledger for
delegations, or put `data.edge = { from, to, kind }` on events) and `AgentTranscript` (per-agent thought / plan /
tool / approval rows). On connect the room sends `{ type: "history", events }` with stable ids, deduped against live
events. Pusher: `PusherPublisher` and `useAgentTelemetry` both default to `PUSHER_TELEMETRY_EVENT` (`agent-turn-executed`).
`roomRoutes` serves `/api/rooms/:id` and `/live` only when `canObserveRoom(await room.describe(), claims)`: same
tenant, a full user token (no `aud`/`cid`, no visitor), and owner of the conversation that opened the room or an
observer role (`ROOM_OBSERVER_ROLES` = admin, operator).

### 7. Test without Cloudflare
Room engine and ledger tests run on `NodeSqlStore` (`packages/cloudflare/test/rooms-registry.test.ts`,
`rooms-registry-hardening.test.ts`, `packages/core/test/delegation.test.ts`); DO classes are tested with
`vi.mock("cloudflare:workers")`, a fake `ctx.storage.sql` and fake timers for alarms; delegation end to end runs in a
real Flue runtime with the faux provider (`packages/flue/test/delegation.test.ts`, `delegation-hardening.test.ts`).
The generated project ships `test/multi-agent.test.ts` (room observation, bus and room conversation ids) and
`test/multi-agent-dispatch.test.ts` (seeded initialData on summons, bus deliveries and delegations; the two-way bus; metric keys).

## Checklist — spec requirements for this topic
- [ ] **Independent stateful DOs; the room is a coordinator DO.** Verify: `wrangler.jsonc` `GROUP_CHAT_ROOM`→`SwarmRoom`; each specialist in `new_sqlite_classes`.
- [ ] **Room transcript + turn-taking in SQLite (R-MA-01).** Verify: `ROOM_MIGRATIONS` v1+v2; test "lets the moderator pick speakers, fans out, and halts on completion".
- [ ] **Cheap moderator / decider with fallback (R-MA-02).** Verify: test "routes on a confident JSON pick and falls back to the lead below the threshold or on garbage".
- [ ] **Async summon with monotonic idempotency keys (R-MA-03).** Verify: `room-turn:<room>:<id>:<seq>`; test "uses a monotonic summon sequence that keeps growing past the 30-message transcript window".
- [ ] **Fan-out, one turn in flight, batching (R-MA-04).** Verify: test "batches what a participant missed into its next summon and keeps one turn in flight per participant".
- [ ] **Fault isolation + reply guard (R-MA-05).** Verify: test "isolates faults: a timed-out participant is skipped with a system message"; `useRoomTurnGuard` e2e test.
- [ ] **A silent speaker never hangs a room (R5).** The engine re-arms for later deadlines; speakers that keep dying settle the room as stuck. Verify: tests "R5: re-arms for a later speaker's deadline…", "re-arms the alarm for the next pending deadline and for the outcome retry".
- [ ] **Turn and budget ceilings with real cost (R-MA-06).** Verify: tests "halts at the room budget ceiling", "counts reported spend and halts at the budget even between posts", "reports each turn's cost from the run ledger exactly once".
- [ ] **Orchestrator spawns rooms, tenant-scoped, flag-gated (R-MA-07, R-TEN-10).** Verify: test "checks the tenant flag and records who opened the room".
- [ ] **Room outcome returns to the orchestrator (R-MA-08), retried until delivered (R9).** Verify: tests "reports the outcome once with the DONE: synthesis, retrying after a failure", "opens idempotently and runs the completion hook", "R9: a failed completion hook retries with backoff…".
- [ ] **Room observation is owner-scoped (SEC-18).** Verify: generated `test/multi-agent.test.ts` › "lets the user who opened the room and observers in, nobody else".
- [ ] **Bus with hop limits that accumulate and TTLs (R-MA-10).** Verify: `busTools` passes `parent`; `validateDeliverable` max 8.
- [ ] **Bus is two-way: specialists and the background worker emit to permitted targets (finding 6, spec L382).** Verify: generated `test/multi-agent-dispatch.test.ts` › "specialists and the background worker can send, only to other dispatch-only specialists".
- [ ] **Server dispatches seed the tenant config (spec L2632–2633).** Verify: generated `test/multi-agent-dispatch.test.ts` › "a room summon carries the tenant config with the room identity", "a bus delivery carries the tenant config and the sender identity", "a new delegated task carries the tenant config; a result back to the requester adds nothing".
- [ ] **Bus and harness conversations are never a person's (SEC-07, SEC-20).** Verify: generated `test/multi-agent.test.ts` › "bus targets are dispatch-only specialists…", "room specialists run in harness conversations…"; flue test "names delegation workers with a harness session key no user can own".
- [ ] **Subagents have read tools (R-MA-09).** Verify: flue test "lets the researcher subagent call a guarded read tool as the parent's tenant and user"; "refuses anything but LOW-risk read-only tools…".
- [ ] **Analyst queries metrics through the typed factory (R-TOOL-13), with the spec's metric keys.** Verify: `src/multi-agent/metrics.ts` mounted on `AnalystAgent`; `packages/core` query-factory tests; generated test "exposes the spec's metric keys".
- [ ] **Live room UI incl. history (R-MA-11, R-UI-04/07).** Verify: tests "serves history as TelemetryEvents whose ids match the live broadcasts", "ingests the room's history frame as events".
- [ ] **Delegation runtime.** Durable ledger, immutable origin, modes, replies, depth/per-run/budget caps, ring guard, task-key reuse, auto-return. Verify: `packages/core/test/delegation.test.ts`, `packages/flue/test/delegation.test.ts` (ledger `invariants()` empty after every scenario).
- [ ] **Worker tools ⊆ requester grant at execution time.** Verify: tests "blocks tools outside the grant, mutating tools in consult mode, and spent budgets" (core) and the `delegationPolicy` assertions in "delegates with a server-resolved target…" (flue).
- [ ] **A worker waiting for a person is not reported failed (R4).** Verify: flue test "does not report a worker as failed/no_report while its granted action waits for approval"; "parkedOnHuman (R4)".
- [ ] **Provenance header on delegated, bus and room turns; imitations escaped.** Verify: tests "escapes imitations in model and human text…".
- [ ] **Flood control.** Verify: tests "refuses duplicates and rate floods…", "trips the breaker on an A→B→C→A ring…", "does not treat a second round of a self-selection room as a ring" (R10), "still trips the breaker on a ping-pong inside one round", "refuses posts from senders that are neither participants nor staff".
- [ ] **Specialist contract (report back, different verifier, DONE:).** Verify: `group-collaboration/SKILL.md`, specialist + orchestrator prompts.
- [ ] **Efficiency report from reported counters (R-OBS-05), window spend not lifetime (R15).** Verify: tests "aggregates the efficiency report from reported counters, never lowering them", "counts only what a long-lived run spent inside the report window, plus leaked VM cost".
- [ ] **Leaked VM cost KPI (R-OBS-07).** `RunCounters.vmLeakedCostUsd` → `kpis.infrastructureLeakedCostUsd`. Verify: same test.
- [ ] **Registry stays fast and bounded (R16).** Verify: tests "prunes settled runs past retention…", "createRegistryBeat throttles per run, never waits longer than its timeout and never throws".
- [ ] **Heartbeats revive runs except TERMINATED (R-OBS-04).** Verify: test "beat() sets the status back to RUNNING except for TERMINATED".
- [ ] **Recovery attempts reset on a clean settle (R20).** Verify: test "counts recoveries in the registry, resets them when a submission completes, and passes a lifetime total".
- [ ] **Signed webhooks + Pusher per tenant room.** Verify: integrations tests for Pusher; `SwarmRoom.sinks()` → `telemetrySinks()`.

## Pitfalls
- **The tenant flag gates everything multi-agent**: `features.multiAgentGroupChat` is off in `SECURE_DEFAULT_TENANT_CONFIG`; seed a dev tenant or rooms/delegation/bus answer "disabled".
- **useAgentStarter fixes the tenant config at render**: the very first message of a conversation still sees the secure default until `loadTenantConfig` has run once.
- **Grants are intersections**: a worker tool missing from the roster `tools` or from the requester's own tools is refused at call time, even though the worker mounts it.
- **`poll` still wakes the requester**: Flue has no silent delivery; the result is recorded and a short note says no reply is needed.
- **Never build agent conversation ids by hand** for harness sessions: use `workerConversationId`, `roomConversationId`, `busConversationId` (all `harnessSessionKey`), or `conversationInstanceId` for a person's chat. A hand-built `dlg.x` or `room.x` parses as a conversation owned by user "dlg"/"room".
- **Rings count unsummoned posts only** (or every post in `selection: "self"`, where detection restarts each round); moderated turns cycle by design.
- **The bus only reaches `BUS_TARGETS`**: adding an HTTP-mounted agent there would let one user's orchestrator write into another person's agent. Use delegation (harness conversations) to reach chat agents' capabilities instead.
- **`broadcast` awaits all sinks** (`Promise.allSettled`); keep webhook timeouts low.
- **Approvals inside rooms park the specialist**; the room reminds it once and then skips it (rooms do not wait for people). Delegated tasks do wait: the reply guard ignores a turn parked on an approval. Keep HIGH-risk work in the orchestrator, a delegated task or a background job.
- **Registry beats are on the tool hot path**: call the registry through `createRegistryBeat` (or an equivalent throttle + timeout) and never await it.
- **Report conversation-cumulative counters**: the report diffs snapshots; a counter that restarts per submission or budget scope under-reports (the registry keeps the max).
- **`delegationPolicy` is strict**: inside a delegated task even `useAgentStarter` built-ins (plan_goals, remember_fact) are refused unless granted; pass `alwaysAllowed: ["plan_goals", "update_goal"]` to allow harmless ones. If `platform()` already sets a `policy`, compose the two.

## Verify
```bash
pnpm --filter @agent-starter/core test           # ledger invariants, grant guard, provenance
pnpm --filter @agent-starter/cloudflare test     # room engine, flood control, decider, outcome hook, registry report
pnpm --filter @agent-starter/flue test           # delegation tools + Flue e2e (reply guard, auto-return), room tools
pnpm --filter @agent-starter/react test          # RunGantt, AgentTranscript, history frames, SwarmTimeline
pnpm --filter @agent-starter/integrations test   # Pusher default event + channel isolation
pnpm --filter create-agent-starter test
```

## Related skills
`agent-starter-planning-and-cognition` (subagents, goal tree) · `agent-starter-background-jobs` (queues, registry, report) ·
`agent-starter-generative-ui` (telemetry hooks, components) · `agent-starter-security` (tenancy, injection defense) ·
`agent-starter-coding-agent` (agent git for concurrent edits) · `agent-starter-definition-of-done`.

## Not yet implemented
- Silent `poll` inbox: results with `reply: "poll"` still arrive as a signal (Flue cannot deliver without a turn).
- A UI route that feeds `RunGantt` delegation edges from the ledger (the ledger lives in each agent DO); today pass `edges` yourself or use room hand-off edges.
- Declarative persona/team packs and a task board with atomic checkout (backlog #6 in `docs/research/grok-style-templates.md`).
- Tier rules (workers cannot delegate, no same-tier delegation) beyond the ring/depth guards.
- Rooms do not wait for a specialist parked on an approval or question: the room reply guard reminds it once, then skips it.
- The report window edges are accurate to one counter bucket (15 min); a conversation pruned after 30 days of silence that resumes reports its lifetime counters once.
