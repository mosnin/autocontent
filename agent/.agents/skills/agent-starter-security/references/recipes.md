# Security recipes (generated-project conventions)

## 1. Mount a new agent securely (`src/app.ts`)
```ts
import { agentAuth, createConversationRoute } from "@agent-starter/flue";
import { createAgentRouter } from "@flue/runtime/routing";
import { BillingAgent } from "./agents/billing.ts";

// sessionSecrets = [SESSION_SIGNING_SECRET, SESSION_SIGNING_SECRET_PREVIOUS] is already defined in app.ts
app.use("/agents/billing-agent/*", agentAuth({ secret: sessionSecrets, agentName: "billing-agent", mount: "/agents/billing-agent", adminRoles: ["admin"] }));
app.route("/agents/billing-agent", createAgentRouter(BillingAgent));
app.route("/api/billing-agent", createConversationRoute({ agentName: "billing-agent", secret: sessionSecrets }));
// and add BillingAgent to the createApprovalRoutes({ agents: [...] }) list
```
- Never add `allowVisitors: true` here: only the widget's support agent accepts anonymous visitor tokens.
- If your SaaS frontend calls this mount cross-origin with the `agent_session` cookie (not a Bearer token), add
  `trustedOrigins: (c) => (c.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)`;
  other cross-site cookie requests get 403 `CSRF_REJECTED`.
To pass the current page or entity to an in-app copilot, use
`extraInitialData: (c, claims) => ({ context: { page: c.req.header("x-page") ?? "" } })`. It is merged into
`initialData`. `useAgentStarter` renders it as `[APP CONTEXT]`, capped at 4 000 chars. **Never put identity
in it.**

## 2. Host SaaS: mint agent session tokens
Use `web/host-routes.example.ts` (`mintAgentSession`) when the SaaS can import `@agent-starter/core`. For any
other Node backend, this produces the same token format:
```ts
import { createHmac } from "node:crypto";

export function mintAgentSession(secret: string, user: { id: string; tenantId: string; roles: string[] }, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ sub: user.id, tid: user.tenantId, roles: user.roles, scopes: [], iat: now, exp: now + ttlSeconds, env: "production" })).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
```
Rules for the token claims:
- `sub` is any stable user id (emails and `auth0|…` work: it is encoded injectively into conversation ids), but it
  must be well-formed UTF-16 (no lone surrogates) and must never be reassigned to another person.
- `tid` must match `TENANT_ID_PATTERN`.
- Never set `aud` or the `visitor` role for signed-in users: restricted tokens are refused by most routes.
- Keep TTLs short and re-mint on the client.

## 3. Signed webhook route with a per-tenant secret and a rate limit
```ts
// src/background/routes.ts
import { createIngestionHandler, KVStore, signedDeliveryVerifier } from "@agent-starter/cloudflare";
import { TokenBucketRateLimiter } from "@agent-starter/core";
import { ChatMessageEventSchema } from "@agent-starter/integrations";

backgroundRoutes.post("/events/chat/:tenantId", async (c) => {
  const tenantId = c.req.param("tenantId");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(tenantId)) return c.json({ error: "INVALID_TENANT" }, 400);
  // Per-tenant secret (current + previous for rotation) stored by your SaaS, e.g. KV `whsec:<tenant>` = JSON array.
  const secrets = JSON.parse((await c.env.TENANT_CONFIG.get(`whsec:${tenantId}`)) ?? "[]") as string[];
  if (secrets.length === 0) return c.json({ error: "UNKNOWN_TENANT" }, 404);
  const handler = createIngestionHandler({
    source: "chat",
    schema: ChatMessageEventSchema,
    // HMAC over METHOD + path + body (sender: signRequest(secret, { method: "POST", path, body })): a captured
    // delivery can't be replayed to another tenant or source, and the replay nonce comes from signed data.
    verify: signedDeliveryVerifier(secrets),
    tenantId: () => tenantId, // signed (it is in the path) and bound to the tenant's own secret
    sessionKey: (p) => p.conversationId,
    eventType: (p) => p.type,
    eventId: (p) => p.id, // stable id → envelope id `chat:<id>` → dedupe across retries
    queue: c.env.EVENTS_QUEUE as Queue,
    nonceCache: { store: new KVStore(c.env.AGENT_CACHE), ttlSeconds: 900, prefix: "nonce:webhook:" },
    rateLimiter: new TokenBucketRateLimiter(new KVStore(c.env.AGENT_CACHE), { ratePerMinute: 60, burst: 20 }),
  });
  return handler(c.req.raw);
});
```
To apply the tenant's own limits, load `tenantConfigs().get(tenantId)` and call
`limiter.take(tenantId, 1, { ratePerMinute: cfg.rateLimit.eventsPerMinute, burst: cfg.rateLimit.burst })` in
your own wrapper. The handler's built-in call passes no override.

## 4. Stripe webhook
```ts
import { createEnvelope } from "@agent-starter/core";
import { parseStripeEvent } from "@agent-starter/integrations";

app.post("/webhooks/stripe/:tenantId", async (c) => {
  const raw = await c.req.text();
  let event;
  try {
    event = await parseStripeEvent(c.env.STRIPE_WEBHOOK_SECRET, raw, c.req.header("stripe-signature")); // add STRIPE_WEBHOOK_SECRET to src/env.ts
  } catch {
    return c.json({ error: "SIGNATURE_INVALID" }, 401);
  }
  const envelope = createEnvelope({ id: `stripe:${event.id}`, tenantId: c.req.param("tenantId"), source: "stripe", type: event.type, sessionKey: String(event.data.object.customer ?? event.id), payload: event, signatureVerified: true });
  await (c.env.EVENTS_QUEUE as Queue).send(envelope, { contentType: "json" });
  return c.json({ accepted: true, eventId: envelope.id }, 202);
});
```
`parseStripeEvent` uses one secret per call. To rotate, try the new secret first and fall back to the old one.
(The header itself may carry several `v1` entries.)
Better still, reuse `createIngestionHandler` with
`verify: (raw, req) => verifyStripeSignature(secret, raw, req.headers.get("stripe-signature")).then(() => undefined)`
and `schema: StripeEventSchema`. That gets you the size limits and rate limiting.

## 5. SaaS → edge tenant config push
```ts
// In the SaaS backend. The signature covers METHOD + path + body (canonicalRequest), and each signed
// request is accepted once (KV replay cache), so it can't be replayed against another tenant or verb.
import { signRequest } from "@agent-starter/core";

const path = `/internal/tenants/${tenantId}/config`;
const body = JSON.stringify({ tier: "growth", maxTurnsPerSession: 40, maxBudgetUsd: 3, allowedModelProfiles: ["frontier", "first-line"], deniedTools: ["app_api_delete"] });
const { header } = await signRequest(process.env.WEBHOOK_SIGNING_SECRET as string, { method: "PUT", path, body });
await fetch(`${AGENT_BASE_URL}${path}`, { method: "PUT", headers: { "content-type": "application/json", "x-agent-signature": header }, body });

// Remove a tenant's config (falls back to secure defaults): sign the DELETE with an empty body.
const del = await signRequest(process.env.WEBHOOK_SIGNING_SECRET as string, { method: "DELETE", path });
await fetch(`${AGENT_BASE_URL}${path}`, { method: "DELETE", headers: { "x-agent-signature": del.header } });
```
- A **400** `CONFIG_INVALID` response means the config failed `TenantConfigSchema`. The edge keeps the previous value.
- A **401** means a bad or reused signature: sign every request freshly (a retry needs a new `signRequest`), and make sure `path` is exactly the request path.
- Not in TypeScript? Compute `hex(HMAC-SHA256(secret, "${t}." + "PUT\n" + path + "\n" + body))` and send `x-agent-signature: t=<unix seconds>,v1=<hex>`.

## 5b. Chat rate limits, approver identity and bound approvals (`src/app.ts`)
```ts
import { KVStore } from "@agent-starter/cloudflare";
import { TokenBucketRateLimiter } from "@agent-starter/core";
import { tenantConfigs } from "./lib/platform.ts";

app.use("/agents/assistant/*", agentAuth({
  secret: sessionSecrets, agentName: "assistant", mount: "/agents/assistant",
  // 429 + retry-after. One bucket per user sized by TenantConfig.rateLimit, a tenant ceiling (10× that rate),
  // and for widget visitors a per-visitor bucket plus a shared visitor pool (rateLimits to tune).
  rateLimiter: (c) => new TokenBucketRateLimiter(new KVStore(c.env.AGENT_CACHE), { ratePerMinute: 30, burst: 10, prefix: "rl:chat:" }),
  tenantConfig: (_c, tenantId) => tenantConfigs().get(tenantId),
}));
// Decisions and answers are attributed to the signed-in user (Bearer or agent_session cookie), never a header.
app.route("/", createApprovalRoutes({ agents: [...], secret: (c) => c.env.APPROVAL_SIGNING_SECRET, sessionSecret: sessionSecrets }));
```
Bind an approval link to one approver with `new ApprovalStore(sql, secret, { recipient: (record) => "<approver sub>" })`;
the route then requires that user's session (403 `APPROVER_MISMATCH` otherwise). Rotate the approval secret by
passing `[new, old]` wherever it is read.

## 6. OAuth 2.1 + MCP server
`src/in-app/oauth-mcp.ts`, generated by the `in-app` module, is the reference. It is walked through in
[oauth-mcp.md](oauth-mcp.md).

## 7. Pusher private-channel auth
The generated Worker mounts `POST /api/pusher/auth` (`src/lib/pusher-auth.ts`). It answers 404 until `PUSHER_*` is set
and `integrations.pusher` is on, then 400 for missing params, 401 without a session, 400 for a malformed channel, and
403 for another tenant or someone else's run. Run channels are open to the run's owner and to admin/operator roles; a
`cid`-bound token can watch only its own conversation. Room channels (`room--…`) are admin/operator only, because a room
id is not a conversation id. A host app that signs channels itself uses `web/host-routes.example.ts`
`pusherAuth(request, user | null)`, which applies the same codes and checks. `user` must come from your authenticated
session, never from the form.

## 8. Tenant-scoped R2 tool
```ts
import { defineAgentTool, TenantScopedBlobStore } from "@agent-starter/core";
import * as v from "valibot";
import { workspaceBlobs } from "../lib/platform.ts";

export const readTenantFile = defineAgentTool({
  name: "read_tenant_file",
  description: "Read a file from this workspace's document store.",
  input: v.object({ path: v.pipe(v.string(), v.maxLength(300)) }),
  risk: "LOW",
  sideEffect: "read",
  execute: async ({ path }, ctx) => {
    const store = new TenantScopedBlobStore(workspaceBlobs(), ctx.tenant.tenantId, "docs"); // keys → tenants/<tid>/docs/<path>
    const object = await store.get(path); // "../" or absolute paths throw TenantIsolationError
    return object ? object.text() : `No file at ${path}`;
  },
});
```

## 9. Widget visitor session (`src/widget/routes.ts`)
```ts
import { createVisitorSessionToken, resolveVisitor } from "@agent-starter/core";

// After the publishable key + Origin allowlist check:
const secrets = [c.env.SESSION_SIGNING_SECRET, c.env.SESSION_SIGNING_SECRET_PREVIOUS].filter(Boolean) as string[];
// A valid credential (HMAC over tenant:visitorId) resumes that visitor; anything else mints a fresh random id.
const visitor = await resolveVisitor(secrets, site.tenantId, body.visitor);
const token = await createVisitorSessionToken(c.env.SESSION_SIGNING_SECRET, site.tenantId, visitor.visitorId, 2 * 3600);
return c.json({ token, visitor: visitor.credential, conversationId: conversationIdFor("support-agent", { tid: site.tenantId, sub: `visitor_${visitor.visitorId}` }, "widget") });
```
The browser stores `visitor` (the credential) and sends it back next time; never accept a client-chosen
visitor id as identity. The token (role `visitor`, audience `widget`) only works where `allowVisitors: true`.
