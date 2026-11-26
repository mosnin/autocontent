import { z } from "zod";
import { randomId } from "../util/crypto.ts";

/**
 * Inter-agent message envelope. Agents dispatch typed events to each other like
 * microservices (e.g. a coding agent finds a billing discrepancy and routes it
 * to a "financial-audit" agent) instead of one giant loop doing everything.
 */
export const AgentMessageSchema = z.object({
  id: z.string(),
  type: z.string().min(1).max(120),
  tenantId: z.string(),
  from: z.object({ agent: z.string(), instanceId: z.string() }),
  to: z.object({ agent: z.string(), instanceId: z.string().optional(), routingKey: z.string().optional() }),
  payload: z.unknown(),
  correlationId: z.string(),
  causationId: z.string().optional(),
  /** Loop guard: incremented on every hop, rejected above maxHops. */
  hops: z.number().int().nonnegative(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export interface MessageBus {
  publish(message: AgentMessage): Promise<void>;
}

export type AgentMessageHandler = (message: AgentMessage) => Promise<void>;

export function createAgentMessage(input: {
  type: string;
  tenantId: string;
  from: AgentMessage["from"];
  to: AgentMessage["to"];
  payload: unknown;
  parent?: AgentMessage;
  ttlMs?: number;
}): AgentMessage {
  const now = Date.now();
  return {
    id: randomId("msg"),
    type: input.type,
    tenantId: input.tenantId,
    from: input.from,
    to: input.to,
    payload: input.payload,
    correlationId: input.parent?.correlationId ?? randomId("corr"),
    ...(input.parent ? { causationId: input.parent.id } : {}),
    hops: (input.parent?.hops ?? -1) + 1,
    createdAt: now,
    ...(input.ttlMs ? { expiresAt: now + input.ttlMs } : {}),
  };
}

export function validateDeliverable(message: AgentMessage, options: { maxHops?: number; now?: number } = {}): { ok: true } | { ok: false; reason: string } {
  if (message.hops > (options.maxHops ?? 8)) return { ok: false, reason: `hop limit exceeded (${message.hops})` };
  if (message.expiresAt !== undefined && message.expiresAt < (options.now ?? Date.now())) return { ok: false, reason: "message expired" };
  return { ok: true };
}

/** In-process bus for tests and single-isolate setups. Production uses the Cloudflare Queue bus. */
export class InMemoryMessageBus implements MessageBus {
  private readonly handlers = new Map<string, AgentMessageHandler[]>();
  readonly delivered: AgentMessage[] = [];
  readonly rejected: Array<{ message: AgentMessage; reason: string }> = [];

  subscribe(agent: string, handler: AgentMessageHandler): () => void {
    const list = this.handlers.get(agent) ?? [];
    list.push(handler);
    this.handlers.set(agent, list);
    return () => this.handlers.set(agent, (this.handlers.get(agent) ?? []).filter((h) => h !== handler));
  }

  async publish(message: AgentMessage): Promise<void> {
    const check = validateDeliverable(message);
    if (!check.ok) {
      this.rejected.push({ message, reason: check.reason });
      return;
    }
    this.delivered.push(message);
    for (const handler of this.handlers.get(message.to.agent) ?? []) await handler(message);
  }
}

export interface NotificationAction {
  label: string;
  url: string;
  style?: "primary" | "danger" | "default";
}

export interface Notification {
  tenantId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Stable key that threads all notifications for one run/approval into one conversation. */
  threadKey: string;
  actions?: NotificationAction[];
  idempotencyKey?: string;
}

/** Out-of-band notifications (email via SendRaven, Slack, SMS...). */
export interface Notifier {
  notify(notification: Notification): Promise<{ id?: string; threadId?: string; status: "sent" | "queued" | "pending_approval" | "failed"; error?: string }>;
}

export class ConsoleNotifier implements Notifier {
  readonly sent: Notification[] = [];
  async notify(notification: Notification) {
    this.sent.push(notification);
    console.log(`[notify] ${notification.to}: ${notification.subject}${notification.actions?.length ? ` (${notification.actions.map((a) => a.label).join(", ")})` : ""}`);
    return { status: "sent" as const, id: randomId("ntf") };
  }
}
