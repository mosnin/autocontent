import { type AnyAgentTool, defineAgentTool } from "@agent-starter/core";
import * as v from "valibot";

const DEPARTMENT = v.picklist(["strategist", "content-producer", "seo-editor", "media-buyer", "distribution-manager", "analyst"]);

export const ProposedMovesSchema = v.object({
  summary: v.pipe(v.string(), v.minLength(10), v.maxLength(1000)),
  moves: v.pipe(
    v.array(
      v.object({
        department: DEPARTMENT,
        action: v.pipe(v.string(), v.minLength(5), v.maxLength(300)),
        why: v.pipe(v.string(), v.minLength(5), v.maxLength(500)),
        estimatedCostUsd: v.pipe(v.number(), v.minValue(0), v.maxValue(10_000)),
      }),
    ),
    v.minLength(1),
    v.maxLength(8),
  ),
});

/** Delivers an approved plan to the Marketer web app (the platform's signed, durable outbox: `sendToSaas`). */
export type PlanSender = (payload: Record<string, unknown>, meta: { tenantId: string; eventId?: string; eventType?: string }) => Promise<unknown>;

/**
 * The always-on loop's only acting tool: a plan of next moves for the account owner. It ALWAYS waits for the owner's
 * approval (`requiresApproval`; the persistent agent binds approvals to its owner) and, once approved, is delivered
 * as a signed `marketer.plan.approved` webhook, where the web app opens a Marketer session with it. Nothing is spent
 * or published by this tool: each move still runs through Marketer and its departments' own approvals.
 * Idempotent: the outbox dedupes on the event id (`ctx.idempotencyKey`).
 */
export function createProposeNextMovesTool(send: PlanSender): AnyAgentTool {
  return defineAgentTool({
    name: "propose_next_moves",
    description: "Propose the next marketing moves to the owner (waits for their approval, then hands the plan to Marketer; nothing is spent or published by this tool).",
    input: ProposedMovesSchema,
    risk: "MEDIUM",
    sideEffect: "external",
    requiresApproval: true,
    idempotent: true,
    timeoutMs: 15_000,
    execute: async ({ summary, moves }, ctx) =>
      send(
        { type: "marketer.plan.approved", tenantId: ctx.tenant.tenantId, runId: ctx.runId, summary, moves, totalEstimatedCostUsd: Number(moves.reduce((sum, m) => sum + m.estimatedCostUsd, 0).toFixed(2)) },
        { tenantId: ctx.tenant.tenantId, eventId: ctx.idempotencyKey, eventType: "marketer.plan.approved" },
      ),
  }) as unknown as AnyAgentTool;
}
