import { AgentError } from "@agent-starter/core";
import * as v from "valibot";
import { actorFromServices } from "./actor-context.ts";
import { errorDetail, MarketerApiError, MarketerOutcomeUnknownError, MarketerUnavailableError } from "./errors.ts";
import { type BackendHealth, defaultBackendHealth, READ_RETRY, type ReadRetryPolicy, retryDelayMs } from "./resilience.ts";

export { errorDetail } from "./errors.ts";

/**
 * The ONE client every Marketer tool uses to reach the Marketer REST API (FastAPI, `/api/v1/*`).
 *
 *  - Base URL: `PRIMARY_SAAS_API_URL` (the backend origin, e.g. https://api.marketer.sh). Paths below are relative
 *    to `/api/v1`. It must be https; plain http is accepted only for loopback and private hosts (local dev, a
 *    service network), because the service token rides on every request.
 *  - Auth: `Authorization: Bearer ${SAAS_SERVICE_TOKEN}`. The backend accepts it only when it equals its own
 *    `MARKETER_AGENT_SERVICE_TOKEN` and then acts on the workspace named by `x-tenant-id` with the `agent` role
 *    (backend/auth.py), never a platform admin.
 *  - Tenant: `x-tenant-id` is ALWAYS `ctx.tenant.tenantId` (server-derived by agentAuth / the ingestion handler /
 *    the control plane). It is never read from tool arguments. It is the workspace's tenant id (docs/auth/README.md).
 *  - Actor: `x-actor-id` is the person the run acts for, sent only when `withActor` (actor.ts) put one on the call
 *    from a verified session. The backend then caps the call at agent ∩ that person's role; without it, at the agent
 *    role minus spend:approve and campaign:launch. Never read from arguments, bus messages or room turns.
 *  - Writes (anything but GET) carry `idempotency-key: ctx.idempotencyKey` (derived from run + call + tool + args).
 *    Write TOOLS refuse to send without one (tools/define.ts).
 *  - Persistent agents get `ctx.services.fetch` (brokered + egress-guarded): the client then sends the request
 *    through it with the `saas` credential and never touches the token itself (src/persistent/credentials.ts).
 *  - Redirects are never followed on the direct path (`redirect: "manual"`): the bearer token must not travel to
 *    wherever a 3xx points. The brokered path checks every hop against the egress policy itself.
 *
 * Reliability (the contract the tools and the model rely on):
 *  - Timeouts: every request has one, enforced here whatever the caller's signal does. Reads: 10 s per attempt
 *    inside a 20 s deadline. Writes: one attempt, 25 s. Callers may pass `timeoutMs` / `deadlineMs`.
 *  - Retries: idempotent reads (GET) only, at most 3 attempts, exponential backoff with full jitter, a short
 *    Retry-After honoured, never past the deadline. Writes are NEVER retried here or by the executor: an
 *    unanswered write is an unknown outcome and the rails hand it to a person (docs/adr/0006).
 *  - Backoff when the backend is down: a per-origin circuit breaker and rate-limit pause (resilience.ts). While
 *    open, requests fail fast with TEMPORARILY_UNAVAILABLE and are not sent; writes are only sent while closed.
 *  - Errors are typed (errors.ts): DENIED, NEEDS_APPROVAL, OUTCOME_UNKNOWN, TEMPORARILY_UNAVAILABLE, NOT_FOUND,
 *    CONFLICT, INVALID_INPUT, NOT_CONFIGURED. An HTTP answer stays an `HttpError` (status + FastAPI `detail`), so
 *    the executor's idempotency ledger can tell a definite rejection (4xx: FAILED, may run again) from an unknown
 *    outcome (5xx / timeout / network).
 *
 * Env is read at use time from `ctx.services.env` (the Worker env the hook hands every tool), never at module scope
 * and never through src/lib/platform.ts, so this module and every tools module load in plain Node tests.
 */

export const MARKETER_API_PREFIX = "/api/v1";
/** Credential name of the service token in the persistent agent's credential broker. */
export const SAAS_CREDENTIAL = "saas";

export type MarketerMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined;

/** The subset of `ToolExecutionContext` the client needs (tests pass a plain object). */
export interface MarketerCallContext {
  tenant: { tenantId: string; userId?: string };
  idempotencyKey?: string;
  signal?: AbortSignal;
  services?: Record<string, unknown>;
}

export interface MarketerRequest {
  method: MarketerMethod;
  /** Path under /api/v1, starting with "/". Ids must already be validated by the tool's schema. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Per-attempt timeout. Default: 10 s for reads, 25 s for writes. */
  timeoutMs?: number;
  /** Total time a read may take across its retries. Default 20 s. Writes have one attempt, so `timeoutMs` is it. */
  deadlineMs?: number;
}

/** Test seams and tuning, read from `ctx.services.marketerClient` (production passes none of them). */
export interface MarketerClientRuntime {
  health?: BackendHealth;
  retry?: Partial<ReadRetryPolicy>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export const READ_ATTEMPT_TIMEOUT_MS = 10_000;
export const READ_DEADLINE_MS = 20_000;
export const WRITE_TIMEOUT_MS = 25_000;

interface MarketerEnv {
  PRIMARY_SAAS_API_URL?: string;
  SAAS_SERVICE_TOKEN?: string;
}

type BrokeredFetch = (url: string, init?: RequestInit & { credential?: string }) => Promise<Response>;

const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:|-]{0,127}$/;
const SAFE_PATH = /^\/[A-Za-z0-9_\-/.]*$/;

/** Shared schema pieces for tool inputs. */
export const uuid = (label = "id") => v.pipe(v.string(), v.uuid(`${label} must be a UUID`));
export const limit = (max = 100, fallback = 20) => v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(max)), fallback);
/** Every money-moving or publishing tool asks the model for a one-line reason (audit + approval card). */
export const reason = v.pipe(v.string(), v.minLength(5), v.maxLength(500));

/** Resolve the configured API (throws CONFIG_INVALID when the deployment is missing its vars). */
function resolve(ctx: MarketerCallContext): { baseUrl: string; token: string | undefined; brokered: BrokeredFetch | undefined } {
  const env = (ctx.services?.env ?? {}) as MarketerEnv;
  const baseUrl = (env.PRIMARY_SAAS_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) throw new AgentError("CONFIG_INVALID", "PRIMARY_SAAS_API_URL is not configured: the Marketer API is unreachable.");
  if (!isSafeApiOrigin(baseUrl)) throw new AgentError("CONFIG_INVALID", "PRIMARY_SAAS_API_URL must be https (plain http is accepted only for loopback and private hosts): the service token is sent on every request.");
  const brokered = typeof ctx.services?.fetch === "function" ? (ctx.services.fetch as BrokeredFetch) : undefined;
  const token = env.SAAS_SERVICE_TOKEN?.trim() || undefined;
  if (!brokered && !token) throw new AgentError("CONFIG_INVALID", "SAAS_SERVICE_TOKEN is not configured (it must equal the backend's MARKETER_AGENT_SERVICE_TOKEN).");
  return { baseUrl, token, brokered };
}

/** Build the full URL for a request (exported for tests). */
export function marketerUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  if (!SAFE_PATH.test(path) || path.includes("..") || path.includes("//")) throw new AgentError("TOOL_VALIDATION_FAILED", `Refusing unsafe Marketer API path ${JSON.stringify(path)}`);
  const url = new URL(`${baseUrl}${MARKETER_API_PREFIX}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * https always; http only where the request cannot cross a public network: loopback, single-label service names
 * (docker / service bindings), `.localhost` / `.local` / `.internal`, and private IPv4 ranges. No credentials in the URL.
 */
export function isSafeApiOrigin(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || !host.includes(".")) return true;
  if (/\.(localhost|local|internal)$/.test(host)) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

type Failure = "timeout" | "network" | "aborted";

/**
 * One attempt: the request and its whole body, raced against our own timer and the caller's signal, so a transport
 * that ignores the abort signal still cannot hang the tool.
 */
async function attempt(send: (init: RequestInit) => Promise<Response>, init: RequestInit, timeoutMs: number, parent?: AbortSignal): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  let failure: Failure | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const stop = (why: Failure) => {
      failure ??= why;
      controller.abort();
      reject(new Error(why));
    };
    timer = setTimeout(() => stop("timeout"), Math.max(1, timeoutMs));
    if (parent?.aborted) stop("aborted");
    else if (parent) {
      onAbort = () => stop("aborted");
      parent.addEventListener("abort", onAbort, { once: true });
    }
  });
  const work = (async () => {
    const response = await send({ ...init, signal: controller.signal });
    return { response, text: response.status === 204 ? "" : await response.text() };
  })();
  // If the timer wins, the aborted request rejects later: keep that rejection handled.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, interrupted]);
  } catch (error) {
    // An egress or broker refusal is a typed, definite answer from our own side: pass it through.
    if (!failure && error instanceof AgentError) throw error;
    throw new AttemptFailed(failure ?? "network");
  } finally {
    if (timer) clearTimeout(timer);
    if (parent && onAbort) parent.removeEventListener("abort", onAbort);
  }
}

class AttemptFailed extends Error {
  constructor(readonly failure: Failure) {
    super(failure);
  }
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Call the Marketer API as the executing tenant. Returns parsed JSON (or text, or null for 204).
 * Throws a typed error (errors.ts): `MarketerApiError` (an `HttpError`) for a non-2xx answer,
 * `MarketerUnavailableError` when nothing usable came back from a read or nothing was sent,
 * `MarketerOutcomeUnknownError` when a write was sent and not answered, `AgentError("CONFIG_INVALID")` when unconfigured.
 */
export async function marketerApi<T = unknown>(ctx: MarketerCallContext, request: MarketerRequest): Promise<T> {
  const tenantId = ctx.tenant?.tenantId ?? "";
  if (!TENANT_ID.test(tenantId)) throw new AgentError("TENANT_ISOLATION_VIOLATION", "No valid tenant in the execution context.");
  const { baseUrl, token, brokered } = resolve(ctx);
  const url = marketerUrl(baseUrl, request.path, request.query);
  const write = request.method !== "GET";
  const headers: Record<string, string> = { accept: "application/json", "x-tenant-id": tenantId };
  if (ctx.tenant.userId) headers["x-acting-user"] = ctx.tenant.userId;
  const actor = actorFromServices(ctx.services);
  if (actor) headers["x-actor-id"] = actor.id;
  if (write && ctx.idempotencyKey) headers["idempotency-key"] = ctx.idempotencyKey;
  if (request.body !== undefined) headers["content-type"] = "application/json";
  // The broker injects the service token for the API host only; never set it ourselves on that path.
  if (!brokered) headers.authorization = `Bearer ${token}`;
  const init: RequestInit = {
    method: request.method,
    headers,
    ...(request.body !== undefined && write ? { body: JSON.stringify(request.body) } : {}),
    // Never carry the bearer token across a redirect. The brokered fetch walks hops under the egress policy itself.
    ...(brokered ? {} : { redirect: "manual" as const }),
  };
  const send = (i: RequestInit): Promise<Response> => (brokered ? brokered(url, { ...i, credential: SAAS_CREDENTIAL }) : fetch(url, i));

  const runtime = ((ctx.services?.marketerClient as MarketerClientRuntime | undefined) ?? {}) as MarketerClientRuntime;
  const health = runtime.health ?? defaultBackendHealth;
  const policy: ReadRetryPolicy = { ...READ_RETRY, ...runtime.retry };
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? defaultSleep;
  const random = runtime.random ?? Math.random;
  const origin = new URL(baseUrl).origin;
  const where = { method: request.method, path: request.path, write };
  const perAttempt = request.timeoutMs ?? (write ? WRITE_TIMEOUT_MS : READ_ATTEMPT_TIMEOUT_MS);
  const deadline = now() + (write ? perAttempt : (request.deadlineMs ?? READ_DEADLINE_MS));
  const maxAttempts = write ? 1 : Math.max(1, policy.maxAttempts);

  for (let n = 1; ; n++) {
    const admission = health.admit(origin, write);
    if (!admission.ok) throw new MarketerUnavailableError({ ...where, cause: admission.reason, retryAfterMs: admission.retryAfterMs });
    let failed: MarketerApiError | MarketerUnavailableError;
    let retryAfterMs: number | undefined;
    try {
      const { response, text } = await attempt(send, init, Math.min(perAttempt, Math.max(1, deadline - now())), ctx.signal);
      if (response.ok) {
        health.success(origin);
        if (!text) return null as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
      }
      const error = new MarketerApiError({ status: response.status, method: request.method, path: request.path, body: text, ...optional("retryAfterMs", retryAfter(response)) });
      retryAfterMs = error.retryAfterMs;
      if (response.status === 429) {
        health.neutral(origin);
        if (retryAfterMs) health.pause(origin, retryAfterMs);
      } else if (response.status >= 500 && !/^outcome_unknown\b/i.test(errorDetail(text))) health.failure(origin);
      // Any other complete answer (3xx, 4xx, the backend's own 502 `outcome_unknown: …`) proves the backend is up.
      else health.success(origin);
      // Only reads are retried, and only on answers that can change: 5xx, 429, 408, 425.
      if (write || !error.retryable) throw error;
      failed = error;
    } catch (error) {
      if (!(error instanceof AttemptFailed)) {
        // A typed answer (HTTP status, an egress or broker refusal): release a probe slot and pass it on.
        health.neutral(origin);
        throw error;
      }
      if (error.failure === "aborted") {
        // The caller gave up (run aborted, tool timeout): no verdict on the backend's health.
        health.neutral(origin);
        if (write) throw new MarketerOutcomeUnknownError({ method: request.method, path: request.path, cause: "aborted" });
        throw new MarketerUnavailableError({ ...where, cause: "timeout", attempts: n });
      }
      health.failure(origin);
      // A write that left and was not answered may have landed: never retried, never called "failed".
      if (write) throw new MarketerOutcomeUnknownError({ method: request.method, path: request.path, cause: error.failure });
      failed = new MarketerUnavailableError({ ...where, cause: error.failure, attempts: n });
    }
    if (n >= maxAttempts) throw failed;
    if (retryAfterMs !== undefined && retryAfterMs > policy.maxRetryAfterMs) throw failed;
    const delay = retryDelayMs(policy, n, random, retryAfterMs);
    if (now() + delay >= deadline) throw failed;
    try {
      await sleep(delay, ctx.signal);
    } catch {
      throw failed;
    }
  }
}

const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** `encodeURIComponent` for one path segment (ids are schema-validated already; this is defense in depth). */
export const seg = (value: string): string => encodeURIComponent(value);
