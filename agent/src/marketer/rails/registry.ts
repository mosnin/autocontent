import type { RiskTier } from "@agent-starter/core";

/**
 * The reviewed rails table for every HIGH and CRITICAL Marketer tool (docs/rails/risk-tiers.md).
 *
 * `writeTool` refuses to define a HIGH/CRITICAL tool that is missing here, and the agent enforcement point
 * (`enforce.ts`) re-reads this entry at dispatch. Each entry names the backend action the tool reaches
 * (`src/marketer/rails/actions.py`, checked by `tests/test_rails_core.py`), the kill-switch scopes that stop it,
 * whether it only reduces exposure (pausing, rejecting: never blocked), and argument caps that hold even if a
 * schema is loosened later. Every entry names a real backend action today; `backendAction: "none"` would mark an
 * endpoint outside the backend rails (the agent side would still enforce it).
 *
 * Changing an entry is a risk decision: change `EXPECTED_RISK` in test/marketer-tools.test.ts and the backend
 * registry with it.
 */

export type KillScope = "publish" | "spend";
export type RailsTier = Extract<RiskTier, "HIGH" | "CRITICAL">;

export interface RailsToolEntry {
  tier: RailsTier;
  backendAction: string;
  scopes: readonly KillScope[];
  /** True (or true for these args) when the call only makes things safer. */
  reducesExposure?: boolean | ((args: Record<string, unknown>) => boolean);
  /** A reason to refuse, or null. Arithmetic stays in code, never in a model. */
  caps?: (args: Record<string, unknown>) => string | null;
}

/** Mirrors MAX_DAILY_BUDGET_USD in tools/ads.ts (kept here so the rails do not import the tools they guard). */
export const RAILS_MAX_DAILY_BUDGET_USD = 1_000;

const dailyBudgetCap = (args: Record<string, unknown>): string | null => {
  const value = args.dailyBudgetUsd;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "dailyBudgetUsd must be a non-negative number";
  return value > RAILS_MAX_DAILY_BUDGET_USD ? `dailyBudgetUsd ${value} is above the agent ceiling of ${RAILS_MAX_DAILY_BUDGET_USD}` : null;
};

export const RAILS_TOOLS: Readonly<Record<string, RailsToolEntry>> = Object.freeze({
  // workspace: approving publishes, rejecting discards (backend: content.{video,carousel}.{approve,reject})
  decide_inbox_item: { tier: "HIGH", backendAction: "content.video.approve", scopes: ["publish"], reducesExposure: (a) => a.decision === "reject" },
  // strategy
  // backend: playbook.spend_cap.raise. The tool cannot tell a raise from a lower without the current cap, so it is
  // reviewed as the raise (kill-switch scope "spend"); the backend classifies the actual change itself.
  set_playbook_spend_cap: { tier: "HIGH", backendAction: "playbook.spend_cap.raise", scopes: ["spend"] },
  update_brand_kit: { tier: "HIGH", backendAction: "brand_kit.update", scopes: [] },
  // distribution
  start_campaign: { tier: "HIGH", backendAction: "campaigns.start", scopes: ["publish", "spend"] },
  approve_video: { tier: "HIGH", backendAction: "content.video.approve", scopes: ["publish"] },
  reject_video: { tier: "HIGH", backendAction: "content.video.reject", scopes: [], reducesExposure: true },
  approve_carousel: { tier: "HIGH", backendAction: "content.carousel.approve", scopes: ["publish"] },
  // paid media
  pause_ad_campaign: { tier: "HIGH", backendAction: "ads.campaign.pause", scopes: ["spend"], reducesExposure: true },
  set_ad_budget: { tier: "CRITICAL", backendAction: "ads.budget.change", scopes: ["spend"], caps: dailyBudgetCap },
  activate_ad_campaign: { tier: "CRITICAL", backendAction: "ads.campaign.activate", scopes: ["spend"], caps: dailyBudgetCap },
  decide_ad_approval: { tier: "CRITICAL", backendAction: "ads.approval.execute", scopes: ["spend"], reducesExposure: (a) => a.decision === "rejected" },
});

export function railsEntry(tool: string): RailsToolEntry | undefined {
  return Object.prototype.hasOwnProperty.call(RAILS_TOOLS, tool) ? RAILS_TOOLS[tool] : undefined;
}
