import { auth } from "@clerk/nextjs/server";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { jevDecisions } from "../../../../../.intent-onboarding/packages/decisions-jev/src/index.ts";
import { handleDecisionsRequest } from "../../../../../.intent-onboarding/packages/decisions-jev/src/route.ts";

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
 * A model failure is a 502 error, never a "no": the flow's own timeout and rule take over.
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

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const m = mode();
  if (m === "off") return NextResponse.json({ error: "decisions are not configured" }, { status: 503, headers: NO_STORE });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400, headers: NO_STORE });
  }

  const t0 = Date.now();
  const adapter = jevDecisions({ via: "openrouter", model: process.env.DECISION_MODEL?.trim() || DEFAULT_DECISION_MODEL, timeoutMs: TIMEOUT_MS });
  const result = await handleDecisionsRequest(adapter, body);
  log({ mode: m, status: result.status, latencyMs: Date.now() - t0, body, answers: result.status === 200 ? (result.body as { answers?: unknown }).answers : null });

  if (m === "shadow" && result.status === 200) return NextResponse.json({ error: "shadow mode: logged, not applied" }, { status: 202, headers: NO_STORE });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

/** One structured line per decision: a hash of the state, never the raw state (no PII), and never the key. */
function log(entry: { mode: Mode; status: number; latencyMs: number; body: unknown; answers: unknown }) {
  try {
    const state = (entry.body as { state?: unknown } | null)?.state ?? null;
    console.info(
      JSON.stringify({
        event: "decision",
        point: "onboarding_preselect",
        mode: entry.mode,
        model: process.env.DECISION_MODEL?.trim() || DEFAULT_DECISION_MODEL,
        questionsVersion: QUESTIONS_VERSION,
        stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
        answers: entry.answers,
        fallbackUsed: entry.status !== 200 || entry.mode !== "enforce",
        status: entry.status,
        latencyMs: entry.latencyMs,
      }),
    );
  } catch {
    // logging never changes the response
  }
}
