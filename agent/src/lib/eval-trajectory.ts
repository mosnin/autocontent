import type { EvalRunOutput } from "@agent-starter/evals";
import { workflowStateOf } from "./run-status.ts";

/**
 * Tool calls and the final workflow state (the spec's ExecutedState) from a reply stream. Flue's
 * `tool-output` chunks carry only the call id, so names come from the matching `tool-input` chunk; the
 * final state is the last successful `transition_state` result.
 */
export function createEvalTrajectory() {
  const names = new Map<string, string>();
  const toolCalls: EvalRunOutput["toolCalls"] = [];
  const state: { finalState?: string } = {};
  return {
    toolCalls,
    get finalState() {
      return state.finalState;
    },
    onEvent(chunk: unknown) {
      const c = chunk as { type?: string; toolCallId?: string; toolName?: string; output?: unknown };
      if (c.type === "tool-input" && c.toolCallId && c.toolName) names.set(c.toolCallId, c.toolName);
      if ((c.type === "tool-output" || c.type === "tool-output-error") && c.toolCallId) {
        const tool = names.get(c.toolCallId) ?? c.toolName ?? "unknown";
        toolCalls.push({ tool, status: c.type === "tool-output" ? "ok" : "error" });
        if (tool === "transition_state" && c.type === "tool-output") state.finalState = workflowStateOf(c.output) ?? state.finalState;
      }
    },
  };
}
