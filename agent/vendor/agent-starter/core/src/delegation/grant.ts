import { AgentError } from "../errors.ts";
import { type AnyAgentTool, defineAgentTool, type SideEffect, type ToolExecutionContext } from "../tools/define.ts";
import type { Assignment } from "./types.ts";

/**
 * What a worker may run right now. `null` means the conversation is not working on a delegated
 * assignment, so the worker's own tool set applies unchanged.
 */
export interface ActiveGrant {
  assignmentId: string;
  mode: Assignment["mode"];
  tools: readonly string[];
  /** Remaining USD for this assignment, when the host can measure spend. */
  remainingUsd?: number;
}

export interface GrantGuardOptions {
  /** Resolve the active assignment's grant for this call (reads the worker's own ledger). */
  activeGrant: (ctx: ToolExecutionContext) => ActiveGrant | null;
  /** Harness tools that stay available inside any assignment (e.g. report_delegation, check_delegation). */
  alwaysAllowed?: readonly string[];
}

export class ToolNotGrantedError extends AgentError {
  constructor(tool: string, assignmentId: string, reason: string) {
    super("TOOL_NOT_ALLOWED", `"${tool}" is not available for delegated task ${assignmentId}: ${reason}`, { details: { tool, assignmentId } });
  }
}

/**
 * Why a call is refused under an active grant, or null when it is allowed. `sideEffect` undefined (a tool the caller
 * cannot describe) counts as mutating, so `consult` stays read-only even for tools the guard does not know.
 */
export function grantViolation(grant: ActiveGrant, toolName: string, sideEffect?: SideEffect): string | null {
  if (grant.mode === "notify") return "a notify assignment grants no tools";
  if (!grant.tools.includes(toolName)) return "outside the requester's grant";
  const mutating = sideEffect === undefined || sideEffect === "write" || sideEffect === "external" || sideEffect === "destructive";
  if (grant.mode === "consult" && mutating) return "a consult assignment allows read-only tools only";
  if (grant.remainingUsd !== undefined && grant.remainingUsd <= 0) return "the assignment budget is spent; report what you have";
  return null;
}

/**
 * Execution-time enforcement of "child tools ⊆ parent grant": wraps each tool so that, while the conversation works
 * on a delegated assignment, a call outside the assignment's grant (or a mutating call in a `consult` assignment, or
 * any call after the assignment budget is spent) fails before the tool body runs. Visibility filtering alone is not
 * enough because a model can still emit a call to a tool it was not shown. Wrapped tools keep their contract
 * (risk tier, side effect, schema), so the `ToolExecutor` pipeline (firewall, approvals, budget) still runs first.
 */
export function guardToolsWithGrant(tools: readonly AnyAgentTool[], options: GrantGuardOptions): AnyAgentTool[] {
  const always = new Set(options.alwaysAllowed ?? []);
  return tools.map((tool) => {
    if (always.has(tool.name)) return tool;
    return defineAgentTool({
      ...tool,
      execute: async (args, ctx) => {
        const grant = options.activeGrant(ctx);
        const violation = grant ? grantViolation(grant, tool.name, tool.sideEffect) : null;
        if (grant && violation) throw new ToolNotGrantedError(tool.name, grant.assignmentId, violation);
        return tool.execute(args, ctx);
      },
    });
  });
}
