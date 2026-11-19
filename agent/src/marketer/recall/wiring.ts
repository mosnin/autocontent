import { isUserTurn } from "@agent-starter/flue";
import { observe, useAgentFinish, useAgentStart, useDelivery } from "@flue/runtime";
import { waitUntil } from "cloudflare:workers";
import { bindings } from "../../lib/platform.ts";
import type { Actor } from "../actor-context.ts";
import type { RecallReaderFor } from "../memory/tools.ts";
import { type RecallAccess, recallAccess, recallClient, recallForTurn, recallSession, recordTurn } from "./recall.ts";

/**
 * Platform wiring for recall (the only recall file that imports src/lib/platform.ts and the Flue hooks, so the rest
 * loads in plain Node tests). An agent calls `useRecall(...)` after `useAgentStarter()`:
 *
 *  - person conversations (assistant, copilot): `{ actor }` from `usePersonActor()`. Reads personal + team, writes the
 *    person's own turns to their personal namespace.
 *  - runs with no person (background jobs, the autopilot): `{ actor: null, write: false }`. Team reads only.
 *
 * Without SUPERMEMORY_API_KEY / MEMORY_NAMESPACE_SECRET, or with the workspace setting off, nothing runs.
 */

export interface UseRecallOptions {
  id: string;
  tenantId: string;
  actor: Actor | null;
  /** Person conversations only. Ignored (no writes) when there is no actor. */
  write: boolean;
  /** Persistent agents: their brokered fetch for the backend call. */
  fetch?: typeof fetch;
  /** Declare the hooks but do nothing (keeps hook order stable across renders). */
  off?: boolean;
}

// Last reply text per conversation, from the runtime's event stream (Flue's finish hook carries no reply text).
const lastReply = new Map<string, string>();
const watched = new Set<string>();
// The person's message of the turn in flight, per conversation: set when the delivery starts, taken once when the
// response finishes (the finish hook may run in a render whose delivery is no longer the person's message).
const pendingTurn = new Map<string, string>();
let observerInstalled = false;

function watchReplies(id: string): void {
  watched.add(id);
  if (watched.size > 5_000) watched.delete(watched.values().next().value as string);
  if (observerInstalled) return;
  observerInstalled = true;
  observe((event, ctx) => {
    try {
      const e = event as unknown as { type?: string; purpose?: string; isError?: boolean; instanceId?: string; response?: { output?: { content?: Array<{ type: string; text?: string }> } } };
      const id = e.instanceId ?? ctx.id;
      if (!watched.has(id) || e.type !== "turn" || e.isError || (e.purpose ?? "agent") !== "agent") return;
      const text = (e.response?.output?.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
      if (text) {
        lastReply.set(id, text.slice(0, 8_000));
        if (lastReply.size > 5_000) lastReply.delete(lastReply.keys().next().value as string);
      }
    } catch {
      // observation never breaks the runtime
    }
  });
}

export function useRecall(options: UseRecallOptions): void {
  const delivery = useDelivery();
  const personTurn = isUserTurn(delivery);
  const body = String((delivery as { body?: unknown }).body ?? "");
  const message = personTurn ? body : "";
  // Runs with no person read team memory for the task they were handed (an event, a job, a heartbeat); the text is
  // only a search query, and what comes back is wrapped as untrusted data like everything else.
  const query = options.off ? "" : personTurn ? body : options.actor === null && delivery.kind === "signal" ? body.slice(0, 1_000) : "";
  const writes = !options.off && options.write && options.actor !== null;
  if (writes) watchReplies(options.id);

  let access: RecallAccess | null | undefined;
  const resolveAccess = async (): Promise<RecallAccess | null> => {
    if (access !== undefined) return access;
    const env = bindings() as unknown as Record<string, unknown>;
    if (!recallClient(env)) return (access = null);
    const session = await recallSession(env, options.tenantId, options.actor, options.fetch ? { fetch: options.fetch } : {});
    access = await recallAccess(env, options.tenantId, options.actor, session).catch(() => null);
    // Without a person, never personal (belt and braces over recallAccess).
    if (access && !options.actor) access = { ...access, personal: null };
    return access;
  };

  useAgentStart(async ({ append }) => {
    if (writes && personTurn && message.trim()) {
      pendingTurn.set(options.id, message);
      lastReply.delete(options.id);
      if (pendingTurn.size > 5_000) pendingTurn.delete(pendingTurn.keys().next().value as string);
    }
    if (!query.trim()) return;
    try {
      const a = await resolveAccess();
      const client = a ? recallClient(bindings() as unknown as Record<string, unknown>) : null;
      if (!a || !client) return;
      const { text } = await recallForTurn({ client, access: a }, query);
      if (text) append({ kind: "signal", type: "recalled-memory", body: text });
    } catch {
      // recall is UX, never a gate
    }
  });

  useAgentFinish(async () => {
    if (!writes) return;
    // Once per delivered message, even if the response continues after an append.
    const turn = pendingTurn.get(options.id);
    if (!turn) return;
    pendingTurn.delete(options.id);
    try {
      const a = await resolveAccess();
      const client = a?.personal ? recallClient(bindings() as unknown as Record<string, unknown>) : null;
      if (!a || !client) return;
      const work = recordTurn({ client, access: a }, { conversationId: options.id, message: turn, reply: lastReply.get(options.id) ?? "", at: Date.now() });
      try {
        waitUntil(work);
      } catch {
        // no execution context: the promise still runs
      }
    } catch {
      // writing recall never breaks a turn
    }
  });
}

/** For the recall_memory tool: the access of the run the tool executes in. */
export function recallReaderFor(actor: Actor | null): RecallReaderFor {
  return async (tenantId) => {
    const env = bindings() as unknown as Record<string, unknown>;
    const client = recallClient(env);
    if (!client) return null;
    const session = await recallSession(env, tenantId, actor);
    const access = await recallAccess(env, tenantId, actor, session).catch(() => null);
    return access ? { access: actor ? access : { ...access, personal: null }, client } : null;
  };
}
