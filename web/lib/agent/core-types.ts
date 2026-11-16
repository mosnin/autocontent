// Types mirrored from @agent-starter/core (agent/vendor/agent-starter/core) so the web
// app doesn't need the Worker engine. Keep in sync with core/src/autonomy/approvals.ts and
// core/src/observability/telemetry.ts.
export type ApprovalDecision = "approve" | "reject";
export type ApprovalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED";
export type RunStatus =
  | "IDLE" | "QUEUED" | "RUNNING" | "PROVISIONING" | "PENDING_APPROVAL" | "PAUSED_OVERSIGHT"
  | "STOPPING" | "HALTED" | "COMPLETED" | "FAILED" | "TERMINATED";
export interface TelemetryEvent {
  id: string;
  type: "log" | "turn" | "model" | "tool" | "approval" | "status" | "budget" | "plan" | "memory" | "message" | "error" | "sandbox";
  runId: string;
  tenantId: string;
  roomId?: string;
  senderId: string;
  senderRole: string;
  content: string;
  logType: "info" | "success" | "warning" | "error" | "cognitive";
  status?: RunStatus;
  turnCount: number;
  accumulatedCost: number;
  runtimeSeconds: number;
  timestamp: number;
  data?: Record<string, unknown>;
}
