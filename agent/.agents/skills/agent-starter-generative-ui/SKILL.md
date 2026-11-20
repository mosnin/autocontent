---
name: agent-starter-generative-ui
description: Build and change every user-facing surface of an Agent Starter project with @agent-starter/react — OpenUI generative UI (OpenUI Lang, defaultLibrary components, generativeUISystemPrompt, the runtime COMPONENTS.md contract), full-page AgentChat, the embeddable ChatWidget / mountChatWidget bundle, the in-app AgentSidebar (page context, quickActions), human-oversight cards (HumanOversightCard, useApprovals) and ask_person question cards, thread history (ThreadList, useThreads), live telemetry (useAgentTelemetry over websocket/SSE/Pusher, SwarmTimeline, AgentControlPanel), styles.css theming and the session-token handoff from the host SaaS. Use when building or styling a chat, widget or copilot, adding a custom OpenUI component, rendering approvals or progress, or wiring a UI to an agent.
---

# Generative UI and agent surfaces (`@agent-starter/react`)

Three product surfaces share one engine (`ChatSurface` over Flue's `useFlueAgent`):

| Surface | Component | Module | Typical host file |
|---|---|---|---|
| ChatGPT-style page | `AgentChat` | `chat` | `web/AssistantPage.tsx` |
| Support bubble on any site | `ChatWidget` / `mountChatWidget` | `widget` | `web/embed-widget.tsx` + `src/widget/routes.ts` |
| Copilot docked in your app | `AgentSidebar` | `in-app` | `web/CopilotSidebar.tsx` |

All three render streaming markdown, reasoning, tool cards, **OpenUI generative UI**, inline approval cards,
attachments, stop and retry. Operator/observer views: `SwarmTimeline`, `AgentControlPanel`,
`HumanOversightCard`, fed by `useAgentTelemetry` / `useAgentChat().telemetry`.

## When to use
Building or restyling any UI that talks to an agent; adding an OpenUI component; showing approvals, questions,
cost or progress; a ChatGPT-style thread sidebar; embedding the widget; passing page context to the copilot;
minting tokens for the browser.

## Mental model — who owns what

| Concern | Source |
|---|---|
| Components + hooks (exports list) | `packages/react/src/index.ts` |
| OpenUI library, prompt, example | `packages/react/src/generative/library.tsx` (`defaultComponents`, `defaultLibrary`, `generativeUISystemPrompt`, `defaultLibraryExample`) |
| Renderer with text fallback | `packages/react/src/components/GenerativeUI.tsx` |
| Fence/data-part parsing, approvals/telemetry derivation | `packages/react/src/internal/parts.ts`, `internal/telemetry.ts` |
| Page-context protocol | `packages/react/src/internal/context.ts` (`withContext`, `readMessageContext`) |
| Theme tokens | `packages/react/src/styles.css` (`.as-root` custom properties) |
| Runtime skill agents load | `src/skills/generative-ui/SKILL.md` + generated `COMPONENTS.md` (template: `packages/create-agent-starter/templates/base/files/src/skills/generative-ui/`) |
| COMPONENTS.md generator + sync test | `packages/react/scripts/generate-components-md.ts`, `packages/react/test/components-md.test.ts` |
| Token minting / relay (host) | `web/host-routes.example.ts` |
| Pusher channel auth for dashboards | generated `POST /api/pusher/auth` (base `src/lib/pusher-auth.ts`; 404 until `PUSHER_*` + `integrations.pusher`; owners or admin/operator) |
| Operator dashboards | background `web/JobControlPanel.tsx`, multi-agent `web/SwarmView.tsx` (both take an optional `pusher` client) |
| Conversation ids + thread list | `createConversationRoute` → `POST` / `GET /api/<agent>/conversations`, `DELETE /api/<agent>/conversations/:id` (`packages/flue/src/http.ts`); UI: `ThreadList` (`packages/react/src/components/ThreadList.tsx`) + `useThreads` (`packages/react/src/hooks/use-threads.ts`) |
| Questions from agents (`ask_person`) | tool: `packages/flue/src/ask-person.ts`; answer route `POST /answers/:token` in `createApprovalRoutes`; UI: `HumanOversightCard` question mode + `useApprovals().answer` |
| Widget visitor sessions | `src/widget/routes.ts` `POST /widget/session` (KV `WIDGET_KEYS`; signed visitor credential; token role `visitor`, audience `widget`, accepted only by the support agent mount) |

## How agents produce UI
1. The agent loads the runtime skill: `useSkill(generativeUI)` (`import generativeUI from "../skills/generative-ui/SKILL.md"`).
   The skill tells the model to read `COMPONENTS.md` — the exact component contract.
2. The model answers with a sentence of text plus an `openui-lang` fenced block. `splitOpenUISegments` in the
   chat splits markdown and programs; `GenerativeUI` renders programs (streaming-tolerant) and falls back to
   the raw text if a program cannot render.
3. Alternatively, code (not the model) can write a `data-openui` part: `useDataWriter("openui")({ response: program })`.
4. Button actions come back as `ActionEvent`s: `continue_conversation` sends the button's message (plus its
   `context`) as a new user turn; `open_url` opens http(s) links in a new tab. Nothing else runs by default.

OpenUI Lang in brief (full contract: `COMPONENTS.md`): one statement per line, `root = Stack([...])` first,
positional arguments, `null` to skip a middle optional argument, references by identifier, actions
`@ToAssistant("msg", context?)` / `@OpenUrl("https://…")` / `Action([...])`. The 12 components:
`Stack, Card, Row, Text, Stat, Table, List, Button, Callout, ProgressBar, KeyValue, BarChart`.

## API reference (signatures from source)

```ts
// hooks
useAgentChat({ url?, client?, token?, live? }): UseFlueAgentResult & { client, approvals, pendingApprovals, telemetry, usage,
  isBusy, isStopping, stop(): Promise<boolean>, sendSignal(signal, options?), retry(failed) }
useApprovals({ endpoint?, fetch?, token?, headers?, credentials? /*same-origin*/, onDecided? }):
  { decide(approval, "approve"|"reject", note?), answer(approval, value: string | boolean), answers, pending, isPending(id),
    statuses, errors, resolve(approval) }      // questions: POST { answer } to args.answerUrl; resolved status "APPROVED"
approvalDecisionUrl(approval, decision, endpoint?)        // question answerUrl, then signed approveUrl/rejectUrl, else `${endpoint}/${approvalId}`
readHumanQuestion(approval): HumanQuestion | null         // { questionId, kind: "choice"|"text"|"confirm", question, options?, placeholder?, answerUrl, answer?, answeredBy? }
useThreads({ endpoint /* …/api/<agent> */, token?, fetch?, headers?, credentials?, autoLoad? /*true*/ }):
  { threads: { conversationId, title?, createdAt, updatedAt }[], loading, error, indexed, refresh(), create({ title?, sessionKey? }?): Promise<id>, remove(id) }
useAgentTelemetry({ source: TelemetrySource | null, maxEvents? /*1000*/, initialEvents?, reconnect?, onEvent?, onInvalid? }):
  { events, metrics: { turns, costUsd, runtimeSeconds, vmSeconds }, runStatus, status, error, clear(), ingest(payload) }
type TelemetrySource = { type: "websocket"; url; protocols? } | { type: "sse"; url; withCredentials?; eventName? /*"telemetry"*/ }
                     | { type: "pusher"; channel: PusherLikeChannel; eventName? /*"agent-turn-executed"*/ }
                     | { type: "pusher"; client: PusherLikeClient; channelName; eventName? }   // the hook subscribes / unsubscribes
pusherTelemetryChannel(tenantId, runOrRoomId) → "private-tenant-<tenant>-room-<id>"   // = integrations tenantChannelName (`:` → `=`)
deriveRunStatus(events, { registry?: { status, updatedAt? } | null, busy? }) → RunStatus   // newer of registry / stream; busy lifts IDLE/QUEUED/COMPLETED
computeTelemetryMetrics(events) → { turns, costUsd, runtimeSeconds, vmSeconds }   // vmSeconds = data.vmSeconds counters (max per run, summed)

// components (all accept ChatConnectionProps { url?, client?, token?, live?, chat? } + ChatPresentationProps
//   { placeholder, suggestedPrompts, emptyState, attachments, library, onAction, approvals, onApprovalDecision,
//     showReasoning, showToolCalls, showDiagnostics, renderDataPart, assistantName, assistantAvatarUrl, onSend })
<AgentChat title? headerActions? showUsage? emptyTitle? theme? className? style? />
<ChatWidget position? brandColor? title? subtitle? avatarUrl? greeting? open? defaultOpen? onOpenChange? launcherLabel?
            showEscalation? escalationLabel? onEscalate?(signal, chat) escalationAttributes? zIndex? theme? />
mountChatWidget(target: Element | string, props: ChatWidgetProps, { stylesheetHref? }): { update(props), unmount() }
<AgentSidebar side? title? context?: Record<string, unknown> | (() => …) contextLabel? quickActions?: { id?, label, prompt, description? }[]
              open? defaultOpen? onOpenChange? resizable? width? defaultWidth? minWidth? maxWidth? onWidthChange? mode?: "overlay"|"inline" theme? />
<GenerativeUI response isStreaming? library? onAction? onError? onStateUpdate? initialState? toolProvider? fallback? className? />
<HumanOversightCard approval onDecide(approval, decision, note?) onAnswer?(approval, value) submitting? allowNote? title? compact? />
  // tool "ask_person" → question card: option buttons (choice) / Yes-No (confirm) / text box (text); "Answered: …" once resolved
  // args.diff / args.patch holding a unified diff (merge_to_main, push_branch) → rendered with <DiffView> above the arguments
<ThreadList threads activeId? onSelect(id) onNew? onDelete?(id) loading? error? title? /*"Conversations"*/ untitledLabel? now? className? />
relativeTime(timestamp, now?): string
<SwarmTimeline events title? types? colorFor? showCounters? autoScroll? emptyLabel? groupWindowMs? theme? />
<AgentControlPanel events status? onPause? onResume? onTeardown? budgetUsd? maxTurns? vmSeconds? approval? onDecide? approvals? connectionStatus? title? runId? theme? />
  // status default deriveRunStatus(events); oversight card on PENDING_APPROVAL / PAUSED_OVERSIGHT; Resume on HALTED / PAUSED_OVERSIGHT / FAILED;
  // teardown until COMPLETED / TERMINATED; counters Turns (/ maxTurns), Cost, Runtime (wall clock), VM time (vmSeconds ?? metrics.vmSeconds)

// generative
generativeUISystemPrompt(options?: PromptOptions & { library?: Library }): string   // inline mode on by default
defaultLibrary.extend({ components: { add: [{ component, slots: ["Card.children", …] }], override?, remove? } })
withContext(text, context): string · readMessageContext(raw): { text, context }      // OpenUI message protocol (]]>openui:context)
```

## Recipes

### 1. Session-token handoff (host SaaS → browser → agent)
```ts
// host backend (from web/host-routes.example.ts): YOUR auth decides tenant/user/roles
const token = await createSessionToken(process.env.SESSION_SIGNING_SECRET!, { sub: user.id, tid: user.tenantId, roles: user.roles }, 3600);
```
```tsx
// browser (condensed from web/AssistantPage.tsx): mint a conversation id, then connect
const [conversationId, setConversationId] = useState<string>();
useEffect(() => {
  fetch(`${AGENT_ORIGIN}/api/assistant/conversations`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ sessionKey: "main" }) })
    .then((r) => r.json()).then((j: { conversationId: string }) => setConversationId(j.conversationId));
}, [token]);
const client = useMemo(() => (conversationId ? createFlueClient({ url: `${AGENT_ORIGIN}/agents/assistant/${conversationId}`, token }) : undefined), [conversationId, token]);
return client ? <AgentChat client={client} title="Assistant" suggestedPrompts={["Summarize this week's release notes"]} /> : null;
```
`agentAuth()` verifies the token, checks the id belongs to the caller's tenant/user and rewrites
`initialData` server-side. The same secret signs both sides; rotate with `SESSION_SIGNING_SECRET_PREVIOUS`.
Add the host origin to `ALLOWED_ORIGINS`.

### 2. Embed the widget on any site
`web/embed-widget.tsx` reads `data-key` / `data-origin` from its `<script>` tag, calls `POST /widget/session`
with `{ publicKey, visitor }` (publishable key → one tenant + origin allowlist in KV `WIDGET_KEYS`), stores the
returned **signed visitor credential** (`visitor`, localStorage `agent_visitor`) and calls
`mountChatWidget(host, { url: `${origin}${agentPath}/${conversationId}`, token, title, greeting })`.
The Worker mints the visitor identity; the credential is the only way to resume it (a client-chosen visitor id is
ignored). The token (2 h, role `visitor`, audience `widget`) works only on the support agent's mount
(`agentAuth({ allowVisitors: true })`) and its `/api/support-agent/conversations`; every other agent and route
refuses it. Visitors are Bearer-only (never a cookie) and share a per-tenant visitor rate-limit pool.
Register a site: `npx wrangler kv key put --binding WIDGET_KEYS 'widget:pk_live_x' '{"tenantId":"t","allowedOrigins":["https://www.example.com"]}'`.
Pass `{ stylesheetHref }` to `mountChatWidget` when the host page does not bundle `styles.css`.

### 3. Copilot with page context and quick actions
```tsx
<AgentSidebar client={client} context={() => ({ path: location.pathname, title: document.title, entityId })}
  quickActions={[{ id: "summarize", label: "Summarize this page", prompt: "Summarize what is on this page." }]} />
```
Each message is `withContext(text, context)`; the agent sees an `openui:context` block. Context is
**client-supplied and untrusted** — use it to resolve "this record", never for authorization.

### 4. Approvals and questions UI
`AgentChat`/`ChatWidget`/`AgentSidebar` render a `HumanOversightCard` inline for every `data-approval` part
and POST decisions to the signed links (approval routes on the agent origin, `accept: application/json`
→ 202 JSON). Standalone:
```tsx
const approvals = useApprovals({ onDecided: (r) => console.log(r.status) });
{chat.pendingApprovals.map((a) => (
  <HumanOversightCard key={a.approvalId} approval={approvals.resolve(a)} submitting={approvals.pending[a.approvalId]}
    onDecide={(appr, decision, note) => approvals.decide(appr, decision, note)}
    onAnswer={(appr, value) => approvals.answer(appr, value)} />
))}
```
**Questions (`ask_person`).** The agent's `ask_person` tool (mounted with `useAskPerson` in the chat and in-app
templates) streams an approval-shaped part on the `approval-question` channel:
`{ tool: "ask_person", riskTier: "question", reason: question, args: { type: "human-question", kind, question, options?, answerUrl }, status }`.
Every surface that renders approvals therefore renders the question card with no extra wiring. Clicking an
option POSTs `{ answer }` to the signed `answerUrl` (`/answers/:token`), which validates it against the signed
question and wakes the agent with a `human-answer` signal; the card then shows "Answered: …" (also after reload,
because the agent re-writes the part with `status: "APPROVED"` and `args.answer`). Without `onAnswer`, confirm
questions map to approve/reject and choice/text answers travel as the `note` of `onDecide(…, "approve", answer)`.
Pass `approvals={{ token: sessionToken }}` to the chat surface so decisions and answers carry the signed-in
user's session (the route attributes them to that user when `createApprovalRoutes({ sessionSecret })` is set).

### 4b. Thread history (ChatGPT-style sidebar)
```tsx
// condensed from web/AssistantPage.tsx
const threads = useThreads({ endpoint: `${AGENT_ORIGIN}/api/assistant`, token: sessionToken });
const [conversationId, setConversationId] = useState<string>();
const client = useMemo(() => (conversationId ? createFlueClient({ url: `${AGENT_ORIGIN}/agents/assistant/${encodeURIComponent(conversationId)}`, token: sessionToken }) : undefined), [conversationId, sessionToken]);
<ThreadList threads={threads.threads} activeId={conversationId} onSelect={setConversationId}
  onNew={() => void threads.create().then(setConversationId)} onDelete={(id) => void threads.remove(id)}
  loading={threads.loading} error={threads.error} />
{client ? <AgentChat key={conversationId} client={client} approvals={{ token: sessionToken }} /> : null}
```
The list is scoped server-side to the session's tenant + user; titles come from `create({ title })` or the
first user message. The server stores the index in the `TENANT_CONFIG` KV by default
(`createConversationRoute({ index })` to change it); `indexed: false` means listing is disabled.
`ThreadList` is a `<nav>` landmark with `aria-current="page"` on the open thread. Its `.as-threads*` classes have
no rules in `styles.css` yet: lay it out in your app.

### 5. Live telemetry and operator panels
```tsx
const t = useAgentTelemetry({ source: { type: "websocket", url: roomLiveUrl } });              // room DO broadcasts (history on connect)
// Pusher: your pusher-js client authorizes at the agent app's POST /api/pusher/auth (send the session token as a header)
const pusher = new Pusher(key, { cluster, channelAuthorization: { endpoint: `${origin}/api/pusher/auth`, transport: "ajax", headers: { authorization: `Bearer ${token}` } } });
const p = useAgentTelemetry({ source: { type: "pusher", client: pusher, channelName: pusherTelemetryChannel(tenantId, runId) } }); // event agent-turn-executed
const chat = useAgentChat({ client });                                                        // data-telemetry parts in the conversation
const events = [...chat.telemetry, ...p.events];                                             // deduped by id in the panel
<AgentControlPanel events={events} status={deriveRunStatus(events, { registry: job, busy: chat.isBusy })} budgetUsd={job.budgetUsd} maxTurns={job.maxTurns}
  approvals={{ endpoint: `${origin}/approvals/by-id/${encodeURIComponent(runId)}`, token }} onPause={pause} onResume={resume} onTeardown={teardown} connectionStatus={p.status} />
```
`web/JobControlPanel.tsx` (background module) is that recipe for a job: it polls `GET /api/jobs/:id` (registry status,
`budgetUsd`, `maxTurns`, optional `vmSeconds`), so a job parked on a recipient-bound approval shows PENDING_APPROVAL with
the oversight card, approves / rejects through the operator decide-by-id route (background approvals stream no signed
links), and shows Resume for HALTED / FAILED wired to `/api/jobs/:id/resume`. Its VM time is the job run's own;
browser work delegated to the computer operator is billed on the operator's run. `web/SwarmView.tsx` uses the room's
Pusher channel instead of the WebSocket when given `pusher` (live events only).

### 6. Add a custom OpenUI component safely
```tsx
import { defineComponent } from "@openuidev/react-lang";
import { defaultLibrary } from "@agent-starter/react";
import { z } from "zod/v4";

const Badge = defineComponent({
  name: "Badge", description: "A short status label.",
  props: z.object({ label: z.string().describe("Text"), tone: z.enum(["neutral", "success", "warning", "danger"]).optional().describe("Color") }),
  component: ({ props }) => <span className={`app-badge app-badge--${props.tone ?? "neutral"}`}>{props.label}</span>,
});
// CSS in your app: .app-badge { border-radius: var(--as-radius-sm); background: var(--as-color-surface-2); color: var(--as-color-text); }
// Module scope (parsers memoize by identity). Slots decide where the model may place it.
export const appLibrary = defaultLibrary.extend({ components: { add: [{ component: Badge, slots: ["Card.children", "Row.children", "Stack.children"] }] } });
// <AgentChat library={appLibrary} … />  — pass the same library to every surface
```
Rules: render only props (no `dangerouslySetInnerHTML`, no fetches, no side effects on render); describe every
prop (`.describe`) — descriptions become the contract; style with your own classes over the `--as-*` tokens; links only via `@OpenUrl`
(the chat opens http(s) only). Then **update the contract the model reads**: the shipped generator covers
`defaultLibrary` only, so write `generativeUISystemPrompt({ library: appLibrary })` into
`src/skills/generative-ui/COMPONENTS.md` (vitest script/test in your project) and add a parse test:
`createParser(appLibrary.toJSONSchema(), appLibrary.root).parse(example).meta.errors` must be `[]`.
In this repo, after changing `defaultLibrary`: `pnpm --filter @agent-starter/react gen:components`.
Host apps importing `@openuidev/react-lang` / `zod` directly must use the same versions as
`@agent-starter/react` (`@openuidev/react-lang` 1.1.0, zod 4) so the library and renderer share one copy.

### 7. Theme
Override tokens on `.as-root` (globally or via `style`), force light/dark with `theme` / `data-theme`:
```css
.as-root { --as-color-accent: #0f766e; --as-radius: 12px; --as-font: "Inter", system-ui, sans-serif; }
```
`ChatWidget brandColor` sets the launcher/header color and picks a readable text color automatically.

## Checklist — spec requirements for this topic
- [ ] **OpenUI powers generative UI** with a component library and a model-facing prompt. Verify: `pnpm --filter @agent-starter/react test` ("parses the documented example", "builds an inline-mode system prompt describing every component").
- [ ] **The model gets the exact contract.** `src/skills/generative-ui/COMPONENTS.md` exists and matches the library. Verify: `packages/react/test/components-md.test.ts` passes; `pnpm --filter @agent-starter/react gen:components --check` exits 0. In a generated project: `test -f src/skills/generative-ui/COMPONENTS.md`.
- [ ] **UI renders safely and degrades to text.** Verify: test "falls back to plain text when nothing is renderable"; only `continue_conversation` / `open_url` actions are handled.
- [ ] **ChatGPT-style chat, support widget and in-app sidebar surfaces** (spec: `AgentChatWidget`, `AgentSidebarView`). Verify: `chat.test.tsx` suites `<AgentChat />`, `<ChatWidget />`, `mountChatWidget`, `<AgentSidebar />`.
- [ ] **Telemetry contract** (sender, role, content, turnCount, accumulatedCost, runtimeSeconds, logType, status incl. `PAUSED_OVERSIGHT`, timestamp). Verify: `TelemetryEventSchema` in `packages/core/src/observability/telemetry.ts`; `telemetry.test.tsx` "validates, dedupes by id and orders events".
- [ ] **`useAgentTelemetry` binds an isolated tenant/room channel and cleans up** (spec: Pusher hook with `clearTimeline`). Verify: tests "binds to a host-provided Pusher channel and unbinds on unmount", "subscribes the private channel, binds the telemetry event and unsubscribes on cleanup", "names the channel the server's PusherPublisher sends to", websocket backoff tests; `clear()` exists.
- [ ] **Dashboards subscribe Pusher when configured (checklist item 6, L5681)**, falling back to the Flue stream / room WebSocket. Verify: `web/JobControlPanel.tsx` and `web/SwarmView.tsx` take `pusher` and use `pusherTelemetryChannel`; `pnpm typecheck:web` in a generated project.
- [ ] **Private channel authorization enforces the tenant boundary.** Verify: generated `POST /api/pusher/auth` (`src/lib/pusher-auth.ts`) and `web/host-routes.example.ts` `pusherAuth` → `authorizePrivateChannel`; integrations test "rejects cross-tenant subscriptions".
- [ ] **Swarm timeline with per-agent colors, turns and live cost.** Verify: `swarm-control.test.tsx` `<SwarmTimeline />` tests.
- [ ] **Control panel: status, terminal log, cost/budget bar, pause, emergency teardown, HITL card on `PAUSED_OVERSIGHT`.** Verify: `<AgentControlPanel />` tests ("shows the oversight card when paused for oversight", "requires confirmation for emergency teardown").
- [ ] **Job panel status from registry + stream: PENDING_APPROVAL shows the card and decides by id; HALTED offers Resume** (findings 20, 21). Verify: `dashboards.test.tsx` "takes the newer of the registry and the stream…", "shows the oversight card for a job the registry reports as PENDING_APPROVAL and decides it by id", "offers Resume for a HALTED or FAILED run and keeps teardown available until the run is final".
- [ ] **Billed VM time, not run age** (finding 32). Verify: `dashboards.test.tsx` "shows billed VM time from counters (not the run's age) and the turn limit".
- [ ] **Human oversight card dispatches signed approvals back to the parked agent.** Verify: `approvals.test.tsx` "drives HumanOversightCard end to end"; harness test "parks HIGH-risk tools … runs them exactly once".
- [ ] **`ask_person` questions render and answer from every surface** (choice / confirm / text). Verify: `packages/react/test/threads-questions.test.tsx` "ask_person questions"; `packages/flue/test/ask-person.test.ts` "streams the question card, then marks it answered when the signed answer arrives".
- [ ] **Thread history: the user's conversations, new chat, switch, delete** (R-APP-10). Verify: `threads-questions.test.tsx` "thread history"; `packages/flue/test/http-security.test.ts` "lists, titles and removes only the caller's own threads".
- [ ] **Signed relay events reach the frontend via the host** (verify signature, tenant consistency). Verify: `handleAgentWebhook` in `web/host-routes.example.ts`.
- [ ] **No insecure host endpoints**: token minting, relay receiver and Pusher auth all authenticate server-side. Verify: review `web/host-routes.example.ts` usage in your host; `test/security.test.ts` passes.
- [ ] **Widget visitors reach only the support agent, with a server-minted identity** (SEC-01, SEC-02). Verify: `packages/flue/test/edge-auth.test.ts` "probe visitor.test.ts: a visitor token is refused on /agents/coder…", "lets the visitor talk to the support agent, but never through a cookie"; `packages/core/test/identity-edge.test.ts` "visitor credentials"; generated `src/widget/routes.ts` uses `resolveVisitor` + `createVisitorSessionToken`.
- [ ] **The support agent answers from the help center only** (never user or tenant memory; SEC-03). Verify: generated `src/agents/support.ts` passes `retriever: helpCenter` (AI Search only) to `useAgentStarter` and `search_help_center` uses it.
- [ ] **UI checks per surface** — run [references/ui-checklist.md](references/ui-checklist.md) for chat, widget and in-app.

## Pitfalls
- **Never mint tokens in the browser** or put `SESSION_SIGNING_SECRET` in client env. Tenant/user come from your session.
- **Pusher channel and event:** `PusherPublisher` sends `agent-turn-executed` on `private-tenant-<tenant>-room-<roomId ?? runId>`; build the name with `pusherTelemetryChannel`, never by hand (tenant `:` becomes `=`). Room channels authorize only for admin/operator sessions (a room id is not a conversation id).
- **CORS:** host apps go in `ALLOWED_ORIGINS`. Widget sites need the `origin:<origin>` → `<publicKey>` index entry in `WIDGET_KEYS` next to `widget:<publicKey>`; they get CORS only on `/widget/` and the support agent paths.
- **Cookie auth across origins:** if a host app on another origin uses the `agent_session` cookie instead of a Bearer token, `agentAuth` refuses it (CSRF defence) unless that origin is in `agentAuth({ trustedOrigins })`. Prefer Bearer tokens from the UI.
- **Widget visitor storage:** keep only the server's `visitor` credential; a page that sends its own visitor id gets a fresh anonymous identity every time.
- **Memoize clients** (`useMemo`) — a new `FlueClient` starts a new session.
- **Pusher has no history:** a panel opened mid-run shows only new events from Pusher. The room WebSocket sends a `{ type: "history", events }` frame on connect, and a Flue client replays the conversation's `data-telemetry` parts.
- **`toolProvider` on `GenerativeUI` runs Query/Mutation tools from the browser** — never point it at mutating endpoints; mutations go through guarded agent tools + approvals.
- **Components that fetch or mutate on render** break streaming re-renders and bypass approvals. Props in, markup out.
- **Recipient-bound approvals stream no links:** the panel's default card POSTs to `approvals.endpoint` + `/<approvalId>`; for background jobs that is the operator route `/approvals/by-id/<conversationId>` with an admin/operator session token.
- **Runtime skill names `Chart`, the component is `BarChart`** (`src/skills/generative-ui/SKILL.md`); COMPONENTS.md is authoritative.
- Give `AgentChat` a sized container; import `@agent-starter/react/styles.css` once.
- **Key `AgentChat` by conversation** (`key={conversationId}`) when switching threads, so transcript state does not leak between threads.
- **Question links are unbound by default:** anyone holding an `answerUrl` can answer (attributed `answer-link`). Bind with `useAskPerson({ bindTo: (t) => t.userId })` plus `createApprovalRoutes({ sessionSecret })`, and send the session token from the UI.

## Verify
```bash
pnpm --filter @agent-starter/react test        # components, hooks, OpenUI library, COMPONENTS.md sync
pnpm --filter @agent-starter/react typecheck
pnpm --filter @agent-starter/react gen:components -- --check   # stale contract → exit 1
# generated project
pnpm typecheck && pnpm typecheck:web           # web/ snippets compile against your deps
```

## Related skills
`agent-starter-security` (session tokens, agentAuth, CORS) · `agent-starter-tools-and-firewall` (approvals) ·
`agent-starter-multi-agent` (rooms, SwarmTimeline) · `agent-starter-background-jobs` (control panel, Pusher) ·
`agent-starter-definition-of-done`.

## Not yet implemented
- No SSE telemetry endpoint in generated apps (the hook supports `type: "sse"`; server side only WebSocket rooms and Pusher exist); suggested: a route in `templates/base/files/src/lib/` streaming registry/room events.
- No COMPONENTS.md generator for custom libraries in generated projects (the script covers `defaultLibrary`, lives in `packages/react/scripts/`, and is not published); suggested: export `renderComponentsMarkdown` from `packages/react/src/generative/`.
- Thread titles do not refresh live: after the first message the server sets the title, but `useThreads` shows it only after `refresh()`.
