import { DEFAULT_DECISION_MODEL, DEFAULT_DECISIONS_URL, type DecisionAnswer, type DecisionAnswers, type DecisionQuestion } from "./questions.ts";

/**
 * The decision client: one `fetch` to OpenRouter's decisions endpoint per judgment.
 *
 *  - Endpoint `OPENROUTER_DECISIONS_URL` (default https://openrouter.ai/api/alpha/decisions), key `OPENROUTER_API_KEY`,
 *    model `DECISION_MODEL` (a pinned, dated slug). Server-side only; the key is never logged or returned.
 *  - A hard `AbortSignal` timeout and no retries: a decision sits on a hot path and always has a rule-based fallback.
 *  - The response must carry `usage.cost`. A response without a cost is a failure (we meter every call).
 *  - A failure is a typed value (`{ ok: false, kind }`), never an answer: a failed call is an error, never a "no".
 *
 * Env comes from the caller (the Worker env from `ctx.services.env` or `bindings()`), never from module scope, so this
 * module runs in plain Node tests.
 */

export interface DecisionEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_DECISIONS_URL?: string;
  DECISION_MODEL?: string;
  /** Per-point modes, e.g. "routing=enforce,approval_risk=shadow" (see run.ts). */
  DECISION_MODES?: string;
}

export type DecisionFailureKind = "no_key" | "timeout" | "aborted" | "network" | "http" | "invalid" | "no_cost";

export interface DecisionFailure {
  ok: false;
  kind: DecisionFailureKind;
  message: string;
  ms: number;
  status?: number;
}

export interface DecisionSuccess<Q extends Record<string, DecisionQuestion>> {
  ok: true;
  answers: DecisionAnswers<Q>;
  ms: number;
  model: string;
  /** USD, from OpenRouter's `usage.cost`. */
  cost: number;
}

export type DecisionResult<Q extends Record<string, DecisionQuestion>> = DecisionSuccess<Q> | DecisionFailure;

export interface DecisionClientOptions {
  env: DecisionEnv;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface DecideOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  model?: string;
}

/** Same shape as `.intent-onboarding/packages/core/src/decisions.ts` DecisionAdapter. */
export interface DecisionAdapter {
  decide<Q extends Record<string, DecisionQuestion>>(state: unknown, questions: Q, opts?: { signal?: AbortSignal }): Promise<DecisionAnswers<Q>>;
}

export class DecisionError extends Error {
  constructor(readonly failure: DecisionFailure) {
    super(`decision ${failure.kind}: ${failure.message}`);
    this.name = "DecisionError";
  }
}

export function decisionKey(env: DecisionEnv): string | undefined {
  return env.OPENROUTER_API_KEY?.trim() || undefined;
}

export function decisionUrl(env: DecisionEnv): string {
  return env.OPENROUTER_DECISIONS_URL?.trim() || DEFAULT_DECISIONS_URL;
}

export function decisionModel(env: DecisionEnv): string {
  return env.DECISION_MODEL?.trim() || DEFAULT_DECISION_MODEL;
}

/** The engine's vendor-neutral questions → the decisions API wire format. */
export function toWireQuestions(questions: Record<string, DecisionQuestion>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "yesno") out[name] = { type: "noul", instructions: q.instructions };
    else if (q.type === "choice") out[name] = { type: "choice", instructions: q.instructions, criteria: q.options };
    else out[name] = { type: "score", instructions: q.instructions, criteria: q.levels };
  }
  return out;
}

const unit = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1 ? x : undefined);

/** Wire answers → the contract. Throws on a missing or malformed answer (the whole decision then fails). */
export function fromWireAnswers(questions: Record<string, DecisionQuestion>, answers: unknown): Record<string, DecisionAnswer> {
  if (!answers || typeof answers !== "object") throw new Error("response has no answers");
  const raw = answers as Record<string, Record<string, unknown> | undefined>;
  const out: Record<string, DecisionAnswer> = {};
  for (const [name, q] of Object.entries(questions)) {
    const a = raw[name];
    if (!a || typeof a !== "object") throw new Error(`no answer for "${name}"`);
    if (q.type === "yesno") {
      const p = unit(a.noul ?? a.probability);
      if (p === undefined) throw new Error(`answer "${name}" has no probability`);
      out[name] = { type: "yesno", probability: p };
    } else if (q.type === "choice") {
      const choice = typeof a.choice === "string" ? a.choice : "";
      const confidence = unit(a.confidence);
      if (!(choice in q.options) || confidence === undefined) throw new Error(`answer "${name}" is not a valid choice`);
      const probabilities: Record<string, number> = {};
      const rawP = a.probabilities && typeof a.probabilities === "object" ? (a.probabilities as Record<string, unknown>) : {};
      for (const option of Object.keys(q.options)) probabilities[option] = unit(rawP[option]) ?? (option === choice ? confidence : 0);
      out[name] = { type: "choice", choice, confidence, probabilities };
    } else {
      const score = a.score;
      const confidence = unit(a.confidence);
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > q.levels.length - 1 || confidence === undefined) throw new Error(`answer "${name}" is not a valid score`);
      out[name] = { type: "score", score, confidence };
    }
  }
  return out;
}

/** One decision round trip. Never throws: every failure comes back as `{ ok: false }`. */
export async function requestDecision<Q extends Record<string, DecisionQuestion>>(client: DecisionClientOptions, state: unknown, questions: Q, opts: DecideOptions): Promise<DecisionResult<Q>> {
  const now = client.now ?? Date.now;
  const t0 = now();
  const fail = (kind: DecisionFailureKind, message: string, status?: number): DecisionFailure => ({ ok: false, kind, message: message.slice(0, 200), ms: now() - t0, ...(status !== undefined ? { status } : {}) });
  const key = decisionKey(client.env);
  if (!key) return fail("no_key", "OPENROUTER_API_KEY is not configured");
  if (Object.keys(questions).length === 0) return fail("invalid", "no questions");

  const model = opts.model ?? decisionModel(client.env);
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(new DOMException("aborted by caller", "AbortError"));
  if (opts.signal?.aborted) return fail("aborted", "aborted by caller");
  opts.signal?.addEventListener("abort", onCallerAbort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The timer both aborts the fetch and rejects the race, so a transport that ignores the signal cannot hang us.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const reason = new DOMException(`timed out after ${opts.timeoutMs}ms`, "TimeoutError");
      controller.abort(reason);
      reject(reason);
    }, opts.timeoutMs);
  });
  try {
    const fetchImpl = client.fetch ?? fetch;
    const call = (async () => {
      const response = await fetchImpl(decisionUrl(client.env), {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ model, state, questions: toWireQuestions(questions) }),
        signal: controller.signal,
      });
      const text = await response.text();
      return { response, text };
    })();
    // If the deadline wins, the aborted fetch rejects later: keep that rejection handled.
    call.catch(() => undefined);
    const { response, text } = await Promise.race([call, deadline]);
    if (!response.ok) return fail("http", `decisions endpoint returned HTTP ${response.status}`, response.status);
    let json: { answers?: unknown; model?: unknown; usage?: { cost?: unknown } };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      return fail("invalid", "response is not JSON");
    }
    const cost = json.usage?.cost;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return fail("no_cost", "response has no usage.cost");
    let answers: Record<string, DecisionAnswer>;
    try {
      answers = fromWireAnswers(questions, json.answers);
    } catch (error) {
      return fail("invalid", error instanceof Error ? error.message : "malformed answers");
    }
    return { ok: true, answers: answers as DecisionAnswers<Q>, ms: now() - t0, model: typeof json.model === "string" && json.model ? json.model : model, cost };
  } catch (error) {
    if (timedOut) return fail("timeout", `timed out after ${opts.timeoutMs}ms`);
    if (opts.signal?.aborted) return fail("aborted", "aborted by caller");
    return fail("network", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }
}

/** The client as a `DecisionAdapter` (rejects with `DecisionError` on any failure; callers fall back). */
export function decisionAdapter(client: DecisionClientOptions, defaults: { timeoutMs: number; model?: string }): DecisionAdapter {
  return {
    async decide<Q extends Record<string, DecisionQuestion>>(state: unknown, questions: Q, o?: { signal?: AbortSignal }) {
      const r = await requestDecision(client, state, questions, { timeoutMs: defaults.timeoutMs, ...(defaults.model ? { model: defaults.model } : {}), ...(o?.signal ? { signal: o.signal } : {}) });
      if (!r.ok) throw new DecisionError(r);
      return r.answers;
    },
  };
}
