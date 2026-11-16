import { AgentError } from "../errors.ts";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  /** Successful probes needed in half-open state before closing again. */
  halfOpenSuccesses: number;
  clock?: () => number;
}

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number;
}

/**
 * Keyed circuit breaker (e.g. one circuit per model provider or per external API).
 * When a dependency keeps failing, calls fail fast with CIRCUIT_OPEN so the model
 * router can fall back instead of waiting on timeouts.
 */
export class CircuitBreaker {
  private readonly circuits = new Map<string, CircuitRecord>();
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      cooldownMs: options.cooldownMs ?? 30_000,
      halfOpenSuccesses: options.halfOpenSuccesses ?? 1,
      clock: options.clock ?? Date.now,
    };
  }

  state(key: string): CircuitState {
    const record = this.record(key);
    if (record.state === "open" && this.options.clock() - record.openedAt >= this.options.cooldownMs) {
      record.state = "half_open";
      record.successes = 0;
    }
    return record.state;
  }

  canRequest(key: string): boolean {
    return this.state(key) !== "open";
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.canRequest(key)) {
      throw new AgentError("CIRCUIT_OPEN", `Circuit "${key}" is open; failing fast.`, { details: { key }, retryable: false });
    }
    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (error) {
      this.recordFailure(key);
      throw error;
    }
  }

  recordSuccess(key: string): void {
    const record = this.record(key);
    if (record.state === "half_open") {
      record.successes++;
      if (record.successes >= this.options.halfOpenSuccesses) Object.assign(record, { state: "closed", failures: 0, successes: 0 });
    } else {
      record.failures = 0;
    }
  }

  recordFailure(key: string): void {
    const record = this.record(key);
    record.failures++;
    if (record.state === "half_open" || record.failures >= this.options.failureThreshold) {
      record.state = "open";
      record.openedAt = this.options.clock();
    }
  }

  private record(key: string): CircuitRecord {
    let record = this.circuits.get(key);
    if (!record) {
      record = { state: "closed", failures: 0, successes: 0, openedAt: 0 };
      this.circuits.set(key, record);
    }
    return record;
  }
}
