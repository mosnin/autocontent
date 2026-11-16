import type { RiskTier, TenantConfig } from "../tenancy/tenancy.ts";
import { RISK_ORDER, type SideEffect } from "../tools/define.ts";

export type AutonomyDecision =
  | { action: "allow"; reason: string }
  | { action: "require_approval"; reason: "LOW_MODEL_CONFIDENCE_INTERCEPT" | "EXPLICIT_HIGH_RISK_GATEWAY_TRIGGERED" | "ABOVE_TENANT_AUTONOMY_CEILING" | "TOOL_REQUIRES_CONSENT" }
  | { action: "deny"; reason: string };

export interface ToolRiskProfile {
  name: string;
  tier: RiskTier;
  sideEffect: SideEffect;
  requiresApproval?: boolean;
}

export interface AutonomyPolicy {
  /** Confidence below this downgrades autonomy for any non-LOW tool. Default 0.85. */
  confidenceThreshold: number;
  /** Highest tier the agent may execute without a human. Default MEDIUM. */
  maxAutonomousTier: RiskTier;
  /** Tools that may run autonomously even above the ceiling (explicit, audited exceptions). */
  autonomousAllowlist: string[];
  /** Tools never allowed, even with approval. */
  forbidden: string[];
}

export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  confidenceThreshold: 0.85,
  maxAutonomousTier: "MEDIUM",
  autonomousAllowlist: [],
  forbidden: [],
};

/**
 * Graduated delegation / adjustable autonomy. Reading is LOW, patching code is
 * MEDIUM, charging a card or messaging customers is HIGH, irreversible
 * destruction is CRITICAL. Low confidence or high risk parks the run for a human.
 */
export class AutonomyGateway {
  readonly policy: AutonomyPolicy;

  constructor(policy: Partial<AutonomyPolicy> = {}) {
    this.policy = { ...DEFAULT_AUTONOMY_POLICY, ...policy };
  }

  forTenant(config: TenantConfig): AutonomyGateway {
    return new AutonomyGateway({
      ...this.policy,
      confidenceThreshold: Math.max(this.policy.confidenceThreshold, config.autonomy.confidenceThreshold),
      maxAutonomousTier: RISK_ORDER[config.autonomy.maxAutonomousTier] < RISK_ORDER[this.policy.maxAutonomousTier] ? config.autonomy.maxAutonomousTier : this.policy.maxAutonomousTier,
    });
  }

  evaluate(profile: ToolRiskProfile, confidence = 1): AutonomyDecision {
    if (this.policy.forbidden.includes(profile.name)) return { action: "deny", reason: `Tool "${profile.name}" is forbidden by autonomy policy.` };
    if (profile.tier === "CRITICAL") return { action: "require_approval", reason: "EXPLICIT_HIGH_RISK_GATEWAY_TRIGGERED" };
    if (profile.requiresApproval) return { action: "require_approval", reason: "TOOL_REQUIRES_CONSENT" };
    if (profile.tier !== "LOW" && confidence < this.policy.confidenceThreshold) return { action: "require_approval", reason: "LOW_MODEL_CONFIDENCE_INTERCEPT" };
    if (this.policy.autonomousAllowlist.includes(profile.name)) return { action: "allow", reason: "allowlisted" };
    if (profile.tier === "HIGH") return { action: "require_approval", reason: "EXPLICIT_HIGH_RISK_GATEWAY_TRIGGERED" };
    if (RISK_ORDER[profile.tier] > RISK_ORDER[this.policy.maxAutonomousTier]) return { action: "require_approval", reason: "ABOVE_TENANT_AUTONOMY_CEILING" };
    return { action: "allow", reason: `tier ${profile.tier} within autonomy ceiling ${this.policy.maxAutonomousTier}` };
  }
}
