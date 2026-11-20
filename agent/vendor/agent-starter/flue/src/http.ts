import {
  type ApprovalSecret,
  assertApprover,
  conversationInstanceId,
  createOperatorDecisionToken,
  encodeIdSegment,
  isConversationOwner,
  isVisitorClaims,
  parseAgentInstanceId,
  parseConversationInstanceId,
  type RateLimitDecision,
  type SessionClaims,
  sanitizeSessionKey,
  sha256HexSync,
  type TenantConfig,
  validateHumanAnswer,
  verifyApprovalToken,
  verifyHumanQuestionToken,
  verifySessionToken,
  VOICE_AUDIENCE,
  WIDGET_AUDIENCE,
  wrapUntrusted,
} from "@agent-starter/core";
import { type Agent, dispatch } from "@flue/runtime";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { humanAnswerSignalBody } from "./ask-person.ts";
import { VOICE_SCOPE } from "./voice.ts";

/** Structural rate limiter (core `TokenBucketRateLimiter` fits). */
export interface ChatRateLimiter {
  take(key: string, cost?: number, override?: { ratePerMinute: number; burst: number }): Promise<RateLimitDecision>;
}

/** Signal types a browser may post into a conversation. Everything else (tool-approval, human-answer, …) is server-only. */
export const DEFAULT_CLIENT_SIGNAL_TYPES = ["escalation"] as const;

/**
 * Signal type `agentAuth` turns a voice-channel `{ kind: "user" }` turn into. Flue's user messages
 * cannot carry attributes (its `DeliveredUserMessageSchema` strips unknown keys), so the per-delivery
 * `channel: "voice"` stamp can only ride on a signal. Treat it as user input (same trust as a chat turn).
 */
export const VOICE_UTTERANCE_SIGNAL = "voice-utterance";

/** Channel a delivery arrived on (server-stamped by `agentAuth`). */
export type DeliveryChannel = "chat" | "voice";
/** Route verdict from the optional edge classifier. */
export type DeliveryRoute = "SIMPLE" | "COMPLEX";

/** Attributes the client may never set: `agentAuth` owns them. */
export const SERVER_DELIVERY_ATTRIBUTES = ["channel", "route"] as const;

export interface AgentAuthOptions {
  /** Session token secret(s) shared with the host SaaS (rotate by passing [new, old]). */
  secret: (c: Context) => string | string[];
  /** Agent identity used in conversation ids (`${agent}--${tenant}--${session}`). */
  agentName: string;
  /** Path prefix the agent router is mounted at, e.g. "/agents/support". */
  mount: string;
  /** Allow staff roles to open any conversation in their tenant. */
  adminRoles?: string[];
  /**
   * Accept anonymous widget visitor tokens (role `visitor` / audience `widget`) on this mount.
   * Default false: visitors get 403 everywhere except the widget agent's mount, which sets it.
   */
  allowVisitors?: boolean;
  /**
   * Extra server-side initialData (sync or async), e.g. the copilot's current page, or a trusted
   * `tenantConfig` seed loaded from KV so a paid tenant's first submission does not render on the
   * secure default. Never overrides the server-derived identity; client-sent initialData is always dropped.
   */
  extraInitialData?: (c: Context, claims: SessionClaims) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;
  /**
   * Signal types clients may post (`{ kind: "signal", type }`). Default
   * `["escalation"]`. Server-only signals such as `tool-approval` and
   * `human-answer` carry decisions and must come from the signed routes.
   */
  clientSignalTypes?: readonly string[];
  /**
   * Edge route classifier. When given, every chat-channel signal delivery (client signals such as
   * escalations) is stamped with a server-trusted `route` attribute. Flue `kind: "user"` messages cannot
   * carry attributes, so typed chat turns are not stamped (the agent classifies those itself), and voice
   * turns are never classified (they always use the voice model).
   */
  classify?: (text: string, c: Context) => Promise<DeliveryRoute>;
  /**
   * Chat rate limits (POST). Buckets: one per user (the tenant's `rateLimit`, else the limiter
   * defaults), one tenant-wide ceiling (`tenantMultiplier` × the tenant rate, only when the tenant
   * rate is known), and for visitors a per-visitor bucket plus one shared visitor bucket per tenant.
   * Exceeding any returns 429 with `retry-after`.
   */
  rateLimiter?: (c: Context) => ChatRateLimiter | undefined;
  /** Bucket sizing (defaults: tenant ceiling 10× the tenant rate, 10/min burst 5 per visitor, all visitors 2× the tenant rate). */
  rateLimits?: { tenantMultiplier?: number; perVisitor?: { ratePerMinute: number; burst: number }; visitorsMultiplier?: number };
  /** Tenant config lookup; its `rateLimit` (eventsPerMinute/burst) sizes the per-user bucket and the tenant ceiling. */
  tenantConfig?: (c: Context, tenantId: string) => Promise<Pick<TenantConfig, "rateLimit"> | undefined>;
  /**
   * Origins (besides the request's own) allowed to make COOKIE-authenticated POSTs. Cookie-authenticated
   * POSTs must also be `content-type: application/json` (forces a CORS preflight). Bearer requests are
   * not affected (a browser cannot attach the header cross-site without CORS approval).
   */
  trustedOrigins?: (c: Context) => readonly string[];
  /** Conversation index for thread lists (touched on each message). Default: the `TENANT_CONFIG` KV binding; `false` disables. */
  conversationIndex?: ConversationIndexOption;
}

/** Conversation ids are minted server-side so tenants/users can never address each other's agents. */
export function conversationIdFor(agentName: string, claims: Pick<SessionClaims, "tid" | "sub">, sessionKey: string): string {
  return conversationInstanceId(agentName, claims.tid, claims.sub, sessionKey);
}

const SESSION_COOKIE = /(?:^|;\s*)agent_session=([^;]+)/;

/** Verify the caller's session from `authorization: Bearer` or the `agent_session` cookie; null when absent/invalid. Restricted (visitor, voice) tokens never count. */
async function optionalSession(c: Context, secret: ((c: Context) => string | string[]) | undefined): Promise<SessionClaims | null> {
  if (!secret) return null;
  const candidates: string[] = [];
  const header = c.req.header("authorization");
  if (header) candidates.push(header);
  const cookie = SESSION_COOKIE.exec(c.req.header("cookie") ?? "")?.[1];
  if (cookie) {
    try {
      candidates.push(decodeURIComponent(cookie));
    } catch {
      // malformed cookie encoding: ignore
    }
  }
  for (const token of candidates) {
    try {
      return await verifySessionToken(secret(c), token);
    } catch {
      // try the next credential
    }
  }
  return null;
}

/** Run a best-effort write after the response when the platform allows it (Workers `waitUntil`), else inline. */
async function bestEffort(c: Context, task: () => Promise<unknown>): Promise<void> {
  const promise = task().catch(() => undefined);
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    await promise;
  }
}

/** The channel of a set of claims: `voice` for the voice agent's conversation-bound token, else `chat`. */
export function claimsChannel(claims: Pick<SessionClaims, "scopes"> & { aud?: string | undefined }): DeliveryChannel {
  return claims.aud === VOICE_AUDIENCE || claims.scopes.includes(VOICE_SCOPE) ? "voice" : "chat";
}

interface DeliveryLike {
  kind: string;
  type?: string;
  attributes?: Record<string, string> | undefined;
}

/**
 * Per-delivery channel (contract with `useAgentStarter`): a signal stamped by `agentAuth` carries
 * `attributes.channel`; an HTTP `kind: "user"` turn is always chat (voice turns arrive as
 * `voice-utterance` signals); anything else (server signals such as approvals) falls back to the
 * conversation's `initialData.scopes`.
 */
export function deliveryChannel(delivery: DeliveryLike, initialData?: { scopes?: readonly string[] | undefined } | null): DeliveryChannel {
  if (delivery.kind === "signal") {
    const stamped = delivery.attributes?.channel;
    if (stamped === "voice" || stamped === "chat") return stamped;
  }
  if (delivery.kind === "user") return "chat";
  return Array.isArray(initialData?.scopes) && initialData.scopes.includes(VOICE_SCOPE) ? "voice" : "chat";
}

/** The edge classifier's verdict stamped on this delivery, if any. */
export function deliveryRoute(delivery: DeliveryLike): DeliveryRoute | undefined {
  const route = delivery.kind === "signal" ? delivery.attributes?.route : undefined;
  return route === "SIMPLE" || route === "COMPLEX" ? route : undefined;
}

/** True when a delivery is a person's own turn: a chat `user` message or a stamped voice utterance. */
export function isUserTurn(delivery: DeliveryLike): boolean {
  return delivery.kind === "user" || (delivery.kind === "signal" && delivery.type === VOICE_UTTERANCE_SIGNAL && delivery.attributes?.channel === "voice");
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/**
 * Authentication + tenant isolation for Flue agent routes (`createAgentRouter`
 * has none). Verifies the SaaS session token, checks the conversation id
 * belongs to the caller's tenant and — exactly — to the caller (unless admin),
 * refuses widget visitors unless `allowVisitors`, binds the voice agent's
 * token to its one conversation, refuses client-posted server-only signals,
 * applies per-user / per-visitor / tenant chat rate limits, defends cookie
 * auth against CSRF and rewrites POST bodies so `initialData`
 * (tenant/user/roles) and the delivery attributes (`channel`, `route`) are
 * always server-derived: clients can never spoof another tenant or channel.
 */
export function agentAuth(options: AgentAuthOptions): MiddlewareHandler {
  const allowedSignals = new Set(options.clientSignalTypes ?? DEFAULT_CLIENT_SIGNAL_TYPES);
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const cookie = SESSION_COOKIE.exec(c.req.header("cookie") ?? "")?.[1];
    const viaCookie = !header && !!cookie;
    let claims: SessionClaims;
    try {
      claims = await verifySessionToken(options.secret(c), header || (cookie ? decodeURIComponent(cookie) : null), { audiences: [WIDGET_AUDIENCE, VOICE_AUDIENCE] });
    } catch {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    const visitor = isVisitorClaims(claims);
    if (visitor && (!options.allowVisitors || viaCookie)) {
      return c.json({ error: "FORBIDDEN", message: "Widget visitor sessions cannot use this agent." }, 403);
    }
    const rest = c.req.path.slice(options.mount.length).replace(/^\/+/, "");
    let conversationId: string;
    try {
      conversationId = decodeURIComponent(rest.split("/")[0] ?? "");
    } catch {
      return c.json({ error: "FORBIDDEN", message: "Malformed conversation id." }, 403);
    }
    // Conversation-bound tokens (the voice agent's) address exactly one conversation.
    if ((claims.aud === VOICE_AUDIENCE || claims.cid !== undefined) && claims.cid !== conversationId) {
      return c.json({ error: "FORBIDDEN", message: "This token is bound to another conversation." }, 403);
    }
    const parsed = parseAgentInstanceId(conversationId);
    const isAdmin = !visitor && claims.aud === undefined && (options.adminRoles ?? []).some((r) => claims.roles.includes(r));
    const isOwner = isConversationOwner(conversationId, claims);
    if (!parsed || parsed.agent !== options.agentName || parsed.tenantId !== claims.tid || (!isAdmin && !isOwner)) {
      return c.json({ error: "FORBIDDEN", message: "Conversation does not belong to this user/tenant." }, 403);
    }
    if (viaCookie) {
      // CSRF / cross-site reads: a cookie rides along on cross-site requests (and CORS may allow
      // credentials for some origins), so a browser-sent Origin must be this origin or a trusted one,
      // and a state-changing request must be JSON (which forces a CORS preflight).
      const origin = c.req.header("origin");
      const trusted = new Set([originOf(c.req.url), ...(options.trustedOrigins?.(c) ?? [])]);
      const crossSite = origin !== undefined ? !trusted.has(origin) : c.req.header("sec-fetch-site") === "cross-site";
      const isPost = c.req.method === "POST";
      if (crossSite || (isPost && !(c.req.header("content-type") ?? "").toLowerCase().includes("application/json"))) {
        return c.json({ error: "CSRF_REJECTED", message: "Cookie-authenticated requests must be same-origin (and JSON for POST)." }, 403);
      }
    }
    if (c.req.method === "POST" && rest.split("/").length === 1) {
      let body: Record<string, unknown>;
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        return c.json({ error: "INVALID_JSON" }, 400);
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) return c.json({ error: "INVALID_JSON" }, 400);
      if (body.kind === "signal" && !allowedSignals.has(String(body.type ?? ""))) {
        return c.json({ error: "SIGNAL_NOT_ALLOWED", message: `Signal type "${String(body.type ?? "")}" can only be delivered by the server.` }, 403);
      }
      const limiter = options.rateLimiter?.(c);
      if (limiter) {
        const denied = await takeChatTokens(limiter, options, c, claims, visitor);
        if (denied) {
          const seconds = Math.max(1, Math.ceil(denied.retryAfterMs / 1000));
          return c.json({ error: "RATE_LIMITED", message: "Too many messages; retry shortly.", retryAfterMs: denied.retryAfterMs }, 429, { "retry-after": String(seconds) });
        }
      }
      let extra: Record<string, unknown> | undefined;
      try {
        extra = await options.extraInitialData?.(c, claims);
      } catch {
        // Fail safe, not closed: without the extra seed the agent falls back to the secure default tenant config.
        extra = undefined;
      }
      // A persistent agent's identity is set only by its control plane's dispatch, never on a user's request.
      const { persistent: _persistent, ...safeExtra } = extra ?? {};
      const initialData = { ...safeExtra, tenantId: claims.tid, userId: claims.sub, environment: claims.env, roles: claims.roles, scopes: claims.scopes };
      const message = await stampDelivery(body, claimsChannel(claims), options.classify, c);
      const headers = new Headers(c.req.raw.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json");
      c.req.raw = new Request(c.req.raw.url, { method: "POST", headers, body: JSON.stringify({ ...message, initialData }) });
      // Hono caches parsed bodies per request: drop the cache so downstream handlers that call
      // c.req.json() see the rewritten body, not the client's (possibly spoofed) initialData.
      c.req.bodyCache = {};
      const store = isOwner ? resolveIndexStore(c, options.conversationIndex) : undefined;
      if (store) {
        const title = body.kind === "user" && typeof body.body === "string" ? body.body : undefined;
        await bestEffort(c, () => new ConversationIndex(store).touch(options.agentName, claims, conversationId, title ? { titleFallback: title } : {}));
      }
    }
    c.set("claims" as never, claims as never);
    await next();
  };
}

/** Take one token from each applicable chat bucket; the first denial wins (later buckets are not charged). */
async function takeChatTokens(limiter: ChatRateLimiter, options: AgentAuthOptions, c: Context, claims: SessionClaims, visitor: boolean): Promise<RateLimitDecision | null> {
  const config = await options.tenantConfig?.(c, claims.tid).catch(() => undefined);
  const tenantRate = config?.rateLimit ? { ratePerMinute: config.rateLimit.eventsPerMinute, burst: config.rateLimit.burst } : undefined;
  const scale = (rate: { ratePerMinute: number; burst: number }, factor: number) => ({ ratePerMinute: Math.max(1, Math.round(rate.ratePerMinute * factor)), burst: Math.max(1, Math.round(rate.burst * factor)) });
  const principal = sha256HexSync(claims.sub).slice(0, 32);
  type Bucket = [string, { ratePerMinute: number; burst: number } | undefined];
  const buckets: Bucket[] = [];
  if (visitor) {
    buckets.push([`chat:${claims.tid}:v:${principal}`, options.rateLimits?.perVisitor ?? { ratePerMinute: 10, burst: 5 }]);
    if (tenantRate) buckets.push([`chat:${claims.tid}:visitors`, scale(tenantRate, options.rateLimits?.visitorsMultiplier ?? 2)]);
  } else {
    buckets.push([`chat:${claims.tid}:u:${principal}`, tenantRate]);
  }
  if (tenantRate) buckets.push([`chat:${claims.tid}`, scale(tenantRate, options.rateLimits?.tenantMultiplier ?? 10)]);
  for (const [key, override] of buckets) {
    const decision = await limiter.take(key, 1, override);
    if (!decision.allowed) return decision;
  }
  return null;
}

/**
 * Server-owned delivery shape (contract 1): client `initialData`, signal `attributes` and `tagName` are
 * dropped; signals get `attributes.channel` (+ `route` with a classifier); a voice-channel user turn
 * becomes a `voice-utterance` signal so its channel is known per delivery. Only Flue's reserved
 * siblings `idempotencyKey` and `uid` are kept from the client envelope.
 */
async function stampDelivery(body: Record<string, unknown>, channel: DeliveryChannel, classify: AgentAuthOptions["classify"], c: Context): Promise<Record<string, unknown>> {
  const envelope: Record<string, unknown> = {};
  if ("idempotencyKey" in body) envelope.idempotencyKey = body.idempotencyKey;
  if ("uid" in body) envelope.uid = body.uid;
  const text = typeof body.body === "string" ? body.body : "";
  const attributes = async () => {
    // Voice turns always use the voice model: no classifier round trip on the latency-critical path.
    const route = classify && text && channel !== "voice" ? await classify(text, c).catch(() => undefined) : undefined;
    return { channel, ...(route === "SIMPLE" || route === "COMPLEX" ? { route } : {}) };
  };
  if (body.kind === "signal") return { ...envelope, kind: "signal", type: body.type, body: body.body, attributes: await attributes() };
  if (body.kind === "user" && channel === "voice") return { ...envelope, kind: "signal", type: VOICE_UTTERANCE_SIGNAL, body: body.body, attributes: await attributes() };
  if (body.kind === "user") return { ...envelope, kind: "user", body: body.body, ...(body.attachments !== undefined ? { attachments: body.attachments } : {}) };
  // Unknown kinds go through untouched (minus initialData) so Flue answers with its own validation error.
  const { initialData: _dropped, ...rest } = body;
  return rest;
}

// ---------------------------------------------------------------------------
// Approvals and human answers (public signed links)
// ---------------------------------------------------------------------------

export interface ApprovalRoutesOptions {
  agents: Agent[];
  /** Approval/question signing secret(s); `[current, previous]` while rotating. */
  secret: (c: Context) => ApprovalSecret;
  appName?: string;
  /**
   * Session secret(s): when the decision request carries a valid session
   * (Bearer or `agent_session` cookie) for the token's tenant, the approver is
   * that user (`decidedBy = sub`). Otherwise the decision is attributed to
   * "approval-link". Recipient-bound tokens require such a session.
   */
  sessionSecret?: (c: Context) => string | string[];
  /**
   * Session roles allowed to decide a parked approval by id (`POST /approvals/by-id/:conversationId/:approvalId`,
   * contract 3) for any conversation of their own tenant. Default `["admin", "operator"]`. Needs `sessionSecret`.
   */
  operatorRoles?: readonly string[];
  /**
   * Origins (besides the request's own) allowed to make cookie-authenticated decide-by-id POSTs. Cookie
   * requests must also be `application/json`; Bearer requests are unaffected.
   */
  trustedOrigins?: (c: Context) => readonly string[];
  /** Test seam: replaces Flue `dispatch`. */
  dispatch?: (agent: Agent, request: Parameters<typeof dispatch>[1]) => Promise<unknown>;
}

const isSubmissionConflict = (error: unknown) => {
  const e = error as { status?: unknown; type?: unknown } | null;
  return !!e && (e.status === 409 || e.type === "submission_conflict");
};

async function readDecisionBody(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await c.req.json()) as unknown;
      return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    }
    if (type.includes("form")) return { ...(await c.req.parseBody()) } as Record<string, unknown>;
  } catch {
    // unreadable body → treated as empty
  }
  return {};
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="font:15px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">${body}</body>`;
const button = (label: string, attrs: string, danger = false) => `<button ${attrs} style="padding:.6rem 1rem;border-radius:.5rem;background:${danger ? "#b91c1c" : "#111"};color:#fff;border:0;margin:.25rem .25rem .25rem 0">${escapeHtml(label)}</button>`;

/**
 * Public endpoints for signed links (email/SMS/Slack buttons and the in-app
 * oversight card):
 *   GET  /approvals/:token → confirmation page (GET never mutates — mail scanners prefetch links)
 *   POST /approvals/:token → verify signature + expiry (+ bound approver), wake the parked agent
 *                            with a `tool-approval` signal (idempotent per approval+decision)
 *   GET  /answers/:token   → question page (choice buttons / yes-no / text box); never mutates
 *   POST /answers/:token   → validate the answer against the signed question, wake the agent
 *                            with a `human-answer` signal (first answer wins; repeats are idempotent)
 *   POST /approvals/by-id/:conversationId/:approvalId  { decision: "approve"|"reject", note? }
 *                          → operator decision (contract 3): needs a session with an operator role
 *                            (`operatorRoles`) in the conversation's tenant; dispatches the same
 *                            `tool-approval` signal with a server-minted token bound to that operator
 *                            (same idempotency key as the links, so a link and an operator never both win)
 * The approver/answerer is derived from a verified session token when present
 * (`sessionSecret`), never from a client-supplied header.
 */
export function createApprovalRoutes(options: ApprovalRoutesOptions) {
  const byName = new Map(options.agents.map((a) => [a.agentName ?? a.name, a]));
  const send = options.dispatch ?? dispatch;
  const app = new Hono();
  const wantsJson = (c: Context) => (c.req.header("accept") ?? "").includes("application/json");

  app.get("/approvals/:token", async (c) => {
    try {
      const payload = await verifyApprovalToken(options.secret(c), c.req.param("token"));
      const verb = payload.d === "approve" ? "Approve" : "Reject";
      const bound = payload.r ? "<p>This link is reserved for the designated approver: sign in to the app first.</p>" : "";
      return c.html(
        page(
          `${verb} action`,
          `<h1>${verb} this agent action?</h1><p>${escapeHtml(options.appName ?? "Your agent")} paused before a sensitive action (approval ${escapeHtml(payload.aid)}).</p>${bound}<form method="post">${button(verb, "", payload.d !== "approve")}</form>`,
        ),
      );
    } catch {
      return c.html("<p>This approval link is invalid or has expired.</p>", 400);
    }
  });

  app.post("/approvals/:token", async (c) => {
    const token = c.req.param("token") ?? "";
    let payload;
    try {
      payload = await verifyApprovalToken(options.secret(c), token);
    } catch {
      return c.json({ error: "APPROVAL_TOKEN_INVALID" }, 400);
    }
    const session = await optionalSession(c, options.sessionSecret);
    const approver = session && session.tid === payload.tid ? { tenantId: session.tid, userId: session.sub } : null;
    try {
      assertApprover(payload, approver);
    } catch {
      return c.json({ error: "APPROVER_MISMATCH", message: "This approval is assigned to another approver." }, 403);
    }
    const parsed = parseAgentInstanceId(payload.rid);
    const agent = parsed && parsed.tenantId === payload.tid ? byName.get(parsed.agent) : undefined;
    if (!agent) return c.json({ error: "AGENT_NOT_FOUND" }, 404);
    const body = await readDecisionBody(c);
    const note = typeof body.note === "string" ? body.note.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 500) : "";
    const decidedBy = approver?.userId ?? "approval-link";
    try {
      await send(agent, {
        id: payload.rid,
        // Attributes carry only signed / server values (Flue renders them into the model context);
        // the approver's free-text note travels inside the body as untrusted data.
        message: { kind: "signal", type: "tool-approval", body: `Human decision: ${payload.d}${note ? `\nApprover note: ${wrapUntrusted(note, "approval-note")}` : ""}`, attributes: { token, approver: decidedBy, decision: payload.d } },
        idempotencyKey: `approval:${payload.aid}:${payload.d}`,
      });
    } catch (error) {
      if (isSubmissionConflict(error)) return c.json({ error: "ALREADY_DECIDED", message: "This approval was already decided." }, 409);
      throw error;
    }
    const result = { ok: true, decision: payload.d, approvalId: payload.aid, decidedBy, status: payload.d === "approve" ? "APPROVED" : "REJECTED" };
    if (wantsJson(c)) return c.json(result, 202);
    return c.html(`<p>Recorded: ${escapeHtml(payload.d)}. The agent will continue shortly. You can close this tab.</p>`, 202);
  });

  const operatorRoles = options.operatorRoles ?? ["admin", "operator"];
  app.post("/approvals/by-id/:conversationId/:approvalId", async (c) => {
    const viaCookie = !c.req.header("authorization") && SESSION_COOKIE.test(c.req.header("cookie") ?? "");
    if (viaCookie) {
      // A cookie rides along on cross-site requests: same origin (or trusted) and JSON only (forces a CORS preflight).
      const origin = c.req.header("origin");
      const trusted = new Set([originOf(c.req.url), ...(options.trustedOrigins?.(c) ?? [])]);
      const crossSite = origin !== undefined ? !trusted.has(origin) : c.req.header("sec-fetch-site") === "cross-site";
      if (crossSite || !(c.req.header("content-type") ?? "").toLowerCase().includes("application/json")) {
        return c.json({ error: "CSRF_REJECTED", message: "Cookie-authenticated decisions must be same-origin JSON requests." }, 403);
      }
    }
    const session = await optionalSession(c, options.sessionSecret);
    if (!session) return c.json({ error: "UNAUTHORIZED", message: "An operator session is required." }, 401);
    if (!operatorRoles.some((role) => session.roles.includes(role))) return c.json({ error: "FORBIDDEN", message: "Only operators and admins can decide approvals by id." }, 403);
    const conversationId = c.req.param("conversationId") ?? "";
    const approvalId = c.req.param("approvalId") ?? "";
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(approvalId)) return c.json({ error: "APPROVAL_ID_INVALID" }, 400);
    const parsed = parseAgentInstanceId(conversationId);
    if (!parsed || parsed.tenantId !== session.tid) return c.json({ error: "FORBIDDEN", message: "Conversation does not belong to your tenant." }, 403);
    const agent = byName.get(parsed.agent);
    if (!agent) return c.json({ error: "AGENT_NOT_FOUND" }, 404);
    const body = await readDecisionBody(c);
    const decision = body.decision;
    if (decision !== "approve" && decision !== "reject") return c.json({ error: "DECISION_INVALID", message: 'decision must be "approve" or "reject".' }, 400);
    const note = typeof body.note === "string" ? body.note.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 500) : "";
    const token = await createOperatorDecisionToken(options.secret(c), { approvalId, tenantId: session.tid, conversationId, decision, approverId: session.sub });
    try {
      await send(agent, {
        id: conversationId,
        message: { kind: "signal", type: "tool-approval", body: `Human decision: ${decision}${note ? `\nApprover note: ${wrapUntrusted(note, "approval-note")}` : ""}`, attributes: { token, approver: session.sub, decision } },
        idempotencyKey: `approval:${approvalId}:${decision}`,
      });
    } catch (error) {
      if (isSubmissionConflict(error)) return c.json({ error: "ALREADY_DECIDED", message: "This approval was already decided." }, 409);
      throw error;
    }
    return c.json({ ok: true, decision, approvalId, conversationId, decidedBy: session.sub, status: decision === "approve" ? "APPROVED" : "REJECTED" }, 202);
  });

  app.get("/answers/:token", async (c) => {
    try {
      const q = await verifyHumanQuestionToken(options.secret(c), c.req.param("token"));
      const controls =
        q.kind === "choice"
          ? (q.o ?? []).map((o) => button(o, `name="answer" value="${escapeHtml(o)}"`)).join("")
          : q.kind === "confirm"
            ? `${button("Yes", 'name="answer" value="yes"')}${button("No", 'name="answer" value="no"', true)}`
            : `<textarea name="answer" rows="4" maxlength="2000" required style="width:100%;box-sizing:border-box"></textarea><p>${button("Send answer", 'type="submit"')}</p>`;
      const bound = q.r ? "<p>This question is addressed to a specific person: sign in to the app first.</p>" : "";
      return c.html(page("Your agent has a question", `<h1>Your agent has a question</h1><p>${escapeHtml(options.appName ?? "Your agent")} asks:</p><blockquote>${escapeHtml(q.q)}</blockquote>${bound}<form method="post">${controls}</form>`));
    } catch {
      return c.html("<p>This question link is invalid or has expired.</p>", 400);
    }
  });

  app.post("/answers/:token", async (c) => {
    const token = c.req.param("token") ?? "";
    let q;
    try {
      q = await verifyHumanQuestionToken(options.secret(c), token);
    } catch {
      return c.json({ error: "QUESTION_TOKEN_INVALID" }, 400);
    }
    const session = await optionalSession(c, options.sessionSecret);
    const answerer = session && session.tid === q.tid ? { tenantId: session.tid, userId: session.sub } : null;
    try {
      assertApprover(q, answerer);
    } catch {
      return c.json({ error: "ANSWERER_MISMATCH", message: "This question is addressed to someone else." }, 403);
    }
    let answer;
    try {
      answer = validateHumanAnswer(q, await readDecisionBody(c));
    } catch (error) {
      return c.json({ error: "ANSWER_INVALID", message: error instanceof Error ? error.message : String(error) }, 400);
    }
    const parsed = parseAgentInstanceId(q.rid);
    const agent = parsed && parsed.tenantId === q.tid ? byName.get(parsed.agent) : undefined;
    if (!agent) return c.json({ error: "AGENT_NOT_FOUND" }, 404);
    const answeredBy = answerer?.userId ?? "answer-link";
    try {
      await send(agent, {
        id: q.rid,
        message: {
          kind: "signal",
          type: "human-answer",
          // Free text comes from whoever holds the link: it reaches the model only inside the wrapped body,
          // never as a raw attribute. Choice/confirm answers were validated against the signed options.
          body: humanAnswerSignalBody(q, answer.value),
          attributes: { token, questionId: q.qid, kind: q.kind, answeredBy, ...(q.kind === "text" ? {} : { answer: answer.value }) },
        },
        idempotencyKey: `human-answer:${q.qid}`,
      });
    } catch (error) {
      if (isSubmissionConflict(error)) return c.json({ error: "ALREADY_ANSWERED", message: "This question was already answered." }, 409);
      throw error;
    }
    const result = { ok: true, questionId: q.qid, answer: answer.value, answeredBy, status: "ANSWERED" as const };
    if (wantsJson(c)) return c.json(result, 202);
    return c.html(`<p>Thanks — your answer was sent. The agent will continue shortly. You can close this tab.</p>`, 202);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Conversations: mint + thread list (R-APP-10)
// ---------------------------------------------------------------------------

/** Minimal KV surface (a Workers `KVNamespace` or core `KeyValueStore` both fit). */
export interface ConversationIndexStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export type ConversationIndexOption = ((c: Context) => ConversationIndexStore | undefined) | false | undefined;

export interface ConversationSummary {
  conversationId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

const isIndexStore = (value: unknown): value is ConversationIndexStore =>
  typeof value === "object" && value !== null && typeof (value as ConversationIndexStore).get === "function" && typeof (value as ConversationIndexStore).put === "function";

function resolveIndexStore(c: Context, option: ConversationIndexOption): ConversationIndexStore | undefined {
  if (option === false) return undefined;
  if (option) return option(c);
  const kv = (c.env as { TENANT_CONFIG?: unknown } | undefined)?.TENANT_CONFIG;
  return isIndexStore(kv) ? kv : undefined;
}

const cleanTitle = (value: string) =>
  value
    .replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/**
 * Per user + agent conversation index (one JSON document per
 * `${tenant}/${encodeIdSegment(user)}/${agent}` in KV, newest first, capped).
 * Only conversation ids that parse as owned by that user are ever stored.
 * Concurrent writes from the same user are last-writer-wins (an index, not a
 * ledger: the conversations themselves live in their Durable Objects).
 */
export class ConversationIndex {
  constructor(
    private readonly store: ConversationIndexStore,
    private readonly options: { maxEntries?: number; clock?: () => number } = {},
  ) {}

  static key(agentName: string, claims: Pick<SessionClaims, "tid" | "sub">): string {
    return `conversations:${claims.tid}:${encodeIdSegment(claims.sub)}:${agentName}`;
  }

  async list(agentName: string, claims: Pick<SessionClaims, "tid" | "sub">): Promise<ConversationSummary[]> {
    const raw = await this.store.get(ConversationIndex.key(agentName, claims));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e): e is ConversationSummary => typeof e === "object" && e !== null && typeof (e as ConversationSummary).conversationId === "string")
        .filter((e) => {
          const id = parseConversationInstanceId(e.conversationId);
          return id !== null && id.agent === agentName && isConversationOwner(e.conversationId, claims);
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async touch(agentName: string, claims: Pick<SessionClaims, "tid" | "sub">, conversationId: string, patch: { title?: string; titleFallback?: string } = {}): Promise<void> {
    const parsed = parseConversationInstanceId(conversationId);
    if (!parsed || parsed.agent !== agentName || !isConversationOwner(conversationId, claims)) return;
    const now = (this.options.clock ?? Date.now)();
    const entries = await this.list(agentName, claims);
    const existing = entries.find((e) => e.conversationId === conversationId);
    const title = patch.title ? cleanTitle(patch.title) : existing?.title ?? (patch.titleFallback ? cleanTitle(patch.titleFallback) : undefined);
    const next: ConversationSummary = { conversationId, createdAt: existing?.createdAt ?? now, updatedAt: now, ...(title ? { title } : {}) };
    const rest = entries.filter((e) => e.conversationId !== conversationId);
    await this.store.put(ConversationIndex.key(agentName, claims), JSON.stringify([next, ...rest].slice(0, this.options.maxEntries ?? 200)));
  }

  async remove(agentName: string, claims: Pick<SessionClaims, "tid" | "sub">, conversationId: string): Promise<boolean> {
    const entries = await this.list(agentName, claims);
    const rest = entries.filter((e) => e.conversationId !== conversationId);
    if (rest.length === entries.length) return false;
    await this.store.put(ConversationIndex.key(agentName, claims), JSON.stringify(rest));
    return true;
  }
}

export interface ConversationRouteOptions {
  agentName: string;
  secret: (c: Context) => string | string[];
  /** Accept widget visitor tokens (only for the widget agent's conversation API). Default false. */
  allowVisitors?: boolean;
  /** Where the thread list lives. Default: the `TENANT_CONFIG` KV binding when present; `false` disables listing. */
  index?: ConversationIndexOption;
}

/**
 * Conversation API for UIs (mounted at e.g. `/api/assistant`):
 *   POST   /conversations       { sessionKey?, title? } → { conversationId }  (mint; omit sessionKey for a new thread)
 *   GET    /conversations       → { conversations: [{ conversationId, title?, createdAt, updatedAt }], indexed }
 *   DELETE /conversations/:id   → removes the thread from the caller's list (exact ownership)
 * Every call needs a valid session token; ids are always minted for the caller's own tenant + user.
 * Widget visitor and voice tokens are refused unless `allowVisitors` (visitors only).
 */
export function createConversationRoute(options: ConversationRouteOptions) {
  const app = new Hono();
  const authenticate = async (c: Context): Promise<SessionClaims | null> => {
    try {
      return await verifySessionToken(options.secret(c), c.req.header("authorization") ?? null, { audiences: options.allowVisitors ? [WIDGET_AUDIENCE] : [] });
    } catch {
      return null;
    }
  };

  app.post("/conversations", async (c) => {
    const claims = await authenticate(c);
    if (!claims) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { sessionKey?: unknown; title?: unknown };
    const sessionKey = sanitizeSessionKey(typeof body.sessionKey === "string" && body.sessionKey ? body.sessionKey : crypto.randomUUID());
    const conversationId = conversationIdFor(options.agentName, claims, sessionKey);
    const store = resolveIndexStore(c, options.index);
    if (store) await bestEffort(c, () => new ConversationIndex(store).touch(options.agentName, claims, conversationId, typeof body.title === "string" ? { title: body.title } : {}));
    return c.json({ conversationId });
  });

  app.get("/conversations", async (c) => {
    const claims = await authenticate(c);
    if (!claims) return c.json({ error: "UNAUTHORIZED" }, 401);
    const store = resolveIndexStore(c, options.index);
    if (!store) return c.json({ conversations: [], indexed: false });
    return c.json({ conversations: await new ConversationIndex(store).list(options.agentName, claims), indexed: true });
  });

  app.delete("/conversations/:id", async (c) => {
    const claims = await authenticate(c);
    if (!claims) return c.json({ error: "UNAUTHORIZED" }, 401);
    const id = c.req.param("id");
    if (!isConversationOwner(id, claims)) return c.json({ error: "FORBIDDEN" }, 403);
    const store = resolveIndexStore(c, options.index);
    if (!store) return c.json({ removed: false, indexed: false });
    return c.json({ removed: await new ConversationIndex(store).remove(options.agentName, claims, id), indexed: true });
  });

  return app;
}
