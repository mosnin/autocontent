import { persistentAgentInstanceId, type TenantConfig } from "@agent-starter/core";
import type { PersistentEnv } from "./env.ts";

export const PERSISTENT_AGENT_NAME = "persistent-agent";

/** Seed of a persistent agent's Flue instance: who it is and whom it acts for (read with useInitialData). */
export interface PersistentInitialData {
  tenantId: string;
  userId: string;
  roles: string[];
  tenantConfig?: TenantConfig;
  /** Set only by the control plane's dispatch: no HTTP route can reach this agent or seed this field. */
  persistent: { agentId: string; ownerUserId: string };
}

/**
 * One Flue instance per persistent agent: core persistentAgentInstanceId, `persistent-agent--<tenantId>---agent.<agentId>`.
 * The run registry parses the tenant from it, and it is a harness key no user conversation id can collide with.
 */
export function persistentInstanceId(tenantId: string, agentId: string): string {
  return persistentAgentInstanceId(tenantId, agentId);
}

/** The control plane of one agent: the PERSISTENT_CONTROL instance named `<tenantId>/<agentId>` (the routes use the same name). */
export function controlStub<T = unknown>(env: PersistentEnv, tenantId: string, agentId: string): T {
  const ns = env.PERSISTENT_CONTROL;
  if (!ns) throw new Error("PERSISTENT_CONTROL Durable Object binding is missing");
  return ns.get(ns.idFromName(`${tenantId}/${agentId}`)) as unknown as T;
}
