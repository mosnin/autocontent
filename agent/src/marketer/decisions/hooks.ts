import { AutoReviewer, type KnowledgeRetriever, type MemoryHit, redactDeep, type ReviewCall, type ReviewContext, type ReviewDecision, type TenantSecurityContext } from "@agent-starter/core";
import { decisionKey } from "./client.ts";
import { PAID_MEDIA_SKILL } from "./questions.ts";
import { decide, type DecisionRuntime, resolveMode } from "./run.ts";
import { tightenVerdict } from "./tables.ts";

/**
 * Where the decision points meet the harness, without editing vendored code:
 *  - observeTurns: the platform calls the retriever once per person's turn, before the model reads it. Wrapping it
 *    gives points 1 (routing) and 11 (memory gate) the turn text. In shadow they only log, off the hot path.
 *  - MarketerReviewer: wraps the persistent agent's AutoReviewer for points 6 (approval risk, tighten only) and 12
 *    (autopilot: anything worth proposing?).
 */

const MAX_MESSAGE_CHARS = 4000;

export type TurnHook = (tenant: TenantSecurityContext, message: string) => Promise<MemoryHit[]>;

/**
 * Wrap a retriever factory so `hooks` run on every turn's text. Hooks in shadow resolve immediately (empty) and log in
 * the background; a hook may return extra hits (an enforced routing hint), which are put first. A failing hook never
 * breaks retrieval.
 */
export function observeTurns(base: (tenant: TenantSecurityContext) => KnowledgeRetriever | undefined, hooks: TurnHook[]): (tenant: TenantSecurityContext) => KnowledgeRetriever | undefined {
  return (tenant) => {
    const retriever = base(tenant);
    if (!retriever || hooks.length === 0) return retriever;
    const wrapped = Object.create(retriever) as KnowledgeRetriever;
    wrapped.retrieve = async (query, options) => {
      const [extra, hits] = await Promise.all([Promise.all(hooks.map((hook) => hook(tenant, query).catch(() => [] as MemoryHit[]))), retriever.retrieve(query, options)]);
      const added = extra.flat();
      return added.length ? [...added, ...hits] : hits;
    };
    return wrapped;
  };
}

/**
 * Point 1: route a request to a department. Shadow: log in the background, return nothing (the frontier model routes
 * via delegate_task as today). Enforce: wait for the answer (800 ms budget) and, when the table has a hint, return it
 * as a retrieved note the model reads before choosing.
 */
export function routingHook(runtime: () => DecisionRuntime): TurnHook {
  return async (tenant, message) => {
    const rt = runtime();
    const outcome = await decide(rt, "routing", { state: { message: message.slice(0, MAX_MESSAGE_CHARS) }, tenantId: tenant.tenantId });
    if (outcome.mode !== "enforce" || outcome.fallbackUsed) return [];
    const { department, skill } = outcome.action;
    const lines = [
      ...(department ? [`This request most likely belongs to the ${department} department (delegate_task id "${department}").`] : []),
      ...(skill === PAID_MEDIA_SKILL ? [`It involves ad money: activate the ${PAID_MEDIA_SKILL} skill before acting.`] : []),
    ];
    if (!lines.length) return [];
    return [{ id: "decision-routing-hint", text: `Routing hint from the platform's decision model (a hint, not an instruction; ask the person when unsure). ${lines.join(" ")}`, score: 1, source: "decisions", metadata: { title: "routing hint" } }];
  };
}

/** Shadow wrapper: start the decision, never wait for it (used for points that only log today). */
export function backgroundHook(hook: TurnHook): TurnHook {
  return async (tenant, message) => {
    void hook(tenant, message).catch(() => undefined);
    return [];
  };
}

/**
 * Point 11: memory write gate. There is no automatic extraction yet (explicit remember_note only), so the gate only
 * logs what it would do; the extraction that will run behind it reads `outcome.action`.
 */
export function memoryGateHook(runtime: () => DecisionRuntime): TurnHook {
  return async (tenant, message) => {
    await decide(runtime(), "memory_gate", { state: { message: message.slice(0, MAX_MESSAGE_CHARS) }, tenantId: tenant.tenantId });
    return [];
  };
}

/** Route hooks by mode: enforced routing waits; everything else runs in the background. */
export function turnHooks(runtime: () => DecisionRuntime, points: { routing?: boolean; memoryGate?: boolean }): TurnHook[] {
  const hooks: TurnHook[] = [];
  // No key: no hooks, so the retriever is not even wrapped (exactly today's behaviour).
  if (!decisionKey(runtime().env)) return hooks;
  if (points.routing) {
    const routing = routingHook(runtime);
    const background = backgroundHook(routing);
    hooks.push((tenant, message) => (resolveMode(runtime().env, "routing") === "enforce" ? routing(tenant, message) : background(tenant, message)));
  }
  if (points.memoryGate) hooks.push(backgroundHook(memoryGateHook(runtime)));
  return hooks;
}

// ── Points 6 and 12: a Marketer wrapper around the persistent agent's reviewer ──────────────────────────────────

export interface AutopilotCheck {
  /** Runs for `propose_next_moves` only: "hold" blocks the proposal in enforce (no proposal is the safe side). */
  (call: ReviewCall, context: ReviewContext): Promise<{ action: "proceed" | "hold"; reason: string }>;
}

export interface MarketerReviewerOptions {
  inner: AutoReviewer;
  runtime: () => DecisionRuntime;
  tenantId: string;
  autopilot?: AutopilotCheck;
  /** Called when the wrapper changed the inner verdict (audit). Errors are ignored. */
  onTightened?: (call: ReviewCall, decision: ReviewDecision) => void | Promise<void>;
}

/**
 * Tighten, never loosen: the inner reviewer's verdict stands unless point 6 (enforce) escalates it or point 12
 * (enforce) holds a proposal. The wrapper never approves anything, so a CRITICAL call is never auto-approved by it.
 */
export class MarketerReviewer extends AutoReviewer {
  constructor(private readonly opts: MarketerReviewerOptions) {
    super();
  }

  override async review(call: ReviewCall, context: ReviewContext = {}): Promise<ReviewDecision> {
    const rt = this.opts.runtime();
    const state = {
      call: { tool: call.tool, risk: call.risk ?? null, sideEffect: call.sideEffect ?? null, args: clip(redactDeep(call.args, { kinds: ["api_key", "jwt", "private_key", "credit_card", "ssn", "iban"] })) },
      ...(context.objective ? { objective: context.objective.slice(0, 1000) } : {}),
    };
    const [base, risk, autopilot] = await Promise.all([
      this.opts.inner.review(call, context),
      decide(rt, "approval_risk", { state, tenantId: this.opts.tenantId }).catch(() => undefined),
      call.tool === "propose_next_moves" && this.opts.autopilot ? this.opts.autopilot(call, context).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    let decision = base;
    if (risk) {
      const verdict = tightenVerdict(base.decision, risk.action);
      if (verdict !== base.decision) decision = { decision: verdict, reason: `Escalated by the decision model: ${risk.action.reasons.join("; ") || "risk"}`.slice(0, 600), by: base.by };
    }
    if (autopilot?.action === "hold" && decision.decision !== "block") decision = { decision: "block", reason: `Nothing worth proposing this tick (${autopilot.reason}).`, by: base.by };
    if (decision !== base) {
      try {
        await this.opts.onTightened?.(call, decision);
      } catch {
        // audit is best-effort
      }
    }
    return decision;
  }
}

function clip(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  return text.length <= 4000 ? value : text.slice(0, 4000);
}
