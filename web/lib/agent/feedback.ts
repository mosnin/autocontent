// Thumbs on agent replies (docs/observability/braintrust.md, "Feedback goes
// through the agent"). The browser sends the score to the agent with the same
// session token the chat already uses; the agent checks the span belongs to
// this conversation and tenant, masks the comment and logs `user_rating`.
// The browser never holds a Braintrust key.
//
// Pure module (no path aliases) so `npm test` can import it directly.

export type FeedbackScore = 0 | 1;

export const FEEDBACK_COMMENT_MAX = 1000;

export interface FeedbackBody {
  conversationId: string;
  traceSpanId: string;
  score: FeedbackScore;
  comment?: string;
}

/** OTel span ids are 16 lowercase hex characters; accept 16 or 32 to be safe with trace-id-shaped ids. */
const SPAN_ID = /^[0-9a-f]{16}(?:[0-9a-f]{16})?$/;

export function isTraceSpanId(value: unknown): value is string {
  return typeof value === "string" && SPAN_ID.test(value);
}

/**
 * The root span id of the run that produced an assistant message: the agent
 * attaches it as `metadata.traceSpanId` (Flue message metadata) or, in a flat
 * shape, as `traceSpanId`. Anything else means no thumbs for that message.
 */
export function traceSpanIdOf(message: { traceSpanId?: unknown; metadata?: Record<string, unknown> | null } | null | undefined): string | null {
  if (!message) return null;
  const fromMeta = message.metadata && typeof message.metadata === "object" ? message.metadata.traceSpanId : undefined;
  if (isTraceSpanId(fromMeta)) return fromMeta;
  if (isTraceSpanId(message.traceSpanId)) return message.traceSpanId;
  return null;
}

export function feedbackBody(conversationId: string, traceSpanId: string, score: FeedbackScore, comment?: string): FeedbackBody {
  const trimmed = (comment ?? "").trim().slice(0, FEEDBACK_COMMENT_MAX);
  return { conversationId, traceSpanId, score, ...(trimmed ? { comment: trimmed } : {}) };
}

export function feedbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/marketer/feedback`;
}

/** What a person sees when the agent refuses or fails. */
export function feedbackError(status: number): string {
  if (status === 403) return "Your role can't rate agent replies.";
  if (status === 404) return "That reply can't be rated any more.";
  if (status === 429) return "Too many ratings at once. Try again in a moment.";
  return "Your rating wasn't saved. Try again.";
}

export class FeedbackError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(feedbackError(status));
    this.status = status;
  }
}

/** POST {agent}/api/marketer/feedback. Resolves on 2xx (the agent answers 204); throws FeedbackError otherwise. */
export async function sendFeedback(options: {
  origin: string;
  token: string;
  body: FeedbackBody;
  fetch?: typeof fetch;
}): Promise<void> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(feedbackUrl(options.origin), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${options.token}` },
      body: JSON.stringify(options.body),
    });
  } catch {
    throw new FeedbackError(0);
  }
  if (!res.ok) throw new FeedbackError(res.status);
}
