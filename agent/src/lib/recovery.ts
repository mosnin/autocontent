import type { Env } from "../env.ts";

/**
 * Compute-cleanup hooks for stalled or torn-down runs.
 *
 * The heartbeat sentinel (src/lib/cron.ts) and the emergency teardown routes call
 * every registered hook so modules that hold external compute (boat.dev VMs,
 * browser sessions, sandboxes) can stop it. Register at module scope from the
 * module that owns the compute, e.g. in src/computer-use/vm.ts:
 *
 *   registerRecoveryHook("computer-use:vm", async ({ runId, reason, env }) => {
 *     await stopVmForRun(runId, env, { force: reason === "teardown" });
 *   });
 *
 * This file imports no agents, so any module can import it without cycles.
 */
export interface RecoveryHookContext {
  runId: string;
  tenantId: string;
  agent: string;
  /** "recovery": the sentinel found a silent deadlock; "teardown": an operator forced a stop. */
  reason: "recovery" | "teardown";
  /** 1-based recovery attempt (always 1 for teardown). */
  attempt: number;
  env: Env;
}

export type RecoveryHook = (context: RecoveryHookContext) => Promise<void>;

const hooks = new Map<string, RecoveryHook>();

/** Register (or replace) a named hook. Idempotent per name, so module re-evaluation is safe. */
export function registerRecoveryHook(name: string, hook: RecoveryHook): void {
  hooks.set(name, hook);
}

export function unregisterRecoveryHook(name: string): void {
  hooks.delete(name);
}

export function recoveryHookNames(): string[] {
  return [...hooks.keys()];
}

/** Run every hook; one failing hook never blocks the others or the recovery itself. */
export async function runRecoveryHooks(context: RecoveryHookContext): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];
  for (const [name, hook] of hooks) {
    try {
      await hook(context);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
