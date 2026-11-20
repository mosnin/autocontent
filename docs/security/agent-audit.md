# Agent harness: security and reliability audit

Scope: `agent/` (Cloudflare Workers + Flue, built on agent-starter). Audited against the `agent-starter-security`
skill and the definition-of-done checklists. Date: 2026-11-18.

Not in scope, and only noted where they touch this audit: `agent/src/marketer/decisions/**`,
`agent/src/marketer/memory/**`, `agent/src/skills/**` (owned by other work streams), `agent/vendor/**` (read, never
edited), `backend/`, `src/`, `web/`.

## Summary

No finding lets one tenant read or change another tenant's data. The generated starter layer (session tokens,
`agentAuth`, conversation ids, ingestion, approvals) holds up. The findings are in the Marketer-specific code on top
of it: how the API client behaves when the backend misbehaves, and four places where an agent or a mailbox could act
with more authority than it should have.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | HIGH | A write that got no answer could be retried or re-issued: MEDIUM makers were retried by the executor and reported as a plain failure | fixed |
| 2 | HIGH | Unbound approval links were mailed to the shared ops inbox | fixed |
| 3 | MEDIUM | A department acted on a bus message or room turn with its full autonomy | fixed |
| 4 | MEDIUM | The autopilot's platform-side reads skipped the egress policy and could carry the service token across a redirect | fixed |
| 5 | MEDIUM | The API client followed redirects with the service token and accepted plain http to any host | fixed |
| 6 | MEDIUM | No timeout, breaker or backoff of its own in the API client: a dead backend burned the run's budget | fixed |
| 7 | MEDIUM | Five of six departments had no per-run call quota: a maker loop spends credits, not model budget | fixed |
| 8 | MEDIUM | Writes over MCP had no budget, quota or dedupe that outlives one request | fixed |
| 9 | MEDIUM | Backend error text reached the model outside `<untrusted_content>` | fixed |
| 10 | MEDIUM | Errors were not typed: denied, needs approval, unknown outcome and unavailable looked alike | fixed |
| 11 | LOW | A write tool would send without an idempotency key if the context had none | fixed |
| 12 | LOW | The rails kill switch was not in the env typing or `wrangler.jsonc` | fixed |
| 13 | LOW | Memory-store writes send an idempotency key only when the caller passes one | open (memory stream) |
| 14 | LOW | The decision log posts to the backend outside the API client | open (decisions stream) |
| 15 | LOW | The account owner has no working way to decide a department's approval | open (needs a decision) |
| 16 | LOW | Session tokens have no maximum lifetime on the verifying side | open |
| 17 | LOW | The room live feed takes the session token in the query string | open |
| 18 | LOW | Replay cache, rate limits and job pointers sit on eventually consistent KV | open (known starter gap) |
| 19 | LOW | A dead letter that cannot be parked three times is dropped | open |
| 20 | LOW | API response bodies are not size-capped before parsing | open |
| 21 | LOW | An operator's resume note is spliced into the signal body unwrapped | open |
| 22 | INFO | `wrangler.jsonc` ships localhost origins and KV placeholders | deploy preflight |

## Findings

### 1. HIGH. An unanswered write could run twice (fixed)

`writeTool` set `retry: { maxAttempts: 1 }` only for HIGH and CRITICAL tools. A MEDIUM write marked `idempotent`
(`pause_campaign`, `update_playbook`, ...) was retried up to three times by the executor. A MEDIUM maker that is not
idempotent (`create_video`, `create_article`, `remix_template`: each spends content credits) was sent once, but a
timeout or a 5xx came back to the model as a plain `HTTP_ERROR` or `TIMEOUT`. Nothing told the model the request may
have landed, so the natural next step was to call the maker again with a new call id. The backend does not dedupe on
`idempotency-key`, so that is a second spend.

Fix:
- `agent/src/marketer/tools/define.ts`: every write, at every tier, has `retry: { maxAttempts: 1 }`.
- `agent/src/marketer/api.ts`: a write is sent once. No answer (timeout, dropped connection, aborted run) raises
  `MarketerOutcomeUnknownError`; a 5xx raises a `MarketerApiError` of kind `outcome_unknown`. Both lead with
  `OUTCOME_UNKNOWN:` and tell the model not to call again.
- `MarketerOutcomeUnknownError` is deliberately not an `AgentError`, the same rule as the rails'
  `IndeterminateOutcomeError`, so the harness ledger records UNKNOWN and a replay returns `UNKNOWN_OUTCOME`.

Tests: `test/marketer-reliability.test.ts` › "never retries a write: not on 5xx, not on a network error, not on 429",
"a MEDIUM maker whose request got no answer is OUTCOME_UNKNOWN, sent once, and never replayed", "a MEDIUM maker is not
retried on a 5xx"; `test/marketer-rails.test.ts` › "never retries a write automatically, at any tier".

### 2. HIGH. Unbound approval links were mailed to the ops inbox (fixed)

`approvals()` in `agent/src/lib/platform.ts` always passed the notifier, with `OPS_ALERT_EMAIL` as the recipient. For
the chat agents (Marketer, the copilot, the orchestrator) approval links are not recipient-bound: whoever holds the
link decides. With SendRaven configured, every such link (for example the copilot's `decide_inbox_item`, which
publishes) was also mailed to the shared ops inbox. Anyone with that mailbox could approve a publish for any account.

Fix: `outOfBandApprovalNotifier` in `agent/src/lib/policy.ts`. Only recipient-bound links are mailed; they work only
in the approver's own session. Unbound links stay in the signed-in user's stream.

Tests: `test/agent-guards.test.ts` › "approval links out of band" (three cases).

### 3. MEDIUM. A department acted on a bus message with full autonomy (fixed)

`delegationPolicy` narrows a department's tools only while it works on a delegated task. In a bus conversation or a
room there is no assignment, so every department tool was allowed and MEDIUM makers ran without a person. The pipeline
worker reads webhook text written partly by third parties (titles, platform errors) and holds `send_agent_message`.
It is designed to "read and report, never act", but a poisoned event could make it post a message to the content
producer, which could then spend credits. Two models have to be fooled, and HIGH/CRITICAL calls still parked.

Fix: `departmentAutonomyCap` in `agent/src/multi-agent/roster.ts`, used by `agent/src/agents/specialists.ts`. Only a
delegated task (`-dlg.` harness key) keeps the department's own ceiling. In a bus conversation, a room, or any id
that does not parse, nothing above LOW runs without the account owner's approval. Reads stay free, and replying over
the bus stays autonomous where it already was.

Tests: `test/agent-guards.test.ts` › "a department acts on its own only inside a delegated task" (five cases).

### 4. MEDIUM. The autopilot's platform-side reads skipped egress (fixed)

`agent/src/agents/persistent.ts` built its own fetch for decision point 12: it resolved the `saas` credential from the
broker and called the global `fetch`. That skipped the egress allowlist and followed redirects with the header set.

Fix: `platformBrokeredFetch` in `agent/src/persistent/credentials.ts` uses core `brokeredFetch`: egress policy on
every hop, the credential only for bound hosts and dropped on a redirect to any other host, a hard timeout.

Tests: `test/persistent.test.ts` › "platform-side reads for a persistent agent (decision point 12)" (five cases).

### 5. MEDIUM. Redirects and plain http with the service token (fixed)

The service token acts as any user (`x-tenant-id` chooses which). `marketerApi` used the default redirect mode and
accepted any `http://` base URL.

Fix in `agent/src/marketer/api.ts`: `redirect: "manual"` on the direct path (a 3xx is `NOT_CONFIGURED`), and
`isSafeApiOrigin`: https always; http only for loopback, single-label service names, `.local` / `.internal` and
private IPv4 ranges; no credentials in the URL.

Tests: `test/marketer-reliability.test.ts` › "transport safety".

### 6. MEDIUM. No timeout, breaker or backoff in the client (fixed)

The client relied on the caller's signal. Callers outside the executor had none, and a transport that ignores the
abort signal could hang. With the backend down, every tool call waited out its full timeout and the model moved to the
next tool. See "Reliability" below for what was built.

### 7. MEDIUM. No per-run call quota for five departments (fixed)

Only the media buyer and the pipeline worker had firewall quotas. The model budget (turns, inference dollars) does not
bound content credits: a stuck loop could start a maker on every turn, several per turn.

Fix: `DEPARTMENT_FIREWALL` in `agent/src/marketer/tools/index.ts` (10 calls per tool, 40 in total, per conversation,
durable counters), applied to every department in `specialists.ts`. The backend's spend caps stay the last wall.

Tests: `test/agent-guards.test.ts` › "per-run quotas for every department".

### 8. MEDIUM. Writes over MCP were unmetered (fixed)

An MCP call has no BudgetGuard, its firewall is rebuilt per request, and tool-call ids are random, so the ledger
cannot dedupe a client's retry. MEDIUM makers were exposed.

Fix: `agent/src/in-app/mcp-guard.ts`. Writes are metered per tenant in `AGENT_CACHE` (burst 5, 20 per hour). The
limiter fails closed: if it cannot be read, the write is not sent. Tools that need approval stay unexposed.

Tests: `test/agent-guards.test.ts` › "MCP guard" (seven cases).

The limit is a judgement call. See "Needs a decision".

### 9. MEDIUM. Backend error text reached the model as instructions-capable text (fixed)

Tool output is wrapped as untrusted; tool errors are not. The backend's `detail` can echo a platform error or a title.

Fix: `MarketerApiError` puts the detail on its own lines inside `<untrusted_content source="marketer-api-error">`,
one line, at most 300 characters, delimiters neutralised.

Test: `test/marketer-reliability.test.ts` › "keeps the backend's reason as data".

### 10. MEDIUM. Untyped errors (fixed)

See "Error taxonomy" below.

### 11 and 12. LOW (fixed)

- `writeTool` refuses to send without `ctx.idempotencyKey` (`MarketerNotSentError`). One test per write tool.
- `MARKETER_RAILS_KILL_SWITCH` is typed in `agent/src/env.ts` and listed (empty) in `wrangler.jsonc` `vars`.

### Open findings

- **13.** `agent/src/marketer/memory/store.ts` passes an idempotency key only when its caller supplies one. The
  client stays permissive for direct callers; the tools refuse. The memory stream should always pass one.
- **14.** `agent/src/marketer/decisions/log.ts` posts to the backend with the service token and its own `fetch` (it
  has a 3 s timeout and takes the tenant from the entry). It should go through `marketerApi`.
- **15.** Department approvals are bound to the owner, but the mail goes to `OPS_ALERT_EMAIL`, the owner's stream has
  no links, and decide-by-id needs an `admin` or `operator` role while the web app mints `owner`. This fails closed,
  but as far as I can tell an owner cannot approve a department's HIGH call today. I did not change the role list.
- **16.** `verifySessionToken` accepts any `exp`. The web app mints one hour. A verifier-side cap would need a wrapper.
- **17.** `GET /api/rooms/:id/live?token=` puts the session token in a URL (logs, history).
- **18.** Known starter gap; strict once-only needs a Durable Object.
- **19.** The DLQ consumer retries a failed R2 write with `max_retries: 3`, then the message is gone.
- **20.** `response.text()` is unbounded; the executor truncates what the model sees, not what is read.
- **21.** `POST /api/jobs/:id/resume` takes an operator's note. Operator-only, own tenant.
- **22.** `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS` and three KV ids must be set before a deploy (`scripts/deploy.sh`
  refuses otherwise).

## What was checked and found sound

**Tenancy**
- Every `createAgentRouter` mount sits behind `agentAuth`. Dispatch-only agents have no mount.
- Conversation ownership is exact (`isConversationOwner`); cross-tenant and cross-user requests get 403
  (`test/security.test.ts`).
- Session tokens: HMAC, expiring, rotatable; restricted audiences fail closed. Empty secrets in a rotation list are
  skipped by the verifier, so `SESSION_SIGNING_SECRET_PREVIOUS ?? ""` is harmless.
- Harness session keys (`-dlg.`, `-room.`, `-job.`, `-bus.`, `-agent.`) can never be a user's conversation.
- Storage: artifacts and shadow diffs go through `TenantScopedBlobStore`; dead letters under
  `dlq/agent-events/<tenant>/`; vectors through `VectorMemory`; the control plane is named `<session tid>/<agentId>`;
  rooms `room--<tenant>--`. The run registry is one global object, and its routes check the tenant in the job id.

**Tools**
- Every tool is `defineAgentTool`, through `readTool` / `writeTool` or directly. No `useTool`, no raw MCP connection.
- `test/marketer-rails.test.ts` pins that `RAILS_TOOLS` covers exactly the HIGH and CRITICAL tools at the same
  tiers, and that every CRITICAL tool sets `requiresApproval`.
- The only tool path to the backend is `marketerApi`; the tenant header comes from `ctx.tenant` only.
- Read and write tool output is marked untrusted.

**Prompt injection**
- No agent turns off the security lock, the safety fallback or the injection screen.
- Every live agent loads the `untrusted-content` runtime skill. The pipeline worker and the orchestrator did not
  (the hook's built-in untrusted-content policy and the job skill covered them); both load it now.
- Web tools and Browser Rendering use the one core SSRF guard. Webhook payloads reach the model through `renderTurn`.
- No tool input carries a tenant; `assertPayloadTenant` denies one that differs.

**Webhooks and background jobs**
- Signed over method + path + body, or the tenant's own endpoint secret for body-only schemes (Stripe, Marketer).
- Nonces and event ids come from signed data. Tenant rate limits at the edge and in the consumer.
- Poison messages are acked and logged; both queues have a DLQ with a consumer.

**The autopilot**
- Kill switch read live, unreadable means killed. Egress empty by default. Credentials only through the broker.
- Tool-call cap per tick from the config. The reviewer escalates on error; the decision model can only tighten.
- Its only acting tool always waits for the owner.

**Secrets**
- Nothing secret in `wrangler.jsonc` `vars`. `.dev.vars.example` has empty values. `.dev.vars` is gitignored.

**Observability (Braintrust, `agent/src/lib/braintrust/`)**
- Off unless `BRAINTRUST_API_KEY` (secret) and `BRAINTRUST_PROJECT_ID` are set; the key stays in the Worker and CI, never
  in a response or a log line (failure logs carry our own HTTP status text only).
- Every exported span goes through one masking function (`mask.ts`): secrets, emails, phones, cards, IPs; secret-named
  attributes and JSON keys dropped; personal memory (recall, notes, private entity graph, retrieval) cut out and the
  memory tools' input and output replaced. `metadata` mode is an allowlist. Pinned in `test/braintrust.test.ts`.
- Export runs under `waitUntil` with a timeout and never throws into the run.
- `POST /api/marketer/feedback`: session token, `agent:chat`, the caller's own conversation in their own tenant, a run
  span recorded for that conversation, a per-person rate limit; the browser never holds the Braintrust key.

**Budget**
- Tenant limits are clamped by the platform ceilings (`applyPlatformPolicy`) for every agent.

## Reliability

All of it lives in `agent/src/marketer/api.ts`, `errors.ts` and `resilience.ts`.

| Concern | Behaviour |
|---|---|
| Timeouts | Every request has one, enforced by the client's own timer and race, body included. Reads: 10 s per attempt inside a 20 s deadline. Writes: one attempt, 25 s. Tools pass their own, 2 s under the executor's timeout, so the model reads the typed error. |
| Retries | GET only. At most 3 attempts, exponential backoff with full jitter (250 ms base, 2 s cap), a Retry-After up to 5 s honoured, never past the deadline. The executor's own retry is off for these tools, so the two never multiply. |
| Writes | Never retried. |
| Breaker | Per API origin, per isolate. Opens after 5 consecutive failures (5xx, timeout, network) for 30 s. Then one read probes; a failed probe doubles the cooldown, capped at 5 minutes. Writes are sent only while it is closed. A 4xx, or the backend's own 502 `outcome_unknown`, counts as "up". |
| Rate limits | A 429 with Retry-After pauses the origin until then, capped at 60 s. |
| Idempotency key | Every write tool sends the call's key and refuses to send without one. |

### Error taxonomy

The text the model reads starts with the tag.

| Tag | When | Definite (may run again)? |
|---|---|---|
| `DENIED` | 401, 403, 402 (spend cap, kill switch) | yes |
| `NEEDS_APPROVAL` | 409 `approval_*` from the backend rails | yes |
| `OUTCOME_UNKNOWN` | a write with no answer, a write that got 5xx or 408, 409 `outcome_unknown` | no, except the 409 |
| `TEMPORARILY_UNAVAILABLE` | reads that got 5xx, 429, a timeout or no connection; breaker open; rate-limit pause | yes (nothing was sent, or it was a read) |
| `NOT_FOUND`, `CONFLICT`, `INVALID_INPUT` | 404, other 409, other 4xx | yes |
| `NOT_CONFIGURED` | missing or unsafe `PRIMARY_SAAS_API_URL`, a redirect, no idempotency key | yes |

The harness's own "needs approval" (`PENDING_APPROVAL`, the turn ends) is unchanged.

One deliberate choice: a write that gets 503 `rails_unavailable` is filed as `OUTCOME_UNKNOWN`, although the backend
says it refused before acting. `docs/rails/failure-semantics.md` treats every 5xx on a write as unknown, and I kept
that rule instead of trusting a detail string.

## Needs a decision

1. **Owner approvals (finding 15).** Either add `owner` to `operatorRoles` on `createApprovalRoutes` so the web app
   can decide by id, or route the bound mail to the owner. Until then department HIGH/CRITICAL calls park and stay
   parked.
2. **MCP write limit (finding 8).** Burst 5, 20 per hour per account is my guess at a safe default. The alternative
   is read-only MCP.
3. **Bus and room autonomy (finding 3).** A department now asks the owner before any MEDIUM call that starts from a
   bus message. If departments are meant to chain makers on their own over the bus, that needs a grant mechanism
   instead of a lower bar.

## Not verified here

- Live evals (`pnpm evals`): no model key in this environment.
- Deploy and canary.
- A real round trip through a model. The local smoke run covered `/health`, 401 without a token, 400 on a malformed
  approval token, 401 on `/mcp` and 403 on `/api/jobs/x` in workerd.
- Whether workerd strips `Authorization` on a cross-origin redirect. The fix does not depend on it.
