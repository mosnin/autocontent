import { AgentError, HttpError, TimeoutError, toError } from "../errors.ts";

export type ErrorClass = "rate_limit" | "timeout" | "network" | "server" | "auth" | "validation" | "budget" | "approval" | "unknown";

/** Map any thrown value to a coarse class used by retry, recovery and model fallback logic. */
export function classifyError(error: unknown): ErrorClass {
  if (error instanceof AgentError) {
    switch (error.code) {
      case "BUDGET_LIMIT_EXCEEDED":
        return "budget";
      case "APPROVAL_REQUIRED":
        return "approval";
      case "TIMEOUT":
        return "timeout";
      case "TOOL_VALIDATION_FAILED":
      case "ARGUMENT_CORRUPTION_UNRECOVERABLE":
        return "validation";
      case "RATE_LIMITED":
        return "rate_limit";
      default:
        break;
    }
  }
  if (error instanceof HttpError) {
    if (error.status === 429) return "rate_limit";
    if (error.status === 401 || error.status === 403) return "auth";
    if (error.status === 408) return "timeout";
    if (error.status >= 500) return "server";
    if (error.status >= 400) return "validation";
  }
  const message = toError(error).message.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests/.test(message)) return "rate_limit";
  if (/timed? ?out|etimedout|deadline/.test(message)) return "timeout";
  if (/econnreset|econnrefused|enotfound|network|fetch failed|socket hang up|connection (closed|reset)/.test(message)) return "network";
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable|overloaded/.test(message)) return "server";
  if (/\b40[13]\b|unauthorized|forbidden/.test(message)) return "auth";
  return "unknown";
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof AgentError && error.retryable) return true;
  const cls = classifyError(error);
  return cls === "rate_limit" || cls === "timeout" || cls === "network" || cls === "server";
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Exponential backoff with full jitter (default) or linear backoff. */
  backoff: "exponential" | "linear";
  jitter: boolean;
  retryOn: (error: unknown, attempt: number) => boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 20_000,
  backoff: "exponential",
  jitter: true,
  retryOn: (error) => isRetryableError(error),
};

export interface RetryHooks {
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function computeDelay(policy: RetryPolicy, attempt: number, error?: unknown): number {
  const retryAfter = error instanceof HttpError ? error.retryAfterMs : undefined;
  const raw = policy.backoff === "linear" ? policy.baseDelayMs * attempt : policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(policy.maxDelayMs, raw);
  const jittered = policy.jitter ? Math.random() * capped : capped;
  return Math.max(jittered, Math.min(retryAfter ?? 0, policy.maxDelayMs));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Retry `fn` according to `policy`. Non-retryable errors are rethrown immediately. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, policy: Partial<RetryPolicy> = {}, hooks: RetryHooks = {}): Promise<T> {
  const resolved: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  const wait = hooks.sleep ?? sleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt++) {
    if (hooks.signal?.aborted) throw hooks.signal.reason ?? new Error("Aborted");
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= resolved.maxAttempts || !resolved.retryOn(error, attempt)) throw error;
      const delayMs = computeDelay(resolved, attempt, error);
      hooks.onRetry?.({ attempt, delayMs, error });
      await wait(delayMs, hooks.signal);
    }
  }
  throw lastError;
}

/** Race a promise against a timeout; aborts the provided controller on expiry. */
export async function withTimeout<T>(operation: string, ms: number, fn: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onParentAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new TimeoutError(operation, ms);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}
