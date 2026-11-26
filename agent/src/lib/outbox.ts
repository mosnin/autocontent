import { randomId, type RelayResult, redactDeep, type SqlStore, type TelemetryEvent, type TelemetrySink, WebhookRelay } from "@agent-starter/core";

/**
 * Durable outbox for the signed webhooks this app sends to your SaaS (job results from `notify_saas`,
 * telemetry, ops alerts, reports), R-EVT-11. A delivery is tried right away (WebhookRelay: 3 attempts with
 * backoff). When it still fails, the redacted payload is persisted in the run registry Durable Object's
 * SQLite (`as_outbox`, the row format WebhookRelay itself writes), and the minute cron (src/lib/cron.ts)
 * retries it: WebhookRelay.drainOutbox re-signs each row, backs off up to an hour, and marks it DEAD after
 * 12 attempts. Payloads are redacted before they are stored, exactly as before sending.
 *
 * Pure module (no bindings): platform.ts supplies the outbox port (the registry DO) and registry.ts owns
 * the table.
 */
export interface OutboxEntry {
  destination: string;
  /** The JSON body exactly as it is signed and sent (already redacted). */
  body: string;
  tenantId: string;
  eventId: string;
  eventType?: string;
  error?: string;
}

/** Where failed deliveries go (platform.ts: the run registry DO's `outboxEnqueue`). */
export interface WebhookOutbox {
  enqueue(entry: OutboxEntry): Promise<unknown>;
}

/** First retry 30 s after the failure, then WebhookRelay.drainOutbox's backoff (up to 1 h, 12 attempts). */
export const OUTBOX_FIRST_RETRY_MS = 30_000;

/** Insert one failed delivery (same columns and meaning as WebhookRelay's own outbox rows). */
export function insertOutboxRow(sql: SqlStore, entry: OutboxEntry, now = Date.now()): void {
  sql.exec(
    `INSERT INTO as_outbox (destination, payload, headers_json, attempts, next_attempt_at, status, last_error, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    entry.destination,
    entry.body,
    JSON.stringify({ tenantId: entry.tenantId, eventId: entry.eventId, eventType: entry.eventType ?? "" }),
    0,
    now + OUTBOX_FIRST_RETRY_MS,
    (entry.error ?? "").slice(0, 1000),
    now,
  );
}

/**
 * Send a signed webhook; when every immediate attempt failed, hand the redacted body to the outbox.
 * Returns `{ delivered: false, queued: true }` when it was persisted for retry. Never throws.
 */
export async function deliverWithOutbox(
  relay: WebhookRelay,
  outbox: WebhookOutbox | undefined,
  destination: string,
  payload: Record<string, unknown>,
  meta: { tenantId: string; eventId?: string; eventType?: string },
): Promise<RelayResult> {
  const eventId = meta.eventId ?? randomId("evt");
  const result = await relay.send(payload, { ...meta, eventId, url: destination });
  if (result.delivered || !outbox) return result;
  try {
    await outbox.enqueue({ destination, body: JSON.stringify(redactDeep(payload)), tenantId: meta.tenantId, eventId, ...(meta.eventType ? { eventType: meta.eventType } : {}), ...(result.error ? { error: result.error } : {}) });
    return { ...result, queued: true };
  } catch (error) {
    return { ...result, error: `${result.error ?? "delivery failed"}; outbox unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Telemetry sink: the signed SaaS webhook with the durable outbox behind it. Never throws into the agent. */
export class OutboxWebhookSink implements TelemetrySink {
  constructor(
    private readonly relay: WebhookRelay,
    private readonly destination: string,
    private readonly outbox?: () => WebhookOutbox | undefined,
  ) {}

  async publish(event: TelemetryEvent): Promise<void> {
    const result = await deliverWithOutbox(this.relay, this.outbox?.(), this.destination, event as unknown as Record<string, unknown>, { tenantId: event.tenantId, eventId: event.id, eventType: event.type });
    if (!result.delivered && !result.queued) console.warn(`[outbox] telemetry ${event.id} dropped: ${result.error ?? "unknown error"}`);
  }
}

export interface OutboxDrainResult {
  delivered: number;
  failed: number;
  pending: number;
  dead: number;
}

/** Delivered rows are kept a day (audit), dead letters 30 days. */
const DELIVERED_RETENTION_MS = 86_400_000;
const DEAD_RETENTION_MS = 30 * 86_400_000;

/** Retry due rows (cron), prune old ones and report the backlog. `fetch` is injectable for tests. */
export async function drainWebhookOutbox(sql: SqlStore, secret: string, options: { limit?: number; fetch?: typeof fetch; now?: number } = {}): Promise<OutboxDrainResult> {
  // drainOutbox posts each row to its own stored destination; the relay url is only a required placeholder.
  const relay = new WebhookRelay({ url: "https://outbox.invalid", secret, outbox: sql, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const { delivered, failed } = await relay.drainOutbox(options.limit ?? 50);
  const now = options.now ?? Date.now();
  sql.exec(`DELETE FROM as_outbox WHERE (status = 'DELIVERED' AND created_at < ?) OR (status = 'DEAD' AND created_at < ?)`, now - DELIVERED_RETENTION_MS, now - DEAD_RETENTION_MS);
  return { delivered, failed, ...outboxBacklog(sql) };
}

export function outboxBacklog(sql: SqlStore): { pending: number; dead: number } {
  const rows = sql.exec<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM as_outbox WHERE status IN ('PENDING', 'DEAD') GROUP BY status`);
  return { pending: Number(rows.find((r) => r.status === "PENDING")?.n ?? 0), dead: Number(rows.find((r) => r.status === "DEAD")?.n ?? 0) };
}
