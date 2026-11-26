import type { DecisionAdapter, DecisionAnswers, DecisionQuestion } from '../../core/src/index.ts';

/**
 * A deterministic stand-in for a decision model (e.g. Jev), for tests and replays with no API key.
 * yes/no: high probability when the quoted label in the instructions appears in the state.
 * choice: the option whose label appears in the state. score: the highest level that appears.
 */
export function mockDecisions(opts: { latencyMs?: number; fail?: string; yes?: number; no?: number; calls?: { state: unknown; questions: Record<string, DecisionQuestion> }[] } = {}): DecisionAdapter {
  const yes = opts.yes ?? 0.92;
  const no = opts.no ?? 0.06;
  return {
    async decide<Q extends Record<string, DecisionQuestion>>(state: unknown, questions: Q, o?: { signal?: AbortSignal }) {
      opts.calls?.push({ state, questions });
      if (opts.latencyMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.latencyMs);
          o?.signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))));
        });
      }
      if (opts.fail) throw new Error(opts.fail);
      const out: Record<string, unknown> = {};
      for (const [name, q] of Object.entries(questions)) {
        // Batched helpers ask about one item each ("…about item_3 in the state"): judge only that item.
        const ref = q.instructions.match(/\b(item_\d+)\b/)?.[1];
        const scope = ref && state && typeof state === 'object' ? (state as Record<string, unknown>)[ref] : state;
        const hay = JSON.stringify(scope ?? '').toLowerCase();
        const mentions = (label: string) => label.toLowerCase().split(/[\s/]+/).filter((w) => w.length > 2).some((w) => hay.includes(w));
        if (q.type === 'yesno') {
          const label = q.instructions.match(/"([^"]+)"/g)?.pop()?.slice(1, -1) ?? '';
          out[name] = { type: 'yesno', probability: label && mentions(label) ? yes : no };
        } else if (q.type === 'choice') {
          const entries = Object.entries(q.options);
          const hit = entries.find(([id, label]) => mentions(label ?? id)) ?? entries[0]!;
          out[name] = { type: 'choice', choice: hit[0], confidence: mentions(hit[1] ?? hit[0]) ? 0.9 : 0.4, probabilities: Object.fromEntries(entries.map(([id]) => [id, id === hit[0] ? 0.9 : 0.1 / Math.max(1, entries.length - 1)])) };
        } else {
          const level = q.levels.map((l, i) => (mentions(l) ? i : -1)).reduce((a, b) => Math.max(a, b), 0);
          out[name] = { type: 'score', score: level, confidence: 0.8 };
        }
      }
      return out as DecisionAnswers<Q>;
    },
  };
}
