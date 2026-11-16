import type { PersistentAgentConfig } from "./config.ts";
import type { AgentIdentity } from "./identity.ts";

/**
 * Heartbeat contract between the control plane and the agent. On every tick the control plane dispatches a
 * server-only `heartbeat` (or `schedule`) signal carrying the HEARTBEAT checklist (or the schedule's prompt). If
 * nothing needs doing the agent answers exactly `HEARTBEAT_OK`: the turn ends cheaply and is delivered nowhere.
 */
export const HEARTBEAT_OK = "HEARTBEAT_OK";
export const HEARTBEAT_SIGNAL = "heartbeat";
export const SCHEDULE_SIGNAL = "schedule";
export const PERSISTENT_SIGNAL_TYPES: readonly string[] = [HEARTBEAT_SIGNAL, SCHEDULE_SIGNAL];

/** True when the reply is the no-op answer (whitespace and a trailing period tolerated). */
export function isHeartbeatOk(text: string | undefined | null): boolean {
  return (text ?? "").trim().replace(/\.$/, "") === HEARTBEAT_OK;
}

export type TurnOutcome = "ok" | "heartbeat_ok" | "skipped" | "error" | "killed";

/** One agent turn as the control plane records it (content redacted: tool names and decisions, no text). */
export interface TurnSummary {
  turnId: string;
  /** `heartbeat`, `schedule:<name>` or `manual`. */
  trigger: string;
  startedAt: number;
  endedAt?: number;
  outcome: TurnOutcome;
  toolCalls: string[];
  reviews: Array<{ tool: string; decision: "approve" | "block" | "escalate"; reason: string }>;
  costUsd: number;
}

/** What the control plane hands its `dispatch` hook on each tick. */
export interface PersistentTrigger {
  turnId: string;
  kind: "heartbeat" | "schedule";
  name?: string;
  /** The HEARTBEAT checklist or the schedule's prompt. */
  prompt: string;
  config: PersistentAgentConfig;
  identity: AgentIdentity;
}

/** The trigger label used in turn summaries and signal attributes. */
export function triggerLabel(trigger: Pick<PersistentTrigger, "kind" | "name">): string {
  return trigger.kind === "schedule" ? `schedule:${trigger.name ?? "unnamed"}` : "heartbeat";
}

/** The signal a template dispatches into the Flue agent for a trigger (`type`, `body`, `attributes`). */
export function heartbeatSignal(trigger: PersistentTrigger): { type: string; body: string; attributes: Record<string, string> } {
  const header =
    trigger.kind === "heartbeat"
      ? `Heartbeat tick. Work through your HEARTBEAT checklist below. If nothing needs doing, reply exactly ${HEARTBEAT_OK} and call no tools.`
      : `Scheduled run "${trigger.name}". Do the task below. If nothing needs doing, reply exactly ${HEARTBEAT_OK}.`;
  return {
    type: trigger.kind === "heartbeat" ? HEARTBEAT_SIGNAL : SCHEDULE_SIGNAL,
    body: `${header}\n\n${trigger.prompt}`.slice(0, 12_000),
    attributes: { turnId: trigger.turnId, trigger: triggerLabel(trigger), configVersion: String(trigger.config.version) },
  };
}
