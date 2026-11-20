import { type AgentIdentity, heartbeatSignal, type PersistentTrigger } from "@agent-starter/core";
import { PersistentAgent } from "../agents/persistent.ts";
import type { Env } from "../env.ts";
import { dispatchInitialData } from "../lib/platform.ts";
import { trackedDispatch } from "../lib/submissions.ts";
import { type PersistentInitialData, persistentInstanceId } from "./instance.ts";

/**
 * The control plane's dispatch hook: one heartbeat or schedule tick → one server-only signal into the agent.
 * The agent has no HTTP mount, so only the control plane (and the approval routes' tool-approval signal) can reach
 * it; the body is the checklist or schedule prompt, and the turn id doubles as the idempotency key, so a retried
 * alarm never runs a tick twice. The tenant's config seeds the first render (dispatchInitialData).
 */
export async function dispatchPersistentTurn(env: Env, trigger: PersistentTrigger): Promise<void> {
  const { identity } = trigger;
  const signal = heartbeatSignal(trigger);
  await trackedDispatch(env, PersistentAgent, {
    id: persistentInstanceId(identity.tenantId, identity.agentId),
    message: { kind: "signal", type: signal.type, body: signal.body, attributes: signal.attributes },
    initialData: await persistentInitialData(identity),
    idempotencyKey: `persistent:${trigger.turnId}`.slice(0, 256),
  });
}

/** initialData of the agent's instance: its own principal as the user, role `agent`, and the owner it acts for. */
export async function persistentInitialData(identity: AgentIdentity): Promise<PersistentInitialData> {
  return { ...(await dispatchInitialData(identity.tenantId)), userId: identity.principal, roles: ["agent"], persistent: { agentId: identity.agentId, ownerUserId: identity.ownerUserId } };
}
