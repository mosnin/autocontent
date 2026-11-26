import { BackendHealth } from "../resilience.ts";
import { namespaceOf, type Scope } from "./namespace.ts";

/**
 * A thin, typed Supermemory v5 REST client (`fetch`), over only the calls the agent makes: add, search, profile.
 *
 * Why not the `supermemory` 5.x SDK: three endpoints, per-call timeouts that must stay inside a turn budget, our own
 * breaker, exact retry rules, and no new dependency to bundle for Workers. The agent never deletes or forgets: those
 * calls do not exist here (the person forgets from the Memory page, through the backend).
 *
 *  - Every call takes a `Scope` from namespace.ts. A string is refused. This is the ONLY module that builds a
 *    namespace URL path (test/recall.test.ts guards it).
 *  - Base URL `SUPERMEMORY_BASE_URL` (default https://api.supermemory.ai): https, or http on loopback only.
 *  - Auth: `Authorization: Bearer SUPERMEMORY_API_KEY` only. Redirects are never followed.
 *  - Timeouts: reads 2.5 s (the turn budget usually cuts sooner), writes 8 s.
 *  - Retries: none, except `add` (always with a stable id) gets one retry on a network error, timeout or 5xx.
 *  - Breaker: BackendHealth keyed by origin; open → calls fail fast without sending.
 */

export const DEFAULT_SUPERMEMORY_URL = "https://api.supermemory.ai";
export const READ_TIMEOUT_MS = 2_500;
export const WRITE_TIMEOUT_MS = 8_000;
const MAX_CONTENT = 30_000;

export interface RecallEnv {
  SUPERMEMORY_API_KEY?: string;
  SUPERMEMORY_BASE_URL?: string;
  MEMORY_NAMESPACE_SECRET?: string;
}

export interface SearchHit {
  id: string;
  text: string;
  score: number;
}

export interface ProfileItem {
  id: string;
  text: string;
  kind: "static" | "dynamic";
}

export class RecallError extends Error {
  constructor(
    readonly kind: string,
    readonly status = 0,
  ) {
    super(`supermemory ${kind} (${status})`);
    this.name = "RecallError";
  }
}

export function safeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin;
  return null;
}

export function recallConfigured(env: RecallEnv): boolean {
  const key = env.SUPERMEMORY_API_KEY?.trim() ?? "";
  const secret = env.MEMORY_NAMESPACE_SECRET?.trim() ?? "";
  return key.length > 0 && new TextEncoder().encode(secret).length >= 32 && safeBaseUrl(env.SUPERMEMORY_BASE_URL?.trim() || DEFAULT_SUPERMEMORY_URL) !== null;
}

export const recallHealth = new BackendHealth({ failureThreshold: 3, cooldownMs: 30_000 });

export interface RecallClientOptions {
  env: RecallEnv;
  fetch?: typeof fetch;
  health?: BackendHealth;
}

export class SupermemoryClient {
  private readonly base: string;
  private readonly key: string;
  private readonly doFetch: typeof fetch;
  private readonly health: BackendHealth;

  constructor(options: RecallClientOptions) {
    const base = safeBaseUrl(options.env.SUPERMEMORY_BASE_URL?.trim() || DEFAULT_SUPERMEMORY_URL);
    const key = options.env.SUPERMEMORY_API_KEY?.trim() ?? "";
    if (!base || !key) throw new RecallError("not_configured");
    this.base = base;
    this.key = key;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.health = options.health ?? recallHealth;
  }

  toJSON(): Record<string, string> {
    return { base: this.base };
  }

  private path(scope: Scope, suffix: string): string {
    const ns = namespaceOf(scope);
    if (!ns) throw new TypeError("supermemory: a Scope from recall/namespace.ts is required, never a string");
    return `${this.base}/ns/${encodeURIComponent(ns)}${suffix}`;
  }

  private async send<T>(url: string, body: unknown, options: { timeoutMs: number; retries?: number; write?: boolean; signal?: AbortSignal; notFoundAs?: T }): Promise<T> {
    let attempt = 0;
    for (;;) {
      const admitted = this.health.admit(this.base, options.write === true);
      if (!admitted.ok) throw new RecallError("circuit_open");
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.doFetch(url, { method: "POST", headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), redirect: "manual", signal });
      } catch {
        if (options.signal?.aborted) {
          this.health.neutral(this.base);
          throw new RecallError("aborted");
        }
        this.health.failure(this.base);
        if (attempt < (options.retries ?? 0)) {
          attempt++;
          continue;
        }
        throw new RecallError("network");
      }
      if (res.status >= 500) {
        this.health.failure(this.base);
        if (attempt < (options.retries ?? 0)) {
          attempt++;
          continue;
        }
        throw new RecallError("server", res.status);
      }
      if (res.status === 404 && options.notFoundAs !== undefined) {
        this.health.neutral(this.base);
        return options.notFoundAs;
      }
      if (res.status >= 300) {
        this.health.neutral(this.base);
        throw new RecallError(res.status < 400 ? "redirect_refused" : "rejected", res.status);
      }
      this.health.success(this.base);
      return (await res.json().catch(() => ({}))) as T;
    }
  }

  /** Append to the document `id` (one per conversation): one retry is safe because the id is stable. */
  async add(scope: Scope, input: { content: string; id: string; metadata: Record<string, string | number | boolean> }, signal?: AbortSignal): Promise<void> {
    if (!/^[A-Za-z0-9_.:-]{1,255}$/.test(input.id)) throw new RecallError("bad_id");
    await this.send(this.path(scope, "/document"), { content: input.content.slice(0, MAX_CONTENT), id: input.id, metadata: input.metadata }, { timeoutMs: WRITE_TIMEOUT_MS, retries: 1, write: true, ...(signal ? { signal } : {}) });
  }

  async search(scope: Scope, query: string, options: { limit?: number; threshold?: number; signal?: AbortSignal } = {}): Promise<SearchHit[]> {
    const data = await this.send<{ results?: Array<{ id?: unknown; memory?: unknown; chunk?: unknown; similarity?: unknown }> }>(
      this.path(scope, "/search"),
      { query: query.slice(0, 2000), searchMode: "memories", limit: Math.max(1, Math.min(options.limit ?? 6, 20)), threshold: options.threshold ?? 0.45 },
      { timeoutMs: READ_TIMEOUT_MS, notFoundAs: { results: [] }, ...(options.signal ? { signal: options.signal } : {}) },
    );
    return (data.results ?? []).flatMap((r) => {
      const text = typeof r.memory === "string" ? r.memory : typeof r.chunk === "string" ? r.chunk : "";
      return typeof r.id === "string" && text ? [{ id: r.id, text, score: typeof r.similarity === "number" ? r.similarity : 0 }] : [];
    });
  }

  /** The maintained profile (no query: a profile call never takes one). */
  async profile(scope: Scope, signal?: AbortSignal): Promise<ProfileItem[]> {
    const data = await this.send<{ profile?: { static?: Array<{ id?: unknown; memory?: unknown }>; dynamic?: Array<{ id?: unknown; memory?: unknown }> } }>(
      this.path(scope, "/profile"),
      {},
      { timeoutMs: READ_TIMEOUT_MS, notFoundAs: { profile: { static: [], dynamic: [] } }, ...(signal ? { signal } : {}) },
    );
    const pick = (items: Array<{ id?: unknown; memory?: unknown }> | undefined, kind: ProfileItem["kind"]): ProfileItem[] =>
      (items ?? []).flatMap((m) => (typeof m.id === "string" && typeof m.memory === "string" && m.memory ? [{ id: m.id, text: m.memory, kind }] : []));
    return [...pick(data.profile?.static, "static"), ...pick(data.profile?.dynamic, "dynamic")];
  }
}
