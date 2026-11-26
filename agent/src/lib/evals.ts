import { conversationInstanceId, randomId } from "@agent-starter/core";
import { createEvalHarnessHandler, type EvalRunOutput } from "@agent-starter/evals";
import { isAwaitingHuman } from "@agent-starter/flue";
import { init } from "@flue/runtime";
import { AGENTS } from "../agents.generated.ts";
import type { Env } from "../env.ts";
import { createEvalTrajectory } from "./eval-trajectory.ts";
import { evalRunPolicy } from "./policy.ts";

/**
 * POST /api/test-eval-harness?agent=<name> — Promptfoo's HTTP provider calls this (promptfoo.config.yaml).
 * Each case runs against a FRESH conversation (unique id) of the target agent in
 * shadow mode (mutating tools simulated), streams the run to collect tool calls,
 * and returns turns/cost/status for assertions. Disabled unless EVAL_HARNESS_SECRET
 * (≥16 chars) is set — never enable it with a weak secret in production.
 * The secret is not a user session (src/lib/policy.ts evalRunPolicy): "live" mode is refused unless
 * EVAL_ALLOW_LIVE=true, EVAL_TENANTS (optional) pins the tenants, and the user is namespaced `eval:<id>`.
 */
export function evalHarness(request: Request, env: Env): Promise<Response> {
  const handler = createEvalHarnessHandler({
    secret: () => env.EVAL_HARNESS_SECRET,
    run: async (requested): Promise<EvalRunOutput> => {
      const policy = evalRunPolicy(requested, env as Env & { EVAL_ALLOW_LIVE?: string; EVAL_TENANTS?: string });
      if (!policy.ok) return { executionStatus: "FAILED", finalText: policy.error, turnCount: 0, accumulatedCost: 0, toolCalls: [], trajectory: [], errorCode: policy.error.split(":")[0] };
      const input = { ...requested, tenantId: policy.tenantId, userId: policy.userId, mode: policy.mode };
      const agentName = new URL(request.url).searchParams.get("agent") || Object.keys(AGENTS)[0] || "";
      const agent = AGENTS[agentName];
      if (!agent) throw new Error(`Unknown agent ${agentName}`);
      // Same id encoding as user conversations (the user id is encoded injectively).
      const id = conversationInstanceId(agentName, input.tenantId, input.userId, `eval-${randomId().slice(0, 12)}`);
      const handle = init(agent, { id });
      const toolCalls: EvalRunOutput["toolCalls"] = [];
      const message = input.message ?? (typeof input.eventPayload === "string" ? input.eventPayload : JSON.stringify(input.eventPayload));
      try {
        // `replay` > 1 re-delivers the identical request with one idempotency key (a reconnecting client /
        // provider redelivery): Flue must converge on the first submission, so side effects run once.
        const request = { message, initialData: { tenantId: input.tenantId, userId: input.userId, environment: "test", mode: input.mode }, idempotencyKey: input.idempotencyKey ?? `eval-${randomId()}` };
        const deliveries = input.replay ?? 1;
        const receipt = await handle.dispatch(request);
        let deduplicatedDeliveries = 0;
        for (let i = 1; i < deliveries; i++) {
          const again = await handle.dispatch(request);
          if (again.deduplicated || again.submissionId === receipt.submissionId) deduplicatedDeliveries++;
        }
        const trajectory = createEvalTrajectory();
        const reply = await handle.read(receipt, { onEvent: trajectory.onEvent });
        toolCalls.push(...trajectory.toolCalls);
        const meta = (reply.metadata ?? {}) as { budget?: { turns?: number; costUsd?: number; exhausted?: boolean }; securityLocked?: boolean };
        // A reply parked on a human (pending approval or open ask_person question) is not "completed".
        const status = meta.securityLocked ? "TERMINATED" : meta.budget?.exhausted ? "HALTED" : isAwaitingHuman(meta) ? "PENDING_APPROVAL" : "COMPLETED";
        return {
          executionStatus: status,
          ...(trajectory.finalState ? { finalState: trajectory.finalState } : {}),
          finalText: reply.text,
          turnCount: meta.budget?.turns ?? 0,
          accumulatedCost: meta.budget?.costUsd ?? 0,
          toolCalls,
          trajectory: toolCalls.map((t) => `${t.tool} → ${t.status}`),
          deliveries,
          deduplicatedDeliveries,
          ...(meta.securityLocked ? { errorCode: "SECURITY_EXCEPTION_HALT" } : {}),
        };
      } catch (error) {
        return { executionStatus: "FAILED", finalText: error instanceof Error ? error.message : String(error), turnCount: 0, accumulatedCost: 0, toolCalls, trajectory: [] };
      }
    },
  });
  return handler(request);
}

