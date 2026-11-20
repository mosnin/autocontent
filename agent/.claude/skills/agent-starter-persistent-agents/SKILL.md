---
name: agent-starter-persistent-agents
description: Build and operate always-on persistent agents (OpenClaw-style) in an Agent Starter project — the opt-in persistent module, the trusted PersistentAgentControl Durable Object (versioned config, proposals with auto/human review, heartbeat and schedule alarm with quiet hours and single flight, kill switch, append-only audit log, turn summaries, provenance-tagged memory with snapshot and rollback), useAgentStarter({ persistent }) (HEARTBEAT_OK short-circuit, tool-call cap per tick, render and execution lock, auto-review of every tool call that fails closed), the managed egress allowlist and deny list, the credential broker and fetch_url, agent identity and signed agent assertions, quarantined self-authored skills and the PersistentAgentPanel UI. Use when adding or changing a persistent agent, its checklist, schedules, egress, credentials, budget, reviewer or skills, wiring its console, or debugging ticks that never fire, run twice, are skipped or get blocked.
---

# Persistent agents

A persistent agent wakes on its own (heartbeat or named schedule) and acts with no human prompt. The design follows
OpenAI's "Securing persistent agents like OpenClaw" and OWASP Agentic ASI06 (memory poisoning) and ASI10 (rogue
agents): **a trusted control plane decides; the agent is untrusted and can only propose.**

## When to use
Adding the `persistent` module or a new persistent agent, editing its HEARTBEAT checklist, schedules, quiet hours,
egress allowlist, credentials, budget, tool-call cap, reviewer model or skills, embedding its console, or debugging
ticks (not firing, skipped, duplicated, blocked by review or egress).

## Mental model — trusted vs untrusted

```
PersistentAgentControl DO  (TRUSTED, one per agent: `<tenantId>/<agentId>`)
  config vN (zod PersistentAgentConfigSchema) ── proposals ── audit log (append-only) ── turn summaries ── memory
  alarm: next = min(heartbeat, schedules), deferred by quietHours; one turn in flight, else a "skipped" record
     │ dispatch(trigger) hook  (template: src/persistent/dispatch.ts → trackedDispatch)
     ▼  signal heartbeat|schedule {turnId, trigger, configVersion}, idempotencyKey persistent:<turnId>
Flue instance persistent-agent--<t>---agent.<agentId>   (UNTRUSTED, no HTTP mount)
  useAgentStarter({ persistent }) → kill lock (render + every execution), tool-call cap, egress guard + broker,
  auto-review of each call (approve | block | escalate → owner approval), HEARTBEAT_OK ends the turn
     │ tools: propose_config_change, propose_skill, remember, recall_memory, fetch_url   (RPC port: propose / memory only)
     └ onTurnSummary → control.recordTurn (clears in-flight)     reviewer.onDecision → control.recordReview
```

| Concern | Generated project | Library source |
|---|---|---|
| Control plane DO (subclass, `dispatch` + `telemetrySinks` hooks) | `src/persistent/control.ts` (`PersistentAgentControl`, binding `PERSISTENT_CONTROL`) | `packages/cloudflare/src/persistent-control.ts` |
| Control routes | `src/persistent/routes.ts` (`persistentRoutes`) | `packages/cloudflare/src/persistent-control.ts` `createPersistentControlRoutes` |
| Tick → signal glue, initialData | `src/persistent/dispatch.ts` (`dispatchPersistentTurn`, `persistentInitialData`) | `packages/core/src/persistent/heartbeat.ts` (`heartbeatSignal`, `HEARTBEAT_OK`) |
| Instance id, control stub | `src/persistent/instance.ts` (`persistentInstanceId`, `controlStub`) | `packages/core/src/ingestion/events.ts` `persistentAgentInstanceId` |
| Credentials + managed egress from Worker vars | `src/persistent/credentials.ts` (`credentialSources`, `credentialBroker`, `managedEgress`) | `packages/core/src/persistent/credentials.ts`, `egress.ts` |
| No-control-plane port (evals) | `src/persistent/sandbox.ts` (`sandboxControlPort`) | `packages/core/src/persistent/tools.ts` (`PersistentControlPort`) |
| Bindings type | `src/persistent/env.ts` (`PersistentEnv`) | — |
| The agent | `src/agents/persistent.ts` (`PersistentAgent`, identity `persistent-agent`) | `packages/flue/src/use-agent-starter.ts` (`persistent` option) |
| Config schema, proposals, classification | — | `packages/core/src/persistent/config.ts` |
| Auto-reviewer | — | `packages/core/src/persistent/review.ts` (`AutoReviewer`) |
| Identity + agent assertion | — | `packages/core/src/persistent/identity.ts` |
| Memory provenance, snapshots | — | `packages/core/src/persistent/memory.ts` |
| VM env filtering | — | `packages/core/src/persistent/env.ts` (`filterSensitiveEnv`) |
| Runtime skill | `src/skills/persistent-operation/SKILL.md` | — |
| UI | `web/PersistentAgentConsole.tsx` | `packages/react/src/components/PersistentAgentPanel.tsx`, `hooks/use-persistent-agent.ts` |
| Evals | `evals/module-persistent.yaml` | — |

## API reference (from source)

```ts
// @agent-starter/core (packages/core/src/persistent/*)
PersistentAgentConfigSchema   // agentId, name, ownerUserId, heartbeatMinutes (≥5, default 30), heartbeat (markdown),
                              // schedules[{name,cron,prompt}], quietHours?{tz,start,end}, egress{allow,deny},
                              // credentials[{name,hosts}], skills[{name,description,body}] (approved only),
                              // dailyBudgetUsd (5), maxToolCallsPerTick (20), autoReview{enabled,model?}, enabled, version
DEFAULT_PERSISTENT_CONFIG; ConfigPatchSchema; ConfigProposalSchema
classifyProposal(old, next): "auto" | "human"   // widening egress/credentials/budget/frequency, any skill → "human"
createEgressGuard({ managedAllow, managedDeny?, tenantAllow?, agentAllow?, agentDeny?, managedAllowedDomainsOnly? = true })
  → { assertAllowed(url), isAllowed(url), deny };  DEFAULT_DENY; parseHostList(var)
CredentialBroker.fromConfig(bindings, secrets) → resolve(name, url) | allows | scrub | names;  brokeredFetch({ broker, egress })
createGuardedFetchTool({ egress: () => policy, broker?: () => broker })   // fetch_url {url, method GET|POST, body?, credential?};
                                               // MEDIUM, external, untrusted output; the hook mounts it on every persistent agent
new AutoReviewer({ model, modelId?, timeoutMs?, onDecision? }).review(call, context) → { decision, reason, by }
agentIdentity(tenantId, agentId, ownerUserId) → { principal: "agent:<t>/<a>", actingFor: "user:<id>", … }
signAgentAssertion(secret, { identity, audience, ttlSeconds ≤ 300, scope? }) / verifyAgentAssertion(secrets, token, { audience, replay? })
AGENT_ASSERTION_HEADER = "x-agent-assertion"
createPersistentControlTools({ control: (ctx) => PersistentControlPort, principal })
provenanceFor(source, { derivedFromUntrusted? }); renderRecalledMemory; UNTRUSTED_MEMORY_TTL_SECONDS (30 days)
filterSensitiveEnv(env); nextScheduleFire(cron, from, tz?); heartbeatSignal(trigger); HEARTBEAT_OK
persistentAgentInstanceId(tenantId, agentId)

// @agent-starter/flue
useAgentStarter({ ...platform(name, id), persistent: {
  identity, config: value | () => config | Promise<config>,
  killSwitch: () => Promise<boolean>,                    // re-checked live before every execution; a throw = killed
  egress?: EgressPolicy | (config) => EgressPolicy,      // none → nothing allowed (fail closed)
  broker?: CredentialBroker | (config) => CredentialBroker,
  reviewer?: AutoReviewer | (config) => AutoReviewer | undefined,  // none + autoReview.enabled → every call escalates
  onTurnSummary?: (summary: TurnSummary) => Promise<void>,
}})  → ctx.persistent = { config, killed, identity }    // cached in usePersistentState, refetched when configVersion is newer

// @agent-starter/cloudflare
class PersistentAgentControl<Env>  // protected dispatch(trigger), telemetrySinks(), now(); RPC getState, getConfig, putConfig,
                                   // propose, listProposals, decideProposal, disable, enable, isKilled, recordTurn,
                                   // recordReview, readAudit, memoryWrite/Recall/Snapshot/Rollback/Snapshots, kick()
createPersistentControlRoutes<Env>({ namespace, sessionSecrets, adminRoles? = ["admin"], securityRoles? = ["security","admin"], creatorRoles? = adminRoles })

// @agent-starter/react
<PersistentAgentPanel endpoint agentId token canReadAudit? pollMs? />;  usePersistentAgent(options)
```

### Routes (`src/persistent/routes.ts`, all `Authorization: Bearer <session>`; DO = `<session tid>/<agentId>`)
| Route | Who | Result |
|---|---|---|
| `GET /api/persistent/:agentId` | owner (`sub === ownerUserId`) or admin | `{ config, status: { enabled, killed, inFlight, nextTickAt, lastTickAt }, turns }` |
| `PUT …/config` `{ config, expectedVersion }` | creator role for version 0; owner/admin after | 201 created, 200 applied, 202 `{ proposal }` when the change widens access, 409 `VERSION_CONFLICT` |
| `GET …/proposals?status=` · `POST …/proposals/:id/approve\|reject` `{ note? }` | owner or admin | 409 `NOT_PENDING` once decided |
| `POST …/disable` · `POST …/enable` | owner or admin | kill switch |
| `GET …/audit?cursor=&limit=` (≤ 200) | security or admin role | `{ entries, nextCursor? }` |
| `POST …/memory/snapshot` · `POST …/memory/rollback` `{ snapshotId }` · `GET …/memory/snapshots` | owner or admin | memory snapshots |

Errors: 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_CONFIGURED`, 400 `INVALID` (also a malformed agent id).

## Setup (once per project)
1. Scaffold with the module: `pnpm run create my-app --modules chat,persistent` (it adds `PersistentAgent`, the
   `PERSISTENT_CONTROL` DO, the `PersistentAgentControl` migration class and `react`).
2. Platform egress: put the hosts any persistent agent may ever reach in `wrangler.jsonc` `vars.PERSISTENT_EGRESS_ALLOW`
   (empty = no outbound fetches). Extra denials: `PERSISTENT_EGRESS_DENY`.
3. Credentials: map credential names to Worker secrets in `src/persistent/credentials.ts` (template: `github` →
   `GITHUB_TOKEN` on `api.github.com`; `saas` → `SAAS_SERVICE_TOKEN` on the `PRIMARY_SAAS_API_URL` host).
4. Secrets: `npx wrangler secret put PERSISTENT_ASSERTION_SECRET` (signs agent assertions to your SaaS).
5. Reviewer model (optional): `PERSISTENT_REVIEW_MODEL` (a Workers AI id); default the first-line model.
6. Create an agent as a tenant admin: `PUT /api/persistent/<agentId>/config` with `{ config: { agentId, name, ownerUserId, heartbeat }, expectedVersion: 0 }`
   (`createPersistentAgent` in `web/PersistentAgentConsole.tsx`). The alarm arms itself; the first tick follows `heartbeatMinutes`.
7. UI: render `PersistentAgentConsole` with the owner's session token; pass `roles` so security staff see the audit log.

## Recipes

**Write a good HEARTBEAT checklist.** One line per check, each with the condition that makes it actionable
("If an invoice is overdue more than 7 days, draft a reminder for approval"). Say what to ignore. The agent answers
`HEARTBEAT_OK` when nothing applies, so a quiet tick costs one short model call.

**Add a schedule.** `schedules: [{ name: "daily-digest", cron: "0 8 * * 1-5", prompt: "Send the owner a digest of yesterday's activity." }]`
with `quietHours: { tz: "Europe/Berlin", start: "22:00", end: "07:00" }`. A schedule that fires more often than the
current one is a widening change → human approval.

**A tool that calls an external API.** Use `ctx.services.fetch` (a `BrokeredFetch` from `@agent-starter/core`:
brokered + egress-guarded) and name a credential; never global `fetch`, never a token in args. Often `fetch_url` is enough:
```ts
defineAgentTool({
  name: "list_open_issues", description: "List open GitHub issues of the configured repository.",
  input: v.object({ repo: v.pipe(v.string(), v.regex(/^[\w.-]+\/[\w.-]+$/)) }),
  risk: "LOW", sideEffect: "read", outputTrust: "untrusted",
  execute: async ({ repo }, ctx) => {
    const fetch = ctx.services.fetch as BrokeredFetch;   // brokered + egress-guarded, set by useAgentStarter({ persistent })
    return (await fetch(`https://api.github.com/repos/${repo}/issues?state=open`, { credential: "github" })).json();
  },
});
```
The host must be on `PERSISTENT_EGRESS_ALLOW`, on the agent's `egress.allow` (when set) and bound to `github`.

**Call your SaaS as the agent.** Sign an assertion and send it with the service credential:
`headers: { [AGENT_ASSERTION_HEADER]: await signAgentAssertion(env.PERSISTENT_ASSERTION_SECRET, { identity: ctx.persistent.identity, audience: "saas" }) }`.
The SaaS verifies with `verifyAgentAssertion(secrets, token, { audience: "saas", replay })` and records "agent acting for user".

**Run VM commands from a persistent agent.** Pass `filterSensitiveEnv(env)` as the VM environment so `GH_TOKEN`,
`*_TOKEN`, `*_SECRET`, `*_KEY` and `*PASSWORD*` never reach the sandbox. Code runs only in codemode (`globalOutbound: null`) or a boat.dev VM.

**Roll back poisoned memory.** `POST …/memory/snapshot` before risky work; `POST …/memory/rollback { snapshotId }`
restores it. Untrusted entries expire after 30 days anyway.

## Checklist
Core tests are `packages/core/test/persistent.test.ts`, control plane `packages/cloudflare/test/persistent-control.test.ts`,
hook `packages/flue/test/hook-persistent.test.ts`, template `test/persistent.test.ts`, UI `packages/react/test/persistent.test.tsx`.
- [ ] The agent can only propose; widening changes (egress, credentials, budget, schedule frequency, any skill) need a human; identity, owner, `enabled` and `version` are never proposable. Verify: core "classifies widening proposals as human and narrowing/text ones as auto", "never lets a patch change identity, owner, enabled or version"; core "only propose (source agent) and store agent memory as untrusted".
- [ ] Every config change is versioned and audited; widening owner edits come back 202 as proposals; stale versions 409. Verify: control "creates a versioned config, applies low-risk changes and parks widening ones as proposals", "returns 202 proposals for widening edits, 409 on stale versions, and approves them".
- [ ] Self-authored skills are quarantined until a human approves; low-risk agent proposals apply after auto-review. Verify: control "applies an agent's low-risk proposal after auto-review and quarantines a self-authored skill".
- [ ] Egress: default deny list and private hosts always refused, tenant/agent lists only narrow, every redirect hop checked, URL arguments of any tool checked. Verify: core "denies the default deny list and private hosts on top of the allowlist", "lets tenant and agent lists only narrow the managed allowlist", "checks every redirect hop"; hook "caps tool calls per tick and blocks URL arguments outside the egress policy"; template "builds a managed allowlist the agent can only narrow, with the default deny list on top".
- [ ] Credential broker: header only for bound hosts over https, stripped on cross-host redirects, scrubbed from output; config bindings narrow the platform map. Verify: core "injects the header only for bound hosts and never for unknown names or http", "drops caller credential headers and strips the credential on redirect to another host", "fetches only allowlisted hosts, injects the brokered credential and scrubs it from output"; template "injects a credential only for hosts both the platform and the agent's config bind it to".
- [ ] Auto-review before every call, secrets never shown to the reviewer, fail closed (escalate), HIGH still needs a human. Verify: core "returns the model's verdict and never shows secrets to the reviewer", "fails closed: no model, errors and garbage all escalate", "blocks, escalates to approval, or lets approved LOW calls run (HIGH still needs a human)", "treats a throwing reviewer as escalate and skips review for an already approved call"; hook "auto-reviews every call: approve runs, block denies, escalate parks for a human".
- [ ] Kill switch locks execution live and render on the next tick, an unreadable switch counts as killed, the alarm stops. Verify: hook "locks execution when the kill switch flips mid-turn, then locks render on the next tick", "treats an unreadable kill switch as disabled"; control "the kill switch stops dispatch and the alarm; a lost turn is cleared after the stale window"; UI "disables the agent only after confirmation, then offers re-enable".
- [ ] Ticks: heartbeat with checklist and identity, single flight with skip records, schedules, quiet hours, daily budget stop, failed dispatch recorded. Verify: control "dispatches a heartbeat with the checklist and identity, then single-flights and records skips", "fires named schedules, defers during quiet hours and stops on the daily budget", "records a failed dispatch as an error turn and clears in-flight"; core "computes the next fire with steps, lists, day-of-week and time zones", "defers ticks inside quiet hours, including windows that span midnight".
- [ ] The template dispatch is a server-only signal, idempotent per turn id, as the agent's own principal. Verify: template "turns a heartbeat tick into one server-only signal, idempotent per turn, as the agent's own principal", "labels schedule ticks with their name".
- [ ] `HEARTBEAT_OK` ends the turn cheaply and is delivered nowhere; `maxToolCallsPerTick` enforced. Verify: hook "handles a heartbeat: HEARTBEAT_OK ends the turn cheaply and reports a summary", "caps tool calls per tick…"; evals `evals/module-persistent.yaml` "Heartbeat: nothing needs doing, so the reply is exactly HEARTBEAT_OK".
- [ ] Identity: own principal, harness instance id no user owns, initialData no client can seed, assertions ≤ 5 min with single-use `jti`. Verify: core "separates the agent principal from the owner and round-trips a signed assertion", "rejects the wrong audience, expiry, tampering and replays", "names the persistent agent's conversation with a harness key no user can own"; template "a client request through agentAuth can neither open the agent's instance nor seed `persistent` in initialData".
- [ ] Memory provenance: only the owner is trusted, agent output never promoted, untrusted entries wrapped and expiring, snapshot and rollback. Verify: core "trusts only the owner, never promotes agent output, and expires untrusted entries", "snapshots and rolls back", "records provenance on vector memory and wraps untrusted recalls"; control "keeps a redacted, paginated audit log and provenance memory with rollback".
- [ ] Sensitive env vars never reach VMs. Verify: core "filters sensitive env vars before VM commands".
- [ ] Routes: session required, DO from the session tenant, creator role to create, owner/admin to manage, security role for the audit log. Verify: control "requires a session (401), a creator role to create (403) and owner/admin to manage", "restricts the audit log to security roles and serves kill switch and memory routes"; template "require a session token and derive the control plane from the session's tenant".
- [ ] Owner console: status, next tick, turns with review decisions, proposals approve/reject with a note, paginated audit for security roles only. Verify: UI "shows status, next tick, limits, recent turns with review decisions and pending proposals", "approves proposals with a note and surfaces a refused decision", "shows the paginated audit log to security roles and 'restricted' on 403".
- [ ] The module composes alone and with every other module. Verify: `packages/create-agent-starter/test/compose.test.ts` "wires the persistent module: control DO, routes, no HTTP mount for the agent, egress vars and its eval suite".

## Pitfalls
- **Never give the agent a tool that writes config.** Its only path is `propose_config_change` / `propose_skill`;
  the control plane's RPC port has no setter for the agent.
- **Never use global `fetch` in a persistent agent's tools.** Use `ctx.services.fetch`; the policy hook also checks
  any `url`-like argument, but a tool that fetches by itself bypasses the broker.
- **An empty `PERSISTENT_EGRESS_ALLOW` means no outbound calls**, not "anything goes" (`managedAllowedDomainsOnly`).
- **Do not mount the agent over HTTP.** Its initialData (`persistent`) is only set by the control plane's dispatch;
  `agentAuth` drops client-supplied initialData, and the instance id is a harness key no user owns.
- **Config at render is the cached copy** (`ctx.persistent.config`); a newly approved skill mounts on the next tick
  (the signal's `configVersion` triggers the refetch).
- **The owner is part of the instance seed.** `initialData.persistent.ownerUserId` is recorded once, at the first
  dispatch, and the template builds the identity (and the approver) from it. Changing `ownerUserId` in the config
  (admin only) does not re-seed a running instance: create a new `agentId` for a new owner.
- **Approvals are bound to the owner** (`approvals({ bindToRecipient: true, approverId })`): the agent never sees links.

## Verify
```bash
pnpm --filter @agent-starter/core test && pnpm --filter @agent-starter/flue test && pnpm --filter @agent-starter/cloudflare test
pnpm --filter @agent-starter/react test            # persistent.test.tsx
pnpm --filter create-agent-starter test            # composes --modules persistent alone
# generated project
pnpm typecheck && pnpm typecheck:web && pnpm test && pnpm evals
```

## Deliberate deviations
- The agent assertion is a compact HMAC token mirroring RFC 8693 `act` and the WAG/XAA drafts, a stand-in until
  those drafts settle; swap in an asymmetric signer when the SaaS must verify without a shared secret.
- Self-authored skills are stored in the config (approved only) and mounted as inline Flue skills, not written to R2.
- The eval harness runs the agent without a control plane (sandbox port: nothing stored, no egress, no credentials).

## Related skills
`agent-starter` (architecture), `agent-starter-security` (tenancy, egress, secrets, injection),
`agent-starter-tools-and-firewall` (tool contracts, approvals, policy hook), `agent-starter-memory-and-context`
(memory), `agent-starter-background-jobs` (dispatch, run registry, sentinel), `agent-starter-generative-ui` (React
panels), `agent-starter-computer-use` (VMs), `agent-starter-scaffold` (adding the module), `agent-starter-definition-of-done`.
