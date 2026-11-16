/** Server-side request handler for a host's decisions route. No SDK import. */
import type { DecisionAdapter, DecisionQuestion } from '../../core/src/index.ts';

// ── Host API route ───────────────────────────────────────────────────────────

export interface DecisionLimits {
  maxQuestions: number;
  maxInstructionChars: number;
  maxStateBytes: number;
}
export const DEFAULT_LIMITS: DecisionLimits = { maxQuestions: 64, maxInstructionChars: 600, maxStateBytes: 32_000 };

function validate(body: unknown, limits: DecisionLimits): { state: unknown; questions: Record<string, DecisionQuestion> } | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const { state, questions } = body as { state?: unknown; questions?: unknown };
  if (state === undefined) return 'state is required';
  if (JSON.stringify(state).length > limits.maxStateBytes) return `state is larger than ${limits.maxStateBytes} bytes`;
  if (!questions || typeof questions !== 'object') return 'questions must be an object';
  const entries = Object.entries(questions as Record<string, unknown>);
  if (entries.length === 0 || entries.length > limits.maxQuestions) return `between 1 and ${limits.maxQuestions} questions are allowed`;
  for (const [name, q] of entries) {
    if (!/^[A-Za-z0-9_]{1,80}$/.test(name)) return `invalid question name "${name}"`;
    const qq = q as Record<string, unknown>;
    if (typeof qq.instructions !== 'string' || qq.instructions.length > limits.maxInstructionChars) return `question "${name}" needs instructions under ${limits.maxInstructionChars} characters`;
    if (qq.type === 'choice' && (typeof qq.options !== 'object' || !qq.options || Object.keys(qq.options).length < 2)) return `choice "${name}" needs at least 2 options`;
    if (qq.type === 'score' && (!Array.isArray(qq.levels) || qq.levels.length < 2)) return `score "${name}" needs at least 2 levels`;
    if (!['yesno', 'choice', 'score'].includes(String(qq.type))) return `question "${name}" has an unknown type`;
  }
  return { state, questions: questions as Record<string, DecisionQuestion> };
}

/**
 * The body of a host API route (Next.js route handler, Express handler…). Validates and size-limits
 * the request so the route can't be used as a free general-purpose model proxy.
 *
 *   export async function POST(req: Request) {
 *     const r = await handleDecisionsRequest(adapter, await req.json());
 *     return Response.json(r.body, { status: r.status });
 *   }
 */
export async function handleDecisionsRequest(adapter: DecisionAdapter, body: unknown, limits: DecisionLimits = DEFAULT_LIMITS): Promise<{ status: number; body: unknown }> {
  const v = validate(body, limits);
  if (typeof v === 'string') return { status: 400, body: { error: v } };
  try {
    return { status: 200, body: { answers: await adapter.decide(v.state, v.questions) } };
  } catch (e) {
    return { status: 502, body: { error: e instanceof Error ? e.message : 'decision failed' } };
  }
}

