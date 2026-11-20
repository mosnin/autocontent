import { z } from "zod";
import { AgentError } from "../errors.ts";
import { completeJson } from "../models/structured.ts";
import type { ModelProvider } from "../models/types.ts";
import { RiskTierSchema } from "../tenancy/tenancy.ts";
import type { GoalTree } from "./goal-tree.ts";

const PlannedGoalSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/, "snake_case id"),
  title: z.string().min(3).max(200),
  riskTier: RiskTierSchema.default("LOW"),
  dependsOn: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
});

export const PlanSchema = z.object({
  intent: z.string().max(200),
  goals: z.array(PlannedGoalSchema).min(1).max(12),
});
export type Plan = z.infer<typeof PlanSchema>;

const ReplanSchema = z.object({
  rationale: z.string().max(400),
  spawn: z.array(PlannedGoalSchema).min(1).max(5),
});

/** Which goal templates / tools an event type may use (the intent layer's allowed sub-graphs). */
export interface IntentPolicy {
  /** Map from intent/event type to allowed tool names. "*" allows all. */
  allowedTools: Record<string, string[]>;
  defaultAllowed?: string[];
}

/**
 * Intent & execution planning layer. Before the primary model touches a tool, a
 * lighter model decomposes the goal into a dependency graph of sub-goals that is
 * validated (ids, dependencies, tool allow-lists) and loaded into the GoalTree.
 * On failure, `replan` prunes the broken branch and spawns alternatives under
 * the same parent — the root objective is never dropped.
 */
export class Planner {
  constructor(
    private readonly options: { intentModel: ModelProvider; replanModel?: ModelProvider; availableTools: string[]; policy?: IntentPolicy; maxReplans?: number },
  ) {}

  async decompose(objective: string, context: { eventType?: string; contextSummary?: string } = {}): Promise<Plan> {
    const allowed = this.allowedFor(context.eventType);
    const { value } = await completeJson(this.options.intentModel, PlanSchema, {
      system:
        "You are an intent and execution planner for an autonomous agent. Decompose the objective into the smallest set of concrete, verifiable sub-goals (max 12). " +
        "Use dependsOn to order work; mark irreversible or customer-facing actions HIGH risk. Only reference tools from the allowed list. " +
        "List in each goal's tools every tool that goal needs: while a goal is actionable, only its tools may run (an empty list allows any tool).",
      prompt: `Objective: ${objective}\nEvent type: ${context.eventType ?? "unspecified"}\nAllowed tools: ${allowed.join(", ") || "(none)"}\n${context.contextSummary ? `Context:\n${context.contextSummary}` : ""}`,
      schemaName: "execution_plan",
      maxOutputTokens: 1500,
    });
    return this.validate(value, allowed);
  }

  validate(plan: Plan, allowed = this.allowedFor()): Plan {
    const ids = new Set<string>();
    for (const goal of plan.goals) {
      if (ids.has(goal.id)) throw new AgentError("PLAN_INVALID", `Duplicate goal id ${goal.id}`);
      ids.add(goal.id);
    }
    for (const goal of plan.goals) {
      for (const dep of goal.dependsOn) if (!ids.has(dep)) throw new AgentError("PLAN_INVALID", `Goal ${goal.id} depends on unknown goal ${dep}`);
      goal.tools = goal.tools.filter((t) => allowed.includes(t) || allowed.includes("*"));
    }
    // Reject cycles (Kahn's algorithm).
    const indegree = new Map(plan.goals.map((g) => [g.id, g.dependsOn.length]));
    const queue = plan.goals.filter((g) => g.dependsOn.length === 0).map((g) => g.id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift() as string;
      visited++;
      for (const g of plan.goals) {
        if (g.dependsOn.includes(id)) {
          const next = (indegree.get(g.id) ?? 0) - 1;
          indegree.set(g.id, next);
          if (next === 0) queue.push(g.id);
        }
      }
    }
    if (visited !== plan.goals.length) throw new AgentError("PLAN_INVALID", "Plan contains a dependency cycle");
    return plan;
  }

  load(plan: Plan, tree: GoalTree, rootId = "root", rootTitle?: string): void {
    if (!tree.get(rootId)) tree.addGoal({ id: rootId, title: rootTitle ?? plan.intent, riskTier: "LOW" });
    for (const goal of plan.goals) {
      tree.addGoal({ id: `${rootId}.${goal.id}`, parentId: rootId, title: goal.title, riskTier: goal.riskTier, dependsOn: goal.dependsOn.map((d) => `${rootId}.${d}`), allowedTools: goal.tools });
    }
    tree.setStatus(rootId, "ACTIVE");
  }

  async replan(tree: GoalTree, failedGoalId: string, error: string, replanCount: number): Promise<{ spawned: string[]; message: string }> {
    if (replanCount >= (this.options.maxReplans ?? 3)) {
      throw new AgentError("PLAN_INVALID", `CRITICAL_REPLANNING_LIMIT: ${replanCount} re-plans already attempted for this run.`);
    }
    const failed = tree.get(failedGoalId);
    if (!failed) throw new AgentError("PLAN_INVALID", `Unknown goal ${failedGoalId}`);
    tree.prune(failedGoalId);
    const parentId = failed.parentId ?? failedGoalId;
    const model = this.options.replanModel ?? this.options.intentModel;
    const { value } = await completeJson(model, ReplanSchema, {
      system: "You are the executive re-planner of a self-healing agent. A sub-goal failed. Propose 1-5 alternative sub-goals that route around the failure while still achieving the parent goal. Do not repeat the failed approach.",
      prompt: `Failed goal: ${failed.id} — ${failed.title}\nError: ${error.slice(0, 1500)}\n\nCurrent tree:\n${tree.render()}\n\nAllowed tools: ${this.allowedFor().join(", ")}`,
      schemaName: "replan",
      maxOutputTokens: 1000,
    });
    const spawned: string[] = [];
    for (const goal of value.spawn) {
      const id = `${parentId}.r${replanCount + 1}_${goal.id}`;
      tree.addGoal({ id, parentId, title: goal.title, riskTier: goal.riskTier, allowedTools: goal.tools.filter((t) => this.allowedFor().includes(t)) });
      spawned.push(id);
    }
    tree.setStatus(parentId, "ACTIVE");
    return { spawned, message: `[🔄 RE-PLANNING] Pruned "${failedGoalId}". ${value.rationale} Spawned: ${spawned.join(", ")}.` };
  }

  allowedFor(eventType?: string): string[] {
    const policy = this.options.policy;
    if (!policy) return this.options.availableTools;
    const list = (eventType && policy.allowedTools[eventType]) || policy.defaultAllowed || this.options.availableTools;
    return list.includes("*") ? this.options.availableTools : list.filter((t) => this.options.availableTools.includes(t));
  }
}
