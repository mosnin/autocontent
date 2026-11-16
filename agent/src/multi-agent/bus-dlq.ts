import { AgentMessageSchema } from "@agent-starter/core";
import type { Env } from "../env.ts";
import { notifier } from "../lib/platform.ts";

/**
 * Dead-letter handling for the inter-agent bus.
 *
 * A bus message lands in `agent-bus-dlq` after `max_retries` failed deliveries. This
 * consumer parks each one in R2 under `dlq/agent-bus/<tenantId>/<deadAt>-<messageId>.json`,
 * acks it and alerts the ops inbox, so agent-to-agent hand-offs are never silently lost
 * and never loop. Inspect them with `wrangler r2 object get` or reuse the background
 * module's DLQ routes pattern to replay.
 */
export const BUS_DLQ_PREFIX = "dlq/agent-bus/";

export async function handleAgentBusDlq(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
  const parked: Array<{ key: string; tenantId: string; attempts: number }> = [];
  for (const message of batch.messages) {
    const parsed = AgentMessageSchema.safeParse(message.body);
    const tenantId = parsed.success ? parsed.data.tenantId : "_invalid";
    const deadAt = Date.now();
    const key = `${BUS_DLQ_PREFIX}${tenantId}/${deadAt}-${message.id}.json`;
    try {
      await env.WORKSPACE_BUCKET.put(key, JSON.stringify({ key, messageId: message.id, tenantId, attempts: message.attempts, deadAt, body: message.body }), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { tenantId },
      });
      message.ack();
      parked.push({ key, tenantId, attempts: message.attempts });
    } catch (error) {
      console.error(`[bus-dlq] could not park ${message.id}`, error);
      message.retry({ delaySeconds: 60 });
    }
  }
  if (!parked.length) return;
  console.warn(`[bus-dlq] parked ${parked.length} dead letter(s): ${parked.map((p) => p.key).join(", ")}`);
  const n = notifier();
  if (n && env.OPS_ALERT_EMAIL) {
    await n
      .notify({
        tenantId: "platform",
        to: env.OPS_ALERT_EMAIL,
        subject: `Agent bus DLQ: ${parked.length} undelivered agent message(s)`,
        text: `Agent-to-agent messages failed ${parked[0]?.attempts ?? "?"}+ deliveries and were parked in R2:\n${parked.map((p) => `- ${p.tenantId}: ${p.key}`).join("\n")}`,
        threadKey: "dlq:agent-bus",
      })
      .catch((error: unknown) => console.warn("[bus-dlq] alert failed", error));
  }
}
