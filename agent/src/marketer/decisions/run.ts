import { type DecisionClientOptions, type DecisionEnv, decisionKey, decisionModel, requestDecision } from "./client.ts";
import { createDecisionLogger, type DecisionLogger, stateHash } from "./log.ts";
import {
  approvalRiskQuestions,
  AUTOPILOT_QUESTIONS,
  DECISION_QUESTIONS_VERSION,
  type DecisionAnswer,
  type DecisionMode,
  type DecisionPoint,
  type DecisionQuestion,
  MEMORY_GATE_QUESTIONS,
  POINTS,
  ROUTING_QUESTIONS,
} from "./questions.ts";
import {
  APPROVAL_RISK_FAIL_CLOSED,
  APPROVAL_RISK_RULE,
  type ApprovalRiskAction,
  approvalRiskTable,
  AUTOPILOT_RULE,
  type AutopilotAction,
  type AutopilotFacts,
  autopilotTable,
  MEMORY_GATE_RULE,
  type MemoryGateAction,
  memoryGateTable,
  ROUTING_RULE,
  type RoutingAction,
  routingTable,
} from "./tables.ts";

/**
 * `decide(runtime, point, input)`: the one entry point for a decision.
 *
 *  1. Mode per point: `off | shadow | enforce`. With no OPENROUTER_API_KEY every point is `off` and nothing is called,
 *     so behaviour is exactly today's. With a key: `DECISION_MODES` / `DECISION_MODE_<POINT>` override the point's
 *     default (questions.ts: every point defaults to shadow).
 *  2. shadow: call the model, log the answer and what the table would do, act on the rule (today's behaviour).
 *     enforce: act on the table. On timeout, error or a missing cost, a fail-closed point takes its tightening action
 *     and a fail-open point takes the rule.
 *  3. Log every call (log.ts), never blocking the decision.
 */

export interface DecisionRuntime {
  env: DecisionEnv & Record<string, unknown>;
  fetch?: typeof fetch;
  logger?: DecisionLogger;
  now?: () => number;
  /** Who is asking (for the log only). */
  agent?: string;
  runId?: string;
  /**
   * Observability: called once per decision-model call (never for an `off` point) with what may go on a trace: point,
   * mode, model, latency, cost, tokens and whether the fallback answered. Never the state or the answers. A throwing
   * callback is ignored.
   */
  onCall?: (call: DecisionCallRecord) => void;
}

export interface DecisionCallRecord {
  point: DecisionPoint;
  mode: DecisionMode;
  model: string | null;
  latencyMs: number;
  cost: number;
  tokens?: number;
  fallbackUsed: boolean;
  failure: string | null;
  at: number;
}

interface PointIO {
  routing: { state: { message: string }; facts: undefined; action: RoutingAction };
  approval_risk: { state: { call: unknown; objective?: string; brand_rules?: string[] }; facts: undefined; action: ApprovalRiskAction };
  memory_gate: { state: { message: string }; facts: undefined; action: MemoryGateAction };
  autopilot: { state: Record<string, unknown>; facts: AutopilotFacts; action: AutopilotAction };
}

export type PointState<P extends DecisionPoint> = PointIO[P]["state"];
export type PointAction<P extends DecisionPoint> = PointIO[P]["action"];

export type DecideInput<P extends DecisionPoint> = { state: PointState<P>; tenantId: string; signal?: AbortSignal } & (PointIO[P]["facts"] extends undefined ? { facts?: undefined } : { facts: PointIO[P]["facts"] });

export interface DecisionOutcome<P extends DecisionPoint> {
  point: P;
  mode: DecisionMode;
  /** What the caller must do now. */
  action: PointAction<P>;
  /** What the table proposed from the model's answers (undefined when the model did not answer or the point is off). */
  proposed?: PointAction<P>;
  /** True when the action came from the rule or the fail-closed path rather than the model. */
  fallbackUsed: boolean;
  failure?: string;
  answers?: Record<string, DecisionAnswer>;
  latencyMs: number;
  cost: number;
}

interface PointSpec<P extends DecisionPoint> {
  questions(state: PointState<P>): Record<string, DecisionQuestion>;
  table(answers: Record<string, DecisionAnswer>, facts: PointIO[P]["facts"]): PointAction<P>;
  rule(facts: PointIO[P]["facts"]): PointAction<P>;
  failClosed(facts: PointIO[P]["facts"]): PointAction<P>;
}

const SPECS: { [P in DecisionPoint]: PointSpec<P> } = {
  routing: { questions: () => ROUTING_QUESTIONS, table: (a) => routingTable(a), rule: () => ROUTING_RULE, failClosed: () => ROUTING_RULE },
  approval_risk: {
    questions: (s) => approvalRiskQuestions(s.brand_rules),
    table: (a) => approvalRiskTable(a),
    rule: () => APPROVAL_RISK_RULE,
    failClosed: () => APPROVAL_RISK_FAIL_CLOSED,
  },
  memory_gate: { questions: () => MEMORY_GATE_QUESTIONS, table: (a) => memoryGateTable(a), rule: () => MEMORY_GATE_RULE, failClosed: () => MEMORY_GATE_RULE },
  autopilot: { questions: () => AUTOPILOT_QUESTIONS, table: (a, f) => autopilotTable(a, f), rule: () => AUTOPILOT_RULE, failClosed: () => AUTOPILOT_RULE },
};

const MODES = new Set<DecisionMode>(["off", "shadow", "enforce"]);

/** The point's mode: off without a key; else DECISION_MODE_<POINT>, then DECISION_MODES, then the point's default. */
export function resolveMode(env: DecisionEnv & Record<string, unknown>, point: DecisionPoint): DecisionMode {
  if (!decisionKey(env)) return "off";
  const direct = env[`DECISION_MODE_${point.toUpperCase()}`];
  if (typeof direct === "string" && MODES.has(direct.trim() as DecisionMode)) return direct.trim() as DecisionMode;
  for (const pair of (env.DECISION_MODES ?? "").split(/[,\s]+/)) {
    const [name, mode] = pair.split("=").map((x) => x.trim());
    if ((name === point || name === "*") && mode && MODES.has(mode as DecisionMode)) return mode as DecisionMode;
  }
  return POINTS[point].defaultMode;
}

export async function decide<P extends DecisionPoint>(runtime: DecisionRuntime, point: P, input: DecideInput<P>): Promise<DecisionOutcome<P>> {
  const spec = SPECS[point] as unknown as PointSpec<P>;
  const facts = input.facts as PointIO[P]["facts"];
  const mode = resolveMode(runtime.env, point);
  const rule = spec.rule(facts);
  if (mode === "off") return { point, mode, action: rule, fallbackUsed: true, latencyMs: 0, cost: 0 };

  const config = POINTS[point];
  const client: DecisionClientOptions = { env: runtime.env, ...(runtime.fetch ? { fetch: runtime.fetch } : {}), ...(runtime.now ? { now: runtime.now } : {}) };
  // The state the model sees includes code-computed facts, stated as facts.
  const modelState = facts === undefined ? input.state : { ...(input.state as object), facts };
  const result = await requestDecision(client, modelState, spec.questions(input.state), { timeoutMs: config.timeoutMs, ...(input.signal ? { signal: input.signal } : {}) });

  let outcome: DecisionOutcome<P>;
  if (result.ok) {
    const proposed = spec.table(result.answers, facts);
    outcome = { point, mode, action: mode === "enforce" ? proposed : rule, proposed, fallbackUsed: mode !== "enforce", answers: result.answers, latencyMs: result.ms, cost: result.cost };
  } else {
    const action = mode === "enforce" && config.failure === "closed" ? spec.failClosed(facts) : rule;
    outcome = { point, mode, action, fallbackUsed: true, failure: result.kind, latencyMs: result.ms, cost: 0 };
  }
  void logOutcome(runtime, input, modelState, outcome, result.ok ? result.model : decisionModel(runtime.env));
  try {
    runtime.onCall?.({
      point,
      mode,
      model: result.ok ? result.model : decisionModel(runtime.env),
      latencyMs: outcome.latencyMs,
      cost: outcome.cost,
      ...(result.ok ? { tokens: result.tokens } : {}),
      fallbackUsed: outcome.fallbackUsed,
      failure: outcome.failure ?? null,
      at: (runtime.now ?? Date.now)(),
    });
  } catch {
    // observability never changes a decision
  }
  return outcome;
}

async function logOutcome<P extends DecisionPoint>(runtime: DecisionRuntime, input: DecideInput<P>, state: unknown, outcome: DecisionOutcome<P>, model: string): Promise<void> {
  try {
    const logger = runtime.logger ?? createDecisionLogger();
    logger.write({
      point: outcome.point,
      mode: outcome.mode,
      model,
      questionsVersion: DECISION_QUESTIONS_VERSION,
      stateHash: await stateHash(state),
      answers: outcome.answers ?? null,
      fallbackUsed: outcome.fallbackUsed,
      failure: outcome.failure ?? null,
      latencyMs: outcome.latencyMs,
      cost: outcome.cost,
      actionTaken: outcome.action,
      proposed: outcome.proposed ?? null,
      tenantId: input.tenantId,
      runId: runtime.runId ?? null,
      agent: runtime.agent ?? null,
      at: (runtime.now ?? Date.now)(),
    });
  } catch {
    // logging never changes a decision
  }
}
