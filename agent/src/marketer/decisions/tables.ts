import {
  APPROVAL_RISK_THRESHOLDS,
  AUTOPILOT_THRESHOLDS,
  type DecisionAnswer,
  DEPARTMENTS,
  type DepartmentId,
  MEMORY_GATE_THRESHOLDS,
  PAID_MEDIA_SKILL,
  ROUTING_THRESHOLDS,
} from "./questions.ts";

/**
 * Truth tables: answers → action. Pure functions, no I/O, every row unit-tested (test/decisions.test.ts).
 * The model judges; these decide. Arithmetic (spend pace) is computed in code before a table runs.
 */

type Answers = Record<string, DecisionAnswer | undefined>;

/** P(yes) of a yes/no answer; 0 when missing (a table never reads a missing answer as a "yes"). */
export function yes(answers: Answers, name: string): number {
  const a = answers[name];
  return a?.type === "yesno" ? a.probability : 0;
}

export function choiceOf(answers: Answers, name: string): { choice: string; confidence: number; probabilities: Record<string, number> } | undefined {
  const a = answers[name];
  return a?.type === "choice" ? a : undefined;
}

// ── 1. Routing ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface RoutingAction {
  /** "hint": one department is clear enough to suggest; "frontier": the frontier model plans as today. */
  action: "hint" | "frontier";
  department: DepartmentId | null;
  /** Skill to force (paid-media-safety when the request involves ad money). */
  skill: string | null;
}

export const ROUTING_RULE: RoutingAction = { action: "frontier", department: null, skill: null };

export function routingTable(answers: Answers): RoutingAction {
  const adMoney = yes(answers, "ad_money") >= ROUTING_THRESHOLDS.adMoney;
  const multi = yes(answers, "multi_department") >= ROUTING_THRESHOLDS.multiDepartment;
  const dept = choiceOf(answers, "department");
  const skill = adMoney ? PAID_MEDIA_SKILL : null;
  const known = dept && (DEPARTMENTS as readonly string[]).includes(dept.choice);
  if (multi || !known || dept.confidence < ROUTING_THRESHOLDS.minDepartmentConfidence) return { action: "frontier", department: null, skill };
  return { action: "hint", department: dept.choice as DepartmentId, skill };
}

// ── 6. Approval risk (tighten only) ──────────────────────────────────────────────────────────────────────────────

export interface ApprovalRiskAction {
  /** "escalate": a person decides; "keep": the existing verdict (tier, reviewer) stands. Never "approve". */
  action: "escalate" | "keep";
  reasons: string[];
}

export const APPROVAL_RISK_RULE: ApprovalRiskAction = { action: "keep", reasons: [] };
export const APPROVAL_RISK_FAIL_CLOSED: ApprovalRiskAction = { action: "escalate", reasons: ["decision model unavailable"] };

export function approvalRiskTable(answers: Answers): ApprovalRiskAction {
  const reasons: string[] = [];
  for (const name of Object.keys(answers).filter((k) => k.startsWith("brand_rule_")).sort()) {
    if (yes(answers, name) >= APPROVAL_RISK_THRESHOLDS.brandRule) reasons.push(`breaks ${name.replace("brand_rule_", "brand rule ")}`);
  }
  if (yes(answers, "regulated_claim") >= APPROVAL_RISK_THRESHOLDS.regulatedClaim) reasons.push("makes a health, finance or legal claim");
  if (yes(answers, "names_competitor") >= APPROVAL_RISK_THRESHOLDS.competitor) reasons.push("names a competitor");
  const verdict = choiceOf(answers, "verdict");
  // Missing verdict reads as "no opinion" (keep), never as approval.
  if (verdict && (verdict.probabilities.approve ?? 0) <= APPROVAL_RISK_THRESHOLDS.escalateIfApproveAtMost) reasons.push(`reviewer judgment: ${verdict.choice}`);
  return reasons.length ? { action: "escalate", reasons } : { action: "keep", reasons };
}

type Verdict = "approve" | "escalate" | "block";
const STRICTNESS: Record<Verdict, number> = { approve: 0, escalate: 1, block: 2 };

/** Combine the existing verdict with the table: the result is never looser than `base`. */
export function tightenVerdict(base: Verdict, risk: ApprovalRiskAction): Verdict {
  const proposed: Verdict = risk.action === "escalate" ? "escalate" : base;
  return STRICTNESS[proposed] > STRICTNESS[base] ? proposed : base;
}

// ── 11. Memory write gate ────────────────────────────────────────────────────────────────────────────────────────

export interface MemoryGateAction {
  action: "extract" | "skip";
}

/** Today: no automatic extraction (explicit remember_note only). */
export const MEMORY_GATE_RULE: MemoryGateAction = { action: "skip" };

export function memoryGateTable(answers: Answers): MemoryGateAction {
  return { action: yes(answers, "lasting_fact") >= MEMORY_GATE_THRESHOLDS.lastingFact ? "extract" : "skip" };
}

// ── 12. Autopilot ────────────────────────────────────────────────────────────────────────────────────────────────

export interface AutopilotFacts {
  /** Computed in code: today's spend is above the pace for the daily cap. */
  overPace: boolean;
}

export interface AutopilotAction {
  /** "proceed": today's heartbeat behaviour; "hold": nothing worth proposing this tick (never adds a proposal). */
  action: "proceed" | "hold";
  reason: string;
}

export const AUTOPILOT_RULE: AutopilotAction = { action: "proceed", reason: "heartbeat checklist" };

export function autopilotTable(answers: Answers, facts: AutopilotFacts): AutopilotAction {
  if (facts.overPace) return { action: "proceed", reason: "spend above pace" };
  if (yes(answers, "inbox_waiting") >= AUTOPILOT_THRESHOLDS.inboxWaiting) return { action: "proceed", reason: "inbox item waiting more than a day" };
  const goal = choiceOf(answers, "goal_status");
  if (goal?.choice === "blocked" && goal.confidence >= AUTOPILOT_THRESHOLDS.goalBlocked) return { action: "proceed", reason: "goal blocked: a person is needed" };
  if (goal?.choice === "met" && goal.confidence >= AUTOPILOT_THRESHOLDS.goalMet) return { action: "hold", reason: "goal met: nothing worth proposing" };
  return { action: "proceed", reason: "goal continues" };
}

/**
 * Spend pace, in code: is `spentUsd` above the cap pro rata for the time of day? `hour` is 0-23 in the account's
 * time zone. No cap (0 or missing) is never over pace.
 */
export function overSpendPace(spentUsd: number, dailyCapUsd: number | undefined, hour: number): boolean {
  if (!dailyCapUsd || dailyCapUsd <= 0 || !Number.isFinite(spentUsd)) return false;
  const elapsed = Math.min(24, Math.max(1, Math.floor(hour) + 1)) / 24;
  return spentUsd > dailyCapUsd * elapsed * AUTOPILOT_THRESHOLDS.paceSlack;
}
