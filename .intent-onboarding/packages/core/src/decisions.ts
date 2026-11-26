/**
 * Decisions: calibrated, typed judgments from a decision model (e.g. Jev from TypeSafe AI).
 *
 * Vendor-neutral by design (packages/core never imports vendor SDKs). A decision model answers
 * typed questions about some state with probabilities, never prose. The engine uses it where a
 * rule would be a guess: pre-selecting intent options, mapping free-text answers, inferring fields,
 * classifying activation items and picking the rehearsal example. Every use has a rule-based
 * fallback and a timeout, so onboarding never waits on, or breaks because of, a model.
 */
import type { InferSource } from '../../spec/src/index.ts';
import type { Enricher } from './types.ts';

export type DecisionQuestion =
  | { type: 'yesno'; instructions: string }
  | { type: 'choice'; instructions: string; options: Record<string, string | null> }
  | { type: 'score'; instructions: string; levels: [string, string, ...string[]] };

export type DecisionAnswer<Q extends DecisionQuestion = DecisionQuestion> = Q extends { type: 'yesno' }
  ? { type: 'yesno'; probability: number }
  : Q extends { type: 'choice'; options: infer O }
    ? { type: 'choice'; choice: keyof O & string; confidence: number; probabilities: Record<keyof O & string, number> }
    : { type: 'score'; score: number; confidence: number };

export type DecisionAnswers<Q extends Record<string, DecisionQuestion>> = { [K in keyof Q]: DecisionAnswer<Q[K]> };

export interface DecisionAdapter {
  /**
   * Answer every question about `state` in one round trip. Implementations should be fast
   * (~100ms for Jev) and must reject rather than hang; the engine also applies its own timeout.
   */
  decide<Q extends Record<string, DecisionQuestion>>(state: unknown, questions: Q, opts?: { signal?: AbortSignal }): Promise<DecisionAnswers<Q>>;
}

/** Run a decision with a hard timeout. Resolves undefined on timeout or error (callers fall back). */
export async function decideWithin<Q extends Record<string, DecisionQuestion>>(
  adapter: DecisionAdapter | undefined,
  state: unknown,
  questions: Q,
  timeoutMs: number,
): Promise<{ answers?: DecisionAnswers<Q>; ms: number; ok: boolean; reason?: string }> {
  const t0 = Date.now();
  if (!adapter || Object.keys(questions).length === 0) return { ms: 0, ok: false, reason: 'no adapter' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      adapter.decide(state, questions, { signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
    return { answers, ms: Date.now() - t0, ok: true };
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Split work into batches so one request never carries an unbounded number of questions. */
function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Classify activation items with a yes/no question ("Is this a buyer or seller lead who went
 * quiet?"). Returns every item with its probability, highest first; filter with `threshold`.
 * This is what makes a proof like "I found 14 leads" accurate rather than a keyword count.
 */
export async function classifyItems<T>(
  adapter: DecisionAdapter,
  items: T[],
  opts: { instructions: string; toState: (item: T) => unknown; threshold?: number; batchSize?: number },
): Promise<{ item: T; probability: number }[]> {
  const scored: { item: T; probability: number }[] = [];
  for (const batch of chunk(items, opts.batchSize ?? 20)) {
    const questions = Object.fromEntries(batch.map((_, i) => [`item_${i}`, { type: 'yesno', instructions: `${opts.instructions} Answer about item_${i} in the state.` } as const]));
    const state = Object.fromEntries(batch.map((item, i) => [`item_${i}`, opts.toState(item)]));
    const answers = (await adapter.decide(state, questions)) as Record<string, { probability: number }>;
    batch.forEach((item, i) => scored.push({ item, probability: answers[`item_${i}`]?.probability ?? 0 }));
  }
  return scored.filter((s) => s.probability >= (opts.threshold ?? 0)).sort((a, b) => b.probability - a.probability);
}

/** Rank items on an ordered rubric (e.g. lead warmth) to pick the best rehearsal example. */
export async function rankItems<T>(
  adapter: DecisionAdapter,
  items: T[],
  opts: { instructions: string; levels: [string, string, ...string[]]; toState: (item: T) => unknown; batchSize?: number },
): Promise<{ item: T; score: number; confidence: number }[]> {
  const ranked: { item: T; score: number; confidence: number }[] = [];
  for (const batch of chunk(items, opts.batchSize ?? 20)) {
    const questions = Object.fromEntries(batch.map((_, i) => [`item_${i}`, { type: 'score', instructions: `${opts.instructions} Rate item_${i} in the state.`, levels: opts.levels } as const]));
    const state = Object.fromEntries(batch.map((item, i) => [`item_${i}`, opts.toState(item)]));
    const answers = (await adapter.decide(state, questions)) as Record<string, { score: number; confidence: number }>;
    batch.forEach((item, i) => ranked.push({ item, score: answers[`item_${i}`]?.score ?? 0, confidence: answers[`item_${i}`]?.confidence ?? 0 }));
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * Infer a field by asking a choice question about everything enrichment has learned so far
 * (website text, detected tech, email domain). The model's calibrated confidence becomes the
 * field's confidence, so the engine's confirm-vs-ask threshold (RULES §3.3) just works.
 */
export function decisionEnricher(
  adapter: DecisionAdapter,
  opts: { field: string; instructions: string; options: Record<string, string | null>; minConfidence?: number; timeoutMs?: number },
): Enricher {
  return async ({ profile, context }) => {
    const state = {
      email_domain: profile.email.split('@')[1],
      known: Object.fromEntries(Object.entries(context).map(([k, v]) => [k, v.value])),
    };
    const r = await decideWithin(adapter, state, { answer: { type: 'choice', instructions: opts.instructions, options: opts.options } }, opts.timeoutMs ?? 1500);
    const a = r.answers?.answer;
    if (!a || a.confidence < (opts.minConfidence ?? 0.5)) return { inferences: [] };
    return { inferences: [{ field: opts.field, value: a.choice, source: 'model' as InferSource, confidence: a.confidence }] };
  };
}
