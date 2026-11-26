import { type ApprovalLinks, type ApprovalRecord, type ApprovalStore, approvalArgsHash } from "../autonomy/approvals.ts";
import { AutonomyGateway } from "../autonomy/gateway.ts";
import type { BudgetGuard } from "../budget/budget.ts";
import { AgentError, BudgetExceededError, errorMessage, HttpError, TenantIsolationError } from "../errors.ts";
import { wrapUntrusted } from "../guardrails/injection.ts";
import { redactDeep, redactSensitive } from "../guardrails/pii.ts";
import type { TelemetryEmitter } from "../observability/telemetry.ts";
import { type Span, SpanAttr, type Tracer } from "../observability/tracer.ts";
import { retry, withTimeout } from "../reliability/retry.ts";
import { assertPayloadTenant } from "../tenancy/tenancy.ts";
import { randomId } from "../util/crypto.ts";
import { truncateMiddle } from "../util/text.ts";
import type { AnyAgentTool, ToolExecutionContext } from "./define.ts";
import type { ToolFirewall } from "./firewall.ts";
import { ArgumentHealer } from "./healer.ts";
import { deriveIdempotencyKey, type IdempotencyStore } from "./idempotency.ts";
import { toJsonSchema } from "./schema.ts";

export type ToolOutcome =
  | { status: "ok"; output: unknown; text: string; durationMs: number; cached: boolean }
  | { status: "simulated"; output: unknown; text: string }
  | { status: "approval_required"; approval: { approvalId: string; reason: string; riskTier: string; links?: ApprovalLinks }; text: string }
  | { status: "denied"; reason: string; text: string }
  | { status: "budget_exceeded"; reason: string; text: string }
  | { status: "invalid_arguments"; issues: string[]; text: string }
  | { status: "error"; code: string; message: string; retryable: boolean; text: string };

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Raw JSON text from the model or an already-parsed object. */
  arguments: string | unknown;
}

export type ToolCallContext = Omit<ToolExecutionContext, "idempotencyKey" | "toolCallId"> & {
  /** Model confidence for this action in [0, 1]; drives the autonomy gateway. */
  confidence?: number;
};

export interface AuditEntry {
  runId: string;
  tenantId: string;
  actor: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

export interface ToolExecutorOptions {
  tools: AnyAgentTool[];
  firewall?: ToolFirewall;
  healer?: ArgumentHealer;
  gateway?: AutonomyGateway;
  approvals?: ApprovalStore;
  budget?: BudgetGuard;
  idempotency?: IdempotencyStore;
  tracer?: Tracer;
  parentSpan?: Span;
  telemetry?: TelemetryEmitter;
  /** Redact secrets/PII from tool output before the model sees it. */
  redactOutputs?: boolean;
  audit?: (entry: AuditEntry) => void;
  onApprovalRequested?: (record: ApprovalRecord, links: ApprovalLinks) => Promise<void>;
  defaultTimeoutMs?: number;
  defaultMaxOutputChars?: number;
  /**
   * Execution-time policy hook (e.g. FSM state gating, business rules). Runs after
   * the firewall; a denial is final for this call. Visibility filtering alone is
   * not enough — a model can still emit a call to a hidden tool.
   */
  policy?: (toolName: string, args: unknown) => { allowed: boolean; reason?: string };
  /**
   * Model-based safeguard (persistent agents): reviews each call that is not already human-approved, after the
   * autonomy gateway's deny check and before approval or execution. `block` denies the call, `escalate` sends it
   * to the human approval flow, `approve` lets it continue (HIGH/CRITICAL and approval-required tools still need a
   * human). The hook must fail closed (escalate) itself; a throw here is also treated as `escalate`.
   */
  review?: (input: { tool: AnyAgentTool; args: unknown; call: ToolCallRequest; context: ToolCallContext }) => Promise<{ decision: "approve" | "block" | "escalate"; reason: string }>;
}

/**
 * The single choke point every tool call passes through, in order:
 * lookup → heal + validate → firewall (lists, quotas, argument rules) → policy
 * hook → tenant isolation → budget → autonomy / approvals → shadow
 * interception → idempotency → timeout + retry → output redaction + untrusted
 * wrapping → audit + telemetry.
 *
 * The model never reaches a SaaS endpoint without clearing this schema layer.
 */
export class ToolExecutor {
  private readonly tools: Map<string, AnyAgentTool>;
  private readonly healer: ArgumentHealer;
  private readonly gateway: AutonomyGateway;

  constructor(private readonly options: ToolExecutorOptions) {
    this.tools = new Map(options.tools.map((t) => [t.name, t]));
    this.healer = options.healer ?? new ArgumentHealer();
    this.gateway = options.gateway ?? new AutonomyGateway();
  }

  list(): AnyAgentTool[] {
    return [...this.tools.values()];
  }

  get(name: string): AnyAgentTool | undefined {
    return this.tools.get(name);
  }

  /** JSON-schema tool specs for the model, filtered through the firewall. */
  specs(tenantConfig?: ToolExecutionContext["tenantConfig"]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    const visible = this.options.firewall ? this.options.firewall.visible(this.list(), tenantConfig) : this.list();
    return visible.map((tool) => ({ name: tool.name, description: describeTool(tool), parameters: toJsonSchema(tool.input) }));
  }

  async execute(request: ToolCallRequest, context: ToolCallContext): Promise<ToolOutcome> {
    // Providers that omit or repeat empty tool-call ids must never share approvals or idempotency keys (SEC-10).
    const call: ToolCallRequest = typeof request.id === "string" && request.id.trim() ? request : { ...request, id: randomId("call") };
    const span = this.options.tracer?.startSpan(`tool:${call.name}`, {
      kind: "tool",
      ...(this.options.parentSpan ? { parent: this.options.parentSpan } : {}),
      attributes: { [SpanAttr.toolName]: call.name, [SpanAttr.toolArgs]: call.arguments, [SpanAttr.tenantId]: context.tenant.tenantId, [SpanAttr.runId]: context.runId },
    });
    const outcome = await this.run(call, context).catch((error: unknown): ToolOutcome => {
      const err = error instanceof AgentError ? error : new AgentError("TOOL_EXECUTION_FAILED", errorMessage(error), { cause: error });
      return { status: "error", code: err.code, message: err.message, retryable: err.retryable, text: JSON.stringify({ error: err.code, message: err.message }) };
    });
    span?.setAttribute(SpanAttr.toolResult, outcome.text);
    span?.setAttribute("tool.status", outcome.status);
    if (outcome.status === "error") span?.end("error", outcome.message);
    else span?.end("ok");
    this.options.audit?.({
      runId: context.runId,
      tenantId: context.tenant.tenantId,
      actor: context.tenant.userId,
      action: `tool.${outcome.status}`,
      target: call.name,
      detail: { toolCallId: call.id, mode: context.mode },
    });
    await this.options.telemetry?.emit({
      type: outcome.status === "approval_required" ? "approval" : "tool",
      content: summarizeOutcome(call.name, outcome),
      logType: outcome.status === "ok" || outcome.status === "simulated" ? "success" : outcome.status === "approval_required" ? "warning" : "error",
      ...(outcome.status === "approval_required" ? { status: "PENDING_APPROVAL" as const } : {}),
      data: {
        tool: call.name,
        toolCallId: call.id,
        status: outcome.status === "approval_required" ? "PENDING_APPROVAL" : outcome.status,
        ...(outcome.status === "approval_required"
          ? {
              outcome: outcome.status,
              approvalId: outcome.approval.approvalId,
              // With approvalId, enough for an operator to decide by id: POST /approvals/by-id/:conversationId/:approvalId (contract 3).
              conversationId: context.runId,
              reason: outcome.approval.reason,
              riskTier: outcome.approval.riskTier,
              args: maskArgs(call.arguments),
            }
          : {}),
      },
    });
    return outcome;
  }

  private async run(call: ToolCallRequest, context: ToolCallContext): Promise<ToolOutcome> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { status: "denied", reason: `Unknown tool "${call.name}"`, text: JSON.stringify({ error: "TOOL_NOT_FOUND", available: [...this.tools.keys()] }) };
    }

    // Heal + validate before anything sees the arguments.
    let args: unknown;
    try {
      args = (await this.healer.heal(tool.name, call.arguments, tool.input)).value;
    } catch (error) {
      const issues = error instanceof AgentError && Array.isArray(error.details.issues) ? (error.details.issues as string[]) : [errorMessage(error)];
      return { status: "invalid_arguments", issues, text: JSON.stringify({ error: "TOOL_VALIDATION_FAILED", issues, hint: "Fix the arguments to match the tool schema and call it again." }) };
    }

    const firewall = this.options.firewall?.evaluate(tool.name, args, context.tenantConfig);
    if (firewall && !firewall.allowed) {
      return { status: "denied", reason: firewall.reason ?? "denied", text: JSON.stringify({ error: "TOOL_NOT_ALLOWED", reason: firewall.reason }) };
    }
    // Hold the quota slot synchronously (no await since evaluate) so a parallel batch cannot overshoot.
    const release = this.options.firewall?.reserve(tool.name) ?? (() => {});
    try {
      return await this.guarded(tool, call, args, context);
    } finally {
      release();
    }
  }

  private async guarded(tool: AnyAgentTool, call: ToolCallRequest, args: unknown, context: ToolCallContext): Promise<ToolOutcome> {
    const policy = this.options.policy?.(tool.name, args);
    if (policy && !policy.allowed) {
      return { status: "denied", reason: policy.reason ?? "denied by policy", text: JSON.stringify({ error: "TOOL_NOT_ALLOWED", reason: policy.reason ?? "denied by policy" }) };
    }

    try {
      assertPayloadTenant(args, context.tenant.tenantId);
    } catch (error) {
      if (error instanceof TenantIsolationError) {
        return { status: "denied", reason: error.message, text: JSON.stringify({ error: "ERROR_UNAUTHORIZED_TENANT", message: error.message }) };
      }
      throw error;
    }

    if (this.options.budget) {
      try {
        await this.options.budget.check();
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { status: "budget_exceeded", reason: error.message, text: JSON.stringify({ error: "BUDGET_LIMIT_EXCEEDED", message: error.message }) };
        }
        throw error;
      }
    }

    const approval = await this.authorize(tool, call, args, context);
    if (approval) return approval;

    const isMutating = tool.sideEffect === "write" || tool.sideEffect === "external" || tool.sideEffect === "destructive";
    if (context.mode !== "live" && isMutating) {
      const simulatedCtx = await this.buildContext(tool, call, args, context);
      const output = tool.simulate ? await tool.simulate(args, simulatedCtx) : { simulated: true, wouldHaveExecuted: { tool: tool.name, args } };
      this.options.firewall?.record(tool.name);
      return { status: "simulated", output, text: this.render(tool, output) };
    }

    const ctx = await this.buildContext(tool, call, args, context);
    const started = Date.now();

    if (isMutating && !ctx.step && this.options.idempotency) {
      const existing = await this.options.idempotency.get(ctx.idempotencyKey);
      if (existing?.status === "COMPLETED") {
        return { status: "ok", output: existing.result, text: this.render(tool, existing.result), durationMs: 0, cached: true };
      }
      if ((existing?.status === "STARTED" || existing?.status === "UNKNOWN") && !tool.idempotent) {
        return {
          status: "error",
          code: "UNKNOWN_OUTCOME",
          message: `A previous attempt of "${tool.name}" was interrupted mid-flight; its outcome is unknown. Verify the external state before retrying.`,
          retryable: false,
          text: JSON.stringify({ error: "UNKNOWN_OUTCOME", tool: tool.name, idempotencyKey: ctx.idempotencyKey }),
        };
      }
      await this.options.idempotency.start(ctx.idempotencyKey, { runId: context.runId, tool: tool.name });
    }

    const canRetry = tool.idempotent === true || tool.sideEffect === "none" || tool.sideEffect === "read";
    const invoke = () =>
      retry(
        () => withTimeout(`tool ${tool.name}`, tool.timeoutMs ?? this.options.defaultTimeoutMs ?? 60_000, (signal) => Promise.resolve(tool.execute(args, { ...ctx, signal })), context.signal),
        canRetry ? { maxAttempts: 3, ...tool.retry } : { maxAttempts: 1 },
        { signal: context.signal, onRetry: ({ attempt, error }) => ctx.log("warn", `retrying ${tool.name} (attempt ${attempt + 1})`, { error: errorMessage(error) }) },
      );

    try {
      const output = ctx.step && isMutating ? await ctx.step(`tool:${tool.name}`, invoke) : await invoke();
      if (isMutating && !ctx.step) await this.options.idempotency?.complete(ctx.idempotencyKey, output);
      this.options.firewall?.record(tool.name);
      this.options.budget?.recordToolCall();
      return { status: "ok", output, text: this.render(tool, output), durationMs: Date.now() - started, cached: false };
    } catch (error) {
      if (isMutating && !ctx.step && this.options.idempotency) {
        // A timeout or transport failure may have happened after the side effect landed: a non-idempotent
        // replay of this exact call must report UNKNOWN_OUTCOME, not execute again (R18).
        const store = this.options.idempotency;
        if (tool.idempotent !== true && !isDefiniteFailure(error) && store.unknown) await store.unknown(ctx.idempotencyKey, errorMessage(error));
        else await store.fail(ctx.idempotencyKey, errorMessage(error));
      }
      this.options.firewall?.record(tool.name);
      throw error;
    }
  }

  private async authorize(tool: AnyAgentTool, call: ToolCallRequest, args: unknown, context: ToolCallContext): Promise<ToolOutcome | null> {
    const store = this.options.approvals;
    // An approval authorises exactly one call: same id, same tool, same arguments (SEC-10).
    const prior = store ? store.findMatching(context.runId, call.id, tool.name, await approvalArgsHash(args)) : null;
    if (prior?.status === "APPROVED") return null;
    if (prior?.status === "REJECTED" || prior?.status === "EXPIRED") {
      return { status: "denied", reason: `Human ${prior.status === "REJECTED" ? "rejected" : "did not approve"} "${tool.name}"`, text: JSON.stringify({ error: "APPROVAL_REJECTED", status: prior.status, note: prior.decisionNote ? wrapUntrusted(prior.decisionNote, "approval-note") : null }) };
    }
    const decision = this.gateway.forTenant(context.tenantConfig).evaluate({ name: tool.name, tier: tool.risk, sideEffect: tool.sideEffect, ...(tool.requiresApproval ? { requiresApproval: true } : {}) }, context.confidence ?? 1);
    if (decision.action === "allow" && !this.options.review) return null;
    if (decision.action === "deny") return { status: "denied", reason: decision.reason, text: JSON.stringify({ error: "TOOL_NOT_ALLOWED", reason: decision.reason }) };
    if (prior?.status === "PENDING_APPROVAL" && store) {
      return { status: "approval_required", approval: { approvalId: prior.id, reason: prior.reason, riskTier: prior.riskTier }, text: pendingText(tool.name, prior.id) };
    }
    let reason: string = decision.action === "require_approval" ? decision.reason : "";
    if (this.options.review) {
      const verdict = await this.options.review({ tool, args, call, context }).catch((error: unknown) => ({ decision: "escalate" as const, reason: `reviewer failed: ${errorMessage(error)}` }));
      if (verdict.decision === "block") {
        return { status: "denied", reason: `AUTO_REVIEW_BLOCKED: ${verdict.reason}`, text: JSON.stringify({ error: "AUTO_REVIEW_BLOCKED", reason: verdict.reason, hint: "The safety reviewer blocked this call. Do not retry it; choose a different approach or stop." }) };
      }
      if (verdict.decision === "escalate") reason = `AUTO_REVIEW_ESCALATED: ${verdict.reason}`.slice(0, 500);
      else if (decision.action === "allow") return null;
    } else if (decision.action === "allow") return null;
    return this.requestApproval(tool, call, args, context, reason || "AUTO_REVIEW_ESCALATED");
  }

  private async requestApproval(tool: AnyAgentTool, call: ToolCallRequest, args: unknown, context: ToolCallContext, reason: string): Promise<ToolOutcome> {
    const store = this.options.approvals;
    const decision = { reason };
    if (!store) {
      const approvalId = `apr_${call.id}`;
      return { status: "approval_required", approval: { approvalId, reason: decision.reason, riskTier: tool.risk }, text: pendingText(tool.name, approvalId) };
    }
    const { record, links } = await store.create({ runId: context.runId, tenantId: context.tenant.tenantId, tool: tool.name, toolCallId: call.id, args, riskTier: tool.risk, reason: decision.reason });
    await this.options.onApprovalRequested?.(record, links);
    return { status: "approval_required", approval: { approvalId: record.id, reason: decision.reason, riskTier: tool.risk, links }, text: pendingText(tool.name, record.id) };
  }

  private async buildContext(tool: AnyAgentTool, call: ToolCallRequest, args: unknown, context: ToolCallContext): Promise<ToolExecutionContext> {
    const { confidence: _confidence, ...rest } = context;
    return {
      ...rest,
      toolCallId: call.id || randomId("call"),
      idempotencyKey: await deriveIdempotencyKey({ runId: context.runId, step: call.id, tool: tool.name, args }),
    };
  }

  private render(tool: AnyAgentTool, output: unknown): string {
    let text = typeof output === "string" ? output : JSON.stringify(output ?? null);
    if (this.options.redactOutputs !== false) text = redactSensitive(text, { kinds: ["api_key", "jwt", "private_key", "credit_card", "ssn"] }).text;
    text = truncateMiddle(text, tool.maxOutputChars ?? this.options.defaultMaxOutputChars ?? 12_000);
    const trust = tool.outputTrust ?? (tool.sideEffect === "external" || tool.sideEffect === "read" ? "untrusted" : "trusted");
    return trust === "untrusted" ? wrapUntrusted(text, `tool:${tool.name}`) : text;
  }
}

/**
 * A failure that proves the side effect did NOT happen: a typed, non-retryable
 * refusal (`AgentError` other than a timeout) or an HTTP 4xx rejection.
 * Timeouts, aborts, network errors and 5xx responses are ambiguous.
 */
export function isDefiniteFailure(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 400 && error.status < 500 && !error.retryable;
  if (error instanceof AgentError) return !error.retryable && error.code !== "TIMEOUT";
  return false;
}

/** Arguments as shown on approval cards and telemetry: parsed, secrets/cards/SSNs masked, long strings clipped. */
export function maskArgs(raw: unknown): unknown {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      value = raw;
    }
  }
  const clip = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
    if (depth > 6) return "[…]";
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => clip(x, depth + 1));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 50).map(([k, x]) => [k, clip(x, depth + 1)]));
    return v;
  };
  return clip(redactDeep(value, { kinds: ["api_key", "jwt", "private_key", "credit_card", "ssn"] }), 0);
}

function pendingText(tool: string, approvalId: string): string {
  return JSON.stringify({
    status: "PENDING_APPROVAL",
    approvalId,
    message: `"${tool}" requires human approval. Do not retry it; tell the user it is awaiting approval and continue with other safe work or stop.`,
  });
}

function describeTool(tool: AnyAgentTool): string {
  const risk = tool.risk === "LOW" ? "" : ` [risk: ${tool.risk}${tool.risk === "HIGH" || tool.risk === "CRITICAL" ? ", requires human approval" : ""}]`;
  return `${tool.description}${risk}`;
}

function summarizeOutcome(name: string, outcome: ToolOutcome): string {
  switch (outcome.status) {
    case "ok":
      return `${name} succeeded${outcome.cached ? " (idempotent replay)" : ""} in ${outcome.durationMs}ms`;
    case "simulated":
      return `${name} simulated (shadow mode)`;
    case "approval_required":
      return `${name} paused pending human approval (${outcome.approval.reason})`;
    case "denied":
      return `${name} denied: ${outcome.reason}`;
    case "budget_exceeded":
      return `${name} blocked: ${outcome.reason}`;
    case "invalid_arguments":
      return `${name} invalid arguments: ${outcome.issues.join("; ")}`;
    case "error":
      return `${name} failed: ${outcome.message}`;
  }
}

/**
 * Tool masking: expose only the tools relevant to the current task (saves tokens and reduces mis-selection).
 * `alwaysInclude` tools (safety, planning) are kept on top of the `maxTools` most relevant others.
 */
export function maskTools<T extends { name: string; description: string; tags?: string[] }>(
  tools: T[],
  query: string,
  options: { maxTools?: number; alwaysInclude?: string[] } = {},
): T[] {
  const max = options.maxTools ?? 8;
  const always = new Set(options.alwaysInclude ?? []);
  const others = tools.filter((tool) => !always.has(tool.name));
  if (others.length <= max) return tools;
  const words = new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const chosen = new Set(
    others
      .map((tool, index) => {
        const haystack = `${tool.name.replace(/[_-]/g, " ")} ${tool.description} ${(tool.tags ?? []).join(" ")}`.toLowerCase();
        let score = 0;
        for (const word of words) if (haystack.includes(word)) score += word.length > 5 ? 2 : 1;
        return { tool, score, index };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, max)
      .map((s) => s.tool.name),
  );
  return tools.filter((tool) => always.has(tool.name) || chosen.has(tool.name));
}
