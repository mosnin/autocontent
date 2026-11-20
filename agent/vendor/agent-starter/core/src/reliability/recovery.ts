import { AgentError, errorMessage } from "../errors.ts";
import type { SqlStore } from "../storage/ports.ts";
import { classifyError, sleep } from "./retry.ts";

export type FailureState = "HEALTHY" | "VM_UNREACHABLE" | "LLM_RATE_LIMIT" | "SANDBOX_TIMEOUT" | "TOOL_FAILURE" | "PAUSED_OVERSIGHT" | "CRITICAL_FAILED";

export interface RecoveryStrategy {
  /** Called before the next attempt; e.g. power-cycle a VM or rotate a model. */
  heal?: (info: { stepName: string; error: unknown; attempt: number }) => Promise<void>;
  backoffMs?: (attempt: number) => number;
}

export interface RecoveryManagerOptions {
  scope: string;
  maxRetries?: number;
  classify?: (error: unknown) => FailureState;
  strategies?: Partial<Record<FailureState, RecoveryStrategy>>;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

export function defaultFailureClassifier(error: unknown): FailureState {
  const message = errorMessage(error);
  if (/sandbox|vm|boat|container/i.test(message) && /unreachable|404|econn|etimedout|stopped/i.test(message)) return "VM_UNREACHABLE";
  switch (classifyError(error)) {
    case "rate_limit":
      return "LLM_RATE_LIMIT";
    case "timeout":
      return /sandbox|exec/i.test(message) ? "SANDBOX_TIMEOUT" : "TOOL_FAILURE";
    case "network":
    case "server":
      return "TOOL_FAILURE";
    case "approval":
      return "PAUSED_OVERSIGHT";
    default:
      return "CRITICAL_FAILED";
  }
}

/**
 * Failure state machine with SQLite-checkpointed retry counters (survives
 * Durable Object eviction). Each failure is classified, persisted, optionally
 * healed by a strategy, then retried with backoff until `maxRetries`.
 */
export class RecoveryManager {
  private readonly maxRetries: number;
  private readonly classify: (error: unknown) => FailureState;
  private readonly strategies: Partial<Record<FailureState, RecoveryStrategy>>;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly clock: () => number;

  constructor(
    private readonly sql: SqlStore,
    private readonly options: RecoveryManagerOptions,
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.classify = options.classify ?? defaultFailureClassifier;
    this.strategies = options.strategies ?? {};
    this.wait = options.sleep ?? ((ms) => sleep(ms));
    this.clock = options.clock ?? Date.now;
  }

  current(): { state: FailureState; retryCount: number; lastError: string | null } {
    const row = this.sql.exec<{ state: string; retry_count: number; last_error: string | null }>(
      `SELECT state, retry_count, last_error FROM as_recovery_state WHERE scope = ?`,
      this.options.scope,
    )[0];
    return row ? { state: row.state as FailureState, retryCount: Number(row.retry_count), lastError: row.last_error } : { state: "HEALTHY", retryCount: 0, lastError: null };
  }

  async executeWithRecovery<T>(stepName: string, action: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        const result = await action();
        this.update("HEALTHY", 0, null);
        return result;
      } catch (error) {
        const state = this.classify(error);
        if (state === "PAUSED_OVERSIGHT") {
          this.update(state, this.current().retryCount, errorMessage(error));
          throw error;
        }
        const attempt = this.current().retryCount + 1;
        this.update(state, attempt, errorMessage(error));
        if (state === "CRITICAL_FAILED" || attempt > this.maxRetries) {
          this.update("CRITICAL_FAILED", attempt, errorMessage(error));
          throw new AgentError("RECOVERY_EXHAUSTED", `[CRITICAL_HALT] Step "${stepName}" abandoned after ${attempt} attempt(s); system safe-stopped.`, {
            cause: error,
            details: { stepName, state, attempt },
          });
        }
        const strategy = this.strategies[state];
        await strategy?.heal?.({ stepName, error, attempt });
        await this.wait(strategy?.backoffMs?.(attempt) ?? 1000 * attempt);
      }
    }
  }

  reset(note: string | null = null): void {
    this.update("HEALTHY", 0, note);
  }

  update(state: FailureState, retries: number, lastError: string | null): void {
    this.sql.exec(
      `INSERT INTO as_recovery_state (scope, state, retry_count, last_error, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET state = excluded.state, retry_count = excluded.retry_count, last_error = excluded.last_error, updated_at = excluded.updated_at`,
      this.options.scope,
      state,
      retries,
      lastError,
      this.clock(),
    );
  }
}
