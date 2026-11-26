import type { DelegationDispatch } from "@agent-starter/flue";
import { dispatch } from "@flue/runtime";
import { AGENTS } from "../agents.generated.ts";
import { dispatchInitialData } from "../lib/platform.ts";

/**
 * Transport for delegation signals (`delegation` to a worker, `delegation-result` back to the requester).
 * The target agent is resolved from the generated registry; the idempotency key makes redeliveries converge.
 * A new worker conversation is seeded with the tenant's config (platform policy applied), so its first turn
 * never renders on the secure default (first-line model only) while the isolate's config cache is cold.
 */
export const delegationDispatch: DelegationDispatch = async (target, request) => {
  const agent = AGENTS[target.agent];
  if (!agent) throw new Error(`Unknown agent ${target.agent}`);
  const seed = request.initialData;
  await dispatch(agent, {
    id: target.conversationId,
    message: request.message,
    ...(seed ? { initialData: await dispatchInitialData(seed.tenantId, seed) } : {}),
    idempotencyKey: request.idempotencyKey,
  });
};
