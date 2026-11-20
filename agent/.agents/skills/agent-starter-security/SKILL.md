---
name: agent-starter-security
description: Keep an Agent Starter project secure — tenancy and conversation ids (exact ownership, harness session keys), HMAC session tokens with restricted audiences (widget visitors, the voice agent's conversation-bound token) and rotation, signed visitor credentials, agentAuth (server-side initialData and delivery attributes, server-only signals, per-user rate limits, cookie CSRF, cross-tenant 403s), tenant-scoped storage, edge tenant config (secure defaults, lockdown, signed SaaS sync), SSRF guard, OAuth 2.1 (workers-oauth-provider) and tools as an MCP server, webhook ingestion (method+path+body signatures, rotation, signed-data nonces, zod, rate limits, 202-and-enqueue), signed outbound webhooks, prompt-injection defense and the security lock, untrusted content, secrets, PII redaction, residency, Pusher channel auth. Use when touching auth, routes, tenants, tokens, OAuth/MCP, webhooks, injection handling, secrets or anything that could leak data across tenants.
---

# Security

## When to use
- Mounting or changing any HTTP route, agent router, widget session, OAuth/MCP endpoint, webhook or tenant-sync route.
- Anything that derives, stores or compares a tenant id, user id, role or token.
- Handling third-party content: webhooks, web pages, emails, tool output, retrieved docs.
- Adding secrets, rotating keys, or reviewing data exposure (PII, residency, telemetry).

## Mental model: trust boundaries

| Boundary | Proof of identity | Enforced by |
|---|---|---|
| Browser/SaaS → agent routes | HMAC session token minted by the host SaaS | `agentAuth()` (`packages/flue/src/http.ts`) |
| Browser → new conversation | session token | `createConversationRoute()` mints the id server-side |
| Anonymous widget visitor → support agent | publishable key + `Origin` allowlist (KV `WIDGET_KEYS`) + server-signed visitor credential → 2 h token with role `visitor`, audience `widget` | `src/widget/routes.ts`; only the mount with `agentAuth({ allowVisitors: true })` accepts it |
| Voice agent (Node, LiveKit) → one conversation | signed claim (`VOICE_AGENT_SECRET`) → token with audience `voice` and `cid` = that conversation | `createVoiceRoutes` claim + `agentAuth` (cid binding); every other route refuses it |
| Third-party webhook → queue | HMAC `t=,v1=` signature over method + path + body (`signedDeliveryVerifier`) or the raw body, with signed-data nonces | `createIngestionHandler()` (`packages/cloudflare/src/ingestion.ts`) |
| SaaS → tenant config | HMAC over method + path + body, single use (KV replay cache) | `createTenantSyncRoutes()` (`packages/cloudflare/src/tenant-sync.ts`) |
| Email/SMS approver → run | signed, expiring approval token (optionally bound to one approver) + session for identity | `createApprovalRoutes()` (`packages/flue/src/http.ts`) |
| Operator / SaaS → parked approval (by id) | session token with an `operatorRoles` role (default `admin`, `operator`) in the conversation's tenant; Bearer, or a same-origin JSON cookie request | `POST /approvals/by-id/:conversationId/:approvalId` in `createApprovalRoutes()`; mints a 10-min operator token bound to that user |
| Person answering `ask_person` → run | signed, expiring question token (`POST /answers/:token`) | `createApprovalRoutes()` |
| Agent-supplied URL → fetch | public http(s) host only | `assertPublicHttpUrl` (`packages/core/src/tenancy/egress.ts`) |
| External AI client → your tools | OAuth 2.1 access token (PKCE, resource-bound) | `createAgentOAuthProvider()` + `createToolMcpHandler()` |
| Model output / tool args → anything | **never trusted for identity** | `assertPayloadTenant` in `ToolExecutor`, tenant-scoped stores |
| Third-party text → prompt | **always data** | cleansing, `<untrusted_content>`, render-time lock |

Identity flows one way: token → `initialData` → `useAgentStarter` builds the `TenantSecurityContext` →
`ctx.tenant` in every tool. Nothing the model or client says can change it.

In a generated project, the `packages/<pkg>/src/...` paths live under `node_modules/@agent-starter/<pkg>/src/...`.

## Tenancy and conversation ids
- Tenant ids must match `TENANT_ID_PATTERN` (`TenantIdSchema`): 1–128 chars of `[A-Za-z0-9_.:-]`, starting with a letter/digit, **no `--` and no trailing `-`** (either would make instance ids ambiguous).
- `TenantSecurityContext = { tenantId, userId, environment, roles, scopes }` (`packages/core/src/tenancy/tenancy.ts`).
- User-owned conversation (Durable Object instance) id: `${agent}--${tenantId}--${encodeIdSegment(userId)}.${sessionKey}` (`packages/core/src/ingestion/events.ts`):
  - `encodeIdSegment(sub)` is injective and reversible: `[A-Za-z0-9_]` stay, every other UTF-8 byte becomes `:XX` (`jane.doe@acme.com` → `jane:2Edoe:40acme:2Ecom`). The output never contains `.` or `-`, so a `sub` can never forge the owner/session separator or `--`. It is never truncated.
  - `conversationInstanceId(agent, tenantId, userId, sessionKey)` (core) / `conversationIdFor(agentName, claims, sessionKey)` (flue) are the only ways to mint one. `sanitizeSessionKey` keeps `[A-Za-z0-9_.:-]`, collapses `--`, caps at 60 chars.
  - `isConversationOwner(id, { tid, sub })` is the exact check: same tenant and `owner === encodeIdSegment(sub)`. Compare encoded values; never decode for authorization.
  - `parseConversationInstanceId(id)` → `{ agent, tenantId, owner, userId, sessionKey }`; `parseAgentInstanceId(id)` splits on the **first two** `--` (the session key may contain `--`) and returns null when the tenant segment is not a valid tenant id.
- `encodeIdSegment` works on WTF-8 bytes: lone surrogates get their own byte form instead of collapsing onto U+FFFD, so the encoding is injective over every JS string; `SessionClaimsSchema` also refuses a `sub` that is not well-formed UTF-16 (`isWellFormedIdentity`).
- Server-side ids without a user use `agentInstanceId(agent, tenant, sessionKey)`:
  - the tenant must match `TENANT_ID_PATTERN` (invalid → `TENANT_ISOLATION_VIOLATION`); it is never truncated or rewritten;
  - the session key goes through `instanceSessionKey`: at most 160 chars of `[A-Za-z0-9_.:-]` stay verbatim, anything else becomes `<readable prefix>:h<128-bit SHA-256>` (`sha256HexSync`), so `user 123` and `user_123` never share an instance.
- **Harness-owned sessions** (delegation workers, room specialists, background jobs, bus targets) use `harnessSessionKey(kind: "dlg" | "room" | "job" | "bus", key)` → `-<kind>.<key>`. The leading `-` is outside the `encodeIdSegment` alphabet, so `parseConversationInstanceId` rejects the id and `isConversationOwner` can never match it, whatever the user's `sub` (a user named `dlg` included). `parseHarnessSessionKey(sessionKey)` reads it back.
- `agentAuth({ secret, agentName, mount, adminRoles?, allowVisitors?, extraInitialData?, clientSignalTypes?, classify?, rateLimiter?, rateLimits?, tenantConfig?, trustedOrigins?, conversationIndex? })` runs on every request under `mount`:
  1. Verifies `Authorization: Bearer <token>` or the `agent_session` cookie, accepting the restricted audiences `widget` and `voice` for its own checks below. Failure → **401** `UNAUTHORIZED`.
  2. **Widget visitors** (role `visitor` or audience `widget`) → **403** unless `allowVisitors: true` (only the widget's support agent mount sets it; compose generates it). Visitors never authenticate by cookie, and never count as admins.
  3. **Conversation-bound tokens** (audience `voice`, or any `cid` claim) → **403** unless the path's conversation id equals `cid`.
  4. Parses the conversation id from the path. Malformed encoding, wrong agent, wrong tenant, or not `isConversationOwner` (unless the caller has an `adminRoles` role, which still requires the same tenant) → **403** `FORBIDDEN`.
  5. **Cookie auth (CSRF):** a browser-sent `Origin` must be this origin or in `trustedOrigins(c)` (without `Origin`, `sec-fetch-site: cross-site` is refused), for reads and writes, and a `POST` must be `content-type: application/json` (forces a CORS preflight) → **403** `CSRF_REJECTED`. Bearer requests are not affected.
  6. For `POST /:id`:
     - a client-posted `{ kind: "signal" }` whose `type` is not in `clientSignalTypes` (default `["escalation"]`) → **403** `SIGNAL_NOT_ALLOWED`. `tool-approval` and `human-answer` carry decisions and only arrive through the signed routes;
     - rate limits (any denial → **429** `RATE_LIMITED` + `retry-after`): one bucket per user (`chat:<tid>:u:<hash>`, sized by `tenantConfig(c, tid).rateLimit`, else the limiter defaults); a tenant ceiling (`chat:<tid>`, `rateLimits.tenantMultiplier` × the tenant rate, default 10×, only when the tenant rate is known); for visitors a per-visitor bucket (`rateLimits.perVisitor`, default 10/min burst 5) plus one shared pool for all visitors of the tenant (`visitorsMultiplier` × the tenant rate, default 2×), so minting fresh visitor ids does not bypass it;
     - rewrites the body so `initialData = { ...await extraInitialData(c, claims), tenantId, userId, environment, roles, scopes }`: the server-derived identity always wins and client-sent `initialData` is dropped. `extraInitialData` may be async, e.g. to seed a trusted `tenantConfig` from KV so a paid tenant's first submission does not render on the secure default; if it throws, the request proceeds without the seed. Bad JSON → **400**;
     - **server-owned delivery attributes** (contract with `useAgentStarter`): client signal `attributes` and `tagName` are dropped; signals get `attributes.channel` (`"voice"` for the voice token, else `"chat"`) and, with `classify`, on chat-channel signals, `attributes.route` (`SIMPLE` / `COMPLEX`); a voice-channel `{ kind: "user" }` turn becomes a `voice-utterance` signal (`VOICE_UTTERANCE_SIGNAL`) carrying `channel: "voice"`. Only Flue's reserved siblings `idempotencyKey` and `uid` survive from the client envelope. Read the stamp with `deliveryChannel(delivery, initialData)`, `deliveryRoute(delivery)` and `isUserTurn(delivery)`;
     - touches the caller's conversation index (thread list; default store: the `TENANT_CONFIG` KV binding, `conversationIndex: false` disables).
  7. Sets `c.get("claims")`.
- `createConversationRoute({ agentName, secret, index?, allowVisitors? })` serves `POST /conversations` (mint; omit `sessionKey` for a new thread, optional `title`), `GET /conversations` (the caller's threads, newest first) and `DELETE /conversations/:id` (exact ownership). `ConversationIndex` stores one JSON list per `conversations:<tenant>:<encodedUser>:<agent>` and only accepts ids the user owns.
- Flue applies `initialData` **only when the instance is created**. Role changes do not reach an existing conversation; mint a new conversation id after privilege changes.
- `createAgentRouter` (Flue) has **no auth**. Every `app.route("/agents/x", createAgentRouter(X))` must sit behind `app.use("/agents/x/*", agentAuth({...}))`.
- `useAgentStarter` falls back to `tenantId: "public"`, `userId: "anonymous"` when `initialData` is missing. A route without `agentAuth` therefore silently runs as "public".

## Session tokens (`packages/core/src/tenancy/session-token.ts`)
- Format: `base64url(JSON claims).base64url(HMAC-SHA256)`. This is a header-less JWT shape, and **not** a standard JWT.
- Claims (`SessionClaimsSchema`): `sub` (well-formed UTF-16), `tid`, `roles[]`, `scopes[]`, `iat`, `exp` (seconds), `env`, and two optional restriction claims:
  - `aud`: restricted audience. Absent on the host SaaS's normal user tokens. `WIDGET_AUDIENCE` (`"widget"`) marks anonymous visitors; `VOICE_AUDIENCE` (`"voice"`) marks the voice agent's token;
  - `cid`: the one conversation id the token may address.
- `createSessionToken(secret, { sub, tid, roles?, scopes?, env?, aud?, cid? }, ttlSeconds = 3600)`: the host SaaS calls this server-side with the shared `SESSION_SIGNING_SECRET`. Never mint tokens in the browser.
- `verifySessionToken(secret | secret[], token, { now?, audiences? } | now)` accepts a `Bearer ` prefix. It checks the signature against every secret (timing-safe), then decodes the payload, then the claims schema, then expiry, then the **audience**: a token whose effective audience (`sessionAudience(claims)`: `aud`, or `widget` for any token with the `visitor` role) is not in `audiences` is refused. The default is none, so visitor and voice tokens fail closed on every route that did not opt in (conversation APIs, approvals, rooms, jobs, VM, coder, voice, OAuth consent). Any failure is `AgentError("SIGNATURE_INVALID")`.
- **Widget visitors** (`session-token.ts`): `resolveVisitor(secrets, tenantId, credential?)` resumes the visitor a valid credential proves (`<visitorId>.<HMAC(secret, tenant:visitorId)>`, `createVisitorCredential` / `verifyVisitorCredential`), else mints a fresh random id; it always re-signs with the current secret. A bare visitor id proves nothing. `createVisitorSessionToken(secret, tenantId, visitorId, ttl = 2 h)` mints `visitorClaims(...)` = `{ sub: "visitor_<id>", roles: ["visitor"], scopes: [], aud: "widget" }`. `isVisitorClaims(claims)` tests either marker.
- **Rotation.** `src/app.ts` passes `sessionSecrets = [SESSION_SIGNING_SECRET, SESSION_SIGNING_SECRET_PREVIOUS]`:
  1. Set `SESSION_SIGNING_SECRET_PREVIOUS` to the current secret.
  2. Set `SESSION_SIGNING_SECRET` to the new secret and deploy.
  3. Switch the SaaS minter to the new secret.
  4. After the max token TTL, delete `SESSION_SIGNING_SECRET_PREVIOUS`.

  `createConsentHandler` (OAuth) and `createApprovalRoutes({ sessionSecret })` take `string | string[]` too; pass the same pair.
- **Approval/question secrets rotate the same way:** `ApprovalStore`, `createApprovalToken`/`verifyApprovalToken`, `createApprovalRoutes({ secret })` and `ask_person` accept `string | string[]` (`ApprovalSecret`); the first entry signs, any entry verifies.

## Tool and storage isolation
- `ToolExecutor` calls `assertPayloadTenant(args, tenantId)` on every call. Any `tenantId`/`tenant_id`/`tenant`/`orgId`/`organizationId`/`workspaceId` (any depth, any case) whose value differs from the executing tenant → `denied`, `ERROR_UNAUTHORIZED_TENANT`.
- `TenantScopedBlobStore(inner, tenantId, subPrefix?)` confines keys to `tenants/<tenant>/…`. `safeRelativeKey` rejects `..`, absolute paths and empty segments.
- `TenantScopedVectorStore` stamps `tenantId` on writes, force-filters `tenantId` on queries, and drops foreign rows on the way out. `VectorMemory` always uses it.
- `assertSameTenant(ctx, resourceTenantId)` is for anything you load by id.
- SaaS calls carry `x-tenant-id` / `x-acting-user` from `ctx.tenant`. The SaaS must enforce them server-side too.

## Edge tenant config (`TenantConfigProvider`)
- KV key `config:<tenantId>`, schema `TenantConfigSchema`:
  - `tier`, `maxTurnsPerSession`, `maxBudgetUsd`, `maxTokensPerSession?`;
  - `allowedModelProfiles`, `allowedTools?`, `deniedTools`;
  - `rateLimit`, `autonomy`, `features`.
- Missing config → `SECURE_DEFAULT_TENANT_CONFIG`: free tier, 5 turns, $0.15, every risky feature flag off. Malformed config → `TenantLockdownError` (`TENANT_METADATA_CORRUPTED_HALT`): fail closed and never guess limits.
- Caching: 60 s in-isolate plus a 300 s KV edge cache.
- The SaaS pushes changes to `PUT /internal/tenants/:tenantId/config` and removes them with `DELETE` (`createTenantSyncRoutes({ kv, secret, replay?, toleranceSeconds? })`). Requests are signed with `signRequest(WEBHOOK_SIGNING_SECRET, { method, path, body })`:
  - the HMAC covers `METHOD\npath\nbody` (`canonicalRequest`), so a captured PUT can't be replayed as a DELETE or against another tenant;
  - `verifySignedRequest(..., { replay })` accepts each signed request once inside the window: the replay key is a hash of the signed content (`KeyValueReplayGuard`, default `replay:tenant-sync:*` in the same KV). KV is eventually consistent; use a DO-backed `ReplayGuard` for strict once-only.
- Feature flags are read directly as `tenantConfig.features?.<flag>`: `codeExecution` gates `run_code` (`createCodeExecutionTool` throws `TOOL_NOT_ALLOWED` when off); `voice` gates voice calls (parses to `false` when absent; optional in the TS type so older configs still compile).

## OAuth 2.1 + MCP server (details: [references/oauth-mcp.md](references/oauth-mcp.md))
- `createAgentOAuthProvider({ apiRoute, apiHandler, defaultHandler, scopesSupported, resource, issuer?, accessTokenTTL? = 3600, refreshTokenTTL? = 30 d })` wraps `@cloudflare/workers-oauth-provider`. It provides PKCE, dynamic client registration, refresh rotation and RFC 9728 metadata, and requires KV `OAUTH_KV`.
- `createConsentHandler({ appName, sessionSecret, loginUrl, sessionCookie? })` serves `/authorize`. The user must already hold a SaaS session **in the cookie** (never `?session=`: URLs leak into logs, history and Referer; visitor and voice tokens are refused). Grant props carry `{ tenantId, userId, roles }`.
- `createToolMcpHandler({ name, version, tools, resolveCaller, executor?, route? = "/mcp", allowedHostnames? })` uses Agents SDK `createMcpHandler` and MCP SDK v2. Every `tools/call` runs through a `ToolExecutor` built **per call**; pass `executor: (caller) => ({ firewall: new ToolFirewall(policy) })` so firewall quotas are per caller, never module-wide.
- `requireScopes(ctx.auth, ["mcp:tools"])` is needed because the provider advertises scopes but does not enforce them. The generated `src/in-app/oauth-mcp.ts` returns **401** when `ctx.auth` is missing (fail closed).

## Webhooks in and out (details: [references/webhooks-ingestion.md](references/webhooks-ingestion.md))
- **In.** `createIngestionHandler({ source, schema, verify, tenantId, sessionKey, eventType, eventId?, queue, rateLimiter?, maxBodyBytes? = 256 000, nonceCache? })` performs, in order:
  1. Method and size limits. Non-POST → **405**; oversize body → **413**.
  2. `verify(rawBody, request)` over the **raw** body. Failure → **401**. Prefer `signedDeliveryVerifier(secrets | (request) => secrets, { header?, toleranceSeconds?, path? })`: it verifies a `signRequest(secret, { method, path, body })` signature, so a captured delivery for `/events/chat/tenant-a` can't be replayed to another tenant, source or verb, and it returns `{ nonce, pathSigned: true }` (secrets may be per tenant, chosen from the path). A plain `void` verifier means only the body is signed.
  3. JSON parse. Bad JSON → **400**.
  4. zod contract. Failure → **400** `CONTRACT_VALIDATION_FAILED`.
  5. Tenant resolution. Failure → **401** `MISSING_TENANT_ISOLATION_CONTEXT`.
  6. Token-bucket rate limit. Over the limit → **429** + `retry-after`.
  7. Nonce cache (`nonceCache: { store, ttlSeconds? = 900, key?, prefix? }`): a delivery whose nonce was already accepted → **200** `{ accepted: false, duplicate: true }`. The default nonce uses **signed data only**: the verifier's nonce; else `${source}:${tenant}:${eventId}` when the path is signed; else `body:<SHA-256 of the raw body>`, NOT scoped by the unsigned tenant/source in the URL, so a body-only signature replayed to another tenant or source is a duplicate. The nonce is recorded only after a successful enqueue. Envelope ids follow the same rule (`${source}:${eventId}` when the path is signed, else `evt:${eventId}`).
  8. Enqueue the envelope → **202**.
  9. Anything unexpected along the way (queue send, nonce store, rate limiter outage) → **500** `{ "error": "INTERNAL_INGESTION_CRASH", "message" }` as JSON (spec L2122), so the sender retries; nothing was accepted.

  `renderTurn(turn)` (the consumer's signal body) wraps the session key, types, ids and every payload in `<untrusted_content>`: webhook text is data.

  The handler does zero AI work.
- **Signatures.** `verifySignature(secrets, body, header, { toleranceSeconds = 300 })` parses `t=<unix>,v1=<hex>[,v1=…]` with `parseSignatureHeader`:
  - it accepts any `v1` matching any secret, which covers sender-side and receiver-side rotation;
  - `t` must be one plain integer (a non-numeric `t` used to compare as `NaN` and skip the window); it rejects timestamps outside the window;
  - `signRequest` / `verifySignedRequest` / `canonicalRequest` / `KeyValueReplayGuard` add method + path binding and single use for internal requests.

  Related helpers:
  - `signPayload(secret, body)` produces the sender's header;
  - `verifyRawHmac(secret, body, provided, { encoding, prefix })` covers plain-HMAC providers;
  - `verifyStripeSignature(secret, rawBody, header, toleranceSec)` / `parseStripeEvent()` handle Stripe.
- **Out.** `WebhookRelay({ url, secret, outbox?, redact? = true })`:
  - signs `${t}.${body}` (`x-agent-signature: t=…,v1=…`);
  - sends `x-tenant-id` and `x-agent-event-id`;
  - redacts secrets with `redactDeep`;
  - retries, and parks failures in the durable `as_outbox`.

## Prompt-injection defense (details: [references/injection-defense.md](references/injection-defense.md))
Defense in depth. Every layer is independent:
1. **Ingestion cleansing.** `untrustedString(max)` in zod contracts (Manychat, chat events) bounds length and replaces imperative spans with `[CLEANSED_INJECTION_ATTEMPT]`: the weighted heuristics' matches plus the spec's Manychat keywords anywhere in the text (`CLEANSE_KEYWORDS`: system override, ignore previous instructions, delete table, drop database; mid-sentence, no colon needed). The keywords only cleanse; on their own they do not raise the injection score.
2. **Render-time security lock**, inside `useAgentStarter`:
   - Flue renders the agent (and fixes the tool set) **before** `useAgentStart` runs, so this decision must be synchronous. `assessInjection(body).score >= haltThreshold` (default 0.6), or a message hash that an earlier async check flagged, triggers it.
   - The lock mounts **no tools** and adds the SECURITY LOCK instruction. Response metadata reports `securityLocked: true`.
3. **Async pipeline.** `GuardrailPipeline.checkInput` runs in `useAgentStart`:
   - checks length and blocked topics;
   - asks the `utilityModel` classifier for a second opinion on scores in [0.3, 0.6);
   - on halt or block, appends a `security-notice` signal and stores the message hash, so re-renders of that message lock.
4. **Spotlighting.** `UNTRUSTED_CONTENT_POLICY` is always instructed. Tool output (`outputTrust`), retrieval (`KnowledgeRetriever.render`) and web pages are wrapped in `<untrusted_content>`.
5. The runtime skill `src/skills/untrusted-content/SKILL.md` is loaded by each agent with `useSkill`.
6. **Blast-radius limits.** Tenant checks, the firewall, risk-tier approvals and budgets mean even a successful injection can't cross tenants or act irreversibly.
7. **Egress (SSRF).** Every fetching tool calls the one core guard `assertPublicHttpUrl` / `isPublicHttpUrl` (`packages/core/src/tenancy/egress.ts`, re-exported by `@agent-starter/integrations`; `assertPublicUrl` in `browser.ts` delegates to it). It rejects non-http(s), credentials, `localhost`/`.local`/`.internal`/single-label hosts and private, loopback, link-local, CGNAT (100.64/10), multicast, reserved and documentation IPs, including v4-mapped/translated IPv6, NAT64, 6to4 and Teredo forms (`SsrfBlockedError`).
8. **Human answers are data.** `ask_person` free-text answers and approval notes reach the model only inside `<untrusted_content source="human-answer">` / `source="approval-note"` in the signal body; signal attributes (which Flue renders verbatim) carry only signed or server values (`token`, `questionId`, `kind`, `answeredBy`, `decision`, `approver`; `answer` only for choice/confirm, validated against the signed options). `humanAnswerFromSignal(delivery)` reads the answer back for the question card.
9. **Server-owned signal attributes.** `agentAuth` drops client `attributes` and `tagName` on the signals it admits (a client can't render `<system …>`), and stamps `channel`/`route` itself.

## Secrets, PII, residency
- **Local secrets** live in `.dev.vars`, which is gitignored; copy `.dev.vars.example`. **Production secrets** go in with `wrangler secret put` (`pnpm infra:init` prompts for the core set), and CI uses GitHub Actions secrets. Never put secrets in `wrangler.jsonc` `vars`, in source, in prompts, or in tool output.
- Read env only at use time: `bindings()` in `src/lib/platform.ts`, or `ctx.services.env` inside tools. Never read it at module scope.
- **Distinct secrets per purpose:**
  - `SESSION_SIGNING_SECRET` (+ `_PREVIOUS`): also signs widget visitor credentials (domain-separated `as-visitor:v1:` HMAC input);
  - `APPROVAL_SIGNING_SECRET`;
  - `WEBHOOK_SIGNING_SECRET`;
  - `MANYCHAT_WEBHOOK_SECRET`;
  - `EVAL_HARNESS_SECRET` (≥ 16 chars, or the harness is disabled);
  - provider keys.

  Generate them with `openssl rand -base64 48`.
- **PII redaction:**
  - `redactSensitive(text, { kinds })` covers `email`, `phone`, `credit_card` (Luhn), `ssn`, `iban`, `api_key`, `jwt`, `private_key` and `ip_address`;
  - `redactDeep(value)` additionally masks keys named `authorization`, `api_key`, `secret`, `password`, `token` and `cookie`;
  - tool output is redacted by default (keys, JWTs, private keys, cards, SSNs), and so are relay payloads;
  - the assistant's own text is **not** redacted in Flue agents.
- **Data residency:** there is no jurisdiction configuration. Durable Objects, R2, Vectorize and KV use default placement. See Not yet implemented.

## Recipes
Copy-paste code lives in [references/recipes.md](references/recipes.md):
- mount a new agent securely;
- host SaaS token minting;
- a widget visitor session (signed credential, visitor token);
- a signed webhook route with a per-tenant secret and rate limit;
- a Stripe webhook;
- a tenant-config push from the SaaS;
- OAuth + MCP wiring;
- a Pusher private-channel auth route;
- a tenant-scoped R2 tool.

## Persistent agents (always-on; full guide: `agent-starter-persistent-agents`)
- **Trusted control plane, untrusted agent.** `PersistentAgentControl` (one DO per agent, named `${tid}/${agentId}`) owns config, schedule, egress, credentials and the audit log. The agent can only `propose` (tools `propose_config_change`, `propose_skill`). Widening changes and every skill wait for a human (`classifyProposal`). Every applied change bumps `version`.
- **Own principal.** `agentIdentity(tenantId, agentId, ownerUserId)` gives `agent:<t>/<a>` acting for `user:<owner>`. The conversation id is `persistentAgentInstanceId()`, a harness key no user can own. agentAuth strips `persistent` from `extraInitialData`, so only the control plane's dispatch sets the identity.
- **Agent assertion** to the host SaaS: `signAgentAssertion(secret, { identity, audience })` produces an HS256 compact token with `sub`, `act.sub`, `tenant`, `aud`, `exp` ≤ 5 min and `jti`. Verify it with `verifyAgentAssertion` (audience, lifetime, `jti` replay guard). This mirrors RFC 8693 `act` and stands in until the WAG/XAA drafts settle.
- **Network:** `createEgressGuard` layers the SSRF guard, `DEFAULT_DENY` and a managed allowlist. Tenant and agent lists only narrow it. The hook checks every URL argument and every redirect hop.
- **Secrets:** `CredentialBroker` injects a named credential only for its bound https hosts and strips it on redirect. `scrub()` removes secret values from tool output. Secrets never appear in args, results or logs.
- **Process:** `filterSensitiveEnv(env)` runs before any VM command of a persistent agent.
- **Routes:** `createPersistentControlRoutes`. Errors are explicit: 401 `UNAUTHENTICATED`, 403 `FORBIDDEN` with a reason. Creating an agent requires a creator role (default `admin`), managing it requires owner or admin, and the audit log requires a `security` or `admin` role.

## Checklist (spec requirements; each with its proof)
- [ ] **Every agent route is behind `agentAuth`.** Verify: `grep -n "createAgentRouter" src/app.ts` — each line is preceded by an `app.use(".../*", agentAuth(...))` for the same mount.
- [ ] **Tenant isolation validation:** a client cannot spoof `initialData`, and a different tenant or user gets 403. Verify: `test/security.test.ts` ("forbids opening another tenant's or another user's conversation", "overwrites client-supplied initialData") and `packages/flue/test/http-security.test.ts` ("never lets extraInitialData override the server-derived identity").
- [ ] **Exact conversation ownership for any `sub`** (R-TEN-09): no prefix match; emails and `--` subjects own their conversations. Verify: `http-security.test.ts` "forbids alice from opening alice.bob's conversation (no prefix match)", "lets a user whose sub is an email open the conversation minted for them"; `packages/core/test/tenancy-signing.test.ts` "conversation ids and ownership".
- [ ] **Conversation ids are minted server-side.** Verify: UIs call `POST /api/<agent>/conversations` (`createConversationRoute`) and never build ids themselves.
- [ ] **The thread list is per user + tenant** (R-APP-10). Verify: `http-security.test.ts` "lists, titles and removes only the caller's own threads".
- [ ] **Server-only signals can't be posted by clients.** Verify: `http-security.test.ts` "refuses client-posted server-only signals but allows escalations".
- [ ] **Widget visitor tokens reach only the support agent** (SEC-01): every other mount, conversation API, approvals identity, module route and voice route refuses them. Verify: `packages/flue/test/edge-auth.test.ts` "probe visitor.test.ts: a visitor token is refused on /agents/coder (it used to return 202)", "refuses visitors on conversation APIs (except the widget's) and never treats them as approvers or admins"; `packages/core/test/identity-edge.test.ts` "rejects widget visitor tokens everywhere that does not opt in"; generated `src/app.ts` has `allowVisitors: true` only on the widget agent's mount.
- [ ] **Visitor identity is server-minted** (SEC-02): a client-chosen visitor id is ignored; only the signed credential resumes it. Verify: `identity-edge.test.ts` "proves a visitor id for one tenant only, and a bare id proves nothing"; `packages/livekit/test/voice-limits.test.ts` "SEC-02: a client-chosen visitorId is ignored".
- [ ] **The voice agent's token is bound to its one conversation** (SEC-09). Verify: `edge-auth.test.ts` "works for GET and POST on its conversation only"; `voice-limits.test.ts` "SEC-09: the voice agent's Flue token is audience `voice`…".
- [ ] **Delivery attributes are server-owned** (channel, route; client attributes and tagName dropped). Verify: `edge-auth.test.ts` "drops client attributes and tagName on signals and stamps the channel", "turns a voice-channel user turn into a stamped voice-utterance signal".
- [ ] **Chat rate limits are per user with a tenant ceiling and a visitor pool** (SEC-11). Verify: `edge-auth.test.ts` "one user hammering the agent does not lock out the rest of the tenant", "caps each visitor tightly and all visitors together below the tenant ceiling".
- [ ] **Cookie-authenticated requests are CSRF-protected** (SEC-13). Verify: `edge-auth.test.ts` "rejects text/plain and cross-site origins, accepts same-origin or trusted JSON".
- [ ] **Harness and event instance ids can never be a user's conversation, never truncate a tenant, never merge keys** (SEC-15, SEC-19, SEC-20). Verify: `identity-edge.test.ts` "probe: two tenants sharing a 120-char prefix get different instances", "probe: \\uD800 and U+FFFD no longer share an owner segment", "probe: a user named dlg or room can never own a delegation or room instance".
- [ ] **Session tokens are HMAC-verified, expiring and rotatable; bad payloads fail as `SIGNATURE_INVALID`.** Verify: `tenancy-signing.test.ts` "throws AgentError for a correctly signed but unreadable session token payload", plus a `verifySessionToken([new, old], …)` test.
- [ ] **Decide-by-id needs an operator session of the same tenant** (contract 3): 401 without a session, 403 for a member, another tenant or a cross-site cookie request; the dispatched token is bound to the operator. Verify: flue `decide-by-id.test.ts` "requires an operator or admin session in the conversation's tenant", "refuses cross-site cookie sessions (CSRF) but accepts same-origin JSON ones", "an operator token decides only its own approval, for the bound operator, without the record nonce".
- [ ] **Approvals: approver identity comes from a verified session, links can be bound, secrets rotate** (R-SEC-05). Verify: `http-security.test.ts` "derives the approver from a verified session, never from the x-approver header", "enforces recipient-bound links and accepts the previous secret during rotation"; `tenancy-signing.test.ts` "approval tokens".
- [ ] **Cross-tenant tool arguments are a hard authorization error.** Verify: `packages/core/test/tools.test.ts` "blocks cross-tenant arguments with ERROR_UNAUTHORIZED_TENANT".
- [ ] **R2 and Vectorize access is tenant-confined; long vector ids never collide.** Verify: `security.test.ts` "confines blob keys…" and "never returns another tenant's vectors"; `packages/cloudflare/test/edge-security.test.ts` "hashes ids over 64 bytes deterministically instead of truncating". The Vectorize index has `tenantId` (and, with the chat module, `userId`) metadata indexes (`scripts/init-cloudflare-infra.sh`).
- [ ] **Edge tenant config:** missing → secure default; corrupted → lockdown; synced from the SaaS with method/path-bound, single-use signatures (R-TEN-02). Verify: `security.test.ts` "falls back to secure defaults and locks down corrupted config"; `edge-security.test.ts` "tenant sync".
- [ ] **Tenant feature flags gate capabilities** (R-TEN-10, `codeExecution`). Verify: `edge-security.test.ts` "requires features.codeExecution and gives inner calls deterministic ids so replays dedupe".
- [ ] **Webhook ingestion:** signature over the raw body, zod contract, tenant resolved from a trusted source, 202 + enqueue, zero AI work, optional nonce cache. Verify: `packages/cloudflare/test/cloudflare.test.ts` (202 / 401 / 400 cases); `edge-security.test.ts` "enqueues a delivery once and answers duplicates with 200".
- [ ] **A signed delivery cannot be replayed into another tenant, source or request id** (SEC-06). Verify: `packages/cloudflare/test/ingestion-signing.test.ts` "probe ingest.test.ts: a body-only signature replayed to another tenant or source is now a duplicate", "contract 13: signedDeliveryVerifier binds method + path + body…".
- [ ] **Event payloads reach the model as untrusted data.** Verify: `ingestion-signing.test.ts` "wraps every provider field so a payload cannot close the wrapper or pose as instructions".
- [ ] **Multi-v1 rotation and replay window; malformed `t` rejected** (R-SEC-06). Verify: `security.test.ts` "verifies signed webhooks and rejects tampering and replays"; `tenancy-signing.test.ts` "rejects a non-numeric timestamp instead of skipping the window check (NaN)".
- [ ] **Tenant-level rate limits before waking agents** (R-EVT-04). Verify: chat — `http-security.test.ts` "rate limits chat turns per tenant with 429 + retry-after, honouring TenantConfig.rateLimit"; ingestion — pass a `TokenBucketRateLimiter` to `createIngestionHandler`/`processEventBatch` ("defers turns when the tenant is over its rate limit"). The generated `src/app.ts` passes `rateLimiter: chatRateLimiter, tenantConfig: tenantRateLimit` on every mount.
- [ ] **Outbound webhooks are signed and carry the tenant id; receivers verify both.** Verify: a SaaS-side test calls `verifySignature` on the relayed body and checks `x-tenant-id === body.tenantId`.
- [ ] **Every outbound fetch is SSRF-guarded by the one core guard** (R-SEC-07). Verify: `tenancy-signing.test.ts` "shared SSRF guard", `integrations` `web.test.ts` "SSRF guard", `edge-security.test.ts` "Browser Rendering SSRF guard".
- [ ] **Prompt injection is classified as untrusted and the run halts.** Verify: `flue-e2e.test.ts` "locks tools and refuses when a message is a prompt injection", plus the Promptfoo adversarial set (`pnpm evals`).
- [ ] **Free-text answers and approval notes never ride in signal attributes** (SEC-14). Verify: `edge-auth.test.ts` "keeps the text inside the wrapped body and the card can still show it"; `http-security.test.ts` "derives the approver from a verified session, never from the x-approver header".
- [ ] **Injection cleansing at the edge, spec keywords included.** Verify: `security.test.ts` "cleanses imperative payloads in untrusted fields", core `round3.test.ts` "neutralises the four keywords anywhere, mid-sentence and without a colon", and `integrations` `webhooks.test.ts`.
- [ ] **Ingestion failures answer the JSON crash contract.** Verify: cloudflare `round3-edge.test.ts` "answers 500 INTERNAL_INGESTION_CRASH as JSON when the enqueue fails".
- [ ] **Sandbox escape prevention and no duplicate side effects from `run_code`:** model code can't read env or reach other Durable Objects; `run_code` declares its strongest inner side effect, is not auto-retried and uses deterministic inner call ids. Verify: `createCodeExecutionTool` uses `globalOutbound: null` with no bindings; `edge-security.test.ts` "codemode run_code"; plus an adversarial eval.
- [ ] **OAuth 2.1 protects `/mcp`:** unauthenticated → 401 with `WWW-Authenticate`; missing scope → 403 `insufficient_scope`; grants carry tenant props; firewall quotas per request; consent reads the session from the cookie only. Verify: `curl -i $BASE/mcp` → 401; `GET /.well-known/oauth-protected-resource` lists `resource`; `edge-security.test.ts` "builds the executor (firewall quotas) per request and caller"; `ingestion-signing.test.ts` "ignores ?session= (it would leak into logs and Referer) and visitor tokens".
- [ ] **No insecure endpoints:** every non-public route verifies a session, signature or OAuth token. Verify: route review in `src/app.ts` and the module routes, and `pnpm test`.
- [ ] **Realtime channels are tenant-checked:** Pusher `private-tenant-<tid>-room-*` subscriptions are authorized only for the user's tenant. The Worker serves `POST /api/pusher/auth` (run owner or admin/operator; 400/401/400/403); a host app can use `web/host-routes.example.ts` `pusherAuth` instead. Verify: `integrations` `pusher.test.ts` ("rejects cross-tenant subscriptions") and generated `delivery.test.ts` "answers 400 / 401 / 400 / 403 like the spec and authorizes owners and operators".
- [ ] **Secrets never committed:** `.dev.vars` is gitignored and production values come from `wrangler secret put`. Verify: `git check-ignore .dev.vars` and `grep -rn "sk-" src/` (empty).
- [ ] **Secrets and PII redacted from tool output and telemetry.** Verify: `security.test.ts` "redacts secrets and card numbers from output".

- [ ] **Persistent agents cannot set their own config or identity** (R-PER-*). Verify: `packages/core/test/persistent.test.ts` "never lets a patch change identity, owner, enabled or version"; `packages/cloudflare/test/persistent-control.test.ts` "requires a session (401), a creator role to create (403) and owner/admin to manage"; `packages/flue/test/http-security.test.ts` "never lets a user's request carry a persistent agent identity".
- [ ] **Agent assertions are short-lived, audience-bound and single-use.** Verify: `persistent.test.ts` "rejects the wrong audience, expiry, tampering and replays".

## Pitfalls
- **CORS credentials for widget sites.** Generated apps use `agentCors(WIDGET_PATHS)` (`src/lib/cors.ts`): credentials go only to `ALLOWED_ORIGINS`; widget origins get CORS without credentials (widgets authenticate with Bearer visitor tokens, never cookies). Don't re-add a global `cors({ credentials: true })`.
- **Stripe webhooks are per tenant.** `/webhooks/stripe/:tenantId` verifies only that tenant's own `stripe-webhook-secrets:<tenant>` (404 when none) — there is deliberately no shared fallback secret.
- **Existing conversation ids changed for non-alphanumeric subs:** ids are minted with `encodeIdSegment(sub)`. A `sub` like `auth0|abc` used to produce `auth0_abc`; it now produces `auth0:7Cabc`, so pre-existing conversations of such users are no longer reachable through `agentAuth` (their DOs still exist). Plain `[A-Za-z0-9_]` subs are unchanged.
- **Mounts without the tenant-config seed:** the generated mounts seed `initialData.tenantConfig` (`extraInitialData: seedInitialData`), so the first render uses the tenant's config. A custom mount without it renders its first submission on `SECURE_DEFAULT_TENANT_CONFIG`. Keep agent-level `firewall.deny` for anything critical.
- **Body-only webhook signatures:** with `verifySignature` (body only) the tenant and source in the URL are unsigned; the nonce and event id then come from the signed body alone, so a legitimately identical body sent to two tenants inside the window is treated as a replay. Use `signedDeliveryVerifier` (method + path + body) with per-tenant secrets; the generated background routes do.
- **Replays within the tolerance window:** a valid signed webhook is accepted for 300 s unless you pass `nonceCache` to `createIngestionHandler`. Keep downstream effects idempotent either way.
- **Visitor tokens on a custom mount:** a mount that should serve the widget needs `allowVisitors: true` on BOTH `agentAuth` and `createConversationRoute`; anything you add for visitors must be read-only or ticket-style, because the visitor is anonymous. Never set `allowVisitors` on an internal agent.
- **Cookie auth from another origin:** cookie-authenticated requests whose `Origin` is not the Worker's own are refused unless listed in `agentAuth({ trustedOrigins })`. If your SaaS frontend calls the agent Worker cross-origin with the `agent_session` cookie, pass its origins (for example the `ALLOWED_ORIGINS` list); Bearer tokens need nothing.
- **Voice turns arrive as signals:** a voice-channel `{ kind: "user" }` POST is delivered as a `voice-utterance` signal (Flue user messages cannot carry attributes). Code that branches on `delivery.kind === "user"` must use `isUserTurn(delivery)` to include spoken turns.
- **No route stamp on chat turns:** `classify` can only stamp signals; Flue's `DeliveredUserMessageSchema` strips unknown keys from `{ kind: "user" }`, so `deliveryRoute()` is undefined for typed chat turns.
- **Instance ids changed for odd keys:** `agentInstanceId` now hashes session keys outside `[A-Za-z0-9_.:-]{1,160}` instead of replacing characters with `_`, and throws on an invalid tenant id. Background jobs or rooms keyed that way get new instance ids after upgrading.
- **Tenant-sync signers must sign method + path:** a SaaS sender that still signs only the body (`signPayload(secret, body)`) gets 401. Switch it to `signRequest(secret, { method, path, body })` (recipe 5).
- **Unbound approval/answer links act for whoever holds them:** decisions are attributed to `approval-link` / `answer-link` unless the request carries a verified session (`createApprovalRoutes({ sessionSecret })`). Bind sensitive approvals to one approver (`new ApprovalStore(sql, secret, { recipient })`) and questions with `bindTo`.
- **The eval harness secret is powerful:** `POST /api/test-eval-harness` runs any tenant (pin them with `EVAL_TENANTS`) as an `eval:`-namespaced user; `live` mode is refused unless `EVAL_ALLOW_LIVE=true`. Only enable `EVAL_HARNESS_SECRET` in staging, or with a long random secret.
- **MCP has no approvals:** the template's `createToolMcpHandler` gets no `ApprovalStore`, so CRITICAL tools return a pending result that can never be approved via MCP.
- **Lock bypass via raw tools:** `useMcpConnection` and raw `useTool` tools are not removed by the security lock.
- Don't log raw request bodies or tokens. Telemetry goes through `redactDeep`; `console.log` does not.

## Verify
```bash
pnpm --filter @agent-starter/core test        # security.test.ts, tools.test.ts, tenancy-signing.test.ts
pnpm --filter @agent-starter/flue test        # http.test.ts + http-security.test.ts (edge security), ask-person, flue-e2e (injection lock)
pnpm --filter @agent-starter/cloudflare test  # ingestion 202/401/400, rate limits, edge-security (tenant sync, nonce cache, Vectorize ids, codemode, SSRF, MCP)
pnpm --filter @agent-starter/integrations test  # webhooks (Stripe/Manychat), pusher auth, web SSRF
# generated app
pnpm test             # test/security.test.ts (edge contract) + harness
pnpm evals            # adversarial injection / exfiltration cases
```

## Related skills
`agent-starter-tools-and-firewall` (approvals, firewall) · `agent-starter-background-jobs` (queue consumer,
coalescing, DLQ) · `agent-starter-memory-and-context` (tenant-scoped memory) · `agent-starter-generative-ui`
(widget, Pusher client) · `agent-starter-evals-and-ops` (adversarial evals) · `agent-starter-definition-of-done`.

## Not yet implemented
- **Data residency:** no R2 location hint or regional Vectorize/KV configuration in templates.
- **Strict once-only replay protection:** `KeyValueReplayGuard` and the ingestion nonce cache sit on eventually consistent KV; a Durable Object-backed guard is not shipped.
- **Separate secrets per webhook direction:** one `WEBHOOK_SIGNING_SECRET` still signs tenant-config sync and outbound relays (and is a fallback for inbound events). A receiver of your outbound relays could sign a tenant-sync request with it; split it when relays go to third-party endpoints.
- **Run-telemetry channel ownership:** `web/host-routes.example.ts` authorizes every `private-tenant-<tid>-room-*` channel of the tenant; it does not check that the run belongs to the user.
