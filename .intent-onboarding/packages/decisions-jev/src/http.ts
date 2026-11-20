/** Browser-side decisions adapter. No SDK import, so the Jev SDK never ships to the client. */
import type { DecisionAdapter, DecisionAnswers, DecisionQuestion } from '../../core/src/index.ts';

/** Browser-side adapter: calls the host's decisions route. The engine's timeout still applies. */
export function httpDecisions(endpoint: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): DecisionAdapter {
  return {
    async decide<Q extends Record<string, DecisionQuestion>>(state: unknown, questions: Q, o?: { signal?: AbortSignal }) {
      const res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: o?.signal });
      const json = (await res.json()) as { answers?: DecisionAnswers<Q>; error?: string };
      if (!res.ok || !json.answers) throw new Error(json.error ?? `decisions route returned ${res.status}`);
      return json.answers;
    },
  };
}
