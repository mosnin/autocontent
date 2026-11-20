import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { APIConnectionError, APIError, APITimeoutError, APIUserAbortError, type Questions, TypeSafeClient } from "@typesafe-ai/sdk";
import { jevDecisions, type SystemOneClient } from "../../../../../.intent-onboarding/packages/decisions-jev/src/index.ts";
import { handleDecisionsRequest } from "../../../../../.intent-onboarding/packages/decisions-jev/src/route.ts";
import { getSession } from "@/lib/auth/session";
import { BodyTooLargeError, readJsonCapped } from "@/lib/security/body";
import { isSameOriginRequest } from "@/lib/security/proxy-policy";
import { createRateLimiter } from "@/lib/security/rate-limit";

/**
 * POST /api/onboarding/decisions: decision point 7 (onboarding pre-selection, docs/research/EVALUATION.md 2.3).
 *
 * The onboarding flow's `httpDecisions("/api/onboarding/decisions")` adapter calls this route; the route calls Jev
 * through OpenRouter with OPENROUTER_API_KEY, which never leaves the server. `handleDecisionsRequest` validates and
 * size-limits the body so the route is not a general-purpose model proxy, and only signed-in users reach it.
 *
 * Mode (DECISION_MODE_ONBOARDING_PRESELECT = off | shadow | enforce):
 *  - no key: off. 503 at once, and the flow keeps the spec's preselectWhen rules (today's behaviour).
 *  - with a key: enforce by default (the only point allowed to default to enforce): answers go to the flow.
 *  - shadow: the model is called and logged, and the flow is told to keep its rule (202, no answers).
 * A model failure is a 502 error, never a "no": the flow's own timeout and rule take over. That includes a refused
 * question, an answer of another type than the question asked for, a number out of range and a response without
 * `usage.cost` (docs/decisions/openrouter-contract.md): an unrecognised shape is never passed on as an answer.
 *
 * Abuse bounds: same-origin only, a per-user rate limit (each call spends model money), and a byte cap on the
 * body before it is parsed. Upstream error text is logged, not returned.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "off" | "shadow" | "enforce";

/** Pinned, dated decision model slug; never a floating alias. Override with DECISION_MODEL. */
const DEFAULT_DECISION_MODEL = "typesafe/jev-1.13-20260917";
const QUESTIONS_VERSION = "onboarding-preselect-v1";
/** Server-side budget per call; the browser's engine applies its own 1.5 s timeout on top. */
const TIMEOUT_MS = 1500;

function mode(): Mode {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return "off";
  const m = process.env.DECISION_MODE_ONBOARDING_PRESELECT?.trim();
  return m === "off" || m === "shadow" || m === "enforce" ? m : "enforce";
}

const NO_STORE = { "cache-control": "no-store" };
/** handleDecisionsRequest allows 32 kB of state plus 64 questions; this is the ceiling for the whole body. */
const MAX_BODY_BYTES = 128 * 1024;
/** Onboarding asks a handful of times per screen. Per user, per server instance. */
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(req: Request) {
  if (!isSameOriginRequest(req.method, req.headers)) return NextResponse.json({ error: "cross-origin request refused" }, { status: 403, headers: NO_STORE });
  let userId: string | null;
  try {
    userId = (await getSession())?.user.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const m = mode();
  if (m === "off") return NextResponse.json({ error: "decisions are not configured" }, { status: 503, headers: NO_STORE });
  const hit = limiter.hit(userId);
  if (!hit.ok) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { ...NO_STORE, "retry-after": String(hit.retryAfterSeconds) } });

  let body: unknown;
  try {
    body = await readJsonCapped(req, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: "body is too large" }, { status: 413, headers: NO_STORE });
    body = undefined;
  }
  if (body === undefined) return NextResponse.json({ error: "body must be JSON" }, { status: 400, headers: NO_STORE });

  const t0 = Date.now();
  const call: CallMeta = { cost: null, tokens: null, model: null, failure: null };
  const adapter = jevDecisions({ via: "openrouter", model: process.env.DECISION_MODEL?.trim() || DEFAULT_DECISION_MODEL, timeoutMs: TIMEOUT_MS, client: meteredClient(call) });
  const result = await handleDecisionsRequest(adapter, body);
  log({ mode: m, status: result.status, latencyMs: Date.now() - t0, body, answers: result.status === 200 ? (result.body as { answers?: unknown }).answers : null, call });

  if (m === "shadow" && result.status === 200) return NextResponse.json({ error: "shadow mode: logged, not applied" }, { status: 202, headers: NO_STORE });
  // A 502 body carries the provider's error text; the flow only needs to know it failed.
  if (result.status >= 500) return NextResponse.json({ error: "decision failed" }, { status: result.status, headers: NO_STORE });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

/** What the model call itself reported, for the log line. */
interface CallMeta {
  /** USD, from OpenRouter's `usage.cost`. */
  cost: number | null;
  tokens: number | null;
  /** The model that answered, as OpenRouter names it. */
  model: string | null;
  /** Why the call failed: the SDK's error class and HTTP status, or a shape problem. Never upstream text. */
  failure: string | null;
}

const OPENROUTER_BASE = "https://openrouter.ai/api";
const unit = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;

/** The shape problem with `answers`, or null when every question got an answer of its own type, in range. */
function answerProblem(questions: Questions, answers: unknown): string | null {
  if (!answers || typeof answers !== "object") return "invalid";
  const all = answers as Record<string, Record<string, unknown> | undefined>;
  for (const [name, q] of Object.entries(questions)) {
    const a = all[name];
    if (!a || typeof a !== "object") return "invalid";
    if (a.type === "refusal") return "refused";
    if (a.type !== q.type) return "invalid";
    if (q.type === "noul" && !unit(a.noul)) return "invalid";
    if (q.type === "choice" && (typeof a.choice !== "string" || !Object.hasOwn(q.criteria, a.choice) || !unit(a.confidence))) return "invalid";
    if (q.type === "score" && (typeof a.score !== "number" || !Number.isFinite(a.score) || a.score < 0 || a.score > q.criteria.length - 1 || !unit(a.confidence))) return "invalid";
  }
  return null;
}

/**
 * The SDK client the adapter calls, wrapped to read what the adapter drops (`usage.cost`, tokens, the model that
 * answered) and to refuse a response the flow must not act on. Same client settings as the adapter's own: OpenRouter's
 * System One route, the per-call timeout, no retries (the flow has its own fallback).
 */
function meteredClient(meta: CallMeta): SystemOneClient {
  const sdk = new TypeSafeClient({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: OPENROUTER_BASE, timeout: TIMEOUT_MS, retry: { maxRetries: 0 } });
  const fail = (failure: string): never => {
    meta.failure = failure;
    throw new Error(`decision ${failure}`);
  };
  return {
    async systemOne(request, options) {
      let result: { answers?: unknown; model?: unknown; usage?: { cost?: unknown; input_tokens?: unknown; output_tokens?: unknown } };
      try {
        result = (await sdk.systemOne(request as never, options)) as typeof result;
      } catch (e) {
        meta.failure = e instanceof APIError ? `http_${e.status}` : e instanceof APITimeoutError ? "timeout" : e instanceof APIUserAbortError ? "aborted" : e instanceof APIConnectionError ? "network" : "error";
        throw e;
      }
      if (typeof result?.model === "string") meta.model = result.model;
      const usage = result?.usage;
      if (typeof usage?.input_tokens === "number" && typeof usage?.output_tokens === "number") meta.tokens = usage.input_tokens + usage.output_tokens;
      const problem = answerProblem(request.questions, result?.answers);
      if (problem) return fail(problem);
      const cost = usage?.cost;
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return fail("no_cost");
      meta.cost = cost;
      return { answers: result.answers as Record<string, unknown>, ...(meta.model ? { model: meta.model } : {}) };
    },
  };
}

/** One structured line per decision: a hash of the state, never the raw state (no PII), and never the key. */
function log(entry: { mode: Mode; status: number; latencyMs: number; body: unknown; answers: unknown; call: CallMeta }) {
  try {
    const state = (entry.body as { state?: unknown } | null)?.state ?? null;
    console.info(
      JSON.stringify({
        event: "decision",
        point: "onboarding_preselect",
        mode: entry.mode,
        model: entry.call.model ?? (process.env.DECISION_MODEL?.trim() || DEFAULT_DECISION_MODEL),
        questionsVersion: QUESTIONS_VERSION,
        stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
        answers: entry.answers,
        fallbackUsed: entry.status !== 200 || entry.mode !== "enforce",
        failure: entry.call.failure,
        status: entry.status,
        latencyMs: entry.latencyMs,
        cost: entry.call.cost,
        tokens: entry.call.tokens,
      }),
    );
  } catch {
    // logging never changes the response
  }
}
