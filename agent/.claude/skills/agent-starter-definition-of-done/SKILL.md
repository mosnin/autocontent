---
name: agent-starter-definition-of-done
description: The definition of done for Agent Starter work. Ordered global gates (pinned install, typecheck, unit tests, generated-app build, evals, local smoke run, deploy preflight), out-of-the-box checklists per module (chat, widget, in-app, background, multi-agent, computer-use, coding, voice, persistent), and per-area checklists that cover every spec requirement (R-* IDs in docs/REQUIREMENTS.md), including known gaps so they are never silently skipped. Use before declaring any agent, tool, prompt, module, template or infrastructure change done, before handing over a freshly generated project, and before every deploy.
---

# Agent Starter — definition of done

A change is done when the global gates pass **in order**, the module checklists for every module you touched
(or every module in a new project) are true, and every item in the matching area checklists is ticked or
explicitly reported as open. The checklists cover **every** requirement in `docs/REQUIREMENTS.md`
(in a generated project: the copy of this skill under `.agents/skills/`; the requirements file lives in the
agent-starter monorepo).

## When to use

- Before saying "done" on any change to agents, tools, prompts/skills, models, memory, approvals, queues, crons,
  UI surfaces, templates, `wrangler.jsonc` or deploy scripts.
- After generating a project with `create-agent-starter`, before handing it to a person.
- Before every `pnpm run deploy` and before merging to `main`.
- When asked "does this cover the spec?" — answer with the R-IDs from the area checklists.

## How to use this skill

1. **Scope.** List the modules and areas your change touches (table in §4). A new project touches everything.
2. **Gates.** Run G1–G6 below in order; stop at the first failure and fix it. Run G7–G8 only when deploying.
3. **Module checklists (§3).** For each touched module, confirm every bullet.
4. **Area checklists (§5).** Open each matching `references/checklist-*.md` and run the `verify:` check of every item
   you could have affected. Tick only what you actually ran.
5. **Report.** End with the summary format in §6. Items marked **GAP** or **PARTIAL** are not done: never tick them.
   Say whether your change closes, worsens or leaves them as they are.

## 1. Global gates (run in order)

Commands assume the monorepo root (`/home/user/agent-starter` or your checkout) unless they say "generated app".

### G1 — Install with the pinned overrides intact
- Monorepo: `pnpm install`. Generated app: `pnpm install` (or `npm install`).
- `package.json` must keep `"@earendil-works/pi-ai": "1.4.0"` and `"@earendil-works/pi-agent-core": "1.4.0"` in
  `pnpm.overrides` (generated apps also in `overrides`). Check: `pnpm why -r @earendil-works/pi-ai` (monorepo) or
  `pnpm why @earendil-works/pi-ai` (generated app) shows only 1.4.0.
- Why: pi-ai 1.5.0 removed the `Type` export Flue 2.3.0 imports. If typecheck or tests suddenly fail inside
  `@flue/runtime`, look here first. Never bump `@flue/*` without re-running every gate.

### G2 — Lint and typecheck
- Monorepo: `pnpm lint && pnpm typecheck` (or `pnpm check`, which also runs the tests).
- Generated app: `pnpm lint && pnpm typecheck && pnpm typecheck:web`.
- Zero errors. Do not add `// @ts-ignore`, `as any` or blanket `eslint-disable` to get through; fix the code.

### G3 — Unit tests
- Monorepo: `pnpm test`. This includes `create-agent-starter`'s `test/skills.test.ts` (every builder and runtime skill:
  frontmatter, sibling-skill references, `references/` links) and `test/project-ops.test.ts` (generated wiring).
- Generated app: `pnpm test` (`pnpm test:coverage` for a report). Base tests: `harness.test.ts` (real Flue runtime +
  scripted model: guarded tools, budget ledger, approval exactly-once, injection lock), `security.test.ts` (auth,
  tenant isolation, approval links), `platform.test.ts` (seed, policy, run status, retrieval scoping, CORS, recovery
  hooks). Modules add their own (`background.test.ts`, `ingestion.e2e.test.ts`, `multi-agent.test.ts`,
  `operator-delegation.test.ts`, `coding-policy.test.ts`). No API keys, no Cloudflare login.
- New tool or policy ⇒ add a unit test next to the code you changed (package `test/` or the app's `test/`).

### G4 — Generated-app build
- Reference app in the monorepo:
  `pnpm --filter full-stack-agents typecheck && pnpm --filter full-stack-agents test && pnpm --filter full-stack-agents build`
- Template or package change ⇒ regenerate `examples/full` (`agent-starter-scaffold` §6). CI's "Generated projects" job
  fails when `examples/full` drifts from a fresh compose, and also lints/typechecks every module composed alone and
  builds `voice-agent/`. Locally, for a module you touched:
  ```bash
  D="$(mktemp -d)"
  node packages/create-agent-starter/bin/create-agent-starter.mjs dod-bg --modules background --deps link --yes --dir "$D/dod-bg"
  (cd "$D/dod-bg" && pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build)
  ```
- Added an agent? It is exported, mounted in `src/app.ts` behind `agentAuth()` (if it has HTTP), listed in
  `src/agents.generated.ts`, and its `Flue<Pascal>Agent` class is in a **new** `migrations` tag (R-OPS-02).

### G5 — Evals
- Offline: `pnpm --filter @agent-starter/evals test`.
- Live (needs `OPENAI_API_KEY` and `EVAL_HARNESS_SECRET` of at least 16 characters in `.dev.vars`): terminal 1
  `pnpm dev` (port 5173); terminal 2 `pnpm evals` (`EVAL_BASE_URL` overrides the target). Suites load from
  `evals/*.yaml`, one per composed module, each asserting the first tool, caps and `ExecutedState`. Every assertion
  passes; `pnpm evals:view` to debug.
- New agent or tool ⇒ add a case to that module's `evals/module-*.yaml` (expected first tool + cost/turn caps).

### G6 — Local smoke run (generated app)
```bash
cp .dev.vars.example .dev.vars        # fill OPENAI_API_KEY and the signing secrets
pnpm seed:dev --token                 # generous LOCAL dev tenant (dev_tenant) + a dev session token for dev_user
AGENT_STARTER_LOCAL_ONLY=1 pnpm dev   # offline bindings
curl -s localhost:5173/health                                                        # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5173/api/<agent>/conversations     # 401 without a token
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5173/approvals/malformed-token      # 400
```
**Seeding is required**: unknown tenants get the secure freemium defaults (5 turns, $0.15, features off) (R-APP-08).
Then one real round trip per touched agent (needs `OPENAI_API_KEY`; `TOKEN` is the token `seed:dev --token` printed):
```bash
CID=$(curl -s -X POST localhost:5173/api/assistant/conversations -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"sessionKey":"smoke"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).conversationId')
curl -s -X POST "localhost:5173/agents/assistant/$CID" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"kind":"user","body":"Hello"}'
curl -s "localhost:5173/agents/assistant/$CID?view=history" -H "authorization: Bearer $TOKEN"   # reply + metadata.model/budget/channel
```
Swap `assistant` for the agent you changed. For a HIGH/CRITICAL tool, confirm the reply ends with PENDING_APPROVAL and
that POSTing the approve link executes the tool exactly once. Background ingestion (signed method + path + body,
202 → queue → one job turn) is proven offline by `test/ingestion.e2e.test.ts`; run it after any change to
`src/background/*`.

### G7 — Deploy preflight
- `grep -n REPLACE_WITH_ wrangler.jsonc` prints nothing: every KV id from `pnpm infra:init` is filled in.
- Infra exists for every binding (names are project-scoped, `pnpm infra:init` is re-runnable): queues **and** their DLQs,
  KV namespaces, R2 bucket, Vectorize index with `--dimensions=768` plus the `tenantId` and `userId` metadata indexes
  (tenant- and user-filtered retrieval returns nothing without them).
- `npx wrangler secret list` includes `OPENAI_API_KEY`, `SESSION_SIGNING_SECRET`, `APPROVAL_SIGNING_SECRET`,
  `WEBHOOK_SIGNING_SECRET` (or the per-purpose `INBOUND_WEBHOOK_SECRET` / `OUTBOUND_WEBHOOK_SECRET` / `TENANT_SYNC_SECRET`),
  plus module secrets (`SAAS_SERVICE_TOKEN`, `BOAT_DEV_API_KEY`, `SENDRAVEN_API_KEY`, …).
  `EVAL_HARNESS_SECRET` is unset or at least 16 random characters.
- Migrations: every class in `src/agents.generated.ts` (as `Flue<Pascal>Agent`) and every DO class export appears in some
  `new_sqlite_classes`; no tag that was already deployed was edited.
- `vars`: `PUBLIC_BASE_URL` and `ALLOWED_ORIGINS` point at production, `CODE_VERSION` bumped, `AGENT_MODEL` is
  `openai/gpt-6.1-terra` unless deliberately changed; computer-use has `BOAT_GOLDEN_SNAPSHOT_ID` set.
- Real tenants have config in `TENANT_CONFIG` (synced from the SaaS through `PUT /internal/tenants/:id/config`).
- CI is green, including lint, the prod dependency audit and `semantic-evals` (deploys are gated on evals unless
  `vars.ALLOW_DEPLOY_WITHOUT_EVALS` is set). `scripts/deploy.sh` (via `scripts/canary.sh preflight`) refuses to run while `REPLACE_WITH_*` placeholders remain or
  `PUBLIC_BASE_URL` is localhost or a placeholder (R-OPS-13).

### G8 — Deploy and canary
- `pnpm run deploy` (tsc → vitest → vite build → wrangler deploy → canary). It must end with
  "Production deployment verified"; otherwise `npx wrangler rollback`.

## 2. Non-negotiables to re-check on every change

- Every agent calls `useAgentStarter({ ...platform("<name>", id), ... })`; every tool is `defineAgentTool` with `risk`
  and `sideEffect`; no direct Flue `useTool` and no raw `fetch` exposed to the model.
- `registerExtendedModels()` and `installAgentStarterObserver()` run at module top level of `src/app.ts`, and
  `import "@agent-starter/flue/cloudflare"` is its first import.
- Every `createAgentRouter(...)` mount sits behind `agentAuth()`; tenant ids come only from `initialData` set server-side.
- Mutating tools forward `ctx.idempotencyKey`; customer-facing or irreversible tools are HIGH/CRITICAL.
- Never read `bindings()`/env at module scope; never put secrets in `vars`.
- Approval GET routes never mutate; decisions are POST-only.

## 3. Module checklists — what must be true out of the box

Each bullet names the requirement it proves. "Open" means a known gap: report it, do not tick it. Every module assumes the
dev tenant is seeded (`pnpm seed:dev --token`), otherwise tenants run on the secure freemium defaults (R-APP-08).

**chat (`Assistant`)**
- G6 round trip works for `assistant`; replies stream in `AgentChat` with reasoning, tool cards and generative UI (R-UI-01, R-STK-11).
- Default model is Terra at medium effort, routed through AI Gateway when `AI_GATEWAY_ID` is set; fallbacks configured; tenant `allowedModelProfiles` honoured (R-MOD-01, R-MOD-02, R-MOD-06, R-MOD-09).
- `web_search` appears when `JINA_API_KEY` or `FIRECRAWL_API_KEY` is set; `fetch_url_markdown` always; `browse_page` with `CF_ACCOUNT_ID`/`CF_API_TOKEN` (R-APP-09, R-STK-14, R-STK-15).
- `remember_note` / `search_notes` / `forget_note` recall across the same user's conversations only; notes are redacted before embedding (R-MEM-04, R-TEN-08).
- The chat page lists, switches and deletes threads (`ThreadList`) (R-APP-10); `ask_person` cards render and answers resume the agent (R-TOOL-14, R-UI-06).
- Planning tools work and failed goals re-plan; planner, scratchpad, confidence gating, lenient healing, early compaction and utility routing are on by default (R-COG-02, R-COG-03, R-MEM-01, R-TOOL-05, R-TOOL-07).
- Facts the user saves are recalled in their other conversations (cross-session entity memory) and repeated questions can hit the tenant-scoped semantic cache (R-MEM-03, R-MOD-07).
- `[CLEANSED_INJECTION_ATTEMPT]` in any input or tool result stops the run through `halt_job` (R-SEC-03, R-TOOL-15).
- Each message sees at most 4 relevant tools plus the always-mounted safety, planning and coordination tools; tool outputs over 4,000 characters reach the model compacted, with `expand_tool_output` for exact slices; a failed call carries the critic's pivot in its own result (R-MOD-08, R-MEM-11, R-COG-04).

**widget (`SupportAgent`)**
- A publishable key in `WIDGET_KEYS` with an origin allowlist; `/widget/session` returns a visitor token plus a signed visitor credential only for that origin; widget origins get CORS without credentials (R-TEN-13, R-SEC-15).
- Visitor tokens are refused by every other mount and module route; the support agent retrieves from the help center only (R-SEC-13).
- `ChatWidget`/`mountChatWidget` opens, streams, escalates; `pnpm build:widget` produces the script-tag bundle (R-UI-02); `search_help_center` answers from retrieval (R-MEM-06, R-MEM-07).
- `create_support_ticket` / `handoff_to_human` need `PRIMARY_SAAS_API_URL` + `SAAS_SERVICE_TOKEN` / SendRaven + `OPS_ALERT_EMAIL` (R-STK-13).

**in-app (`Copilot`)**
- `READ_PREFIXES` / `WRITE_PREFIXES` / `DELETE_PREFIXES` in `src/in-app/app-api.ts` match your API (R-TOOL-03, R-TOOL-12).
- `app_api_delete` parks for approval (R-TOOL-04); `AgentSidebar` sends the page as the validated `x-agent-context` header (R-UI-03).
- `/mcp` rejects calls without an OAuth token; the firewall is per request; OAuth metadata is served; `OAUTH_KV` exists (R-STK-08, R-STK-10).

**background (`BackgroundWorker`)**
- Signed event → 202 → queue → one coalesced, job-scoped turn → FSM INGEST→EVALUATE→EXECUTE→REPORT (R-EVT-01, R-EVT-03, R-COG-06).
- Tenant rate limits apply at ingest and in the consumer; redeliveries dedupe by event id; per-tenant webhook secrets work (R-EVT-04, R-EVT-12).
- `trigger_customer_message` parks for approval; the registry shows PENDING_APPROVAL; approve link resumes exactly once (R-BG-08, R-BG-10, R-OBS-04).
- Budgets merge to the stricter of tenant and agent limits; a breach snapshots to R2 and alerts (R-BG-06, R-BG-07); `save_artifact` writes under `tenants/<id>/` (R-TEN-07).
- `/api/jobs/:id/pause|resume|teardown` work; teardown runs compute recovery hooks; dead letters park in R2 and replay (R-BG-11, R-EVT-05).
- With multi-agent and computer-use composed, a job delegates to the analyst (`query_tenant_metrics_factory`) or the operator (browser) and gets their `DONE:` report back; alone it still completes (R-APP-12).
- Webhooks are signed over method + path + body; Stripe uses each tenant's own endpoint secret; sampled jobs fork into shadow twins with diffs in R2, and divergences raise `SHADOW_DIVERGENCE` (R-SEC-14, R-EVT-09, R-EVAL-10).
- Every job turn is routed SIMPLE/COMPLEX by the utility model and starts with the tenant's config (R-MOD-04, R-MA-19).
- `notify_saas` goes through the durable outbox (the minute cron redelivers) and carries a signed, expiring artifact link (R-EVT-11, R-EVT-13).
- `JobControlPanel` shows status, turns of `maxTurns`, cost against `budgetUsd` and VM time, and approves/rejects by id through `POST /approvals/by-id/:jobId/:approvalId` with an operator session (R-UI-05, R-SEC-18).

**multi-agent (`Orchestrator` + specialists)**
- `delegate_task` resolves the target server-side, enforces depth/budget/ring guards and the tool grant, and the result returns to the requester exactly once (R-MA-12, R-MA-13).
- Rooms: decider with lead fallback, `NO_RESPONSE`, flood/ring control, `DONE:` reports, and the room outcome arrives in the orchestrator as `room-result` (R-MA-02, R-MA-15, R-MA-16, R-MA-08).
- Every hand-off carries the provenance header (R-MA-14); `multiAgentGroupChat` gates rooms and delegation (R-TEN-10).
- `SwarmView` shows the timeline, `RunGantt` and `AgentTranscript` (WebSocket by default, Pusher when a client is passed); bus queue + DLQ consumer exist; specialists (and a composed background worker) can send on the bus to permitted specialists (R-UI-11, R-MA-10, R-UI-07).
- Room summons, bus deliveries and delegated tasks carry the tenant's config (R-MA-19).
- `AnalystAgent` answers metrics questions only through `query_tenant_metrics_factory` (point `src/multi-agent/metrics.ts` at your SaaS API); the researcher subagent has read tools (R-TOOL-13, R-MA-09).
- Only the room's opener (or observer roles) can watch it; harness conversations can't be opened by users (R-MA-18, R-MA-17).

**computer-use (`ComputerOperator`)**
- `BOAT_DEV_API_KEY` secret set; golden snapshot built (`node scripts/build-golden-vm.mjs`) and `BOAT_GOLDEN_SNAPSHOT_ID` set (R-CU-03).
- Tenant has `features.computerUse` (+ `autonomousBrowserUse` for browser tools) (R-TEN-10).
- VM seconds are metered per run and `maxVmSeconds` tears the VM down; one VM per run survives isolate eviction (R-CU-05, R-CU-06).
- Interactive browser tools work; `browser_submit` parks for approval and the VM stays up only for `APPROVAL_VM_GRACE_SECONDS` (default 120) while it waits, and every other wait stops the VM; command output streams live; `POST /api/vm/:runId/teardown` force-stops (R-CU-09, R-CU-12, R-CU-13, R-CU-06).
- Long commands keep heartbeating; VMs stopped by the hardware TTL show up as leaked cost in the efficiency report; the operator accepts delegated tasks; PROVISIONING/RUNNING/STOPPING statuses reach telemetry with VM seconds (R-CU-16, R-OBS-07, R-APP-12, R-CU-17).

**coding (`Coder`)**
- `GITHUB_TOKEN` + `GITHUB_REPOSITORY` (or a per-tenant KV mapping) for import/push/PR; `BOAT_DEV_API_KEY` for test runs (R-APP-11).
- Branches are `agent/<name>`; `run_tests` runs in a VM on the committed head; `merge_to_main` needs approval AND a passing run on the approved commit (R-CODE-01, R-CODE-03).
- `CoderWorkbench` shows the approval next to a `DiffView` of exactly that commit (R-UI-06).
- Syncing or merging never overwrites uncommitted edits; `GITHUB_REPOSITORY` applies only to tenants in `GITHUB_REPOSITORY_TENANTS` (R-CODE-03).

**voice (`VoiceAssistant`, or `Assistant` when chat is present)**
- LiveKit Cloud project; `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VOICE_AGENT_SECRET` set; tenant `features.voice` on (R-VOICE-02).
- `POST /voice/sessions` returns connection details; the agent claims a `channel:voice` token; the hook switches to voice mode (R-VOICE-03, R-VOICE-05, R-VOICE-09).
- `voice-agent/` builds and is deployed (`lk agent create` or a container); a call is metered per minute and hard-stopped at the cap (R-VOICE-07, R-VOICE-12).
- Calls reserve against a per-tenant daily voice budget with concurrency caps and rate limits; the agent's token only works for its own conversation (R-VOICE-13, R-VOICE-14, R-VOICE-05).
- Open: SIP telephony and egress recording (not in the source spec) and a shared chat+voice budget (R-VOICE-13).

**persistent (`PersistentAgent`, driven by `PersistentAgentControl`)**
- An admin creates the agent with `PUT /api/persistent/:agentId/config` (`expectedVersion: 0`); other sessions get 403; the agent has no HTTP mount and its conversation id is a harness key no user can open (R-PER-01, R-PER-06).
- The heartbeat fires every `heartbeatMinutes` (default 30, minimum 5) with the checklist, defers in quiet hours, runs one turn at a time (skips are recorded) and a quiet tick ends with `HEARTBEAT_OK`; schedules fire by cron; the tool-call cap and the daily budget hold (R-PER-08).
- The agent only proposes changes: narrowing ones apply after auto-review, widening ones (egress, credentials, budget, frequency, skills) wait for the owner in `PersistentAgentPanel`; self-authored skills stay quarantined until approved (R-PER-02, R-PER-12).
- `fetch_url` reaches only the managed allowlist minus the deny list (`pastebin.com`, `webhook.site`, cloud metadata); credentials are injected by the broker for their bound hosts and never appear in model context, results or logs (R-PER-03, R-PER-04).
- Every tool call is auto-reviewed; with no reviewer model, or when the reviewer errors, the call escalates to the owner instead of running (R-PER-05).
- The kill switch stops the alarm, locks render and execution, and survives an unreadable state (treated as killed) (R-PER-07).
- Memory written from untrusted input stays untrusted, is wrapped on recall and expires; snapshots roll back (R-PER-09). The audit log shows every config change and turn to security/admin roles only (R-PER-10).

## 4. Which area checklists to run

| You changed… | Run these checklists |
|---|---|
| A tool, an integration, approvals, firewall rules | tools, security, tenancy, evals |
| An agent's prompt, skills, planning/workflow options | cognition, evals, the module's §3 list |
| `useAgentStarter`, `platform.ts`, models, budgets | models, background, memory, cognition, observability |
| Ingestion routes, queue consumers, crons, the bus | events, background, ops |
| Auth, sessions, OAuth/MCP, webhooks, widget keys | security, tenancy |
| Memory, retrieval, Vectorize/AI Search, workspace | memory, tenancy |
| Rooms, orchestrator, specialists | multi-agent, observability |
| VM provider, browser automation | computer-use, tools |
| Coding agent | coding, memory |
| Voice module, LiveKit routes, voice agent | voice, security, tenancy |
| Persistent agents, control plane, egress, broker, reviewer | persistent, security, tools, memory |
| React package, telemetry contracts, host routes | ui, observability |
| `wrangler.jsonc`, scripts, CI, templates, CLI | ops, evals, modules |
| New generated project | all of them |

## 5. Area checklists (every R-ID lives in exactly one)

- [references/checklist-stack.md](references/checklist-stack.md) — platform & vendor stack (R-STK)
- [references/checklist-models.md](references/checklist-models.md) — models, routing & caching (R-MOD)
- [references/checklist-background.md](references/checklist-background.md) — durable execution, budgets, HITL (R-BG)
- [references/checklist-events.md](references/checklist-events.md) — ingestion & event routing (R-EVT)
- [references/checklist-tenancy.md](references/checklist-tenancy.md) — multi-tenancy & edge config (R-TEN)
- [references/checklist-tools.md](references/checklist-tools.md) — tools, firewall & autonomy (R-TOOL)
- [references/checklist-security.md](references/checklist-security.md) — security & guardrails (R-SEC)
- [references/checklist-memory.md](references/checklist-memory.md) — memory, retrieval & context (R-MEM)
- [references/checklist-cognition.md](references/checklist-cognition.md) — planning & cognition (R-COG)
- [references/checklist-multi-agent.md](references/checklist-multi-agent.md) — multi-agent collaboration (R-MA)
- [references/checklist-computer-use.md](references/checklist-computer-use.md) — boat.dev VMs (R-CU)
- [references/checklist-coding.md](references/checklist-coding.md) — coding agent & workspace (R-CODE)
- [references/checklist-ui.md](references/checklist-ui.md) — UI surfaces & realtime (R-UI)
- [references/checklist-observability.md](references/checklist-observability.md) — observability & analytics (R-OBS)
- [references/checklist-evals.md](references/checklist-evals.md) — evals & testing (R-EVAL)
- [references/checklist-ops.md](references/checklist-ops.md) — deployment & operations (R-OPS)
- [references/checklist-modules.md](references/checklist-modules.md) — starter modules & out-of-the-box parity (R-APP)
- [references/checklist-voice.md](references/checklist-voice.md) — voice / LiveKit (R-VOICE)
- [references/checklist-persistent.md](references/checklist-persistent.md) — persistent agents (R-PER)

Item format: `- [ ] **R-ID** requirement — verify: <command, test, file or behaviour>`. Items ending in
**(GAP — not implemented yet)** or **(PARTIAL)** state what is missing and where to build it; their `verify:` text says
what to check today and what proves the fix. If you close one, update `docs/REQUIREMENTS.md` (status, implementation,
verification) and the checklist line in the same change.

## 6. Report format

```
Definition of done — <change>
Gates: G1 ✓ G2 ✓ G3 ✓ G4 ✓ (dod-all, dod-<module>) G5 offline ✓ / live ✓|skipped (reason) G6 ✓ G7/G8 n/a|✓
Modules checked: <list>
Checklists run: <files> — ticked: <R-IDs>
Open items affected: <R-IDs> (closed | unchanged | worsened — why)
New tests: <files › names>
```

## 7. Pitfalls

- `openai/gpt-6.1-terra` fails with "Unknown model ID" if `registerExtendedModels()` is not at module top level of `src/app.ts`.
- Flue renders the agent before `useAgentStart` runs: security and budget decisions that hide tools must be synchronous at render.
- Flue tool inputs are Valibot; zod schemas go through `toFlueInputSchema` (done for you inside `useAgentStarter`).
- There is no Flue approval API: approvals are pending output + `terminate: true` + a later `tool-approval` signal from
  `createApprovalRoutes`. Replays are safe only through `SqlIdempotencyStore` and `decideWithToken().changed` — keep both.
- `cloudflare:` imports fail under Node: tests pass `sql: () => new NodeSqlStore()` or use `registerCloudflareContext`.
- `vite dev` wants Cloudflare credentials for remote bindings: set `AGENT_STARTER_LOCAL_ONLY=1` offline.
- Vectorize needs the `tenantId` metadata index or tenant-filtered queries fail.
- `@cloudflare/sandbox` 1.0 has no exec: full VMs go through boat.dev (`BoatDevVmProvider`).
- Heartbeats happen only at submission start and response end (R-OPS-08): tools longer than ~180 s risk a false
  "silent deadlock" abort.

## 8. Related skills

`agent-starter` (start here) · `agent-starter-scaffold` (modules, agents, migrations) ·
`agent-starter-tools-and-firewall` · `agent-starter-security` · `agent-starter-memory-and-context` ·
`agent-starter-planning-and-cognition` · `agent-starter-models-and-cost` · `agent-starter-background-jobs` ·
`agent-starter-multi-agent` · `agent-starter-generative-ui` · `agent-starter-computer-use` ·
`agent-starter-coding-agent` · `agent-starter-evals-and-ops` · `agent-starter-voice`
