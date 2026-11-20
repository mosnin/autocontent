import type { TenantConfig, TenantSecurityContext } from "../tenancy/tenancy.ts";
import type { RiskTier } from "../tenancy/tenancy.ts";
import type { RetryPolicy } from "../reliability/retry.ts";
import type { InferOutput, StandardSchemaV1 } from "./schema.ts";

export type SideEffect = "none" | "read" | "write" | "external" | "destructive";

export interface ToolExecutionContext {
  tenant: TenantSecurityContext;
  tenantConfig: TenantConfig;
  runId: string;
  toolCallId: string;
  /** Deterministic key derived from run + call: pass it to downstream APIs (Stripe, email, DB) to dedupe retries. */
  idempotencyKey: string;
  signal: AbortSignal;
  /** "shadow" runs never perform side effects: destructive tools are intercepted and simulated. */
  mode: "live" | "shadow" | "dry-run";
  log: (level: "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => void;
  /** Durable step helper when the host provides one (Flue `step.do`, or the engine's DurableSteps). */
  step?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** Free-form host services (env bindings, clients) injected by the harness. */
  services: Record<string, unknown>;
}

export interface AgentToolDefinition<S extends StandardSchemaV1 = StandardSchemaV1, O = unknown> {
  name: string;
  description: string;
  input: S;
  /** Risk tier drives the autonomy gateway: LOW runs freely, HIGH/CRITICAL need human approval. */
  risk: RiskTier;
  sideEffect: SideEffect;
  /** Safe to retry automatically on transient failure (reads, or writes that honour idempotency keys). */
  idempotent?: boolean;
  requiresApproval?: boolean;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  /** Max characters of serialized output returned to the model (rest is truncated, head+tail kept). */
  maxOutputChars?: number;
  tags?: string[];
  /**
   * "untrusted" outputs (web pages, emails, third-party API text) are wrapped in
   * <untrusted_content> before the model sees them. Default: untrusted for
   * external/read tools, trusted for none/write.
   */
  outputTrust?: "trusted" | "untrusted";
  /** What a shadow/dry run returns instead of executing (defaults to a description of the would-be action). */
  simulate?: (args: InferOutput<S>, ctx: ToolExecutionContext) => Promise<O> | O;
  execute: (args: InferOutput<S>, ctx: ToolExecutionContext) => Promise<O> | O;
}

/** Define a tool with a contract the harness can enforce (schema, risk tier, side effects, idempotency). */
export function defineAgentTool<S extends StandardSchemaV1, O>(definition: AgentToolDefinition<S, O>): AgentToolDefinition<S, O> {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(definition.name)) {
    throw new Error(`Invalid tool name "${definition.name}" (letters, digits, _ and -, max 64 chars).`);
  }
  if (definition.sideEffect === "destructive" && definition.risk === "LOW") {
    throw new Error(`Tool "${definition.name}" is destructive and cannot be LOW risk.`);
  }
  return Object.freeze({ ...definition });
}

export type AnyAgentTool = AgentToolDefinition<StandardSchemaV1, unknown>;

export const RISK_ORDER: Record<RiskTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
