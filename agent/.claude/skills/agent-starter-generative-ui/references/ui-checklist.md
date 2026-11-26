# UI checklist — chat, widget and in-app surfaces

Run the shared block for every surface, then the surface block. Each item says how to check it.

## Shared (every surface)
- [ ] Token minted server-side by the host (`createSessionToken(SESSION_SIGNING_SECRET, { sub, tid, roles }, ttl)`); no secret in client bundles. Check: `grep -rn SESSION_SIGNING_SECRET web/ src/web 2>/dev/null` only hits server files.
- [ ] Conversation id minted by the server (`POST /api/<agent>/conversations` or `/widget/session`), never built in the browser. Check: no `${agent}--${tenant}` string templates in UI code.
- [ ] Host origin listed in `ALLOWED_ORIGINS` (`wrangler.jsonc` vars). Check: browser devtools shows no CORS preflight failure on `/agents/...` and `/approvals/...`.
- [ ] `@agent-starter/react/styles.css` imported once; component has a sized container (chat) or is fixed-position (widget/sidebar overlay). Check: visual smoke in `pnpm dev`.
- [ ] Flue client memoized (`useMemo` keyed on url/token). Check: React DevTools — one client per conversation; no duplicate SSE connections in Network tab.
- [ ] Generative UI renders and falls back to text. Check: ask for "a table of …" and confirm a `Table`; send a malformed program and confirm plain text.
- [ ] Only safe button actions (`continue_conversation`, `open_url` with http/https). Check: no custom `onAction` that calls mutating APIs directly.
- [ ] Approval cards show tool, risk tier, reason and arguments; decisions POST and the card shows the final status; the agent resumes once. Check: trigger a HIGH-risk tool in dev; approve; verify one execution (harness test pattern).
- [ ] Stop and retry work (`client.abort()`, failed sends keep attachments). Check: `chat.test.tsx` "shows a stop button while busy and a retry for failed sends".
- [ ] Attachments limited to `image/*,application/pdf`, ≤4 files, ≤10 MiB unless you changed `attachments`. Check: props on the component.
- [ ] Theme: tokens overridden on `.as-root`; light/dark both legible (`theme="dark"` and `"light"`). Check: toggle OS theme.
- [ ] Accessibility: keyboard-only send (Enter / Shift+Enter), focus visible, live regions announce new messages. Check: `chat.test.tsx` keyboard tests; manual tab-through.
- [ ] Usage/cost display matches agent metadata (AgentChat header). Check: `showUsage` and the `budget` metadata in `useResponseFinish`.

## Full-page chat (`AgentChat`, module `chat`)
- [ ] Suggested prompts relevant to the tenant's product. Check: empty state.
- [ ] Reasoning collapsed by default; tool cards readable; diagnostics hidden (`showDiagnostics` false). Check: props.
- [ ] Long conversations stay responsive (auto-scroll stops when the user scrolls up). Check: scroll during streaming.
- [ ] Thread history: `ThreadList` + `useThreads` list only the signed-in user's conversations; "New chat" mints a server-side id; switching re-keys `AgentChat`. Check: sign in as two users of one tenant; neither sees the other's threads (`GET /api/assistant/conversations`).
- [ ] `ask_person` questions render as a question card (options / Yes-No / text box), answering resumes the agent once, and the card shows "Answered: …" after a reload. Check: ask the assistant something ambiguous in dev; answer; a second click returns 409.

## Support widget (`ChatWidget` / `mountChatWidget`, module `widget`)
- [ ] Site registered in KV `WIDGET_KEYS` (`widget:<pk>` → `{ tenantId, allowedOrigins, greeting? }`); the page origin is in `allowedOrigins` **and** `ALLOWED_ORIGINS`. Check: `POST /widget/session` returns 200 from the site origin, 403 `ORIGIN_NOT_ALLOWED` from another.
- [ ] Visitor token TTL is short (2 h in `src/widget/routes.ts`); only the server-signed visitor credential persists in `localStorage` (no PII, no client-chosen id). Check: route code and `web/embed-widget.tsx`.
- [ ] A visitor token is refused by every agent except the support agent (try it against `/agents/assistant/...` → 403). Check: `edge-auth.test.ts`.
- [ ] Bundle loads with `defer`, injects the stylesheet via `stylesheetHref` when needed, and does not leak globals. Check: build output; `mountChatWidget` returns `{ update, unmount }`.
- [ ] Launcher/panel: Esc closes, focus trapped while open and returned to the launcher; unread badge counts assistant messages while closed. Check: `chat.test.tsx` `<ChatWidget />` tests.
- [ ] Escalation ("Talk to a human") delivers an `escalation` signal the support agent handles (support-escalation skill) or your `onEscalate`. Check: click it in dev; the agent acknowledges and hands off.
- [ ] `brandColor` has readable contrast (automatic text color) on launcher/header. Check: visual.

## In-app copilot (`AgentSidebar`, module `in-app`)
- [ ] `context` is minimal, non-secret page state (path, title, entity ids); a function so it is read at send time. Check: prop is `() => ({ … })`.
- [ ] Agent treats context as untrusted (resolves "this record", never authorizes with it); writes go through the firewalled app API tools. Check: `src/in-app/app-api.ts` tools enforce tenant + approvals.
- [ ] Quick actions are short, safe prompts (no destructive verbs without approval downstream). Check: `quickActions` list.
- [ ] Resizable within `minWidth`/`maxWidth`; `mode="inline"` when the host layout places it. Check: `chat.test.tsx` "resizes with the keyboard within bounds and toggles open".

## Observer views (`SwarmTimeline`, `AgentControlPanel`)
- [ ] Telemetry source is tenant-scoped (room routes check `room--<tenant>--`, Pusher channels authorized server-side). Check: open another tenant's room → 403.
- [ ] Pusher `eventName: "agent-turn-executed"` passed to `useAgentTelemetry`. Check: events arrive.
- [ ] `budgetUsd` matches the run's real ceiling; pause/teardown handlers call authenticated routes. Check: `/api/jobs/:id/pause` returns `{ paused: true }`.
- [ ] Approval card shown while `PENDING_APPROVAL` / `PAUSED_OVERSIGHT` — pass `approval` explicitly. Check: trigger an approval and confirm the card.
