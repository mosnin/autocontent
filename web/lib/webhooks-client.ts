// Client-safe typed client for the outbound-webhooks API.
//
// Reads go through SWR using WEBHOOKS_KEY + `clientFetch` (see
// lib/client-fetcher.ts). Writes go through the same /api/proxy/... handler
// so the Clerk JWT is attached server-side. NOTHING here may import server-only
// modules — this file runs in the browser.

import { ApiError, clientFetch } from "@/lib/client-fetcher";

// --- Wire types --------------------------------------------------------

/** The five delivery events a receiver can subscribe to. */
export const WEBHOOK_EVENTS = [
  "job.done",
  "job.failed",
  "job.awaiting_approval",
  "article.done",
  "article.failed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Human-facing labels for each event name. */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "job.done": "Job done",
  "job.failed": "Job failed",
  "job.awaiting_approval": "Job awaiting approval",
  "article.done": "Article done",
  "article.failed": "Article failed",
};

export interface WebhookEndpoint {
  id: string;
  user_id: string;
  url: string;
  /** Subscribed events. An empty array means "all events". */
  events: string[];
  enabled: boolean;
  description: string;
  /** HTTP status of the most recent delivery attempt, or null if none. */
  last_status: number | null;
  last_delivery_at: string | null;
  created_at: string;
  /** Signing secret — populated ONLY in the create response, shown once. */
  secret: string | null;
}

export interface CreateWebhookInput {
  url: string;
  events: WebhookEvent[];
  description: string;
}

export interface TestWebhookResult {
  delivered: boolean;
  status_code: number | null;
}

// --- Read (SWR) --------------------------------------------------------

/** SWR key + fetcher for the endpoint list. */
export const WEBHOOKS_KEY = "/api/v1/webhook-endpoints";
export const webhooksFetcher = clientFetch<WebhookEndpoint[]>;

// --- Writes (proxy) ----------------------------------------------------

const ENDPOINTS_PATH = "/api/v1/webhook-endpoints";

async function proxyMutate<T>(
  path: string,
  method: "POST" | "DELETE" | "PATCH",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || `${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return undefined as T;
}

/** Create an endpoint. The returned `secret` is shown exactly once. */
export function createWebhook(input: CreateWebhookInput): Promise<WebhookEndpoint> {
  return proxyMutate<WebhookEndpoint>(ENDPOINTS_PATH, "POST", input);
}

/** Delete an endpoint by id. Resolves once the backend returns 204. */
export function deleteWebhook(id: string): Promise<void> {
  return proxyMutate<void>(`${ENDPOINTS_PATH}/${encodeURIComponent(id)}`, "DELETE");
}

/** Pause or resume delivery for an endpoint. Keeps its secret + history. */
export function setWebhookEnabled(
  id: string,
  enabled: boolean,
): Promise<WebhookEndpoint> {
  return proxyMutate<WebhookEndpoint>(
    `${ENDPOINTS_PATH}/${encodeURIComponent(id)}`,
    "PATCH",
    { enabled },
  );
}

/** Fire a test delivery. Returns whether it was delivered + the status code. */
export function testWebhook(id: string): Promise<TestWebhookResult> {
  return proxyMutate<TestWebhookResult>(
    `${ENDPOINTS_PATH}/${encodeURIComponent(id)}/test`,
    "POST",
  );
}
