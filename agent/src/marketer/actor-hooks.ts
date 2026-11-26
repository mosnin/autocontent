import { useInitialData } from "@flue/runtime";
import { type Actor, delegatedActor, personActor } from "./actor.ts";

/**
 * Render-time actor lookups for agent modules. Both read only the conversation's creation-time initialData, which
 * agentAuth (person conversations) or the requester's delegation dispatch (department tasks) wrote server-side.
 */

type Seed = { userId?: unknown; roles?: unknown; scopes?: unknown; actor?: unknown } | undefined;

/** A conversation the person opened with their own session (assistant, copilot, orchestrator). */
export function usePersonActor(): Actor | null {
  return personActor(useInitialData<Seed>());
}

/** A department conversation: the person behind the delegated task, if this is one. */
export function useDelegatedActor(conversationId: string): Actor | null {
  return delegatedActor(conversationId, useInitialData<Seed>());
}
