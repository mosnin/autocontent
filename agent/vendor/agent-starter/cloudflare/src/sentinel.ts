import type { RunRecord } from "@agent-starter/core";

export interface RegistryLike {
  stalled(thresholdMs: number): Promise<RunRecord[]>;
  setStatus(runId: string, status: RunRecord["status"], error?: string): Promise<void>;
  /** Recovery attempts since the run last settled cleanly (`RunRegistry` resets them on `complete(…, "COMPLETED")`). */
  recoveryAttempts?(runId: string): Promise<number>;
  /** Count one recovery; returns the attempts since the last clean settle and the run's lifetime total. */
  noteRecovery?(runId: string): Promise<{ attempts: number; total: number }>;
}

export interface SentinelResult {
  inspected: number;
  recovered: string[];
  failed: Array<{ runId: string; error: string }>;
}

/** What the sentinel tells `recover` about this attempt. */
export interface RecoveryAttempt {
  /** 1-based attempt since the run last settled cleanly. */
  attempt: number;
  /** Lifetime recoveries of the run (never reset): use it, not `attempt`, in idempotency keys. */
  total: number;
}

/**
 * Out-of-band liveness heartbeat sentinel (run from a `* * * * *` cron
 * trigger). Any run marked RUNNING whose last cognitive step / tool handshake is
 * older than the threshold (default 180 s) is declared a silent deadlock:
 * `recover` should purge stuck compute (stop the VM, abort the Flue instance)
 * and restart from the last checkpoint (e.g. dispatch a `recovery` signal).
 * Runs that exceed `maxRecoveries` are failed instead of looping.
 *
 * Attempts are counted by the registry when it implements `recoveryAttempts` / `noteRecovery` (`RunRegistry` does,
 * and resets the count when a submission settles cleanly, so unrelated stalls days apart never add up). Pass
 * `recoveries` only to keep your own counter; the sentinel then neither reads nor writes the registry's.
 */
export async function sweepStalledRuns(
  registry: RegistryLike,
  options: {
    thresholdMs?: number;
    recover: (run: RunRecord, attempt: RecoveryAttempt) => Promise<void>;
    recoveries?: (runId: string) => Promise<number>;
    maxRecoveries?: number;
    log?: (message: string) => void;
  },
): Promise<SentinelResult> {
  const stalled = await registry.stalled(options.thresholdMs ?? 180_000);
  const result: SentinelResult = { inspected: stalled.length, recovered: [], failed: [] };
  const counted = !options.recoveries && typeof registry.noteRecovery === "function";
  for (const run of stalled) {
    try {
      const attempts = options.recoveries ? await options.recoveries(run.runId) : ((await registry.recoveryAttempts?.(run.runId)) ?? 0);
      if (attempts >= (options.maxRecoveries ?? 3)) {
        await registry.setStatus(run.runId, "FAILED", "SILENT_DEADLOCK: recovery attempts exhausted");
        result.failed.push({ runId: run.runId, error: "recovery attempts exhausted" });
        continue;
      }
      options.log?.(`[sentinel] silent deadlock: ${run.runId} (${Math.round((Date.now() - run.lastHeartbeatAt) / 1000)}s since heartbeat)`);
      // Counted before the work, so a recovery that keeps throwing still runs out of attempts.
      const attempt = counted ? await (registry.noteRecovery as NonNullable<RegistryLike["noteRecovery"]>)(run.runId) : { attempts: attempts + 1, total: attempts + 1 };
      await options.recover(run, { attempt: attempt.attempts, total: attempt.total });
      await registry.setStatus(run.runId, "RUNNING", "recovered from SILENT_DEADLOCK_TIMEOUT");
      result.recovered.push(run.runId);
    } catch (error) {
      result.failed.push({ runId: run.runId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
