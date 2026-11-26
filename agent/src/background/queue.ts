import { processEventBatch, renderTurn } from "@agent-starter/cloudflare";
import { BackgroundWorker } from "../agents/background-worker.ts";
import type { Env } from "../env.ts";
import { classifyDelivery, dispatchInitialData, registry, TenantRateLimiter } from "../lib/platform.ts";
import { trackedDispatch } from "../lib/submissions.ts";
import { type DispatchJobDeps, type DispatchJobResult, dispatchJobTurn } from "./jobs.ts";
import { parseSampleRate, shadowSampled, shadowTwinId } from "./shadow.ts";

/** Background vars this module adds to wrangler.jsonc (module.json `vars`). */
export type BackgroundEnv = Env & { SHADOW_SAMPLE_RATE?: string; SHADOW_MODEL?: string };

/**
 * Queue consumer = traffic controller (routing logic in src/background/jobs.ts).
 *  - Rapid events for the same tenant+session are coalesced into ONE agent turn.
 *  - Provider redeliveries are dropped by event id (KV event ledger), even across batches.
 *  - Tenant turn limits (TenantConfig.rateLimit, a bucket separate from the edge's event bucket) defer a
 *    noisy tenant's turns by re-enqueueing them with a delay; the message is acked, so a deferral never
 *    counts toward max_retries / the DLQ.
 *  - Each turn goes to a JOB-scoped instance: events join the session's open job; a job that reached
 *    REPORT / DONE / FAILED or settled takes no new work, the next turn starts a fresh job.
 *  - The Workers AI utility model labels each turn SIMPLE / COMPLEX (stamped as the signal's `route`), and
 *    the dispatch seeds the tenant's config (dispatchInitialData), so a job's first turn runs on the right model.
 *  - Dispatches carry an idempotency key and are recorded in the submission ledger so the heartbeat
 *    sentinel can re-admit them after a recovery abort.
 *  - SHADOW_SAMPLE_RATE > 0 forks a share of jobs into shadow twins (see shadow.ts).
 */
export async function handleEventsQueue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
  const deps = jobDispatchDeps(env);
  const outcomes: Record<DispatchJobResult["status"], number> = { dispatched: 0, deferred: 0, duplicate: 0 };
  const result = await processEventBatch(batch, {
    dispatchTurn: async (turn) => {
      const outcome = await dispatchJobTurn(deps, turn);
      outcomes[outcome.status]++;
    },
    onDrop: (message, reason) => console.warn(`[queue] dropped ${message.id}: ${reason}`),
  });
  console.log(`[queue] turns=${result.turns} acked=${result.acked} retried=${result.retried} dropped=${result.dropped} dispatched=${outcomes.dispatched} deferred=${outcomes.deferred} duplicate=${outcomes.duplicate}`);
}

export function jobDispatchDeps(env: BackgroundEnv): DispatchJobDeps {
  const reg = registry(env);
  const rate = parseSampleRate(env.SHADOW_SAMPLE_RATE);
  return {
    kv: env.AGENT_CACHE,
    registry: { get: async (runId) => (await reg.get(runId)) as { status: string } | null },
    dispatch: (request) => trackedDispatch(env, BackgroundWorker, request),
    beat: (run) => reg.beat(run),
    render: renderTurn,
    classify: (text) => classifyDelivery(text),
    initialData: (base) => dispatchInitialData(base.tenantId, base),
    limiter: new TenantRateLimiter(env, undefined, "turns"),
    requeue: async (events, delaySeconds) => {
      if (!env.EVENTS_QUEUE) throw new Error("EVENTS_QUEUE is not bound");
      await env.EVENTS_QUEUE.sendBatch(events.map((body) => ({ body, contentType: "json" as const, delaySeconds })));
    },
    ...(rate > 0 ? { shadow: { rate, twinId: shadowTwinId, sampled: shadowSampled } } : {}),
    log: (message) => console.warn(message),
  };
}
