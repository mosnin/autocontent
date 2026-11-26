import { AgentError } from "../errors.ts";
import type { SqlStore } from "../storage/ports.ts";
import type { RiskTier } from "../tenancy/tenancy.ts";

export type GoalStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" | "PRUNED" | "BLOCKED";

export interface GoalNode {
  id: string;
  parentId: string | null;
  title: string;
  status: GoalStatus;
  riskTier: RiskTier;
  retryCount: number;
  dependsOn: string[];
  allowedTools: string[];
  result: string | null;
}

interface GoalRow {
  id: string;
  parent_id: string | null;
  title: string;
  status: string;
  risk_tier: string;
  retry_count: number;
  depends_on: string;
  allowed_tools: string;
  result: string | null;
}

/**
 * Dynamic hierarchical goal tree persisted in the agent's SQLite. After every
 * tool execution the agent marks nodes COMPLETED / FAILED or spawns children;
 * repeated child failures bubble up to the parent to trigger re-planning
 * without abandoning the root objective.
 */
export class GoalTree {
  constructor(
    private readonly sql: SqlStore,
    private readonly scope: { runId: string; tenantId: string },
    private readonly options: { maxRetries?: number; clock?: () => number } = {},
  ) {}

  private now(): number {
    return (this.options.clock ?? Date.now)();
  }

  addGoal(goal: { id: string; parentId?: string | null; title: string; riskTier?: RiskTier; dependsOn?: string[]; allowedTools?: string[] }): GoalNode {
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(goal.id)) throw new AgentError("PLAN_INVALID", `Invalid goal id "${goal.id}"`);
    if (goal.parentId && !this.get(goal.parentId)) throw new AgentError("PLAN_INVALID", `Parent goal "${goal.parentId}" does not exist`);
    const now = this.now();
    this.sql.exec(
      `INSERT INTO as_goal_tree (run_id, id, parent_id, tenant_id, title, status, risk_tier, depends_on, allowed_tools, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?) ON CONFLICT(run_id, id) DO NOTHING`,
      this.scope.runId,
      goal.id,
      goal.parentId ?? null,
      this.scope.tenantId,
      goal.title,
      goal.riskTier ?? "LOW",
      JSON.stringify(goal.dependsOn ?? []),
      JSON.stringify(goal.allowedTools ?? []),
      now,
      now,
    );
    return this.get(goal.id) as GoalNode;
  }

  get(id: string): GoalNode | null {
    const row = this.sql.exec<GoalRow>(`SELECT * FROM as_goal_tree WHERE run_id = ? AND tenant_id = ? AND id = ?`, this.scope.runId, this.scope.tenantId, id)[0];
    return row ? toNode(row) : null;
  }

  all(): GoalNode[] {
    return this.sql.exec<GoalRow>(`SELECT * FROM as_goal_tree WHERE run_id = ? AND tenant_id = ? ORDER BY created_at, id`, this.scope.runId, this.scope.tenantId).map(toNode);
  }

  children(id: string): GoalNode[] {
    return this.all().filter((g) => g.parentId === id);
  }

  /** Update a node; FAILED increments its retry counter and bubbles to the parent after maxRetries. Returns ids that failed. */
  setStatus(id: string, status: GoalStatus, result?: string): string[] {
    const node = this.get(id);
    if (!node) throw new AgentError("PLAN_INVALID", `Unknown goal "${id}"`);
    const failed: string[] = [];
    if (status === "FAILED") {
      const retries = node.retryCount + 1;
      this.sql.exec(`UPDATE as_goal_tree SET status = 'FAILED', retry_count = ?, result = ?, updated_at = ? WHERE run_id = ? AND tenant_id = ? AND id = ?`, retries, result ?? node.result, this.now(), this.scope.runId, this.scope.tenantId, id);
      failed.push(id);
      if (node.parentId && retries > (this.options.maxRetries ?? 2)) failed.push(...this.setStatus(node.parentId, "FAILED", `child ${id} failed ${retries}x`));
      return failed;
    }
    this.sql.exec(`UPDATE as_goal_tree SET status = ?, result = COALESCE(?, result), updated_at = ? WHERE run_id = ? AND tenant_id = ? AND id = ?`, status, result ?? null, this.now(), this.scope.runId, this.scope.tenantId, id);
    if (status === "COMPLETED" && node.parentId) {
      const siblings = this.children(node.parentId);
      if (siblings.length > 0 && siblings.every((s) => s.status === "COMPLETED" || s.status === "PRUNED")) this.setStatus(node.parentId, "COMPLETED");
    }
    return failed;
  }

  /** Mark a subtree PRUNED (abandoned path) without touching its ancestors. */
  prune(id: string): void {
    for (const child of this.children(id)) this.prune(child.id);
    this.sql.exec(`UPDATE as_goal_tree SET status = 'PRUNED', updated_at = ? WHERE run_id = ? AND tenant_id = ? AND id = ?`, this.now(), this.scope.runId, this.scope.tenantId, id);
  }

  /** Every actionable leaf: PENDING/ACTIVE, no pending children, all dependencies completed. */
  actionable(): GoalNode[] {
    const nodes = this.all();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return nodes.filter((n) => {
      if (n.status !== "PENDING" && n.status !== "ACTIVE") return false;
      if (nodes.some((c) => c.parentId === n.id && (c.status === "PENDING" || c.status === "ACTIVE" || c.status === "BLOCKED"))) return false;
      return n.dependsOn.every((d) => byId.get(d)?.status === "COMPLETED");
    });
  }

  /** Next actionable leaf (an ACTIVE one first). */
  next(): GoalNode | null {
    const actionable = this.actionable();
    return actionable.find((n) => n.status === "ACTIVE") ?? actionable[0] ?? null;
  }

  /**
   * The tools the planner allowed for the work that can happen now (R-COG-01): the union of the
   * actionable goals' `allowedTools`. Null when nothing restricts (no plan, nothing actionable, or an
   * actionable goal with no tool list).
   */
  allowedToolsNow(): string[] | null {
    const open = this.actionable();
    if (open.length === 0 || open.some((g) => g.allowedTools.length === 0)) return null;
    return [...new Set(open.flatMap((g) => g.allowedTools))];
  }

  isComplete(): boolean {
    const roots = this.all().filter((n) => n.parentId === null);
    return roots.length > 0 && roots.every((n) => n.status === "COMPLETED");
  }

  render(): string {
    const nodes = this.all();
    if (nodes.length === 0) return "[GOAL TREE] No goals recorded yet.";
    const lines = ["[ACTIVE HIERARCHICAL GOAL TREE]"];
    const walk = (parent: string | null, depth: number) => {
      for (const node of nodes.filter((n) => n.parentId === parent)) {
        const deps = node.dependsOn.length ? ` deps=${node.dependsOn.join(",")}` : "";
        const tools = node.allowedTools.length ? ` tools=${node.allowedTools.join(",")}` : "";
        lines.push(`${"  ".repeat(depth)}- [${node.status}] ${node.id}: ${node.title} (risk ${node.riskTier}${deps}${tools})${node.result ? ` → ${node.result.slice(0, 120)}` : ""}`);
        walk(node.id, depth + 1);
      }
    };
    walk(null, 0);
    return lines.join("\n");
  }
}

function toNode(row: GoalRow): GoalNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    status: row.status as GoalStatus,
    riskTier: row.risk_tier as RiskTier,
    retryCount: Number(row.retry_count),
    dependsOn: JSON.parse(row.depends_on) as string[],
    allowedTools: JSON.parse(row.allowed_tools) as string[],
    result: row.result,
  };
}
