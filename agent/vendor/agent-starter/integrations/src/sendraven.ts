import {
  AgentError,
  HttpError,
  type KeyValueStore,
  type Notification,
  type NotificationAction,
  type Notifier,
  parseRetryAfter,
  retry,
  sha256Hex,
  stableStringify,
} from "@agent-starter/core";

/**
 * SendRaven email notifier over the public REST API (https://api.sendraven.ai).
 *
 * - Threading: the last message id per (tenant, threadKey) is kept in a
 *   KeyValueStore and sent as `reply_to_message_id`, so every notification for
 *   one run/approval lands in one conversation with proper threading headers.
 * - Idempotency: every send carries `Idempotency-Key` (the notification's own
 *   key, or a hash of its content), so retries never mail anyone twice.
 * - Guardrails: `pending_approval` (held for a human), 403 (key allowlist),
 *   429 (daily cap) and 402 (billing) come back as statuses instead of throwing.
 */

export const SENDRAVEN_API_URL = "https://api.sendraven.ai";

export interface SendRavenTag {
  name: string;
  value: string;
}

export interface SendRavenNotifierOptions {
  apiKey: string;
  /** Sender on a verified domain, e.g. "Agent <agent@mail.example.com>". */
  from: string;
  /** Replies only reach SendRaven threads when this is on a domain SendRaven receives for. */
  replyTo?: string;
  /** threadKey → last message id. Without it every notification starts a new conversation. */
  threads?: KeyValueStore;
  /** How long a thread mapping is kept. Default 30 days. */
  threadTtlSeconds?: number;
  keyPrefix?: string;
  tags?: SendRavenTag[];
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Attempts for transient failures (5xx, 409 idempotency_in_progress, network). Default 3. */
  maxAttempts?: number;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Product name shown in the HTML footer. */
  brand?: string;
}

export interface SendRavenSendResponse {
  id: string;
  status: string;
  thread_id?: string | null;
  scheduled_at?: string | null;
  skipped?: boolean;
  reason?: string | null;
  approval_id?: string | null;
}

export type NotifyResult = Awaited<ReturnType<Notifier["notify"]>> & { approvalId?: string };

export interface SendRavenThreadSummary {
  id: string;
  [key: string]: unknown;
}

export interface SendRavenThreadList {
  data?: SendRavenThreadSummary[];
  threads?: SendRavenThreadSummary[];
  has_more?: boolean;
  next_cursor?: string | null;
  [key: string]: unknown;
}

interface SendRavenErrorBody {
  error?: { type?: string; message?: string };
}

class SendRavenApiError extends HttpError {
  readonly type: string | undefined;
  constructor(status: number, type: string | undefined, message: string, body: string, retryAfterMs?: number) {
    super(status, message, body, retryAfterMs);
    this.type = type;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeActionUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const BUTTON_COLORS: Record<NonNullable<NotificationAction["style"]>, string> = { primary: "#2563eb", danger: "#dc2626", default: "#4b5563" };

/** Email-client-safe HTML (inline styles, table layout) with approve/reject style action buttons. */
export function renderNotificationHtml(notification: Pick<Notification, "subject" | "text" | "actions">, brand = "Agent Starter"): string {
  const paragraphs = notification.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0;line-height:1.5">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const buttons = (notification.actions ?? [])
    .map((action) => {
      const href = safeActionUrl(action.url);
      if (!href) return "";
      const color = BUTTON_COLORS[action.style ?? "default"];
      return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:6px;background:${color};color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a>`;
    })
    .join("");
  return [
    "<!doctype html><html><body style=\"margin:0;padding:0;background:#f6f7f9\">",
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0"><tr><td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;font-size:15px">',
    `<tr><td><h1 style="font-size:18px;margin:0 0 16px 0">${escapeHtml(notification.subject)}</h1>${paragraphs}`,
    buttons ? `<div style="margin-top:16px">${buttons}</div>` : "",
    `<p style="margin:24px 0 0 0;color:#6b7280;font-size:12px">Sent by ${escapeHtml(brand)}. Action links are single-use and expire.</p>`,
    "</td></tr></table></td></tr></table></body></html>",
  ].join("");
}

export class SendRavenNotifier implements Notifier {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: SendRavenNotifierOptions) {
    this.baseUrl = (options.baseUrl ?? SENDRAVEN_API_URL).replace(/\/+$/, "");
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private threadStoreKey(tenantId: string, threadKey: string): string {
    return `${this.options.keyPrefix ?? "sendraven:thread:"}${tenantId}:${threadKey}`;
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      if (response.ok) throw new HttpError(response.status, `SendRaven ${method} ${path} returned a non-JSON body`, text);
    }
    if (!response.ok) {
      const error = (parsed as SendRavenErrorBody).error;
      throw new SendRavenApiError(
        response.status,
        error?.type,
        `SendRaven ${method} ${path} failed with HTTP ${response.status}${error?.type ? ` (${error.type})` : ""}: ${error?.message ?? "request failed"}`,
        text,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    return parsed as T;
  }

  /** Transient = 5xx, 409 idempotency_in_progress, 408, network errors. Never 402/403/422/429 (those do not clear on retry). */
  private isTransient(error: unknown): boolean {
    if (error instanceof SendRavenApiError) return error.status >= 500 || error.status === 408 || (error.status === 409 && error.type === "idempotency_in_progress");
    if (error instanceof HttpError) return error.status >= 500;
    return error instanceof TypeError || (error instanceof Error && /network|fetch failed|ECONNRESET/i.test(error.message));
  }

  private async send(body: Record<string, unknown>, idempotencyKey: string): Promise<SendRavenSendResponse> {
    return retry(() => this.request<SendRavenSendResponse>("POST", "/v1/emails", body, { "idempotency-key": idempotencyKey }), {
      maxAttempts: this.options.maxAttempts ?? 3,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      retryOn: (error) => this.isTransient(error),
    }, this.options.sleep ? { sleep: (ms) => (this.options.sleep as (ms: number) => Promise<void>)(ms) } : {});
  }

  async notify(notification: Notification): Promise<NotifyResult> {
    const storeKey = this.threadStoreKey(notification.tenantId, notification.threadKey);
    const replyToMessageId = (await this.options.threads?.get(storeKey)) ?? undefined;
    const idempotencyKey = (notification.idempotencyKey ?? `ntf_${await sha256Hex(stableStringify({ t: notification.tenantId, k: notification.threadKey, to: notification.to, s: notification.subject, b: notification.text, a: notification.actions ?? [] }))}`).slice(0, 255);
    const base: Record<string, unknown> = {
      from: this.options.from,
      to: notification.to,
      subject: notification.subject,
      text: notification.text,
      html: notification.html ?? renderNotificationHtml(notification, this.options.brand),
      tags: [...(this.options.tags ?? []), { name: "tenant", value: notification.tenantId }, { name: "thread", value: notification.threadKey.slice(0, 200) }].slice(0, 10),
      ...(this.options.replyTo ? { reply_to: this.options.replyTo } : {}),
    };

    let response: SendRavenSendResponse;
    try {
      response = await this.send(replyToMessageId ? { ...base, reply_to_message_id: replyToMessageId } : base, idempotencyKey);
    } catch (error) {
      // A stale thread mapping (message purged/unknown) is refused with 422 invalid_request: start a new
      // conversation. The body changed, so it needs its own idempotency key (reusing it would be 422 idempotency_key_reused).
      if (replyToMessageId && error instanceof SendRavenApiError && error.status === 422 && error.type === "invalid_request") {
        await this.options.threads?.delete(storeKey);
        try {
          response = await this.send(base, `${idempotencyKey.slice(0, 240)}:newthread`);
        } catch (retryError) {
          return this.failure(retryError);
        }
      } else {
        return this.failure(error);
      }
    }

    if (response.skipped) {
      return { status: "failed", id: response.id, error: `skipped: ${response.reason ?? "all recipients suppressed"}`, ...(response.thread_id ? { threadId: response.thread_id } : {}) };
    }
    if (response.status === "pending_approval") {
      return { status: "pending_approval", id: response.id, ...(response.thread_id ? { threadId: response.thread_id } : {}), ...(response.approval_id ? { approvalId: response.approval_id } : {}) };
    }
    if (this.options.threads && response.id) {
      await this.options.threads.put(storeKey, response.id, { expirationTtlSeconds: this.options.threadTtlSeconds ?? 30 * 24 * 3600 });
    }
    const status = response.status === "queued" || response.status === "scheduled" ? "queued" : "sent";
    return { status, id: response.id, ...(response.thread_id ? { threadId: response.thread_id } : {}) };
  }

  private failure(error: unknown): NotifyResult {
    if (error instanceof SendRavenApiError) {
      const kind = error.status === 403 ? "forbidden" : error.status === 429 ? "rate_limited" : error.status === 402 ? "billing" : `http_${error.status}`;
      return { status: "failed", error: `${kind}${error.type ? `:${error.type}` : ""}: ${error.message}` };
    }
    if (error instanceof AgentError || error instanceof Error) return { status: "failed", error: error.message };
    return { status: "failed", error: String(error) };
  }

  /** GET /v1/threads — awaiting_reply=true lists conversations that need an answer. Inbound text is untrusted. */
  async listThreads(options: { awaitingReply?: boolean; tag?: string; limit?: number; cursor?: string } = {}): Promise<SendRavenThreadList> {
    const query = new URLSearchParams();
    if (options.awaitingReply !== undefined) query.set("awaiting_reply", String(options.awaitingReply));
    if (options.tag !== undefined) query.set("tag", options.tag);
    if (options.limit !== undefined) query.set("limit", String(Math.min(100, Math.max(1, Math.floor(options.limit)))));
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    const qs = query.toString();
    return this.request<SendRavenThreadList>("GET", `/v1/threads${qs ? `?${qs}` : ""}`);
  }

  /** GET /v1/threads/{id} — chronological transcript (inbound `text` is quote-stripped and untrusted). */
  async getThread(threadId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/v1/threads/${encodeURIComponent(threadId)}`);
  }

  /** POST /v1/threads/{id}/handled — clear awaiting_reply without sending anything. */
  async markHandled(threadId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/v1/threads/${encodeURIComponent(threadId)}/handled`);
  }
}
