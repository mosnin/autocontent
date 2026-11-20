import type { DelegationDispatch, DelegationRosterEntry } from "@agent-starter/flue";
import { AGENTS } from "../agents.generated.ts";
import { bindings, dispatchInitialData } from "./platform.ts";
import { trackedDispatch } from "./submissions.ts";

/**
 * Transport for delegation signals (`delegation` to a worker, `delegation-result` back to the requester),
 * shared by every module: the target agent is resolved from the generated registry (never model text),
 * the idempotency key makes redeliveries converge, and the dispatch is recorded in the submission ledger
 * so the heartbeat sentinel can re-admit it after a recovery abort. A worker's initialData carries its
 * tenant's config (dispatchInitialData), so a fresh worker never renders on the secure defaults.
 */
export const delegationDispatch: DelegationDispatch = async (target, request) => {
  const agent = AGENTS[target.agent];
  if (!agent) throw new Error(`Unknown agent ${target.agent}`);
  await trackedDispatch(bindings(), agent, {
    id: target.conversationId,
    message: request.message,
    ...(request.initialData ? { initialData: await dispatchInitialData(request.initialData.tenantId, request.initialData) } : {}),
    idempotencyKey: request.idempotencyKey,
  });
};

/** Roster entries whose agent is part of this project (modules that were not composed simply drop out). */
export function composedRoster(entries: readonly DelegationRosterEntry[]): DelegationRosterEntry[] {
  return entries.filter((entry) => entry.agent in AGENTS);
}
