/**
 * Promptfoo provider for the decision-model evals (promptfoo.decisions.yaml). It asks the live decision model the
 * production questions (src/marketer/decisions/questions.ts) and returns what the production truth table decides,
 * so a labelled case checks question wording, model and threshold together.
 *
 * Needs OPENROUTER_API_KEY in the shell (OPENROUTER_DECISIONS_URL / DECISION_MODEL optional). Without a key every case
 * returns an error instead of a guess: a failed call is never a "no".
 */
import { requestDecision } from "../../src/marketer/decisions/client.ts";
import { approvalRiskQuestions, POINTS, ROUTING_QUESTIONS } from "../../src/marketer/decisions/questions.ts";
import { approvalRiskTable, routingTable } from "../../src/marketer/decisions/tables.ts";

interface CallContext {
  vars: Record<string, unknown>;
}

const env = () => ({
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_DECISIONS_URL: process.env.OPENROUTER_DECISIONS_URL,
  DECISION_MODEL: process.env.DECISION_MODEL,
});

/** Eval budget per call: the production timeout plus network slack for a laptop. */
const EVAL_SLACK_MS = 2000;

export default class DecisionProvider {
  id(): string {
    return "marketer-decisions";
  }

  async callApi(prompt: string, context?: CallContext): Promise<{ output?: unknown; error?: string; cost?: number; latencyMs?: number }> {
    const vars = context?.vars ?? {};
    const point = String(vars.point ?? "");
    if (point === "routing") {
      const r = await requestDecision({ env: env() }, { message: prompt }, ROUTING_QUESTIONS, { timeoutMs: POINTS.routing.timeoutMs + EVAL_SLACK_MS });
      if (!r.ok) return { error: `decision failed: ${r.kind} (${r.message})` };
      return { output: { ...routingTable(r.answers), answers: r.answers }, cost: r.cost, latencyMs: r.ms };
    }
    if (point === "approval_risk") {
      const brandRules = Array.isArray(vars.brand_rules) ? vars.brand_rules.map(String) : [];
      const state = { call: JSON.parse(prompt) as unknown, objective: String(vars.objective ?? ""), brand_rules: brandRules };
      const r = await requestDecision({ env: env() }, state, approvalRiskQuestions(brandRules), { timeoutMs: POINTS.approval_risk.timeoutMs + EVAL_SLACK_MS });
      if (!r.ok) return { error: `decision failed: ${r.kind} (${r.message})` };
      return { output: { ...approvalRiskTable(r.answers), answers: r.answers }, cost: r.cost, latencyMs: r.ms };
    }
    return { error: `unknown decision point "${point}"` };
  }
}
