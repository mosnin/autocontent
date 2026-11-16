import type { RunStatus } from "@agent-starter/core";

/**
 * Run status in the registry, driven by Flue observer events (wired by
 * observerOptions() in platform.ts). Pure logic with injected dependencies so it
 * is unit-tested in test/platform.test.ts.
 *
 *  - RUNNING (beat) on submission start and on every model turn / tool event
 *    (throttled per instance), so a long tool loop is never mistaken for a deadlock;
 *  - while ONE tool call runs longer than `toolBeatIntervalMs` (a VM build, a large
 *    repo import), the observer keeps beating on an interval, up to `maxToolBeatMs`
 *    per call, so the minute sentinel (180 s threshold) never aborts a healthy long
 *    tool and still catches one that hangs past every tool timeout (R3);
 *  - PENDING_APPROVAL when a tool parked the run for a human (approval or ask_person)
 *    and when that submission settles: the sentinel ignores it, the approval wake
 *    beats it back to RUNNING; QUEUED when the run handed a task to another agent and
 *    waits for its delegation-result (open, not swept);
 *  - on settle, `complete()` records the run's latest counters (turns, cost, tokens, tool calls,
 *    VM time, routing: what the daily efficiency report aggregates), then the status becomes IDLE
 *    (or PENDING_APPROVAL / QUEUED), FAILED on failure; an abort only marks HALTED when nobody
 *    (pause / teardown / sentinel) already set the status;
 *  - workflow transitions (`transition_state` results) are reported to `onWorkflowState`,
 *    so job routing knows when a job reached REPORT / DONE / FAILED (R13).
 * Registry calls are serialized per instance so they land in event order.
 */

/** Tool results that park the run for a human: approvals (PENDING_APPROVAL), ask_person (PENDING_HUMAN_ANSWER). */
const AWAITING_HUMAN = /\\?"(?:status\\?"\s*:\s*\\?"(?:PENDING_APPROVAL|PENDING_ANSWER|PENDING_HUMAN|AWAITING_HUMAN)|awaitingHuman\\?"\s*:\s*true)/;
/** Tool results that hand work to another agent whose result wakes this run (`delegate_task` with reply "resume"). */
const DELEGATED = /\\?"status\\?"\s*:\s*\\?"DELEGATED\\?"/;
const REPLY_RESUME = /\\?"reply\\?"\s*:\s*\\?"resume\\?"/;
/** `transition_state` results: `{ state, instructions }`. */
const WORKFLOW_STATE = /\\?"state\\?"\s*:\s*\\?"([A-Z][A-Z0-9_]{0,40})\\?"/;

function resultText(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  try {
    return (typeof result === "string" ? result : JSON.stringify(result)).slice(0, 20_000);
  } catch {
    return null;
  }
}

/** A tool result that parks the run for a human (the observer sees tool results, not response metadata). */
export function toolResultAwaitsHuman(result: unknown): boolean {
  const text = resultText(result);
  return text !== null && AWAITING_HUMAN.test(text);
}

/** A `delegate_task` result whose answer resumes this run (reply "resume"). */
export function toolResultAwaitsAgent(result: unknown): boolean {
  const text = resultText(result);
  return text !== null && DELEGATED.test(text) && REPLY_RESUME.test(text);
}

/** The state a successful `transition_state` result reports, if any. */
export function workflowStateOf(result: unknown): string | null {
  const text = resultText(result);
  return text === null ? null : (WORKFLOW_STATE.exec(text)?.[1] ?? null);
}

/** KV key (AGENT_CACHE) holding the latest workflow state of an instance; job routing reads it. */
export const workflowStateKey = (instanceId: string) => `wf:${instanceId}`;
/** Workflow states after which a job takes no new work: new events start a fresh job. */
export const CLOSED_WORKFLOW_STATES = new Set(["REPORT", "DONE", "FAILED"]);

/** Events that prove the run is alive, besides the hook's own heartbeats. */
export const LIVENESS_EVENTS = new Set(["submission_running", "turn", "tool_start", "tool", "task_start", "task", "compaction"]);

export type TerminalRunStatus = Extract<RunStatus, "COMPLETED" | "FAILED" | "HALTED" | "TERMINATED">;

export interface RegistryStatusPort<C = Record<string, unknown>> {
  beat(run: { runId: string; tenantId: string; agent: string }): Promise<unknown>;
  setStatus(runId: string, status: RunStatus, error?: string): Promise<unknown>;
  /** Records final counters for the settled submission (cumulative; the registry keeps the max). */
  complete(runId: string, status: TerminalRunStatus, counters?: C): Promise<unknown>;
  get(runId: string): Promise<{ status: RunStatus } | null>;
}

export interface IntervalTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realTimers: IntervalTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface RunStatusObserverOptions<E, C = Record<string, unknown>> {
  registry: (env: E) => RegistryStatusPort<C>;
  /**
   * Latest cumulative counters the hook reported for a run (heartbeat), sent with `complete()` on settle.
   * Called once per settle: implementations may drop the entry (platform.ts does, so the map never grows).
   */
  counters?: (instanceId: string) => C | undefined;
  /** Called for submission_running / submission_settled (the submission ledger, recovery counters). */
  onSubmission?: (env: E, instanceId: string, event: { type: string; submissionId?: unknown; outcome?: unknown }) => Promise<void>;
  /** Called after a successful `transition_state` with the new workflow state. */
  onWorkflowState?: (env: E, instanceId: string, state: string) => Promise<void>;
  /** Called when a submission settled (drop per-run caches such as the hook heartbeat throttle). */
  onSettled?: (instanceId: string) => void;
  /** Minimum gap between liveness beats per instance. Default 10 s. */
  beatIntervalMs?: number;
  /** Beat interval while a single tool call is in flight. Default 60 s (well under the 180 s sentinel threshold). */
  toolBeatIntervalMs?: number;
  /** Stop beating for a tool call that runs longer than this (it is hung: let the sentinel recover it). Default 15 min. */
  maxToolBeatMs?: number;
  clock?: () => number;
  timers?: IntervalTimers;
}

export function createRunStatusObserver<E, C = Record<string, unknown>>(options: RunStatusObserverOptions<E, C>) {
  const awaitingHuman = new Set<string>();
  const awaitingAgent = new Set<string>();
  const lastBeat = new Map<string, number>();
  const chains = new Map<string, Promise<void>>();
  /** In-flight tool calls per instance: toolCallId → interval handle. */
  const inflight = new Map<string, Map<string, unknown>>();
  const interval = options.beatIntervalMs ?? 10_000;
  const toolInterval = options.toolBeatIntervalMs ?? 60_000;
  const maxToolBeat = options.maxToolBeatMs ?? 15 * 60_000;
  const clock = options.clock ?? Date.now;
  const timers = options.timers ?? realTimers;
  const serialize = (id: string, task: () => Promise<unknown>): Promise<void> => {
    const next = (chains.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(task)
      .then(() => undefined);
    chains.set(id, next);
    void next
      .finally(() => {
        if (chains.get(id) === next) chains.delete(id);
      })
      .catch(() => undefined);
    return next;
  };
  const stopTool = (id: string, toolCallId: string) => {
    const calls = inflight.get(id);
    const handle = calls?.get(toolCallId);
    if (handle === undefined || !calls) return;
    timers.clearInterval(handle);
    calls.delete(toolCallId);
    if (calls.size === 0) inflight.delete(id);
  };
  const stopAllTools = (id: string) => {
    for (const toolCallId of [...(inflight.get(id)?.keys() ?? [])]) stopTool(id, toolCallId);
  };

  return async (event: Record<string, unknown> & { type: string }, context: { instanceId: string; agentName: string; tenantId: string; env: E }): Promise<void> => {
    const id = context.instanceId;
    const beatNow = () => serialize(id, () => options.registry(context.env).beat({ runId: id, tenantId: context.tenantId, agent: context.agentName }));
    // Decide synchronously (events arrive in order; registry calls are async).
    if (event.type === "submission_running") {
      awaitingHuman.delete(id);
      awaitingAgent.delete(id);
    }
    if (event.type === "tool" && toolResultAwaitsHuman(event.result)) awaitingHuman.add(id);
    if (event.type === "tool" && event.toolName === "delegate_task" && toolResultAwaitsAgent(event.result)) awaitingAgent.add(id);
    const waiting = awaitingHuman.has(id);
    const delegated = awaitingAgent.has(id);
    if (event.type === "submission_settled") {
      awaitingHuman.delete(id);
      awaitingAgent.delete(id);
      lastBeat.delete(id);
      stopAllTools(id);
      options.onSettled?.(id);
    }

    // Long single tool calls: keep the run alive on an interval until the call ends (or is clearly hung).
    if (event.type === "tool_start" && typeof event.toolCallId === "string") {
      const toolCallId = event.toolCallId;
      const startedAt = clock();
      stopTool(id, toolCallId);
      const handle = timers.setInterval(() => {
        if (clock() - startedAt > maxToolBeat) {
          stopTool(id, toolCallId);
          return;
        }
        void beatNow().catch(() => undefined);
      }, toolInterval);
      (handle as { unref?: () => void } | null)?.unref?.();
      if (!inflight.has(id)) inflight.set(id, new Map());
      inflight.get(id)?.set(toolCallId, handle);
    }
    if (event.type === "tool" && typeof event.toolCallId === "string") stopTool(id, event.toolCallId);

    if (options.onSubmission && (event.type === "submission_running" || event.type === "submission_settled")) {
      await options.onSubmission(context.env, id, event).catch((error: unknown) => console.warn("[ledger]", error));
    }
    if (options.onWorkflowState && event.type === "tool" && event.toolName === "transition_state" && !event.isError) {
      const state = workflowStateOf(event.result);
      if (state) await options.onWorkflowState(context.env, id, state).catch((error: unknown) => console.warn("[workflow]", error));
    }

    if (event.type === "submission_settled") {
      const outcome = String(event.outcome);
      const counters = options.counters?.(id);
      await serialize(id, async () => {
        const reg = options.registry(context.env);
        if (outcome === "completed") {
          await reg.complete(id, "COMPLETED", counters);
          return reg.setStatus(id, waiting ? "PENDING_APPROVAL" : delegated ? "QUEUED" : "IDLE");
        }
        if (outcome === "failed") {
          await reg.complete(id, "FAILED", counters);
          const message = (event.error as { message?: string } | undefined)?.message;
          return message ? reg.setStatus(id, "FAILED", message) : undefined;
        }
        const current = await reg.get(id);
        if (!current || current.status === "RUNNING") await reg.complete(id, "HALTED", counters);
      });
      return;
    }
    if (event.type === "tool" && waiting) {
      await serialize(id, () => options.registry(context.env).setStatus(id, "PENDING_APPROVAL"));
      return;
    }
    if (!LIVENESS_EVENTS.has(event.type)) return;
    const now = clock();
    if (event.type !== "submission_running" && now - (lastBeat.get(id) ?? Number.NEGATIVE_INFINITY) < interval) return;
    lastBeat.set(id, now);
    await beatNow();
  };
}

export interface HeartbeatRegistryPort<C> {
  beat(run: { runId: string; tenantId: string; agent: string }, counters?: C): Promise<unknown>;
}

export interface HookHeartbeatOptions<C> {
  registry: () => HeartbeatRegistryPort<C>;
  agent: string;
  tenantOf: (runId: string) => string;
  /** Every call's counters (kept for `complete()` on settle, even when the beat itself is throttled). */
  onCounters?: (runId: string, counters: C) => void;
  /** Minimum gap between registry beats per run. Default 15 s (the observer beats on turns and tools too). */
  intervalMs?: number;
  /** A beat still pending after this long no longer blocks the next one. Default 5 s. */
  staleAfterMs?: number;
  clock?: () => number;
  onError?: (error: unknown) => void;
}

/**
 * `useAgentStarter({ heartbeat })` for the run registry, off the tool hot path (R16): the hook calls it
 * before and after every tool call, so it never awaits the registry. It records the counters, then sends at
 * most one beat per run per `intervalMs`, fire-and-forget, with at most one beat in flight per run; registry
 * errors and latency never reach the tool call. Call `forget(runId)` when the run settles.
 */
export function createHookHeartbeat<C>(options: HookHeartbeatOptions<C>): ((runId: string, counters: C) => Promise<void>) & { forget(runId: string): void; tracked(): number } {
  const sentAt = new Map<string, number>();
  const pendingSince = new Map<string, number>();
  const interval = options.intervalMs ?? 15_000;
  const stale = options.staleAfterMs ?? 5_000;
  const clock = options.clock ?? Date.now;
  const beat = async (runId: string, counters: C): Promise<void> => {
    options.onCounters?.(runId, counters);
    const now = clock();
    const pending = pendingSince.get(runId);
    if (pending !== undefined && now - pending < stale) return;
    if (now - (sentAt.get(runId) ?? Number.NEGATIVE_INFINITY) < interval) return;
    sentAt.set(runId, now);
    pendingSince.set(runId, now);
    let call: Promise<unknown>;
    try {
      call = options.registry().beat({ runId, tenantId: options.tenantOf(runId), agent: options.agent }, counters);
    } catch (error) {
      pendingSince.delete(runId);
      options.onError?.(error);
      return;
    }
    void Promise.resolve(call)
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        if (pendingSince.get(runId) === now) pendingSince.delete(runId);
      });
  };
  return Object.assign(beat, {
    forget(runId: string) {
      sentAt.delete(runId);
      pendingSince.delete(runId);
    },
    tracked: () => sentAt.size,
  });
}
