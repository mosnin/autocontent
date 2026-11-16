/**
 * Jev (TypeSafe AI) as the onboarding engine's decision model.
 *
 * Server side:  jevDecisions()           → DecisionAdapter calling Jev via @typesafe-ai/sdk
 *               handleDecisionsRequest() → body of a host API route (src/route.ts, no SDK)
 * Browser side: httpDecisions(url)       → DecisionAdapter that calls that route (src/http.ts, no SDK)
 *
 * Jev's SDK refuses to run in a browser by default because the API key would be exposed, so the
 * engine running in the browser always reaches Jev through the host's own server route.
 */
import { choice, noul, score, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import type { DecisionAdapter, DecisionAnswers, DecisionQuestion } from '../../core/src/index.ts';

/** The slice of TypeSafeClient this adapter uses (lets tests inject a fake). */
export interface SystemOneClient {
  systemOne(request: { state: unknown; questions: Questions; model?: string }, options?: { signal?: AbortSignal; timeout?: number }): PromiseLike<{ answers: Record<string, unknown>; model?: string }>;
}

export interface JevOptions {
  /** Defaults to process.env.TYPESAFE_API_KEY (direct) or OPENROUTER_API_KEY (via: 'openrouter'). */
  apiKey?: string;
  /** Call TypeSafe directly (default) or through OpenRouter with an OpenRouter key. */
  via?: 'typesafe' | 'openrouter';
  /** Pin a model version, e.g. 'jev-1.14'. Default: the SDK's default (jev-latest). */
  model?: string;
  /** Per-request timeout in ms. The engine applies its own budget on top. Default 2000. */
  timeoutMs?: number;
  /** Inject a client (tests, custom transport). */
  client?: SystemOneClient;
  /** Custom fetch for the SDK transport (proxies, tests). */
  fetch?: typeof fetch;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api';

/** Map the engine's vendor-neutral questions onto Jev's primitives. */
export function toJevQuestions(questions: Record<string, DecisionQuestion>): Questions {
  const out: Questions = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'yesno') out[name] = noul(q.instructions);
    else if (q.type === 'choice') out[name] = choice(q.instructions, q.options);
    else out[name] = score(q.instructions, q.levels);
  }
  return out;
}

/** Map Jev's answers back to the engine's shape. */
export function fromJevAnswers(questions: Record<string, DecisionQuestion>, answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(questions)) {
    const a = answers[name] as Record<string, unknown> | undefined;
    if (!a) throw new Error(`Jev returned no answer for "${name}"`);
    if (q.type === 'yesno') out[name] = { type: 'yesno', probability: Number(a.noul) };
    else if (q.type === 'choice') out[name] = { type: 'choice', choice: String(a.choice), confidence: Number(a.confidence), probabilities: a.probabilities ?? {} };
    else out[name] = { type: 'score', score: Number(a.score), confidence: Number(a.confidence) };
  }
  return out;
}

/** A DecisionAdapter backed by Jev. Server-side only. */
export function jevDecisions(opts: JevOptions = {}): DecisionAdapter {
  const via = opts.via ?? 'typesafe';
  const client: SystemOneClient =
    opts.client ??
    new TypeSafeClient({
      apiKey: opts.apiKey ?? (via === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY),
      baseURL: via === 'openrouter' ? OPENROUTER_BASE : undefined,
      timeout: opts.timeoutMs ?? 2000,
      retry: { maxRetries: 0 }, // onboarding has its own fallback; never stack retries on the critical path
      fetch: opts.fetch,
    });
  return {
    async decide<Q extends Record<string, DecisionQuestion>>(state: unknown, questions: Q, o?: { signal?: AbortSignal }) {
      const result = await client.systemOne({ state: state as never, questions: toJevQuestions(questions), model: opts.model }, { signal: o?.signal, timeout: opts.timeoutMs ?? 2000 });
      return fromJevAnswers(questions, result.answers) as DecisionAnswers<Q>;
    },
  };
}

export { handleDecisionsRequest, DEFAULT_LIMITS, type DecisionLimits } from './route.ts';
export { httpDecisions } from './http.ts';
