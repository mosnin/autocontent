import { sweepStalledRuns } from "@agent-starter/cloudflare";
import { init } from "@flue/runtime";
import { AGENTS } from "../agents.generated.ts";
import type { Env } from "../env.ts";
import { registry } from "./platform.ts";
import { runRecoveryHooks } from "./recovery.ts";
import { forgetDispatch, pendingDispatches, recoveriesKey, recoverySubmissionKey, runningSubmission, trackedDispatch } from "./submissions.ts";

export const RECOVERY_SIGNAL_BODY =
  "SILENT_DEADLOCK_TIMEOUT: your previous step stalled and was aborted. Re-check the goal tree / workflow state, verify the outcome of the last action before repeating it, and continue from the last completed step.";

/**
 * Out-of-band liveness heartbeat sentinel (cron: every minute).
 * A run marked RUNNING with no cognitive step / tool handshake for 180 s is a
 * silent deadlock. Recovery:
 *  1. Flue can only abort ALL unsettled work of an instance, so the sentinel
 *     first reads the submission ledger (src/lib/submissions.ts): the stalled
 *     head and the programmatic dispatches queued behind it.
 *  2. It aborts (stops billing on the hung model/tool call) only when the head
 *     is known, or when nothing acked upstream is queued behind it.
 *  3. Registered recovery hooks run (e.g. the computer-use module stops the
 *     run's VM, R-CU-14).
 *  4. The agent is woken with a recovery signal, then the queued dispatches the
 *     abort cancelled are re-admitted in their original order.
 * Runs that keep deadlocking are failed after 3 recoveries instead of looping forever; the counter
 * resets once the run completes real work again (src/lib/submissions.ts), so unrelated stalls of a
 * long-lived conversation never add up.
 * Long single tool calls (VM builds, repo imports) keep beating while they run (run-status.ts and the
 * executor's heartbeat service), so the 180 s threshold only catches real stalls.
 * Runs waiting for a human are PENDING_APPROVAL (and runs waiting for a delegated task QUEUED), never
 * RUNNING, so they are not swept.
 * Each sweep first drains the durable webhook outbox (drainWebhookOutbox below).
 */
export async function sweepHeartbeats(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  const reg = registry(env);
  await drainWebhookOutbox(env);
  const result = await sweepStalledRuns(reg, {
    thresholdMs: 180_000,
    maxRecoveries: 3,
    recoveries: async (runId) => {
      const raw = await env.AGENT_CACHE.get(recoveriesKey(runId));
      return raw ? Number(raw) : 0;
    },
    recover: async (run) => {
      const outcome = await recoverStalledRun(env, run);
      if (outcome.hookFailures.length) console.warn(`[sentinel] recovery hooks failed for ${run.runId}: ${outcome.hookFailures.join("; ")}`);
    },
    log: (message) => console.warn(message),
  });
  if (result.inspected) console.log(`[sentinel] inspected=${result.inspected} recovered=${result.recovered.length} failed=${result.failed.length}`);
}

/**
 * Durable webhook outbox (src/lib/outbox.ts): every minute, retry the signed deliveries to the SaaS (job results,
 * telemetry, alerts, reports) that failed their immediate retries. Never throws: a drain failure must not stop
 * the sentinel.
 */
export async function drainWebhookOutbox(env: Env): Promise<void> {
  try {
    const result = await registry(env).drainOutbox();
    if (result.delivered || result.failed || result.dead) console.log(`[outbox] delivered=${result.delivered} failed=${result.failed} pending=${result.pending} dead=${result.dead}`);
  } catch (error) {
    console.warn("[outbox] drain failed", error);
  }
}

export async function recoverStalledRun(env: Env, run: { runId: string; tenantId: string; agent: string }): Promise<{ aborted: boolean; readmitted: number; hookFailures: string[] }> {
  const agent = AGENTS[run.agent];
  if (!agent) throw new Error(`No agent registered for identity ${run.agent}`);
  const attempts = Number((await env.AGENT_CACHE.get(recoveriesKey(run.runId))) ?? 0) + 1;
  await env.AGENT_CACHE.put(recoveriesKey(run.runId), String(attempts), { expirationTtl: 86_400 });

  const head = await runningSubmission(env, run.runId);
  const queued = (await pendingDispatches(env, run.runId)).filter((d) => d.submissionId !== head);
  const handle = init(agent, { id: run.runId });
  // Without a known head, aborting could cancel acked work for nothing: only abort when it is safe.
  const aborted = head !== null || queued.length === 0;
  if (aborted) await handle.abort();

  const hooks = await runRecoveryHooks({ runId: run.runId, tenantId: run.tenantId, agent: run.agent, reason: "recovery", attempt: attempts, env });

  const recovery = await handle.dispatch({
    message: { kind: "signal", type: "recovery", body: RECOVERY_SIGNAL_BODY, attributes: { attempt: String(attempts) } },
    idempotencyKey: `recovery:${run.runId}:${attempts}`,
  });
  // The recovery signal completing on its own is not progress: only other work resets the counter.
  await env.AGENT_CACHE.put(recoverySubmissionKey(run.runId), recovery.submissionId, { expirationTtl: 86_400 });

  let readmitted = 0;
  if (aborted) {
    for (const item of queued) {
      // A fresh key: the original key names the aborted submission and would converge on it.
      await trackedDispatch(env, agent, { id: run.runId, message: item.message, idempotencyKey: `${item.idempotencyKey ?? item.submissionId}:readmit:${attempts}`.slice(0, 256) });
      await forgetDispatch(env, run.runId, item.submissionId);
      readmitted++;
    }
  }
  return { aborted, readmitted, hookFailures: hooks.filter((h) => !h.ok).map((h) => `${h.name}: ${h.error}`) };
}
