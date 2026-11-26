import { isConversationOwner, type KeyValueStore, parseConversationInstanceId, type RateLimitDecision, type SessionClaims, sha256Hex, verifySessionToken } from "@agent-starter/core";
import { Hono } from "hono";
import { hasScope } from "../permissions.ts";
import { TRACE_SPAN_ID_PATTERN } from "./annotations.ts";
import { type BraintrustConfig, braintrustHeaders } from "./config.ts";
import { maskId, maskText } from "./mask.ts";

/**
 * People's thumbs on agent replies (docs/observability/braintrust.md, "Contracts between the pieces"):
 *
 *   POST /api/marketer/feedback   Authorization: Bearer <agent session token>
 *   { conversationId, traceSpanId, score: 0 | 1, comment? }  (comment ≤ 1,000 characters, masked)
 *
 *  - 401 without a valid session token (visitor and voice tokens are refused);
 *  - 403 without `agent:chat`, or a conversation-bound token for another conversation;
 *  - 400 for a malformed body; 429 over the per-person rate limit;
 *  - 404 when Braintrust is not configured, the conversation is not the caller's own (in their own workspace), or the
 *    span is not one of that conversation's runs (`rememberRunSpan`, written when each run starts);
 *  - 204 otherwise: `user_rating` (and the masked comment, and the person id as `user_id`) goes to Braintrust's
 *    project-logs feedback API in the background (waitUntil, timeout, logged once on failure). The browser never
 *    sees the Braintrust key.
 */

export const FEEDBACK_PATH = "/api/marketer/feedback";
export const MAX_COMMENT_CHARS = 1_000;
const RUN_SPAN_TTL_SECONDS = 90 * 86_400;
const FEEDBACK_TIMEOUT_MS = 5_000;

/** KV key of one run of one conversation (the conversation id already names the tenant and the owner). */
export const runSpanKey = (conversationId: string, traceSpanId: string) => `bt:run:${conversationId}:${traceSpanId}`;

/** Record that `traceSpanId` is a run of `conversationId` (called when the run starts; conversations only). */
export async function rememberRunSpan(kv: KeyValueStore, conversationId: string, traceSpanId: string): Promise<void> {
  if (!parseConversationInstanceId(conversationId) || !TRACE_SPAN_ID_PATTERN.test(traceSpanId)) return;
  await kv.put(runSpanKey(conversationId, traceSpanId), "1", { expirationTtlSeconds: RUN_SPAN_TTL_SECONDS });
}

export async function isRunSpan(kv: KeyValueStore, conversationId: string, traceSpanId: string): Promise<boolean> {
  return (await kv.get(runSpanKey(conversationId, traceSpanId))) !== null;
}

export interface FeedbackInput {
  conversationId: string;
  traceSpanId: string;
  score: 0 | 1;
  comment?: string;
}

/** Validate the request body; null when it is not a feedback request. */
export function parseFeedback(body: unknown): FeedbackInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.conversationId !== "string" || b.conversationId.length > 1_024 || !b.conversationId) return null;
  if (typeof b.traceSpanId !== "string" || !TRACE_SPAN_ID_PATTERN.test(b.traceSpanId)) return null;
  if (b.score !== 0 && b.score !== 1) return null;
  if (b.comment !== undefined && b.comment !== null && (typeof b.comment !== "string" || b.comment.length > MAX_COMMENT_CHARS)) return null;
  const comment = typeof b.comment === "string" ? b.comment.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim() : "";
  return { conversationId: b.conversationId, traceSpanId: b.traceSpanId, score: b.score, ...(comment ? { comment } : {}) };
}

/** POST one `user_rating` to Braintrust's project-logs feedback API. Throws on a non-2xx (the caller logs it). */
export async function sendFeedback(config: BraintrustConfig, input: { traceSpanId: string; score: number; comment?: string; userId: string; tenantId: string; conversationId: string }, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(`${config.apiUrl}/v1/project_logs/${encodeURIComponent(config.projectId)}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", ...braintrustHeaders(config) },
    body: JSON.stringify({
      feedback: [
        {
          id: input.traceSpanId,
          scores: { user_rating: input.score },
          ...(input.comment ? { comment: input.comment } : {}),
          metadata: { user_id: input.userId, tenant_id: input.tenantId, conversation_id: input.conversationId },
          source: "external",
        },
      ],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? FEEDBACK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Braintrust feedback failed: HTTP ${response.status}`);
}

export interface FeedbackDecision {
  status: 204 | 400 | 401 | 403 | 404 | 429;
  error?: string;
  retryAfterMs?: number;
  send?: { traceSpanId: string; score: number; comment?: string; userId: string; tenantId: string; conversationId: string };
}

/** The whole authorization decision (pure apart from the KV read and the limiter). */
export async function decideFeedback(input: {
  claims: SessionClaims | null;
  body: unknown;
  configured: boolean;
  runs: KeyValueStore;
  limiter?: { take(key: string): Promise<RateLimitDecision> };
}): Promise<FeedbackDecision> {
  const { claims } = input;
  if (!claims) return { status: 401, error: "UNAUTHORIZED" };
  if (!hasScope(claims, "agent:chat")) return { status: 403, error: "FORBIDDEN" };
  const feedback = parseFeedback(input.body);
  if (!feedback) return { status: 400, error: "INVALID_FEEDBACK" };
  if (claims.cid !== undefined && claims.cid !== feedback.conversationId) return { status: 403, error: "FORBIDDEN" };
  if (input.limiter) {
    const decision = await input.limiter.take(`${claims.tid}:u:${(await sha256Hex(claims.sub)).slice(0, 32)}`);
    if (!decision.allowed) return { status: 429, error: "RATE_LIMITED", retryAfterMs: decision.retryAfterMs };
  }
  if (!input.configured) return { status: 404, error: "FEEDBACK_NOT_CONFIGURED" };
  // Their own conversation, in their own workspace: anything else is indistinguishable from "no such run".
  const parsed = parseConversationInstanceId(feedback.conversationId);
  if (!parsed || parsed.tenantId !== claims.tid || !isConversationOwner(feedback.conversationId, claims)) return { status: 404, error: "RUN_NOT_FOUND" };
  if (!(await isRunSpan(input.runs, feedback.conversationId, feedback.traceSpanId))) return { status: 404, error: "RUN_NOT_FOUND" };
  return {
    status: 204,
    send: {
      traceSpanId: feedback.traceSpanId,
      score: feedback.score,
      ...(feedback.comment ? { comment: maskText(feedback.comment).slice(0, MAX_COMMENT_CHARS) } : {}),
      userId: maskId(claims.sub),
      tenantId: claims.tid,
      conversationId: feedback.conversationId,
    },
  };
}

let feedbackFailureLogged = false;

export function createFeedbackRoute<E extends object>(options: {
  sessionSecrets: (env: E) => string[];
  config: (env: E) => BraintrustConfig | undefined;
  runs: (env: E) => KeyValueStore;
  limiter?: (env: E) => { take(key: string): Promise<RateLimitDecision> };
  fetch?: typeof fetch;
  waitUntil?: (promise: Promise<unknown>) => void;
}) {
  return new Hono<{ Bindings: E }>().post(FEEDBACK_PATH, async (c) => {
    const claims = await verifySessionToken(options.sessionSecrets(c.env), c.req.header("authorization") ?? null).catch((): SessionClaims | null => null);
    const body = await c.req.json().catch(() => null);
    const config = options.config(c.env);
    const decision = await decideFeedback({ claims, body, configured: Boolean(config), runs: options.runs(c.env), ...(options.limiter ? { limiter: options.limiter(c.env) } : {}) });
    if (decision.status === 429) {
      c.header("retry-after", String(Math.max(1, Math.ceil((decision.retryAfterMs ?? 1_000) / 1_000))));
    }
    if (decision.status !== 204 || !decision.send || !config) return c.json({ error: decision.error ?? "ERROR" }, decision.status as 400 | 401 | 403 | 404 | 429);
    const work = sendFeedback(config, decision.send, options.fetch ? { fetch: options.fetch } : {}).catch((error: unknown) => {
      if (feedbackFailureLogged) return;
      feedbackFailureLogged = true;
      console.warn(`[braintrust] feedback not recorded: ${error instanceof Error ? error.message.slice(0, 200) : "error"} (further failures are not logged)`);
    });
    try {
      if (options.waitUntil) options.waitUntil(work);
    } catch {
      // no execution context (tests): the promise still runs
    }
    return c.body(null, 204);
  });
}
