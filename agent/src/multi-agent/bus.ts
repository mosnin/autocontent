import { QueueMessageBus, routeAgentMessages } from "@agent-starter/cloudflare";
import { type AgentMessage, type AnyAgentTool, createAgentMessage, defineAgentTool, parseAgentInstanceId, withProvenance } from "@agent-starter/core";
import { dispatch, useDelivery } from "@flue/runtime";
import * as v from "valibot";
import { AGENTS } from "../agents.generated.ts";
import type { Env } from "../env.ts";
import { bindings, dispatchInitialData } from "../lib/platform.ts";
import { BUS_ROUTING_KEY, BUS_TARGETS, busConversationId } from "./roster.ts";

/**
 * The bus message this turn is answering, rebuilt from the harness-written signal attributes of an `agent-message`
 * delivery. Passing it as `parent` keeps `correlationId`, `causationId` and `hops` across hand-offs, so the hop limit
 * (validateDeliverable, max 8) stops ping-pong between agents.
 */
function incomingParent(delivery: ReturnType<typeof useDelivery>, tenantId: string): AgentMessage | undefined {
  if (delivery.kind !== "signal" || delivery.type !== "agent-message") return undefined;
  const attrs = delivery.attributes ?? {};
  const hops = Number(attrs.hops);
  if (!attrs.messageId || !attrs.correlationId || !Number.isInteger(hops) || hops < 0) return undefined;
  return {
    id: attrs.messageId,
    type: attrs.topic ?? "agent-message",
    tenantId,
    from: { agent: attrs.fromAgent ?? "unknown", instanceId: attrs.fromInstance ?? "unknown" },
    to: { agent: "self" },
    payload: null,
    correlationId: attrs.correlationId,
    hops,
    createdAt: 0,
  };
}

/**
 * Inter-agent message bus (Cloudflare Queues), two-way: the orchestrator and every specialist mount it, so an agent
 * can hand a typed event to another agent class (e.g. the security auditor routes a billing discrepancy to the
 * analyst, and the analyst answers on the same correlation) without one giant loop owning everything. Hop limits and
 * TTLs stop ping-pong (a reply carries its parent's hop count); delivery is a provenance-wrapped Flue signal with an
 * idempotency key. Call it during render (it reads the current delivery).
 *
 * SEC-07: targets are limited to `BUS_TARGETS` (dispatch-only agents, never the sender) and the conversation is
 * always a harness session (`busConversationId`), so a message can never reach, or create, a person's conversation.
 * Senders are any agent of the tenant; a reply to a person goes through that agent's own conversation, not the bus.
 */
export function busTools(fromAgent: string, instanceId: string): AnyAgentTool[] {
  const delivery = useDelivery();
  const targets = BUS_TARGETS.filter((agent) => agent !== fromAgent && agent in AGENTS);
  if (targets.length === 0) return [];
  return [
    defineAgentTool({
      name: "send_agent_message",
      description: `Send an asynchronous message to another agent (${targets.join(", ")}). Use for hand-offs that do not need an immediate answer.`,
      input: v.object({
        toAgent: v.picklist(targets as [string, ...string[]]),
        topic: v.pipe(v.string(), v.regex(/^[a-z0-9_.-]{2,60}$/)),
        payload: v.pipe(v.string(), v.maxLength(8000)),
        sessionKey: v.optional(v.pipe(v.string(), v.regex(BUS_ROUTING_KEY)), "bus"),
      }),
      risk: "MEDIUM",
      sideEffect: "external",
      idempotent: true,
      execute: async ({ toAgent, topic, payload, sessionKey }, ctx) => {
        if (ctx.tenantConfig.features?.multiAgentGroupChat !== true) {
          return { sent: false, message: "Agent-to-agent messaging is not enabled for this workspace (tenant feature multiAgentGroupChat)." };
        }
        const queue = bindings().AGENT_BUS;
        if (!queue) throw new Error("AGENT_BUS binding is not configured");
        const parent = incomingParent(delivery, ctx.tenant.tenantId);
        const message = createAgentMessage({
          type: topic,
          tenantId: ctx.tenant.tenantId,
          from: { agent: fromAgent, instanceId },
          to: { agent: toAgent, routingKey: sessionKey },
          payload,
          ...(parent ? { parent } : {}),
          ttlMs: 24 * 3600_000,
        });
        await new QueueMessageBus(queue as never).publish(message);
        return { sent: true, messageId: message.id, hops: message.hops };
      },
    }),
  ];
}

export async function handleAgentBus(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext): Promise<void> {
  await routeAgentMessages(batch, async (message) => {
    const agent = AGENTS[message.to.agent];
    if (!agent || !BUS_TARGETS.includes(message.to.agent)) {
      // Not deliverable by policy (HTTP-mounted or unknown agent): drop it, never retry.
      console.warn(`[bus] dropped ${message.id}: ${message.to.agent} is not a bus target`);
      return;
    }
    const sender = parseAgentInstanceId(message.from.instanceId);
    if (sender && sender.tenantId !== message.tenantId) throw new Error("Bus message sender belongs to another tenant");
    // The tenant's config (platform policy applied) seeds a new bus conversation, so its first turn never renders on
    // the secure default (first-line model only) while the isolate's config cache is cold.
    const initialData = await dispatchInitialData(message.tenantId, { userId: `agent:${message.from.agent}`, roles: ["agent"] });
    await dispatch(agent, {
      id: busConversationId(message.to.agent, message.tenantId, message.to.routingKey ?? "bus"),
      message: {
        kind: "signal",
        type: "agent-message",
        body: withProvenance({ from: message.from.agent, what: "message", id: message.id, authority: "information" }, `${message.type}${sender ? ` (from session ${sender.sessionKey})` : ""}:\n${String(message.payload)}`),
        attributes: { messageId: message.id, correlationId: message.correlationId, hops: String(message.hops), topic: message.type, fromAgent: message.from.agent, fromInstance: message.from.instanceId },
      },
      initialData,
      idempotencyKey: `bus:${message.id}`,
    });
  });
}
