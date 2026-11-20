---
name: agent-starter-voice
description: Add and operate voice calls (LiveKit) in an Agent Starter project — the opt-in voice module, @agent-starter/livekit (createVoiceRoutes token minting with explicit agent dispatch, signed agent claim that mints a conversation-bound channel:voice Flue token, verified and de-duplicated webhooks, VoiceSessionDO with per-minute ledger and deleteRoom budget stop, the per-tenant daily voice spend ledger with concurrency caps, per-tenant/caller/IP rate limits, signed widget visitor credentials), the Node voice-agent app (FlueLLM, defineVoiceAgent, startVoiceWorker, media actions), @agent-starter/react/voice (VoiceSession, useVoiceSession, mountVoiceWidget), LiveKit Cloud setup and deploy, recording consent, approvals by voice, latency and cost. Use when adding voice to an agent, deploying or debugging the voice agent, changing call caps, pricing, recording or consent, embedding the voice widget, or when a call does not connect, never gets an answer, double-submits turns or does not hang up.
---

# Voice (LiveKit)

Voice is an opt-in **surface** for existing agents, not a second brain. The Worker stays the control plane and
the brain; LiveKit carries audio; a separate Node process (`voice-agent/`) does VAD, turn detection, STT and TTS.
Every reply comes from the same guarded Flue agent as chat, so tools, approvals, budgets, memory, injection
defense, model routing and audit are identical.

## When to use
Adding voice to a project or an agent, deploying the voice agent, wiring the voice UI or widget, changing call
caps, prices, recording or consent, adding a media tool (hang up, transfer, DTMF), or debugging calls.

## Mental model — what runs where

```
Browser ──POST /voice/sessions (session token)──▶ Worker: verify → features.voice → policy → rate limits → ledger.reserve (daily
        budget + live-call caps) or per-call budget → VoiceSessionDO.init
        ◀── {server_url, participant_token, voice_session_id, conversation_id}   → createRoom + explicit dispatch {v,vsid,channel}
Browser ══WebRTC══ LiveKit room vs_<id> ══ voice-agent (Node, @livekit/agents 1.9.5)
voice-agent ──POST /voice/agent/claim (HMAC VOICE_AGENT_SECRET)──▶ Worker: flueUrl + flueToken(caller, channel:voice, aud voice,
        cid = conversation) + policy
voice-agent ──FlueLLM: send()/wait() per final transcript──▶ /agents/<agent>/<conversationId> (agentAuth: cid must match; the
        turn becomes a `voice-utterance` signal stamped channel=voice → useAgentStarter voice mode for that delivery)
voice-agent ──POST /voice/agent/usage every 15 s──▶ VoiceSessionDO ledger → continue | wrap_up | hangup; tenant ledger settled
LiveKit ──POST /livekit/webhook (WebhookReceiver JWT + sha256)──▶ dedupe by event.id → VoiceSessionDO reconcile + telemetry
VoiceSessionDO alarm ──▶ RoomServiceClient.deleteRoom (claim timeout, or call cap + grace): the hard stop
```

| Concern | Generated project | Library source |
|---|---|---|
| Worker routes wiring | `src/voice/routes.ts` (`voiceRoutes`, `voiceAgents`) | `packages/livekit/src/routes.ts` `createVoiceRoutes` |
| Session DO (state, consent, ledger, alarm) | `src/voice/session-do.ts` (`VoiceSessionDO`, binding `VOICE_SESSIONS`) | `packages/livekit/src/durable-objects.ts`, `session-engine.ts` |
| Tenant voice ledger (daily budget, live-call caps) | `src/voice/routes.ts` `voiceLedger` → the `ledger:<tenantId>` instance of `VoiceSessionDO` | `packages/livekit/src/ledger.ts` (`VoiceLedgerEngine`) |
| Voice bindings type | `src/voice/env.ts` (`VoiceEnv`, `voiceEnv`) | — |
| Wire contract (dispatch metadata, claim, usage, voice actions) | — | `packages/livekit/src/contract.ts` |
| Tokens, clients, identities | — | `packages/livekit/src/livekit.ts` |
| Policy + budget gate + recording | KV `TENANT_CONFIG` key `voice:<tenantId>` | `packages/livekit/src/policy.ts` |
| Voice-capable agent | `src/agents/voice-assistant.ts` (`VoiceAssistant`, `/agents/voice-assistant`, tool `end_call`) | — |
| Voice mode in the brain | — | `packages/flue/src/voice.ts` (`isVoiceChannel`, `VOICE_INSTRUCTION`), `useAgentStarter` `model.voice` |
| Runtime skill | `src/skills/voice-conversation/SKILL.md` | — |
| Media worker | `voice-agent/` (`src/agent.ts`, `Dockerfile`, `livekit.toml`, `build.mjs`, `env.example`) | `packages/livekit/src/agent/*` |
| UI | `web/VoicePage.tsx`, `web/voice-embed.tsx` | `packages/react/src/voice/*` |

**Which agent answers?** `VOICE_AGENTS` (default `assistant,voice-assistant`) lists HTTP-mounted agents; names not
generated in the project are dropped. With the chat module the call goes to `Assistant`; alone, to `VoiceAssistant`.
**Anonymous widget calls** only reach `widgetAgents` (the template: the widget's `support-agent`, the one mount with
`allowVisitors`); without the widget module the widget voice route refuses every call.

## API reference (from source)

```ts
// @agent-starter/livekit (Worker-safe, no cloudflare: imports)
createVoiceRoutes<E>({
  livekit: (c) => Partial<LiveKitConfig>,            // { url, apiKey, apiSecret, agentName } — always passed explicitly
  sessionSecrets, sessionSigningSecret, agentSecrets, publicBaseUrl,
  agents: (c) => Record<agentName, mountPath>, defaultAgent?,
  loadTenantConfig: (c, tid) => Promise<{ features, maxBudgetUsd }>,   // features.voice is the switch
  loadVoicePolicy?: (c, tid) => VoicePolicyInput | null, devEnabled?: (c) => boolean,
  remainingBudgetUsd?: (c, { claims, tenantConfig }) => number,       // per-call budget, default tenantConfig.maxBudgetUsd
  session: (c, vsid) => VoiceSessionApi,                               // VoiceSessionDO stub
  ledger?: (c, tid) => VoiceLedgerApi,                                 // VoiceSessionDO stub named `ledger:<tid>`
  rateLimiter?: (c) => VoiceRateLimiter,                               // TokenBucketRateLimiter; limits come from the policy
  widgetAgents?: (c) => string[],                                      // visitor-enabled agents (default none: widget off)
  dedupe?: (c) => KeyValueStore, telemetry?: (c) => TelemetrySink[], widgetSites?: (c) => KeyValueStore | undefined,
  dispatchMode?: "createRoom" | "token", participantTokenTtlSeconds?: number /* 600 */,
}) → Hono   // POST /voice/sessions, POST /voice/widget/session, GET /voice/sessions/:vsid, POST /voice/sessions/:vsid/end,
            // POST /voice/agent/claim, POST /voice/agent/usage, POST /livekit/webhook
VoicePolicySchema  // agents, maxCallSeconds 900, minCallSeconds 30, perMinuteUsd 0.05, sources ["microphone"], chat,
                   // recording "off"|"transcript"|"full", consentVersion, disclosure, greeting, claimTimeoutSeconds 20,
                   // graceSeconds 15, usageIntervalSeconds 15, wrapUpSeconds 30,
                   // dailyBudgetUsd 5, maxConcurrentSessions 5, maxConcurrentSessionsPerCaller 1,
                   // sessionsPerMinute 10, sessionsPerMinutePerCaller 3, widgetSessionsPerMinutePerIp 5
VoiceLedgerEngine(sql, clock) · engineLedgerApi(engine, tid) · VOICE_LEDGER_MIGRATIONS
  .reserve({ vsid, tenantId, principal, perMinuteUsd, maxCallSeconds, minCallSeconds, dailyBudgetUsd, perCallBudgetUsd,
             maxConcurrent, maxConcurrentPerPrincipal, ttlSeconds }) → { ok, maxCallSeconds, reservedUsd } | { ok: false, error }
  .settle(vsid, costUsd, ended) · .spend() → { day, spentUsd, reservedUsd, committedUsd, active }
voiceEnabled(tenantConfig, devEnabled) · resolveVoicePolicy(input) · voiceBudget(policy, remainingUsd) → { ok, maxCallSeconds }
effectiveRecording(policy, consent) · recordingOptions(mode)     // → session.start({ record })
mintParticipantToken(config, { identity, room, ttlSeconds?, sources?, canPublishData?, dispatch? }) · verifyParticipantToken
participantIdentity(secret, tid, sub) → "u_<24 hex>" · createLiveKitClients(config) → { rooms, dispatch } · livekitApiHost(url)
signAgentRequest(secret, body) / verifyAgentRequest(secrets, body, header)   // t=,v1= HMAC, 60 s window
VoiceSessionEngine(sql, clock) · engineSessionApi(engine, vsid) · VOICE_SESSION_MIGRATIONS
VOICE_SCOPE = "channel:voice" · VOICE_ACTION_DATA_PART = "voice-action" · DispatchMetadataSchema (strict {v,vsid,channel})
VoiceActionSchema  // { type: "hangup", say? } | { type: "transfer", to: "tel:+…"|"sip:…", say? } | { type: "dtmf", digits }

// @agent-starter/livekit/durable-objects
class VoiceSessionDO<Env> extends DurableObject  // init, claim, usage, webhook, end, status, ledger, alarm
                                                 // + tenant-ledger role (instance `ledger:<tid>`): reserve, settle, spend
  protected livekitConfig()   // default env LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_AGENT_NAME
  protected telemetrySinks()  // default []
  protected spendLedger(tid)  // tenant ledger the alarm settles a call in (default null; the template returns `ledger:<tid>`)

// @agent-starter/livekit/agent (Node only; peers @livekit/agents 1.9.5, @livekit/rtc-node ^1.2.1, @flue/sdk 2.3.0)
defineVoiceAgent({ workerUrl?, secret?, stt?, tts?, vad?, turnDetection?, sessionOptions?, interruptPolicy?, filler?,
                   wrapUp?, goodbye?, proactiveReplies?, onSessionStarted?, flue?, fetch? })   // module default export
startVoiceWorker(import.meta.url, { agentName?, drainTimeoutMs? })                          // explicit dispatch
new FlueLLM({ url, token, client?, interruptPolicy?: "before-tools"|"always"|"never", idempotencyPrefix?, turnTimeoutMs?,
              onToolStart?, onVoiceAction?, onApproval?, onDataPart? })                    // llm.LLM subclass
voiceSessionOptions({ llm, stt?, tts?, vad?, turnDetection?, extra? })   // forces preemptiveGeneration off, llm maxRetry 0
VoiceWorkerClient({ workerUrl, secret }).claim(...) / .reportUsage(...) · parseDispatchMetadata · createVoiceActionExecutor
watchProactiveReplies(client, isOurs, speak) · turnIdempotencyKey · flueConnOptions

// @agent-starter/react/voice (optional peers livekit-client ^2.23.0, @livekit/components-react ^2.9.25)
<VoiceSession endpoint token consent={{ version }} pendingApprovals agent resume onSessionStart onEnded>{(call) => …}</VoiceSession>
useVoiceSession({ endpoint, token, agent, resume, consent, autoStart?, notifyEnd? }) → { session, details, conversationId, start, end, error }
mountVoiceWidget(target, { publicKey, apiBase, accent?, theme?, position?, consentVersion?, title?, visitor? }) → { shadowRoot, unmount }
storedVoiceVisitor(explicit?) · rememberVoiceVisitor(credential)   // the server-signed visitor credential in localStorage
requestVoiceSession · createVoiceTokenSource · VoiceVisualizer · usePublishPermissions · useVoiceErrors · VOICE_CSS · shadowStyles
```

## Setup (once per project)
1. Scaffold with the module from a checkout of agent-starter: `pnpm run create my-app --modules chat,voice` (or add `voice` later, see
   `agent-starter-scaffold`; it adds `VoiceAssistant`, the `VOICE_SESSIONS` DO and a migration class `VoiceSessionDO`).
2. LiveKit Cloud: create a project, copy its `wss://` URL into `wrangler.jsonc` `vars.LIVEKIT_URL`, create an API
   key pair. Secrets: `npx wrangler secret put LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VOICE_AGENT_SECRET`
   (`openssl rand -base64 48`). Locally put them in `.dev.vars`.
3. Webhooks: LiveKit Cloud → Settings → Webhooks → `${PUBLIC_BASE_URL}/livekit/webhook`, signed with the same key.
4. Turn voice on per tenant: `features.voice: true` in its TenantConfig (`PUT /internal/tenants/:id/config`).
   Optional policy in KV: `npx wrangler kv key put --binding TENANT_CONFIG 'voice:tenant_alpha' '{"maxCallSeconds":600,"perMinuteUsd":0.06,"recording":"transcript","consentVersion":"v2"}'`.
   Local only: `VOICE_DEV_ENABLED=1` in `.dev.vars` (ignored unless `PUBLIC_BASE_URL` is localhost).
5. Deploy the voice agent (`voice-agent/README.md`): `cd voice-agent && cp env.example env.voice` (set
   `AGENT_STARTER_URL`, `VOICE_AGENT_SECRET`, `LIVEKIT_AGENT_NAME`), `npm install`, `lk agent create --secrets-file env.voice --region us-east`.
   Self-host: `docker build` the provided `Dockerfile` (node:24-slim, non-root) and pass LIVEKIT_* at runtime.
6. UI: render `web/VoicePage.tsx`, or build `web/voice-embed.tsx` as a script and register the site in
   `WIDGET_KEYS` with `"voice": { "enabled": true }` (needs the widget module: anonymous callers only reach the
   support agent; `voice.agent` may only name one of `widgetAgents`).

## Recipes

**Make an existing agent voice-ready.** Add it to `VOICE_AGENTS` (it must be HTTP-mounted). `useAgentStarter`
already switches to `model.voice` (or `model.firstLine`), lowers thinking and adds `VOICE_INSTRUCTION` when the
token carries `channel:voice`. Load the runtime skill too: `useSkill(voiceConversation)` from
`../skills/voice-conversation/SKILL.md`. Give voice a fast, non-reasoning model: set `VOICE_MODEL`, or
`model: { ...platform(name, id).model, voice: "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast" }`.

**A media tool (transfer to a human, SIP calls only).** Tools decide; the voice agent executes.
```ts
const writeVoiceAction = useDataWriter("voice-action");   // at render, unconditionally
defineAgentTool({
  name: "transfer_to_human", description: "Transfer the phone caller to the support line.",
  input: v.object({}), risk: "HIGH", sideEffect: "external", requiresApproval: true,
  simulate: () => ({ transferred: false, simulated: true }),
  execute: async () => { writeVoiceAction({ type: "transfer", to: "tel:+15550100", say: "Transferring you now." }); return { transferred: true }; },
});
```

**Recording.** Set `recording` in the tenant policy; the UI must send `consent: { recording: true, version }`
matching `consentVersion` (`VoiceSession consent={{ version }}`), otherwise the session records nothing. The voice
agent plays `disclosure` non-interruptibly first and passes `recordingOptions(mode)` (redaction on) to `session.start`.

**Show approvals during a call.** Render `AgentChat` on `conversationId` inside `VoiceSession`'s children (see
`web/VoicePage.tsx`); pass `pendingApprovals` if you track approvals yourself. The agent says "sent for approval";
when it is decided, `watchProactiveReplies` speaks the follow-up. Never accept a spoken "approve".

**Price and cap calls.** `perMinuteUsd` (blended agent + STT + TTS + transport) sets the budget gate and the
per-minute ledger. With `ledger` (the template wires it), each new call atomically reserves its worst case in the
tenant ledger: `maxCallSeconds = min(policy.maxCallSeconds, min(dailyRemaining, perCallBudget) / perMinuteUsd * 60)`,
refused with 402 `VOICE_BUDGET_EXHAUSTED` below `minCallSeconds`, and 429 `VOICE_CONCURRENCY_LIMIT` /
`VOICE_CALLER_CONCURRENCY_LIMIT` past `maxConcurrentSessions` / `…PerCaller`. Usage reports, webhooks, hang-ups and
the DO alarm settle the real cost and free the slot; a never-settled reservation expires at claim timeout + cap +
grace and stays counted at its reserved amount. Tune per tenant in KV `voice:<tenantId>`
(`{"dailyBudgetUsd":20,"maxConcurrentSessions":10}`). Per-session rows: `VoiceSessionDO.ledger()` (shaped like
`as_budget_ledger`, `kind: "voice"`); today's tenant total: the `ledger:<tid>` instance's `spend()`.

**Rate limits.** With `rateLimiter` (template: `TokenBucketRateLimiter` over `AGENT_CACHE`, prefix `rl:voice:`), new
calls are limited per tenant (`sessionsPerMinute`), per caller (`sessionsPerMinutePerCaller`) and, for anonymous
widget calls, per client IP (`widgetSessionsPerMinutePerIp`, from `cf-connecting-ip`) → 429 + `retry-after`.

**Widget visitors.** `POST /voice/widget/session` takes `{ publicKey, visitor?, consent? }`. The Worker mints the
anonymous identity and returns a signed `visitor` credential (`resolveVisitor`); `mountVoiceWidget` stores it and
sends it back to resume. A client-chosen `visitorId` is ignored.

## Checklist
- [ ] `POST /voice/sessions` 401 without a session token; 403 unless `features.voice` (or local dev switch). Verify: `packages/livekit/test/routes.test.ts` "is off unless…".
- [ ] Client `room_config`, tenant ids and identities are ignored; the room name, identity (`u_<hmac>`) and dispatch are server-derived. Verify: "creates the room with ONE explicit dispatch…".
- [ ] Dispatch metadata and room metadata contain only `{v, vsid, channel}` / `{vsid}`: no tokens, secrets, tenant or user ids. Verify: same test + `tokens.test.ts`.
- [ ] Budget pre-check refuses with 402 below `minCallSeconds` and caps `max_call_seconds`. Verify: "gates on budget…".
- [ ] `resume` only accepts the caller's own conversation ids; tokens already scoped `channel:*` (or audience `voice`) and widget visitor tokens cannot open `/voice/sessions`. Verify: same test; `voice-limits.test.ts` "contract 2: widget visitors may only call widgetAgents…", "SEC-09: …It cannot open another voice session".
- [ ] Cumulative voice spend is bounded per tenant per day and live calls are capped per tenant and per caller (SEC-12). Verify: `packages/livekit/test/voice-limits.test.ts` "SEC-12: N parallel anonymous calls stop at the tenant concurrency cap and the daily budget", "reserves each call's worst case…", "caps live calls per tenant and per caller…", "keeps an unsettled reservation at its reserved amount…", "settles the ledger from usage reports and the user's hang-up".
- [ ] New calls are rate limited per tenant, caller and IP. Verify: `voice-limits.test.ts` "SEC-12: rate-limits new calls per client IP, per caller and per tenant".
- [ ] Widget visitors are server-minted and resume only with the signed credential; they reach only the support agent. Verify: `voice-limits.test.ts` "SEC-02: a client-chosen visitorId is ignored…", "contract 2: widget visitors may only call widgetAgents…"; `packages/react/test/voice.test.tsx` "stores the server-signed credential after a call and sends it (only it) on the next one".
- [ ] Participant token TTL ≤ 10 min, `canPublishSources` from policy, `canUpdateOwnMetadata: false`. Verify: `tokens.test.ts`.
- [ ] Claim is HMAC-signed (60 s window, rotation), room must equal `vsid`, idempotent for re-dispatch, 410 after the claim deadline, 409 once ended. Verify: "rejects bad or expired signatures…", "is idempotent…".
- [ ] The Flue token is the caller plus `channel:voice`, audience `voice`, `cid` = the call's conversation (refused by every other route and conversation), TTL = call cap + 5 min, never in dispatch metadata. Verify: "exchanges a signed vsid…"; `packages/flue/test/edge-auth.test.ts` "works for GET and POST on its conversation only".
- [ ] Voice mode is decided per delivery: the voice token's turns arrive as `voice-utterance` signals stamped `channel: "voice"`, typed chat turns stay chat, so a chat thread resumed by voice speaks and a voice-born thread opened in chat writes. Verify: `edge-auth.test.ts` "turns a voice-channel user turn into a stamped voice-utterance signal; chat turns stay kind:user".
- [ ] Webhooks verified with `WebhookReceiver` on the raw body; tampered/unsigned → 401; de-duplicated by `event.id` (KV 24 h). Verify: `/livekit/webhook` tests.
- [ ] The DO alarm deletes the room at the claim deadline and at cap + grace, retrying on LiveKit errors. Verify: `session.test.ts` "VoiceSessionDO alarm".
- [ ] Ledger is one row per started minute, only grows, idempotent per `(vsid, seq)` and reconciled from webhooks. Verify: `session.test.ts`, "meters usage per minute…".
- [ ] `FlueLLM` streams only text deltas of its own submission; preemptive generation off; `maxRetry: 0`; idempotency key per turn. Verify: `flue-llm.test.ts`.
- [ ] Barge-in stops speech at once; `flue.abort()` only before a tool started (default). Verify: "on barge-in aborts…".
- [ ] Media actions come only from guarded Flue tools (`voice-action` data part, validated by `VoiceActionSchema`). Verify: "ignores other submissions' deltas…".
- [ ] Recording only with policy **and** matching consent; disclosure spoken first; LiveKit observability redaction on. Verify: "records only with policy + matching consent".
- [ ] UI connects only through `/voice/sessions` (one request per Start), shows captions, mute/end, approval-pending, consent gate. Verify: `packages/react/test/voice.test.tsx`.
- [ ] Widget: publishable key + Origin allowlist, shadow root, hex-only colors, CORS-simple request. Verify: `voice.test.tsx` "mountVoiceWidget…", routes "reuses the publishable key…".
- [ ] `voice-agent/`: `@agent-starter/*` are devDependencies (bundled by esbuild, so the `--omit=dev` runtime image never fetches them), glibc image, non-root, no LIVEKIT_* baked in, `env.voice` gitignored (`voice-agent/.gitignore`); Worker `tsconfig` excludes it (includes only `src`, `test`, config).
- [ ] Pins: `@livekit/agents` and plugins 1.9.5 in lockstep, `@livekit/rtc-node ^1.2.1`, `livekit-server-sdk 2.19.2`, `@flue/sdk` = Worker Flue (2.3.0).
- [ ] Voice model is fast and non-reasoning (`VOICE_MODEL` / `model.voice`); `gpt-6.1-terra` at medium reasoning is too slow for voice.

## Pitfalls
- **Never put bearer tokens or tenant ids in dispatch metadata or the participant JWT.** LiveKit stores job
  metadata (dashboards, logs) and the browser can read its token. The claim endpoint is the only door.
- **`livekit-server-sdk` reads `process.env.LIVEKIT_*` when an argument is omitted.** Always pass url/key/secret
  (`createLiveKitClients`, `VoiceSessionDO.livekitConfig()` do).
- **Token expiry does not end a call** (checked only at connect; LiveKit refreshes connected participants). The
  budget stop is `deleteRoom` from the DO alarm.
- **Preemptive generation and LLM retries double-submit turns** — each LLM request is a durable Flue submission.
  `voiceSessionOptions` forces both off; do not override with `sessionOptions`.
- **`useSession` calls its token source on mount and after `end()`.** `createVoiceTokenSource` only creates a
  session once armed by Start; do not swap in `TokenSource.endpoint`.
- **Room names are the session id**; never use LiveKit "individual" SIP dispatch rules (they put the caller's
  number in the room name).
- **`@agent-starter/*` publish TypeScript**: the voice agent bundles them with esbuild (`build.mjs`); plain
  `node src/agent.ts` will not strip types inside `node_modules`.
- **pnpm skips native build scripts** unless allowed: `voice-agent/package.json` pre-approves
  `@livekit/local-inference` and `@livekit/blingfire`.
- **LiveKit Cloud must reach the Worker** for claims: tunnel `pnpm dev` when testing locally.
- The voice agent crashing → LiveKit re-dispatches within ~15 s; the claim is idempotent so the new agent resumes.
- **The voice token only works on its own conversation.** Tooling that reused it for other conversations, thread
  lists or approvals now gets 401/403; mint a normal session for those.
- **Voice turns are signals.** Agent code that branches on `delivery.kind === "user"` must use `isUserTurn()` from
  `@agent-starter/flue` to include spoken turns.
- **Without `ledger` there is no cumulative cap.** A custom `createVoiceRoutes` without `ledger` and `rateLimiter`
  only applies the per-call budget; wire both (the template does).

## Verify
```bash
pnpm --filter @agent-starter/livekit typecheck && pnpm --filter @agent-starter/livekit test
pnpm --filter @agent-starter/react test            # voice.test.tsx
pnpm --filter create-agent-starter test            # composes --modules voice alone
# generated project
pnpm typecheck && pnpm typecheck:web && pnpm test
cd voice-agent && npm install && npm run typecheck && npm run build
```
Manual (needs LiveKit credentials): `lk agent logs` shows the claim, a call in `web/VoicePage.tsx` reaches the
agent, `GET /voice/sessions/:vsid` reports `active`, and the room disappears at the cap.

## Related skills
`agent-starter` (architecture), `agent-starter-security` (session tokens, agentAuth, webhooks),
`agent-starter-tools-and-firewall` (media tools, approvals), `agent-starter-models-and-cost` (voice model, budget),
`agent-starter-generative-ui` (AgentChat next to the call, widget patterns), `agent-starter-scaffold` (adding the module),
`agent-starter-definition-of-done`.

## Not yet implemented
- Inbound and outbound SIP telephony (dispatch rules per tenant number, caller principals with DTMF/OTP step-up,
  agent-initiated `createSipParticipant`, answering-machine detection). `transfer`/`dtmf` actions execute only when
  a SIP participant is in the room. Deferred on purpose: SIP is not in the source spec.
- Our own recording through Egress to R2 (`tenants/<tid>/voice/<vsid>/`); only LiveKit observability recording is
  wired. Deferred on purpose: Egress recording is not in the source spec.
- One budget across chat and voice: the voice ledger caps voice spend per tenant per day, but it is separate from the
  model `BudgetGuard` ledger (`BudgetGuard.recordMedia` does not exist).
- Realtime speech-to-speech low-latency mode, camera/screen frames to the brain, and an iframe embed route.
- Reconciling the words actually heard after a barge-in back into the Flue history.
