import { EventEnvelopeSchema } from "@agent-starter/core";
import type { Env } from "../env.ts";
import { notifier } from "../lib/platform.ts";

/**
 * Dead-letter handling for the events queue.
 *
 * A message lands in `agent-events-dlq` after `max_retries` failed deliveries
 * (dispatch kept failing). The DLQ consumer parks each one in R2 under
 * `dlq/agent-events/<tenantId>/<receivedAt>-<messageId>.json`, acks it and alerts
 * the ops inbox, so nothing is lost and nothing loops. Operators drain / replay
 * per tenant with the routes in routes.ts (`GET /api/dlq`, `POST /api/dlq/replay`,
 * `POST /api/dlq/purge`) or `pnpm dlq:replay`.
 */
export const DLQ_PREFIX = "dlq/agent-events/";

export interface DeadLetter {
  key: string;
  messageId: string;
  tenantId: string;
  attempts: number;
  deadAt: number;
  body: unknown;
}

const tenantOf = (body: unknown): string => {
  const parsed = EventEnvelopeSchema.safeParse(body);
  return parsed.success ? parsed.data.tenantId : "_invalid";
};

export async function handleEventsDlq(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
  const parked: DeadLetter[] = [];
  for (const message of batch.messages) {
    const tenantId = tenantOf(message.body);
    const deadAt = Date.now();
    const key = `${DLQ_PREFIX}${tenantId}/${deadAt}-${message.id}.json`;
    const record: DeadLetter = { key, messageId: message.id, tenantId, attempts: message.attempts, deadAt, body: message.body };
    try {
      await env.WORKSPACE_BUCKET.put(key, JSON.stringify(record), { httpMetadata: { contentType: "application/json" }, customMetadata: { tenantId } });
      message.ack();
      parked.push(record);
    } catch (error) {
      console.error(`[dlq] could not park ${message.id}`, error);
      message.retry({ delaySeconds: 60 });
    }
  }
  if (!parked.length) return;
  console.warn(`[dlq] parked ${parked.length} dead letter(s): ${parked.map((p) => p.key).join(", ")}`);
  const n = notifier();
  if (n && env.OPS_ALERT_EMAIL) {
    await n
      .notify({
        tenantId: "platform",
        to: env.OPS_ALERT_EMAIL,
        subject: `Agent events DLQ: ${parked.length} dead letter(s)`,
        text: `Events failed ${parked[0]?.attempts ?? "?"}+ deliveries and were parked in R2:\n${parked.map((p) => `- ${p.tenantId}: ${p.key}`).join("\n")}\n\nInspect: GET /api/dlq · Replay: POST /api/dlq/replay (or pnpm dlq:replay)`,
        threadKey: "dlq:agent-events",
      })
      .catch((error: unknown) => console.warn("[dlq] alert failed", error));
  }
}

/** Dead letters of one tenant, oldest first. */
export async function listDeadLetters(env: Env, tenantId: string, limit = 100): Promise<DeadLetter[]> {
  const listed = await env.WORKSPACE_BUCKET.list({ prefix: `${DLQ_PREFIX}${tenantId}/`, limit: Math.min(Math.max(limit, 1), 1000) });
  const records = await Promise.all(
    listed.objects.map(async (object) => {
      const body = await env.WORKSPACE_BUCKET.get(object.key);
      return body ? ((await body.json()) as DeadLetter) : null;
    }),
  );
  return records.filter((r): r is DeadLetter => r !== null).sort((a, b) => a.deadAt - b.deadAt);
}

/**
 * Re-enqueue a tenant's dead letters (all, or the given keys) on the events queue and
 * delete them from R2. Envelope ids are kept, so the consumer's event ledger still
 * de-duplicates anything that did get processed.
 */
export async function replayDeadLetters(env: Env, tenantId: string, keys?: string[]): Promise<{ replayed: string[]; skipped: string[] }> {
  if (!env.EVENTS_QUEUE) throw new Error("EVENTS_QUEUE is not bound");
  const replayed: string[] = [];
  const skipped: string[] = [];
  for (const letter of await listDeadLetters(env, tenantId, 1000)) {
    if (keys && !keys.includes(letter.key)) continue;
    const envelope = EventEnvelopeSchema.safeParse(letter.body);
    if (!envelope.success || envelope.data.tenantId !== tenantId) {
      skipped.push(letter.key);
      continue;
    }
    await env.EVENTS_QUEUE.send(envelope.data, { contentType: "json" });
    await env.WORKSPACE_BUCKET.delete(letter.key);
    replayed.push(letter.key);
  }
  return { replayed, skipped };
}

/** Drop a tenant's dead letters (all, or the given keys) without replaying them. */
export async function purgeDeadLetters(env: Env, tenantId: string, keys?: string[]): Promise<{ purged: string[] }> {
  const purged: string[] = [];
  for (const letter of await listDeadLetters(env, tenantId, 1000)) {
    if (keys && !keys.includes(letter.key)) continue;
    await env.WORKSPACE_BUCKET.delete(letter.key);
    purged.push(letter.key);
  }
  return { purged };
}
