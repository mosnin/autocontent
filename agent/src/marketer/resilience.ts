/**
 * Backend health for the Marketer API client: a circuit breaker and a rate-limit pause, per API origin.
 *
 * Why: when the backend is down every tool call would otherwise wait out its full timeout, the model would see a
 * generic failure, try another tool, wait again, and burn the run's turn and cost budget on a dead dependency.
 * With the breaker, after `failureThreshold` consecutive failures (5xx, timeout, network) requests fail fast with
 * TEMPORARILY_UNAVAILABLE for `cooldownMs`, then ONE read is let through as a probe:
 *
 *   closed ──(N consecutive failures)──▶ open ──(cooldown)──▶ half-open ──(probe ok)──▶ closed
 *                                          ▲                      │
 *                                          └──────(probe fails)───┘   (cooldown doubles, capped)
 *
 * Writes never probe: a write is only sent while the circuit is closed, because a write into a backend that just
 * recovered is exactly the request whose outcome we could not confirm (docs/adr/0006). A refused write was never
 * sent, so it is a definite "temporarily unavailable", not an unknown outcome.
 *
 * A 429 with Retry-After pauses the origin until then (capped): reads and writes are refused without being sent.
 *
 * State is per isolate (a Worker isolate or one Durable Object): no storage, no cross-tenant data, and good enough
 * to stop one run from looping. The key is the API origin only.
 */
export interface BackendHealthOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  maxCooldownMs?: number;
  maxPauseMs?: number;
  now?: () => number;
}

export type Admission = { ok: true; probe: boolean } | { ok: false; reason: "circuit_open" | "rate_limited"; retryAfterMs: number };

interface Circuit {
  failures: number;
  /** 0 = closed. */
  openedAt: number;
  cooldownMs: number;
  probing: boolean;
  pausedUntil: number;
}

export class BackendHealth {
  private readonly circuits = new Map<string, Circuit>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly maxPauseMs: number;
  private readonly now: () => number;

  constructor(options: BackendHealthOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.maxCooldownMs = options.maxCooldownMs ?? 300_000;
    this.maxPauseMs = options.maxPauseMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /** May this request be sent now? Admitting a probe marks it in flight until `success` or `failure`. */
  admit(key: string, write: boolean): Admission {
    const c = this.circuit(key);
    const now = this.now();
    if (c.pausedUntil > now) return { ok: false, reason: "rate_limited", retryAfterMs: c.pausedUntil - now };
    if (c.openedAt === 0) return { ok: true, probe: false };
    const remaining = c.openedAt + c.cooldownMs - now;
    if (remaining > 0) return { ok: false, reason: "circuit_open", retryAfterMs: remaining };
    // Half-open: one read probes; writes and concurrent reads wait for its verdict.
    if (write || c.probing) return { ok: false, reason: "circuit_open", retryAfterMs: Math.min(c.cooldownMs, 5_000) };
    c.probing = true;
    return { ok: true, probe: true };
  }

  success(key: string): void {
    const c = this.circuit(key);
    c.failures = 0;
    c.openedAt = 0;
    c.cooldownMs = this.cooldownMs;
    c.probing = false;
  }

  /** A failure that says the backend is unhealthy: 5xx, timeout, network. Never a 4xx, never a caller's abort. */
  failure(key: string): void {
    const c = this.circuit(key);
    const now = this.now();
    if (c.probing) {
      c.probing = false;
      c.openedAt = now;
      c.cooldownMs = Math.min(this.maxCooldownMs, c.cooldownMs * 2);
      return;
    }
    c.failures++;
    if (c.openedAt === 0 && c.failures >= this.failureThreshold) {
      c.openedAt = now;
      c.cooldownMs = this.cooldownMs;
    }
  }

  /** The request ended without a verdict on health (a 4xx, a caller's abort): release a probe slot if it held one. */
  neutral(key: string): void {
    this.circuit(key).probing = false;
  }

  /** The backend said "slow down" (429 + Retry-After): refuse everything until then, capped. */
  pause(key: string, retryAfterMs: number): void {
    if (!(retryAfterMs > 0)) return;
    const c = this.circuit(key);
    c.pausedUntil = Math.max(c.pausedUntil, this.now() + Math.min(retryAfterMs, this.maxPauseMs));
  }

  state(key: string): "closed" | "open" | "half_open" {
    const c = this.circuit(key);
    if (c.openedAt === 0) return "closed";
    return c.openedAt + c.cooldownMs - this.now() > 0 ? "open" : "half_open";
  }

  reset(): void {
    this.circuits.clear();
  }

  private circuit(key: string): Circuit {
    let c = this.circuits.get(key);
    if (!c) {
      c = { failures: 0, openedAt: 0, cooldownMs: this.cooldownMs, probing: false, pausedUntil: 0 };
      this.circuits.set(key, c);
    }
    return c;
  }
}

/** The isolate's shared health record (tests pass their own through `ctx.services.marketerClient.health`). */
export const defaultBackendHealth = new BackendHealth();

/** Bounded retries for idempotent reads: full jitter, capped, never past the caller's deadline. */
export interface ReadRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** A Retry-After longer than this is not waited out: the read fails as temporarily unavailable instead. */
  maxRetryAfterMs: number;
}

export const READ_RETRY: Readonly<ReadRetryPolicy> = Object.freeze({ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000, maxRetryAfterMs: 5_000 });

/** Delay before retry number `attempt` (1 = after the first failure): full jitter, floored by a short Retry-After. */
export function retryDelayMs(policy: ReadRetryPolicy, attempt: number, random: () => number, retryAfterMs?: number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jittered = Math.floor(random() * ceiling);
  return Math.max(jittered, Math.min(retryAfterMs ?? 0, policy.maxRetryAfterMs));
}
