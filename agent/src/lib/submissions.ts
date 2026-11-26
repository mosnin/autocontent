import { type Agent, type AgentDispatchRequest, type DeliveredMessageInput, type DispatchReceipt, dispatch } from "@flue/runtime";
import type { Env } from "../env.ts";

/**
 * Submission ledger (AGENT_CACHE KV) for the heartbeat sentinel.
 *
 * Flue 2.3.0 can only abort ALL unsettled work of an instance (the stalled head
 * and every queued submission behind it). Queue messages behind a programmatic
 * dispatch were already acked, so a blind abort would silently drop them. The
 * ledger records:
 *  - `sub:pending:<runId>:<submissionId>`: programmatic dispatches (queue consumer,
 *    job routes) with their message, so recovery can re-admit the queued ones;
 *  - `sub:running:<runId>:<submissionId>`: which submission is currently running
 *    (written by the observer on `submission_running`), so recovery never
 *    re-admits the stalled head itself.
 * Every key is unique per submission (no per-key KV write contention) and is
 * deleted when the submission settles; TTLs bound anything a missed event leaves.
 */
const TTL_SECONDS = 2 * 86_400;

export interface TrackedDispatch {
  submissionId: string;
  message: DeliveredMessageInput;
  idempotencyKey?: string;
  at: number;
}

const pendingKey = (runId: string, submissionId = "") => `sub:pending:${runId}:${submissionId}`;
const runningKey = (runId: string, submissionId = "") => `sub:running:${runId}:${submissionId}`;
/** Sentinel recoveries of a run (src/lib/cron.ts); reset when the run completes real work again (R20). */
export const recoveriesKey = (runId: string) => `recoveries:${runId}`;
/** The submission id of the run's latest recovery signal: its own completion is not proof of progress. */
export const recoverySubmissionKey = (runId: string) => `recoveries:sub:${runId}`;

/** `dispatch()` + ledger entry. Use for every programmatic dispatch whose upstream was already acknowledged. */
export async function trackedDispatch(env: Env, agent: Agent, request: AgentDispatchRequest): Promise<DispatchReceipt> {
  const receipt = await dispatch(agent, request);
  if (!receipt.deduplicated) {
    const entry: TrackedDispatch = { submissionId: receipt.submissionId, message: request.message, ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}), at: Date.now() };
    await env.AGENT_CACHE.put(pendingKey(request.id, receipt.submissionId), JSON.stringify(entry), { expirationTtl: TTL_SECONDS }).catch((error: unknown) => console.warn("[ledger] pending write failed", error));
  }
  return receipt;
}

/**
 * Observer hook: keep the ledger in step with Flue submission events. A submission that settles
 * `completed` (other than the sentinel's own recovery signal) proves the run made progress again, so
 * its recovery counter is reset: unrelated stalls hours apart never add up to the "failed after 3
 * recoveries" limit, while a run that keeps stalling on the same work still does (R20).
 */
export async function recordSubmissionEvent(env: Pick<Env, "AGENT_CACHE">, instanceId: string, event: { type: string; submissionId?: unknown; outcome?: unknown }): Promise<void> {
  const submissionId = typeof event.submissionId === "string" ? event.submissionId : "";
  if (!submissionId || !env.AGENT_CACHE) return;
  if (event.type === "submission_running") {
    await env.AGENT_CACHE.put(runningKey(instanceId, submissionId), String(Date.now()), { expirationTtl: TTL_SECONDS });
  } else if (event.type === "submission_settled") {
    await Promise.all([env.AGENT_CACHE.delete(runningKey(instanceId, submissionId)), env.AGENT_CACHE.delete(pendingKey(instanceId, submissionId))]);
    if (event.outcome === "completed" && (await env.AGENT_CACHE.get(recoveriesKey(instanceId))) !== null) {
      const recoverySignal = await env.AGENT_CACHE.get(recoverySubmissionKey(instanceId));
      if (recoverySignal !== submissionId) await Promise.all([env.AGENT_CACHE.delete(recoveriesKey(instanceId)), env.AGENT_CACHE.delete(recoverySubmissionKey(instanceId))]);
    }
  }
}

/** The submission currently running for a run (most recently started), if the ledger knows it. */
export async function runningSubmission(env: Env, runId: string): Promise<string | null> {
  const listed = await env.AGENT_CACHE.list({ prefix: runningKey(runId) });
  const keys = listed.keys.map((k) => k.name.slice(runningKey(runId).length)).filter(Boolean);
  if (keys.length === 0) return null;
  const started = await Promise.all(keys.map(async (id) => ({ id, at: Number((await env.AGENT_CACHE.get(runningKey(runId, id))) ?? 0) })));
  return started.sort((a, b) => b.at - a.at)[0]?.id ?? null;
}

/** Programmatic dispatches of a run that have not settled yet, oldest first. */
export async function pendingDispatches(env: Env, runId: string): Promise<TrackedDispatch[]> {
  const listed = await env.AGENT_CACHE.list({ prefix: pendingKey(runId) });
  const entries = await Promise.all(listed.keys.map(async (k) => env.AGENT_CACHE.get(k.name)));
  return entries
    .filter((raw): raw is string => typeof raw === "string")
    .map((raw) => JSON.parse(raw) as TrackedDispatch)
    .sort((a, b) => a.at - b.at);
}

/** Forget a ledger entry (e.g. after re-admitting it under a new submission id). */
export async function forgetDispatch(env: Env, runId: string, submissionId: string): Promise<void> {
  await env.AGENT_CACHE.delete(pendingKey(runId, submissionId));
}
