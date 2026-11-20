import { useAgentStart, useDelivery, useResponseFinish, useResponseStart } from "@flue/runtime";
import type { Actor } from "../../marketer/actor-context.ts";
import { bindings } from "../platform.ts";
import { currentTraceSpanId, recordRunScore, setRunIdentity } from "./annotations.ts";
import { braintrustConfig } from "./config.ts";

/**
 * Braintrust wiring an agent declares after `useAgentStarter()` (docs/observability/braintrust.md):
 *
 *  - `traceSpanId` on each assistant message the agent delivers: response metadata (Flue `useResponseStart` /
 *    `useResponseFinish`), the root span id of the run that produced it. Added only while Braintrust is configured;
 *    clients that do not know the field ignore it, and a client must hide feedback when it is absent;
 *  - the person and their role for the run's root span (from the verified session, never the model);
 *  - the `approval` score when the delivery is a person's approval decision (a server-sent `tool-approval` signal).
 *
 * Every hook is declared unconditionally, so hook order is stable across renders.
 */
export function useTraceRun(options: { id: string; actor: Actor | null }): void {
  const { id, actor } = options;
  if (actor?.id) setRunIdentity(id, { actorId: actor.id, ...(actor.roles[0] ? { role: actor.roles[0] } : {}) });
  const delivery = useDelivery();

  useAgentStart(() => {
    if (delivery.kind !== "signal" || delivery.type !== "tool-approval") return;
    const decision = delivery.attributes?.decision;
    if (decision === "approve") recordRunScore(id, "approval", 1);
    else if (decision === "reject") recordRunScore(id, "approval", 0);
  });

  const metadata = (): Record<string, unknown> | void => {
    try {
      if (!braintrustConfig(bindings() as unknown as Record<string, unknown>)) return;
      const traceSpanId = currentTraceSpanId(id);
      return traceSpanId ? { traceSpanId } : undefined;
    } catch {
      return undefined;
    }
  };
  useResponseStart(metadata);
  useResponseFinish(metadata);
}
