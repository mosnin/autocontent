/**
 * What the Braintrust exporter adds to a run's trace beyond the spans the Flue trace recorder writes
 * (docs/observability/braintrust.md, "As built (agent)"):
 *
 *  - the run's root span id is DETERMINISTIC: `traceSpanIdFor(instanceId, submissionId)`. The agent stamps it on the
 *    assistant message it delivers (`traceSpanId`) while the run is still going, and the exporter gives the root span
 *    that same id, so a thumbs up on the message lands on the right trace;
 *  - identity the trace recorder does not know (the person and their role), from the verified session;
 *  - scores (`approval`) and decision-model calls (GenAI spans) recorded while the run executes.
 *
 * In-isolate state only (a Durable Object runs a conversation in one isolate, and the recorder exports from the same
 * one). Every map is bounded; losing an entry only means a trace without that annotation.
 */

const MAX_ENTRIES = 2_000;

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/** 64-bit FNV-1a over UTF-8, as 16 hex chars: a valid, non-zero OTLP span id. Synchronous on purpose (response hooks are sync). */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const hex = hash.toString(16).padStart(16, "0");
  return hex === "0000000000000000" ? "0000000000000001" : hex;
}

/** The root span id of the run that handles `submissionId` in `instanceId`. */
export function traceSpanIdFor(instanceId: string, submissionId: string): string {
  return fnv1a64(`marketer-run\n${instanceId}\n${submissionId}`);
}

export const TRACE_SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;

/* ------------------------------------------------------------------ *
 * Current submission per instance (fed by the platform observer)
 * ------------------------------------------------------------------ */

const currentSubmission = new Map<string, string>();

/** Feed every Flue observation through this (platform observer `onEvent`). Returns the new run's span id on a submission start. */
export function trackObservation(event: { type: string; submissionId?: unknown }, instanceId: string): { submissionId: string; traceSpanId: string } | undefined {
  if (event.type !== "submission_running" || typeof event.submissionId !== "string" || !event.submissionId) return undefined;
  remember(currentSubmission, instanceId, event.submissionId);
  return { submissionId: event.submissionId, traceSpanId: traceSpanIdFor(instanceId, event.submissionId) };
}

/** The span id of the run in flight for this instance, or undefined before its submission started. */
export function currentTraceSpanId(instanceId: string): string | undefined {
  const submissionId = currentSubmission.get(instanceId);
  return submissionId ? traceSpanIdFor(instanceId, submissionId) : undefined;
}

/* ------------------------------------------------------------------ *
 * Identity, scores and decision calls
 * ------------------------------------------------------------------ */

export interface RunIdentity {
  actorId?: string;
  role?: string;
}

export interface DecisionCall {
  point: string;
  mode: string;
  model: string | null;
  latencyMs: number;
  cost: number;
  tokens?: number;
  fallbackUsed: boolean;
  failure?: string | null;
  at: number;
}

export interface RunAnnotations {
  identity?: RunIdentity;
  scores: Record<string, number>;
  decisions: DecisionCall[];
}

const identities = new Map<string, RunIdentity>();
const runs = new Map<string, { scores: Record<string, number>; decisions: DecisionCall[] }>();
const runKey = (instanceId: string, submissionId: string | undefined) => `${instanceId}\n${submissionId ?? ""}`;

function runEntry(instanceId: string) {
  const key = runKey(instanceId, currentSubmission.get(instanceId));
  let entry = runs.get(key);
  if (!entry) {
    entry = { scores: {}, decisions: [] };
    remember(runs, key, entry);
  }
  return entry;
}

/** The person (and role) a conversation acts for, from the verified session. */
export function setRunIdentity(instanceId: string, identity: RunIdentity): void {
  if (!identity.actorId && !identity.role) return;
  remember(identities, instanceId, { ...(identity.actorId ? { actorId: identity.actorId } : {}), ...(identity.role ? { role: identity.role } : {}) });
}

/** A score (0..1) on the run in flight. Values outside 0..1 are ignored. */
export function recordRunScore(instanceId: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) return;
  runEntry(instanceId).scores[name] = value;
}

/** A decision-model call made by the run in flight (at most 50 kept per run). */
export function recordDecisionCall(instanceId: string, call: DecisionCall): void {
  const entry = runEntry(instanceId);
  if (entry.decisions.length < 50) entry.decisions.push(call);
}

/** Everything recorded for one run, removed as it is read (the exporter calls this once per exported root). */
export function takeRunAnnotations(instanceId: string, submissionId: string | undefined): RunAnnotations {
  const keys = submissionId ? [runKey(instanceId, submissionId), runKey(instanceId, undefined)] : [runKey(instanceId, undefined)];
  const scores: Record<string, number> = {};
  const decisions: DecisionCall[] = [];
  for (const key of keys) {
    const entry = runs.get(key);
    if (!entry) continue;
    runs.delete(key);
    Object.assign(scores, entry.scores);
    decisions.push(...entry.decisions);
  }
  if (decisions.length) scores.decision_fallback = decisions.some((d) => Boolean(d.failure)) ? 1 : 0;
  const identity = identities.get(instanceId);
  return { ...(identity ? { identity } : {}), scores, decisions };
}

/** Tests only. */
export function resetRunAnnotations(): void {
  currentSubmission.clear();
  identities.clear();
  runs.clear();
}
