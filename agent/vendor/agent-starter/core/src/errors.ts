/**
 * Typed error hierarchy. Every failure the harness raises carries a stable
 * machine-readable `code` so evals, dashboards and recovery logic can branch on
 * it without string-matching messages.
 */
export type AgentErrorCode =
  | "TENANT_ISOLATION_VIOLATION"
  | "TENANT_METADATA_CORRUPTED_HALT"
  | "BUDGET_LIMIT_EXCEEDED"
  | "SECURITY_EXCEPTION_HALT"
  | "GUARDRAIL_BLOCKED"
  | "TOOL_NOT_FOUND"
  | "TOOL_NOT_ALLOWED"
  | "TOOL_VALIDATION_FAILED"
  | "TOOL_EXECUTION_FAILED"
  | "ARGUMENT_CORRUPTION_UNRECOVERABLE"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_TOKEN_INVALID"
  | "CIRCUIT_OPEN"
  | "TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "HTTP_ERROR"
  | "SILENT_DEADLOCK"
  | "MIGRATION_RUNNER_ABORTED"
  | "MERGE_CONFLICT"
  | "WORKSPACE_ERROR"
  | "PLAN_INVALID"
  | "INVALID_STATE_TRANSITION"
  | "RECOVERY_EXHAUSTED"
  | "VERSION_HANDOFF"
  | "RATE_LIMITED"
  | "SIGNATURE_INVALID"
  | "CONFIG_INVALID";

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(
    code: AgentErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, details: this.details, retryable: this.retryable };
  }
}

export class TenantIsolationError extends AgentError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("TENANT_ISOLATION_VIOLATION", message, { details });
  }
}

export class TenantLockdownError extends AgentError {
  constructor(tenantId: string, cause?: unknown) {
    super("TENANT_METADATA_CORRUPTED_HALT", `Tenant configuration for "${tenantId}" is corrupted; execution locked down.`, {
      details: { tenantId },
      cause,
    });
  }
}

export interface BudgetBreach {
  limit: "turns" | "costUsd" | "tokens" | "wallClockMs" | "toolCalls" | "vmSeconds";
  used: number;
  max: number;
}

export class BudgetExceededError extends AgentError {
  readonly breach: BudgetBreach;
  constructor(breach: BudgetBreach) {
    super("BUDGET_LIMIT_EXCEEDED", `Execution halted: ${breach.limit} budget exhausted (${breach.used} / ${breach.max}).`, {
      details: { ...breach },
    });
    this.breach = breach;
  }
}

export class SecurityHaltError extends AgentError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("SECURITY_EXCEPTION_HALT", message, { details });
  }
}

export class GuardrailBlockedError extends AgentError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("GUARDRAIL_BLOCKED", message, { details });
  }
}

export class ToolValidationError extends AgentError {
  readonly issues: string[];
  constructor(toolName: string, issues: string[], details: Record<string, unknown> = {}) {
    super("TOOL_VALIDATION_FAILED", `Arguments for tool "${toolName}" failed validation:\n- ${issues.join("\n- ")}`, {
      details: { toolName, issues, ...details },
    });
    this.issues = issues;
  }
}

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  riskTier: string;
  reason: string;
}

/** Thrown to interrupt a run when an action needs a human decision. Not a failure: the run is parked. */
export class ApprovalRequiredError extends AgentError {
  readonly approval: PendingApproval;
  constructor(approval: PendingApproval) {
    super("APPROVAL_REQUIRED", `Action "${approval.toolName}" paused pending human approval (${approval.reason}).`, {
      details: { ...approval },
    });
    this.approval = approval;
  }
}

export class HttpError extends AgentError {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly body: string;
  constructor(status: number, message: string, body = "", retryAfterMs?: number) {
    super("HTTP_ERROR", message, {
      details: { status, body: body.slice(0, 2000) },
      retryable: status === 408 || status === 409 || status === 425 || status === 429 || status >= 500,
    });
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }

  static async fromResponse(response: Response, context: string): Promise<HttpError> {
    const body = await response.text().catch(() => "");
    return new HttpError(response.status, `${context} failed with HTTP ${response.status}`, body, parseRetryAfter(response.headers.get("retry-after")));
  }
}

export class TimeoutError extends AgentError {
  constructor(operation: string, ms: number) {
    super("TIMEOUT", `${operation} timed out after ${ms}ms`, { details: { operation, ms }, retryable: true });
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

export function errorMessage(value: unknown): string {
  return toError(value).message;
}
