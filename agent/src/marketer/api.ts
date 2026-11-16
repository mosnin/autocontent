import { AgentError, HttpError } from "@agent-starter/core";
import * as v from "valibot";

/**
 * The ONE client every Marketer tool uses to reach the Marketer REST API (FastAPI, `/api/v1/*`).
 *
 *  - Base URL: `PRIMARY_SAAS_API_URL` (the backend origin, e.g. https://api.marketer.sh). Paths below are relative
 *    to `/api/v1`.
 *  - Auth: `Authorization: Bearer ${SAAS_SERVICE_TOKEN}`. The backend accepts it only when it equals its own
 *    `MARKETER_AGENT_SERVICE_TOKEN` and then acts as the user named by `x-tenant-id` (backend/auth.py, agent
 *    delegation: always role "user", never admin).
 *  - Tenant: `x-tenant-id` is ALWAYS `ctx.tenant.tenantId` (server-derived by agentAuth / the ingestion handler /
 *    the control plane). It is never read from tool arguments; Marketer's tenant id is the Clerk user id.
 *  - Writes (anything but GET) carry `idempotency-key: ctx.idempotencyKey` (derived from run + call + tool + args).
 *  - Persistent agents get `ctx.services.fetch` (brokered + egress-guarded): the client then sends the request
 *    through it with the `saas` credential and never touches the token itself (src/persistent/credentials.ts).
 *  - Errors become `HttpError` (status + FastAPI `detail` in the message), so the executor's idempotency ledger can
 *    tell a definite rejection (4xx: FAILED, may run again) from an unknown outcome (5xx / timeout / network).
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
}

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

/** FastAPI errors carry `{ "detail": string | [{ msg, loc }] }`: surface the reason, bounded. */
export function errorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    const detail = parsed.detail;
    if (typeof detail === "string") return detail.slice(0, 300);
    if (Array.isArray(detail)) {
      return detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join("; ")
        .slice(0, 300);
    }
  } catch {
    // not JSON
  }
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A short hint per status so the model reacts correctly instead of retrying blindly. */
function statusHint(status: number): string {
  if (status === 401 || status === 403) return " (the agent service token was refused: check SAAS_SERVICE_TOKEN = MARKETER_AGENT_SERVICE_TOKEN)";
  if (status === 402) return " (blocked by a spend cap or guard: report it to the person, do not retry)";
  if (status === 404) return " (not found for this account)";
  if (status === 409) return " (state conflict: re-read the record before doing anything else)";
  if (status === 422) return " (the API rejected the input)";
  if (status === 429) return " (rate limited: try later)";
  return "";
}

/**
 * Call the Marketer API as the executing tenant. Returns parsed JSON (or text, or null for 204).
 * Throws `HttpError` on a non-2xx status and `AgentError("CONFIG_INVALID")` when unconfigured.
 */
export async function marketerApi<T = unknown>(ctx: MarketerCallContext, request: MarketerRequest): Promise<T> {
  const tenantId = ctx.tenant?.tenantId ?? "";
  if (!TENANT_ID.test(tenantId)) throw new AgentError("TENANT_ISOLATION_VIOLATION", "No valid tenant in the execution context.");
  const { baseUrl, token, brokered } = resolve(ctx);
  const url = marketerUrl(baseUrl, request.path, request.query);
  const write = request.method !== "GET";
  const headers: Record<string, string> = { accept: "application/json", "x-tenant-id": tenantId };
  if (ctx.tenant.userId) headers["x-acting-user"] = ctx.tenant.userId;
  if (write && ctx.idempotencyKey) headers["idempotency-key"] = ctx.idempotencyKey;
  if (request.body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = {
    method: request.method,
    headers,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(request.body !== undefined && write ? { body: JSON.stringify(request.body) } : {}),
  };
  let response: Response;
  if (brokered) {
    // The broker injects the service token for the API host only; never set it ourselves.
    response = await brokered(url, { ...init, credential: SAAS_CREDENTIAL });
  } else {
    headers.authorization = `Bearer ${token}`;
    response = await fetch(url, init);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = errorDetail(body);
    throw new HttpError(response.status, `Marketer ${request.method} ${request.path} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}${statusHint(response.status)}`, body, retryAfterMs(response));
  }
  if (response.status === 204) return null as T;
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
}

/** `encodeURIComponent` for one path segment (ids are schema-validated already; this is defense in depth). */
export const seg = (value: string): string => encodeURIComponent(value);
