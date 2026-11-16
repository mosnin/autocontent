import type { AgentStarterConfig } from "@agent-starter/core";
import { useInstruction, useSkill } from "@flue/runtime";
import appConfig from "../../agent-starter.config.ts";
import { CUSTOM_SKILLS } from "../skills/custom.generated.ts";

/** The targetDomain create-agent-starter writes when none was given (never injected into prompts). */
export const PLACEHOLDER_TARGET_DOMAIN = "Describe what your agents automate for your customers";

/**
 * One instruction line from the domain adaptation config: what the agents automate (`targetDomain`) and the
 * system of record they read and write through their tools (`primaryDatabase`). Empty while targetDomain is
 * still the scaffold placeholder.
 */
export function domainInstruction(config: Pick<AgentStarterConfig, "targetDomain" | "primaryDatabase">): string {
  const domain = config.targetDomain.trim();
  if (!domain || domain === PLACEHOLDER_TARGET_DOMAIN) return "";
  const database = config.primaryDatabase.trim();
  return `Domain: ${domain}.${database ? ` System of record: ${database} (reach it only through your tools).` : ""}`;
}

/**
 * Domain adaptation for an agent (agent-starter.config.ts), called once in every agent function:
 *  - every `customSkills` runtime skill (src/skills/<kebab-name>/SKILL.md, listed in the generated
 *    src/skills/custom.generated.ts) is mounted with useSkill, so the model can activate it on demand;
 *  - the targetDomain / primaryDatabase line is appended to the agent's instructions.
 * Adding a skill: add it to `customSkills`, create its SKILL.md and add the import to custom.generated.ts
 * (create-agent-starter writes both for skills given with --skill).
 */
export function useCustomSkills(): void {
  for (const skill of CUSTOM_SKILLS) useSkill(skill);
  const line = domainInstruction(appConfig);
  if (line) useInstruction(line);
}
