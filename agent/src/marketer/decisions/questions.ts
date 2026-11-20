/**
 * Every decision question, option, threshold, timeout and default mode, in one versioned module.
 *
 * Judgments come from the decision model; decisions stay in code (tables.ts). Changing any question text, option,
 * threshold or timeout here means bumping DECISION_QUESTIONS_VERSION, because a tuned threshold is only valid for the
 * questions it was tuned on. The vocabulary mirrors `.intent-onboarding/packages/core/src/decisions.ts`
 * (yesno / choice / score), so onboarding, the agent Worker and the backend share one contract.
 *
 * Plan: docs/research/EVALUATION.md section 2 (decision points 1, 6, 11 and 12 live here; 7 lives in the web app).
 */

export const DECISION_QUESTIONS_VERSION = "marketer-decisions-v1";

/** OpenRouter decisions endpoint (override with OPENROUTER_DECISIONS_URL). */
export const DEFAULT_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/**
 * Pinned decision model slug (override with DECISION_MODEL). Always a dated slug, never a floating "-latest" alias:
 * a model release must not move a tuned threshold.
 */
export const DEFAULT_DECISION_MODEL = "typesafe/jev-1.13-20260917";

// ── Contract (mirrors .intent-onboarding/packages/core/src/decisions.ts) ──────────────────────────────────────────

export type DecisionQuestion =
  | { type: "yesno"; instructions: string }
  | { type: "choice"; instructions: string; options: Record<string, string | null> }
  | { type: "score"; instructions: string; levels: [string, string, ...string[]] };

export type DecisionAnswer =
  | { type: "yesno"; probability: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number };

export type DecisionAnswers<Q extends Record<string, DecisionQuestion>> = { [K in keyof Q]: DecisionAnswer };

// ── Points ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type DecisionPoint = "routing" | "approval_risk" | "memory_gate" | "autopilot";
export type DecisionMode = "off" | "shadow" | "enforce";

export interface PointConfig {
  /** Number in the plan's decision-point table (EVALUATION.md 2.3). */
  number: number;
  timeoutMs: number;
  /** Mode when a key is set and no override is configured. Every new point starts in shadow. */
  defaultMode: Exclude<DecisionMode, "off">;
  /**
   * What an enforced point does when the model fails (timeout, error, abstain): "closed" takes the tightening action
   * (a person decides / no proposal), "open" falls back to today's rule silently.
   */
  failure: "closed" | "open";
}

export const POINTS: Record<DecisionPoint, PointConfig> = {
  routing: { number: 1, timeoutMs: 800, defaultMode: "shadow", failure: "open" },
  approval_risk: { number: 6, timeoutMs: 1000, defaultMode: "shadow", failure: "closed" },
  memory_gate: { number: 11, timeoutMs: 400, defaultMode: "shadow", failure: "open" },
  autopilot: { number: 12, timeoutMs: 1500, defaultMode: "shadow", failure: "open" },
};

// ── 1. Route a request to a department ───────────────────────────────────────────────────────────────────────────

export const DEPARTMENTS = ["strategist", "content-producer", "seo-editor", "media-buyer", "distribution-manager", "analyst"] as const;
export type DepartmentId = (typeof DEPARTMENTS)[number];

export const ROUTING_QUESTIONS = {
  department: {
    type: "choice",
    instructions: "Which marketing department should handle the request in `message`?",
    options: {
      strategist: "Positioning, playbooks (audience, voice, platforms, posting windows), campaign plans, the brand kit",
      "content-producer": "Short-form videos, carousels, template remixes",
      "seo-editor": "SEO articles and repurposing articles into social posts",
      "media-buyer": "Paid ads: ad accounts, campaigns, budgets, activations",
      "distribution-manager": "Calendar, campaigns, channel connections, approving what gets posted",
      analyst: "Performance, spend in dollars, what moved and why",
    },
  },
  multi_department: { type: "yesno", instructions: "Does `message` ask for work from more than one of these departments?" },
  ad_money: { type: "yesno", instructions: "Does `message` involve spending, raising or moving ad money?" },
} as const satisfies Record<string, DecisionQuestion>;

export const ROUTING_THRESHOLDS = {
  /** Below this the frontier model plans as today (no hint). */
  minDepartmentConfidence: 0.6,
  multiDepartment: 0.5,
  adMoney: 0.5,
} as const;

/** Skill forced when a request involves ad money. */
export const PAID_MEDIA_SKILL = "paid-media-safety";

// ── 6. Approval risk scoring (tighten only) ──────────────────────────────────────────────────────────────────────

export const APPROVAL_RISK_BASE_QUESTIONS = {
  regulated_claim: { type: "yesno", instructions: "Does the content or arguments of `call` make a health, finance or legal claim?" },
  names_competitor: { type: "yesno", instructions: "Does the content or arguments of `call` name a competitor brand?" },
  verdict: {
    type: "choice",
    instructions: "Given `objective` and `call`, should this tool call run without a person looking at it?",
    options: { approve: "Routine and clearly serves the objective", escalate: "A person should decide", block: "Clearly harmful or outside the objective" },
  },
} as const satisfies Record<string, DecisionQuestion>;

/** One yes/no question per brand rule (each its own question). `brandRules` beyond the cap are ignored. */
export const MAX_BRAND_RULES = 10;
export function approvalRiskQuestions(brandRules: readonly string[] = []): Record<string, DecisionQuestion> {
  const rules = Object.fromEntries(
    brandRules.slice(0, MAX_BRAND_RULES).map((_, i) => [`brand_rule_${i}`, { type: "yesno", instructions: `Does the content of \`call\` break \`brand_rules[${i}]\`?` } satisfies DecisionQuestion]),
  );
  return { ...APPROVAL_RISK_BASE_QUESTIONS, ...rules };
}

export const APPROVAL_RISK_THRESHOLDS = {
  brandRule: 0.5,
  regulatedClaim: 0.5,
  competitor: 0.5,
  /** Gate thresholds: P(approve) at or below this escalates; anything above keeps the existing verdict. */
  escalateIfApproveAtMost: 0.1,
} as const;

// ── 11. Memory write gate ────────────────────────────────────────────────────────────────────────────────────────

export const MEMORY_GATE_QUESTIONS = {
  lasting_fact: { type: "yesno", instructions: "Does `message` state a lasting fact or preference about the brand, audience or offer?" },
} as const satisfies Record<string, DecisionQuestion>;

export const MEMORY_GATE_THRESHOLDS = { lastingFact: 0.6 } as const;

// ── 12. Autopilot: anything worth proposing? goal met? ───────────────────────────────────────────────────────────

export const AUTOPILOT_QUESTIONS = {
  inbox_waiting: { type: "yesno", instructions: "Is there an item in `inbox` that has been waiting for a person more than a day?" },
  goal_status: {
    type: "choice",
    instructions: "Given `objective`, `overview` and `facts`, what is the status of the owner's goal?",
    options: { met: "The goal is met; nothing needs doing", continue: "Work should continue", blocked: "Progress is blocked and needs a person" },
  },
} as const satisfies Record<string, DecisionQuestion>;

export const AUTOPILOT_THRESHOLDS = {
  inboxWaiting: 0.5,
  /** Hold a proposal only when the model is this sure the goal is met. */
  goalMet: 0.8,
  goalBlocked: 0.6,
  /** Spend pace (computed in code): today's spend above this share of the cap, pro rata for the hour, is over pace. */
  paceSlack: 1.0,
} as const;
