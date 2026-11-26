import { HttpError } from "../errors.ts";
import { redactDeep } from "../guardrails/pii.ts";
import type { TelemetryEvent, TelemetrySink } from "../observability/telemetry.ts";
import { computeDelay, DEFAULT_RETRY_POLICY, retry } from "../reliability/retry.ts";
import type { SqlStore } from "../storage/ports.ts";
import { randomId } from "../util/crypto.ts";
import { SIGNATURE_HEADER, signPayload, TIMESTAMP_HEADER } from "./signing.ts";

export interface WebhookRelayOptions {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  /** Durable outbox: failed deliveries are persisted and retried by `drainOutbox()` (cron / alarm). */
  outbox?: SqlStore;
  maxAttempts?: number;
  timeoutMs?: number;
  redact?: boolean;
}

export interface RelayResult {
  delivered: boolean;
  status?: number;
  queued?: boolean;
  error?: string;
}

/**
 * Signed outbound webhooks ("webhooks out"). Used to stream agent turns, cost
 * deltas, approvals and final results to the primary SaaS backend. Non-blocking
 * when called from `ctx.waitUntil()`; failures land in a durable outbox instead
 * of being dropped.
 */
export class WebhookRelay implements TelemetrySink {
  constructor(private readonly options: WebhookRelayOptions) {
    if (!options.url) throw new Error("WebhookRelay requires a url");
    if (!options.secret) throw new Error("WebhookRelay requires a signing secret");
  }

  async publish(event: TelemetryEvent): Promise<void> {
    await this.send(event as unknown as Record<string, unknown>, { tenantId: event.tenantId, eventId: event.id, eventType: event.type });
  }

  async send(payload: Record<string, unknown>, meta: { tenantId: string; eventId?: string; eventType?: string; url?: string }): Promise<RelayResult> {
    const body = JSON.stringify(this.options.redact === false ? payload : redactDeep(payload));
    const eventId = meta.eventId ?? randomId("evt");
    const url = meta.url ?? this.options.url;
    try {
      const status = await retry(
        async () => {
          const { signature, timestamp, header } = await signPayload(this.options.secret, body);
          const response = await (this.options.fetch ?? fetch)(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [SIGNATURE_HEADER]: header,
              [TIMESTAMP_HEADER]: timestamp,
              "x-agent-signature-v1": signature,
              "x-tenant-id": meta.tenantId,
              "x-agent-event-id": eventId,
              ...(meta.eventType ? { "x-agent-event-type": meta.eventType } : {}),
            },
            body,
            signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
          });
          if (!response.ok) throw await HttpError.fromResponse(response, "Webhook relay");
          return response.status;
        },
        { maxAttempts: this.options.maxAttempts ?? 3, baseDelayMs: 300 },
      );
      return { delivered: true, status };
    } catch (error) {
      if (this.options.outbox) {
        this.options.outbox.exec(
          `INSERT INTO as_outbox (destination, payload, headers_json, attempts, next_attempt_at, status, last_error, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
          url,
          body,
          JSON.stringify({ tenantId: meta.tenantId, eventId, eventType: meta.eventType ?? "" }),
          this.options.maxAttempts ?? 3,
          Date.now() + 30_000,
          String(error).slice(0, 1000),
          Date.now(),
        );
        return { delivered: false, queued: true, error: String(error) };
      }
      return { delivered: false, error: String(error) };
    }
  }

  /** Retry persisted deliveries; call from a cron trigger or DO alarm. */
  async drainOutbox(limit = 50): Promise<{ delivered: number; failed: number }> {
    if (!this.options.outbox) return { delivered: 0, failed: 0 };
    const rows = this.options.outbox.exec<{ id: number; destination: string; payload: string; headers_json: string; attempts: number }>(
      `SELECT id, destination, payload, headers_json, attempts FROM as_outbox WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY id LIMIT ?`,
      Date.now(),
      limit,
    );
    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      const meta = JSON.parse(row.headers_json) as { tenantId: string; eventId: string; eventType: string };
      const { signature, timestamp, header } = await signPayload(this.options.secret, row.payload);
      try {
        const response = await (this.options.fetch ?? fetch)(row.destination, {
          method: "POST",
          headers: { "content-type": "application/json", [SIGNATURE_HEADER]: header, [TIMESTAMP_HEADER]: timestamp, "x-agent-signature-v1": signature, "x-tenant-id": meta.tenantId, "x-agent-event-id": meta.eventId },
          body: row.payload,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.options.outbox.exec(`UPDATE as_outbox SET status = 'DELIVERED' WHERE id = ?`, row.id);
        delivered++;
      } catch (error) {
        const attempts = Number(row.attempts) + 1;
        const dead = attempts >= 12;
        this.options.outbox.exec(
          `UPDATE as_outbox SET attempts = ?, next_attempt_at = ?, status = ?, last_error = ? WHERE id = ?`,
          attempts,
          Date.now() + computeDelay({ ...DEFAULT_RETRY_POLICY, baseDelayMs: 30_000, maxDelayMs: 3_600_000, jitter: false }, attempts),
          dead ? "DEAD" : "PENDING",
          String(error).slice(0, 1000),
          row.id,
        );
        failed++;
      }
    }
    return { delivered, failed };
  }
}
