/**
 * Thin, typed fetch wrapper around the marketer.sh public API.
 *
 * Design
 * ------
 * - Auth: a personal access token (`mkt_...`, see `docs/api/authentication.md`)
 *   sent as `Authorization: Bearer <token>` on every request.
 * - Errors: every non-2xx response is parsed as the structured error
 *   envelope documented in `docs/api/errors.md` —
 *   `{ error: { code, message, hint, retryable, details } }` — and thrown
 *   as a `MarketerApiError` so callers can branch on `.code` / `.retryable`
 *   instead of parsing prose or guessing at HTTP status semantics.
 * - Idempotency: `request()` accepts an `idempotencyKey` option that is
 *   sent as the `Idempotency-Key` header (see `docs/api/idempotency.md`)
 *   for any mutating call a caller wants to make safely retryable.
 * - Types: `./types.ts` is generated from `docs/api/openapi.json` via
 *   `npm run generate` (openapi-typescript) and re-exported here as
 *   `paths` / `components`. `request<T>()` is a generic low-level escape
 *   hatch typed by response shape `T`; the handful of named methods below
 *   (`listNiches`, `createNiche`, `enqueueJob`, `getJob`, ...) are typed
 *   convenience wrappers for the flows documented in the quickstart. More
 *   can be generated/added over time as the SDK grows — the generic
 *   `request()` method means adding one is a few lines, not a rewrite.
 */

export type { components, operations, paths } from "./types.js";
import type { components } from "./types.js";

export type Niche = components["schemas"]["Niche"];
export type NicheCreate = components["schemas"]["NicheCreate"];
export type NicheUpdate = components["schemas"]["NicheUpdate"];
export type Job = components["schemas"]["Job"];
export type JobEnqueue = components["schemas"]["JobEnqueue"];
export type JobStatus = components["schemas"]["JobStatus"];

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

/** The `error` object nested in every non-2xx response body. */
export interface ErrorBody {
  code: string;
  message: string;
  hint: string | null;
  retryable: boolean;
  details: Record<string, unknown> | null;
}

/**
 * Thrown for any non-2xx response. Carries the parsed structured error
 * envelope plus the HTTP status and correlation id (`X-Request-ID`) so a
 * bug report / support ticket can reference the exact request server-side.
 */
export class MarketerApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string | null;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | null;
  readonly requestId: string | null;

  constructor(status: number, body: ErrorBody, requestId: string | null) {
    super(`${body.code}: ${body.message}`);
    this.name = "MarketerApiError";
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
    this.retryable = body.retryable;
    this.details = body.details;
    this.requestId = requestId;
  }
}

/** A non-JSON or unshaped error body — e.g. an upstream proxy 502. */
export class MarketerHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(status: number, bodyText: string) {
    super(`HTTP ${status}: ${bodyText.slice(0, 500)}`);
    this.name = "MarketerHttpError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

function isErrorEnvelope(value: unknown): value is { error: ErrorBody } {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as Record<string, unknown>).error;
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e.code === "string" && typeof e.message === "string";
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface MarketerClientOptions {
  /** e.g. "https://api.marketer.sh" or "http://localhost:8000" (no trailing slash needed). */
  baseUrl: string;
  /** A personal access token, `mkt_...` — see docs/api/authentication.md. */
  token: string;
  /** Override for testing; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Aborts the request if it hasn't settled within this many ms. Default 30000. */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** Query string parameters; `undefined` values are omitted. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON request body (an object/array), or omit for none. */
  body?: unknown;
  /**
   * Sent as the `Idempotency-Key` header. Pass a stable, unique-per-logical-
   * operation string (e.g. a UUID you generate once and reuse across
   * retries of the *same* call) for any mutating request you want to be
   * safe to retry after a timeout/network error. See docs/api/idempotency.md.
   */
  idempotencyKey?: string;
  /** Extra headers merged over the client defaults. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class MarketerClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: MarketerClientOptions) {
    if (!opts.baseUrl) {
      throw new Error("MarketerClient requires baseUrl (e.g. https://api.marketer.sh)");
    }
    if (!opts.token) {
      throw new Error("MarketerClient requires token (a personal access token, mkt_...)");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Low-level typed request. `T` is the expected decoded JSON response
   * shape — pass one of the generated `components["schemas"][...]` types,
   * or a hand-shaped interface for endpoints not yet wrapped below.
   *
   * Path parameters are the caller's responsibility to interpolate into
   * `path` (e.g. `` `/api/v1/jobs/${jobId}` ``) — kept simple rather than
   * building a URL-templating layer on top of the generated `paths` type.
   */
  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (options.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    // Let an explicit caller signal abort the request too.
    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get("x-request-id");

    if (response.status === 204) {
      return undefined as T;
    }

    const rawText = await response.text();
    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    const parsed: unknown = isJson && rawText ? JSON.parse(rawText) : rawText;

    if (!response.ok) {
      if (isErrorEnvelope(parsed)) {
        throw new MarketerApiError(response.status, parsed.error, requestId);
      }
      throw new MarketerHttpError(response.status, rawText);
    }

    return parsed as T;
  }

  // ------------------------------------------------------------- niches

  async listNiches(): Promise<Niche[]> {
    return this.request<Niche[]>("GET", "/api/v1/niches");
  }

  async getNiche(nicheId: string): Promise<Niche> {
    return this.request<Niche>("GET", `/api/v1/niches/${nicheId}`);
  }

  async createNiche(body: NicheCreate): Promise<Niche> {
    return this.request<Niche>("POST", "/api/v1/niches", { body });
  }

  async updateNiche(nicheId: string, body: NicheUpdate): Promise<Niche> {
    return this.request<Niche>("PUT", `/api/v1/niches/${nicheId}`, { body });
  }

  async archiveNiche(nicheId: string): Promise<void> {
    await this.request<void>("DELETE", `/api/v1/niches/${nicheId}`);
  }

  // --------------------------------------------------------------- jobs

  async listJobs(opts: { status?: JobStatus; nicheId?: string; limit?: number } = {}): Promise<Job[]> {
    return this.request<Job[]>("GET", "/api/v1/jobs", {
      query: { status_filter: opts.status, niche_id: opts.nicheId, limit: opts.limit },
    });
  }

  async getJob(jobId: string): Promise<Job> {
    return this.request<Job>("GET", `/api/v1/jobs/${jobId}`);
  }

  /**
   * Enqueue a pipeline run. Pass `idempotencyKey` (a UUID you generate
   * once) so a network timeout can be safely retried without risking a
   * second job/spend for the same logical request.
   */
  async enqueueJob(body: JobEnqueue, opts: { idempotencyKey?: string } = {}): Promise<Job> {
    return this.request<Job>("POST", "/api/v1/jobs", { body, idempotencyKey: opts.idempotencyKey });
  }

  async retryJob(jobId: string): Promise<Job> {
    return this.request<Job>("POST", `/api/v1/jobs/${jobId}/retry`);
  }

  async approveJob(jobId: string): Promise<Job> {
    return this.request<Job>("POST", `/api/v1/jobs/${jobId}/approve`);
  }

  async rejectJob(jobId: string): Promise<Job> {
    return this.request<Job>("POST", `/api/v1/jobs/${jobId}/reject`);
  }

  /**
   * Poll a job to completion. Simple fixed-interval poll — good enough for
   * CLIs/scripts/quickstarts; a production dashboard should prefer paging
   * `listJobs` or a webhook instead of long-polling one job.
   */
  async waitForJob(
    jobId: string,
    opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<Job> {
    const intervalMs = opts.intervalMs ?? 5_000;
    const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    const terminal = new Set<JobStatus>(["done", "failed", "skipped", "awaiting_approval"]);

    for (;;) {
      const job = await this.getJob(jobId);
      if (terminal.has(job.status)) return job;
      if (Date.now() > deadline) {
        throw new Error(`waitForJob(${jobId}) timed out with status=${job.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (opts.signal?.aborted) {
        throw new Error(`waitForJob(${jobId}) aborted`);
      }
    }
  }
}
