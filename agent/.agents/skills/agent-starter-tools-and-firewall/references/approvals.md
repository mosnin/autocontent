# Human-in-the-loop approvals, end to end

The flow is spread across these files:
- `packages/core/src/autonomy/gateway.ts`: the decision.
- `packages/core/src/autonomy/approvals.ts`: the ledger and tokens.
- `packages/core/src/tools/executor.ts`: `authorize()`, `pendingText()`.
- `packages/flue/src/use-agent-starter.ts`: `onApprovalRequested` and the `tool-approval` handler in `useAgentStart`.
- `packages/flue/src/http.ts`: `createApprovalRoutes`.
- `src/lib/platform.ts`: `approvals()`, `notifier()`.
- `@agent-starter/react`: `useApprovals`, `HumanOversightCard`. See `agent-starter-generative-ui`.

## 0. Configuration (`AgentStarterOptions.approvals`)
```ts
approvals: {
  secret: () => string | string[];      // APPROVAL_SIGNING_SECRET ([new, old] while rotating: first signs, any verifies)
  baseUrl: () => string;                // PUBLIC_BASE_URL; links are `${baseUrl}/approvals/<token>`
  notifier?: () => Notifier | undefined;   // SendRavenNotifier in platform.ts (undefined → UI-only approvals)
  recipient?: (tenant) => string | undefined; // who gets the email (platform.ts: OPS_ALERT_EMAIL)
  bindToRecipient?: boolean;            // bind tokens to the approver; no links in the requester's stream (SEC-17)
  approverId?: (tenant) => string | undefined; // session `sub` bound into tokens (default: recipient)
}
```
Chat agents leave `bindToRecipient` off: the user is the human in the loop and decides on the in-app card.
Background jobs (and any agent where someone else decides) turn it on.
Without `approvals`, the executor still returns `approval_required`, with id `apr_<toolCallId>`. No row,
link or email is created, so nothing can approve it. **Always configure approvals for agents with HIGH or
CRITICAL tools.** `platform()` does this for you.

## 1. Interrupt
1. Before any side effect, `ToolExecutor.authorize()` looks up the approval for this exact call: `(runId, toolCallId, tool, argsHash)` via `ApprovalStore.findMatching` (SEC-10). An empty `toolCallId` is replaced by a random id first, so it never matches another call's approval:
   - `APPROVED`: run the tool.
   - `REJECTED` or `EXPIRED`: deny, with `APPROVAL_REJECTED`.
   - `PENDING_APPROVAL`: return the same pending result again.
2. Otherwise the gateway decides. `require_approval` carries one of these reasons:
   - `EXPLICIT_HIGH_RISK_GATEWAY_TRIGGERED`: the tier is `HIGH`/`CRITICAL`;
   - `TOOL_REQUIRES_CONSENT`: the tool sets `requiresApproval`;
   - `LOW_MODEL_CONFIDENCE_INTERCEPT`: confidence is below the threshold;
   - `ABOVE_TENANT_AUTONOMY_CEILING`: the tier is above the tenant's autonomy ceiling.
3. `ApprovalStore.create()` inserts an `as_approvals` row with these fields:
   - `id = apr_…`, `status PENDING_APPROVAL`;
   - `args_json`, `args_hash`;
   - a random `nonce`;
   - `expires_at = now + ttlMs`. `useAgentStarter` passes no `ttlMs`, so it is always 72 h.
4. `links()` returns `approveToken` and `rejectToken`:
   - format: `base64url(JSON{aid,tid,rid,d,exp,n,r?}).base64url(HMAC-SHA256)`;
   - one token per decision; `r` (the bound approver) is set when `bindToRecipient` is on.
5. `onApprovalRequested(record, links)` runs inside `useAgentStarter`. It:
   - writes the `approval` data part `{ approvalId, tool, riskTier, reason, args, approveUrl, rejectUrl, status: "PENDING_APPROVAL" }`, which the in-app oversight card renders. With `bindToRecipient`, or for a `visitor` identity, the part has no URLs (`sentToApprover: true`): the requester cannot approve their own call;
   - when both a notifier and a recipient exist, calls `notifier.notify({ tenantId, to, subject, text, threadKey: "approvals:<runId>", actions: [Approve, Reject], idempotencyKey: "approval-notify:<approvalId>" })`.
6. The tool outcome is `approval_required`. The model receives `{"status":"PENDING_APPROVAL","approvalId":…,"message":"… Do not retry it …"}` with `terminate: true`.
7. Telemetry emits event `type: "approval"`, `status: "PENDING_APPROVAL"`, with `data.approvalId` and `data.conversationId` (enough to decide by id, below). The relay and Pusher sinks deliver it to the SaaS dashboard.

## 2. Waiting
The agent conversation is a Durable Object. After the turn ends it hibernates, and no compute runs while it
waits. The state that matters lives in its SQLite: the approval row and the transcript.

## 3. Decision (public routes, `createApprovalRoutes({ agents, secret, appName })`, mounted at `/`)
- `GET /approvals/:token`:
  - `verifyApprovalToken` checks the signature, expiry and decision;
  - renders a confirmation page with a `<form method="post">`;
  - **never mutates**, because mail scanners and link previews fetch GET URLs;
  - an invalid or expired token gets an HTML 400.
- `POST /approvals/:token`:
  1. Verifies the token.
  2. `parseAgentInstanceId(payload.rid)` gives the agent name, which is looked up in `agents`. A missing agent gets 404 `AGENT_NOT_FOUND`.
  3. Calls `dispatch(agent, { id: rid, message: { kind: "signal", type: "tool-approval", body, attributes: { token, approver, decision } }, idempotencyKey: "approval:<aid>:<decision>" })`.
  4. Answers 202: HTML, or JSON when `Accept: application/json`, which is how the React card calls it.
- `approver` is the signed-in user (`sub`) when the request carries a valid session for the token's tenant (`sessionSecret`), else `"approval-link"`. A recipient-bound token (`r`) requires that exact signed-in user (403 `APPROVER_MISMATCH` otherwise). Client headers are never trusted.
- `POST /approvals/by-id/:conversationId/:approvalId`, body `{ decision: "approve" | "reject", note? }` (operators; the route needs `sessionSecret`):
  1. The session (Bearer; or the `agent_session` cookie, same origin and `application/json` only) must carry a role from `operatorRoles` (default `["admin", "operator"]`): 401 `UNAUTHORIZED` / 403 `FORBIDDEN`.
  2. `parseAgentInstanceId(conversationId)` must name the session's tenant (403) and a listed agent (404). `approvalId` must look like an id and `decision` must be valid (400).
  3. `createOperatorDecisionToken(secret, { approvalId, tenantId, conversationId, decision, approverId: sub })` mints a token with `r = sub`, `k: "operator"` and a 10-minute expiry.
  4. The same `tool-approval` signal is dispatched with the same idempotency key `approval:<aid>:<decision>` (409 `ALREADY_DECIDED` on a conflict) and the route answers 202 JSON `{ ok, decision, approvalId, conversationId, decidedBy, status }`.
  In the agent, `decideWithToken` accepts an operator token without the record nonce (the route cannot read the agent's SQLite), only for the matching approval id, tenant and conversation, and only with `decidedBy` equal to the bound operator.

## 4. Resume (inside the agent, `useAgentStart`)
1. `new ApprovalStore(sql, secret).decideWithToken(token, approver)` re-verifies the token. It then checks that `tenantId`, `runId` and `nonce` (links only; operator tokens are bound to `approver` instead) match the row (timing-safe), and calls `decide()`:
   - row not pending: `{ changed: false }`. A decision can never flip.
   - past `expiresAt`: status becomes `EXPIRED`, `changed: true`.
   - otherwise: `APPROVED` or `REJECTED`, plus `decided_at` and `decided_by`.
2. If the status is `APPROVED` (decided by this delivery, or found already decided by a retried delivery), the executor runs `{ id: record.toolCallId, name: record.tool, arguments: record.args }` in the agent's mode (shadow still simulates):
   - `authorize()` finds the `APPROVED` row and lets the call through;
   - firewall, tenant, budget and policy checks still run;
   - this path has no Flue step, so `SqlIdempotencyStore` guarantees a single execution.
3. A `tool-approval-result` signal is appended. On success: "Human approved X. Result: …". On rejection: "Human rejected X. Do not retry it; adapt the plan." The model continues from there.
4. The `approval` data part is rewritten with the final status.

## 5. Replay and idempotency guarantees
| Replay | Result |
|---|---|
| Same POST twice | Flue `dispatch` idempotency key `approval:<aid>:<decision>` converges on the original submission |
| Same link in a new submission | `decideWithToken` → `changed: false` → "already approved; nothing further to do" |
| Reject link after approve (or vice versa) | `changed: false`, no flip |
| Tool re-executed for the same call id | `SqlIdempotencyStore` returns the stored result with `cached: true` |
| Interrupted mid-flight, not idempotent | `UNKNOWN_OUTCOME`. The agent must verify external state; it never blindly retries |

A submission retried after `decide` but before execution finds the row `APPROVED` and executes it then; the
idempotency ledger keeps that to one execution. A non-idempotent call that timed out is recorded `UNKNOWN`, so its
replay returns `UNKNOWN_OUTCOME` instead of running twice.

## 6. Non-Flue loop (`AgentRuntime`, Node/tests/evals)
```ts
const result = await runtime.run({ message: "Announce the sale" }); // status "PENDING_APPROVAL", result.pendingApprovals
const resumed = await runtime.decide(approveToken, "owner@example.com"); // decideWithToken + resume()
```
`resume()` re-executes unresolved tool calls and drops the `PENDING_APPROVAL` placeholder result first. It is
tested in `packages/core/test/runtime.test.ts`: "pauses for approval, resumes on a signed decision, and never
double-executes".

## 7. Security notes
- Unbound links are bearer capabilities until they expire. Bind them (`bindToRecipient`) whenever the requester is not the approver; otherwise send them only to the intended approver, over a channel the tenant controls.
- An approval authorises exactly the call a human saw: same id, tool and arguments.
- `APPROVAL_SIGNING_SECRET` must be distinct from the session and webhook secrets. Rotate it by passing `[new, old]`; drop the old one after the 72 h TTL.
- The token's `tid` and `rid` are signed, so a link cannot be pointed at another tenant's run.
- Approval rows live in the conversation's own Durable Object. Operators who want a cross-run list of pending approvals must aggregate from telemetry (`type: "approval"`). No global approvals index exists. Each event carries `approvalId` + `conversationId`, so a list built that way can decide by id.
- Operator tokens are minted only after a verified admin/operator session and are never sent anywhere but the agent; they expire after 10 minutes.
