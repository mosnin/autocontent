import { type AgentStarterConfig, RISK_ORDER, type RiskTier, type TenantConfig } from "@agent-starter/core";

/** Built-in cognitive tools stay usable when `authorizedTools` restricts everything else. */
export const ALWAYS_AUTHORIZED_TOOLS = ["plan_goals", "update_goal", "transition_state", "remember_fact", "recall_entity"];

const globMatch = (pattern: string, name: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(name);

/**
 * Platform policy from agent-starter.config.ts on top of each tenant's edge config (R-OPS-14):
 *  - budget.hardCeilingUsd / budget.maxReasoningTurnsPerJob are hard ceilings
 *    (a tenant can be configured lower, never higher);
 *  - authorizedTools (when non-empty) is the tool allowlist (names or `*` globs),
 *    intersected with the tenant's own allowedTools; built-in planning/workflow/memory tools stay allowed.
 */
export function applyPlatformPolicy(tenant: TenantConfig, policy: Pick<AgentStarterConfig, "budget" | "authorizedTools">): TenantConfig {
  const out: TenantConfig = {
    ...tenant,
    maxBudgetUsd: Math.min(tenant.maxBudgetUsd, policy.budget.hardCeilingUsd),
    maxTurnsPerSession: Math.min(tenant.maxTurnsPerSession, policy.budget.maxReasoningTurnsPerJob),
  };
  if (policy.authorizedTools.length) {
    const authorized = [...policy.authorizedTools, ...ALWAYS_AUTHORIZED_TOOLS];
    out.allowedTools = tenant.allowedTools ? tenant.allowedTools.filter((name) => authorized.some((p) => globMatch(p, name))) : authorized;
  }
  return out;
}

export interface EvalRunRequest {
  tenantId: string;
  userId: string;
  mode: "live" | "shadow" | "dry-run";
}

/**
 * Who and how an eval case may run (SEC-22). The eval secret is a CI credential, not a user session, so:
 *  - mode "live" (real side effects) is refused unless the deployment opts in (`EVAL_ALLOW_LIVE=true`);
 *  - with `EVAL_TENANTS` set (comma list), cases run only in those tenants;
 *  - the acting user is namespaced (`eval:<userId>`), so a case never reads or writes a real user's
 *    memories, notes or conversations.
 */
export function evalRunPolicy(input: EvalRunRequest, env: { EVAL_ALLOW_LIVE?: string | undefined; EVAL_TENANTS?: string | undefined }): { ok: true; tenantId: string; userId: string; mode: EvalRunRequest["mode"] } | { ok: false; error: string } {
  if (input.mode === "live" && env.EVAL_ALLOW_LIVE !== "true") return { ok: false, error: "EVAL_LIVE_MODE_DISABLED: live evals run real side effects; set EVAL_ALLOW_LIVE=true on a dedicated eval deployment to allow them." };
  const tenants = (env.EVAL_TENANTS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tenants.length && !tenants.includes(input.tenantId)) return { ok: false, error: `EVAL_TENANT_NOT_ALLOWED: ${input.tenantId} is not in EVAL_TENANTS.` };
  return { ok: true, tenantId: input.tenantId, userId: input.userId.startsWith("eval:") ? input.userId : `eval:${input.userId}`, mode: input.mode };
}

/**
 * Token-bucket prefixes in AGENT_CACHE. Edge events and consumer turns use separate buckets, so one event
 * is never charged twice and a tenant gets its whole configured rate at each stage (R7).
 */
export const RATE_LIMIT_PREFIXES = { events: "rl:tenant:", turns: "rl:tenant-turns:", chat: "rl:chat:" } as const;

/** Signing-secret vars: one per purpose, each falling back to WEBHOOK_SIGNING_SECRET (SEC-24). */
export interface SigningSecretVars {
  WEBHOOK_SIGNING_SECRET?: string;
  INBOUND_WEBHOOK_SECRET?: string;
  OUTBOUND_WEBHOOK_SECRET?: string;
  TENANT_SYNC_SECRET?: string;
  ARTIFACT_SIGNING_SECRET?: string;
}

export type SigningPurpose = "inbound" | "outbound" | "tenantSync" | "artifacts";

/**
 * The secret for one purpose: "inbound" (shared fallback for signed event routes), "outbound" (WebhookRelay to
 * the SaaS: telemetry, job results, reports), "tenantSync" (SaaS → /internal/tenants/:id/config) or
 * "artifacts" (signed artifact download links, src/lib/artifacts.ts). Set the dedicated var to stop one leaked
 * secret from covering all four; unset → WEBHOOK_SIGNING_SECRET.
 */
export function signingSecret(env: SigningSecretVars, purpose: SigningPurpose): string | undefined {
  const own = { inbound: env.INBOUND_WEBHOOK_SECRET, outbound: env.OUTBOUND_WEBHOOK_SECRET, tenantSync: env.TENANT_SYNC_SECRET, artifacts: env.ARTIFACT_SIGNING_SECRET }[purpose];
  return own || env.WEBHOOK_SIGNING_SECRET || undefined;
}

/**
 * The stricter of two autonomy ceilings. An agent's own cap (e.g. the background worker's MEDIUM) never
 * loosens agent-starter.config.ts: a tighter config always wins, and a looser one is held at the agent's cap.
 */
export function stricterTier(a: RiskTier, b: RiskTier | undefined): RiskTier {
  return b !== undefined && RISK_ORDER[b] < RISK_ORDER[a] ? b : a;
}

/**
 * The limits a job or conversation actually runs with: the stricter of the platform ceilings
 * (agent-starter.config.ts budget) and the tenant's own config (already clamped by applyPlatformPolicy).
 */
export function effectiveBudget(policy: Pick<AgentStarterConfig, "budget">, tenant?: Pick<TenantConfig, "maxBudgetUsd" | "maxTurnsPerSession">): { budgetUsd: number; maxTurns: number } {
  return {
    budgetUsd: Math.min(policy.budget.hardCeilingUsd, tenant?.maxBudgetUsd ?? Number.POSITIVE_INFINITY),
    maxTurns: Math.min(policy.budget.maxReasoningTurnsPerJob, tenant?.maxTurnsPerSession ?? Number.POSITIVE_INFINITY),
  };
}

/**
 * Workers AI model id for a Flue model spec from agent-starter.config.ts (`cloudflare/@cf/...` → `@cf/...`).
 * Anything that is not a Workers AI model gives undefined (the provider's default first-line model).
 */
export function workersAiModel(spec: string | undefined): string | undefined {
  const id = (spec ?? "").trim().replace(/^cloudflare\//, "");
  return id.startsWith("@cf/") || id.startsWith("@hf/") ? id : undefined;
}
