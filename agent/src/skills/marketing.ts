import { type SkillReference, useInstruction, useSkill } from "@flue/runtime";
import type { Department } from "../marketer/tools/index.ts";
import adTestPlan from "./ad-test-plan/SKILL.md";
import auditSite from "./audit-site/SKILL.md";
import brandVoice from "./brand-voice/SKILL.md";
import brief from "./brief/SKILL.md";
import budgetGuard from "./budget-guard/SKILL.md";
import calendarFill from "./calendar-fill/SKILL.md";
import commentTriage from "./comment-triage/SKILL.md";
import competitorWatch from "./competitor-watch/SKILL.md";
import contentBatch from "./content-batch/SKILL.md";
import creativeReview from "./creative-review/SKILL.md";
import hookLab from "./hook-lab/SKILL.md";
import launch from "./launch/SKILL.md";
import learn from "./learn/SKILL.md";
import planCampaign from "./plan-campaign/SKILL.md";
import positioningReview from "./positioning-review/SKILL.md";
import report from "./report/SKILL.md";
import repurpose from "./repurpose/SKILL.md";
import retro from "./retro/SKILL.md";
import scaleWinner from "./scale-winner/SKILL.md";
import seoBrief from "./seo-brief/SKILL.md";

/**
 * Marketer's marketing skills pack (docs/skills/README.md): 20 runtime skills, each a `SKILL.md` an agent activates
 * on demand. A skill is a procedure, never a permission: mounting one adds no tool and changes no risk tier,
 * approval, cap or rail. What an agent can do is still decided by its own tools and the guarded tool pipeline.
 *
 * `owner` is the agent that runs the skill with its own tools: one of the six departments, or "marketer" for
 * skills the lead runs itself (it reads and delegates). The leads (Marketer and the orchestrator) also mount every
 * department skill so they can recognise a request (or a slash command) and hand it to the owner with
 * `delegate_task`. test/skills.test.ts checks that every tool a skill lists in `allowed-tools` is one its owner holds.
 */
export type SkillOwner = Department | "marketer";

/** Who mounts skills: a department (its own skills) or a lead (all of them). */
export type SkillAgent = Department | "marketer" | "orchestrator";

export interface MarketingSkill {
  /** Skill name = directory under src/skills = the slash command without the slash. */
  name: string;
  skill: SkillReference;
  owner: SkillOwner;
  /** The role the skill plays (gstack-style persona). */
  role: string;
  /** The artifact it produces. */
  produces: string;
}

export const MARKETING_SKILLS: readonly MarketingSkill[] = [
  { name: "brief", skill: brief, owner: "marketer", role: "Head of marketing", produces: "Marketing Brief" },
  { name: "positioning-review", skill: positioningReview, owner: "strategist", role: "CMO", produces: "Positioning review with proposed brief edits" },
  { name: "plan-campaign", skill: planCampaign, owner: "marketer", role: "Strategist", produces: "Campaign plan" },
  { name: "brand-voice", skill: brandVoice, owner: "strategist", role: "Brand designer", produces: "Brand kit proposal" },
  { name: "hook-lab", skill: hookLab, owner: "content-producer", role: "Creative director", produces: "Ranked hook shortlist" },
  { name: "content-batch", skill: contentBatch, owner: "content-producer", role: "Content producer", produces: "Content batch report" },
  { name: "seo-brief", skill: seoBrief, owner: "seo-editor", role: "SEO editor", produces: "Article brief" },
  { name: "repurpose", skill: repurpose, owner: "seo-editor", role: "SEO editor", produces: "Verified post drafts per channel" },
  { name: "calendar-fill", skill: calendarFill, owner: "distribution-manager", role: "Distribution manager", produces: "Calendar proposal" },
  { name: "creative-review", skill: creativeReview, owner: "content-producer", role: "Design reviewer", produces: "Creative review scorecard" },
  { name: "ad-test-plan", skill: adTestPlan, owner: "media-buyer", role: "Media buyer", produces: "Pre-registered ad test plan" },
  { name: "scale-winner", skill: scaleWinner, owner: "media-buyer", role: "Media buyer", produces: "Budget change proposal" },
  { name: "budget-guard", skill: budgetGuard, owner: "marketer", role: "Spend warden", produces: "Spend freeze report" },
  { name: "launch", skill: launch, owner: "marketer", role: "Launch manager", produces: "Launch readiness checklist" },
  { name: "comment-triage", skill: commentTriage, owner: "analyst", role: "Community manager", produces: "Triage list with reply drafts" },
  { name: "competitor-watch", skill: competitorWatch, owner: "marketer", role: "Analyst", produces: "Competitor change log" },
  { name: "audit-site", skill: auditSite, owner: "marketer", role: "SEO auditor", produces: "Ranked site fix list" },
  { name: "retro", skill: retro, owner: "analyst", role: "Analyst", produces: "Retro and new Learnings" },
  { name: "learn", skill: learn, owner: "marketer", role: "Memory keeper", produces: "Memory review" },
  { name: "report", skill: report, owner: "analyst", role: "Reporter", produces: "Stakeholder report" },
];

const isLead = (agent: SkillAgent): agent is "marketer" | "orchestrator" => agent === "marketer" || agent === "orchestrator";

/** The skills an agent mounts: a lead gets the whole pack, a department only the skills it owns. */
export function marketingSkillsFor(agent: SkillAgent): readonly MarketingSkill[] {
  return isLead(agent) ? MARKETING_SKILLS : MARKETING_SKILLS.filter((entry) => entry.owner === agent);
}

/**
 * One instruction line for the leads: how a slash command maps to a skill and who runs it. It restates that a skill
 * is not an approval, so a typed command can never be read as consent to publish or spend.
 */
export function slashCommandInstruction(): string {
  const departments = MARKETING_SKILLS.filter((entry) => entry.owner !== "marketer").map((entry) => `/${entry.name} → ${entry.owner}`);
  const own = MARKETING_SKILLS.filter((entry) => entry.owner === "marketer").map((entry) => `/${entry.name}`);
  return `Marketing skills: when a message starts with a slash command, or asks for what a skill describes, activate that skill and follow it. You run ${own.join(", ")} yourself. The others belong to a department: hand them over with delegate_task and name the skill in the brief (${departments.join("; ")}). A skill is a procedure, not an approval: every publish, spend and brand change still waits for the person.`;
}

/** Mount the agent's marketing skills (call once per render, next to useCustomSkills). */
export function useMarketingSkills(agent: SkillAgent): void {
  for (const entry of marketingSkillsFor(agent)) useSkill(entry.skill);
  if (isLead(agent)) useInstruction(slashCommandInstruction());
}
