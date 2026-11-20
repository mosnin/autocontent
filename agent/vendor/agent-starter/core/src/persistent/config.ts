import { z } from "zod";
import { assessInjection } from "../guardrails/injection.ts";
import { countFires, isValidCron, isValidTimeZone } from "./cron.ts";

/**
 * Persistent-agent configuration: owned by the trusted control plane (`PersistentAgentControl`), never by the agent.
 * The agent can only PROPOSE changes (`ConfigPatchSchema`); `classifyProposal` decides whether a change is low risk
 * (applied after auto-review) or widens access (needs a human). Every applied change bumps `version`.
 */
export const PERSISTENT_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
export const MIN_HEARTBEAT_MINUTES = 5;
export const DEFAULT_HEARTBEAT_MINUTES = 30;
export const DEFAULT_MAX_TOOL_CALLS_PER_TICK = 20;

export const DEFAULT_HEARTBEAT_CHECKLIST = [
  "# HEARTBEAT",
  "",
  "- Check whether anything in your memory or schedules needs follow-up now.",
  "- If nothing needs doing, reply exactly HEARTBEAT_OK and call no tools.",
].join("\n");

const HostPattern = z
  .string()
  .min(1)
  .max(253)
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => s === "*" || /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(s), { message: "Host pattern must be a hostname, *.hostname or *" });

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ScheduleSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i),
  cron: z.string().max(120).refine(isValidCron, { message: "Invalid 5-field cron expression" }),
  prompt: z.string().min(1).max(4000),
});
export type PersistentSchedule = z.infer<typeof ScheduleSchema>;

export const QuietHoursSchema = z.object({ tz: z.string().refine(isValidTimeZone, { message: "Unknown time zone" }), start: HHMM, end: HHMM });

export const CredentialBindingSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i),
  hosts: z.array(HostPattern).min(1).max(20),
});
export type CredentialBinding = z.infer<typeof CredentialBindingSchema>;

export const PersistentSkillSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  description: z.string().min(1).max(1024),
  body: z.string().min(1).max(20_000),
});
export type PersistentSkill = z.infer<typeof PersistentSkillSchema>;

export const PersistentAgentConfigSchema = z.object({
  agentId: z.string().regex(PERSISTENT_AGENT_ID),
  name: z.string().min(1).max(120),
  ownerUserId: z.string().min(1).max(256),
  heartbeatMinutes: z.number().int().min(MIN_HEARTBEAT_MINUTES).max(7 * 24 * 60).default(DEFAULT_HEARTBEAT_MINUTES),
  /** The HEARTBEAT checklist (markdown) dispatched on every tick. */
  heartbeat: z.string().max(8000).default(DEFAULT_HEARTBEAT_CHECKLIST),
  schedules: z
    .array(ScheduleSchema)
    .max(20)
    .default([])
    .refine((list) => new Set(list.map((s) => s.name)).size === list.length, { message: "Schedule names must be unique" }),
  quietHours: QuietHoursSchema.optional(),
  /** Agent-level egress: narrows the platform allowlist (never widens it while managedAllowedDomainsOnly). */
  egress: z.object({ allow: z.array(HostPattern).max(100).default([]), deny: z.array(HostPattern).max(100).default([]) }).default({ allow: [], deny: [] }),
  /** Credential names the agent may use and the hosts each may be sent to (the broker injects them). */
  credentials: z.array(CredentialBindingSchema).max(20).default([]),
  /** Approved skills only (self-authored skills land in quarantine as proposals first). */
  skills: z.array(PersistentSkillSchema).max(20).default([]),
  dailyBudgetUsd: z.number().positive().max(10_000).default(5),
  maxToolCallsPerTick: z.number().int().min(1).max(200).default(DEFAULT_MAX_TOOL_CALLS_PER_TICK),
  autoReview: z.object({ enabled: z.boolean().default(true), model: z.string().max(200).optional() }).default({ enabled: true }),
  enabled: z.boolean().default(true),
  version: z.number().int().min(1).default(1),
});
export type PersistentAgentConfig = z.infer<typeof PersistentAgentConfigSchema>;
export type PersistentAgentConfigInput = z.input<typeof PersistentAgentConfigSchema>;

/** Defaults for everything but identity (`agentId`, `name`, `ownerUserId`). */
export const DEFAULT_PERSISTENT_CONFIG: Omit<PersistentAgentConfig, "agentId" | "name" | "ownerUserId"> = {
  heartbeatMinutes: DEFAULT_HEARTBEAT_MINUTES,
  heartbeat: DEFAULT_HEARTBEAT_CHECKLIST,
  schedules: [],
  egress: { allow: [], deny: [] },
  credentials: [],
  skills: [],
  dailyBudgetUsd: 5,
  maxToolCallsPerTick: DEFAULT_MAX_TOOL_CALLS_PER_TICK,
  autoReview: { enabled: true },
  enabled: true,
  version: 1,
};

/** What a proposal may change. Identity, owner, `enabled` (the kill switch) and `version` are never proposable. */
export const ConfigPatchSchema = z
  .object({
    heartbeat: z.string().max(8000),
    heartbeatMinutes: z.number().int().min(MIN_HEARTBEAT_MINUTES).max(7 * 24 * 60),
    schedules: z.array(ScheduleSchema).max(20),
    quietHours: QuietHoursSchema.nullable(),
    egress: z.object({ allow: z.array(HostPattern).max(100), deny: z.array(HostPattern).max(100) }),
    credentials: z.array(CredentialBindingSchema).max(20),
    dailyBudgetUsd: z.number().positive().max(10_000),
    maxToolCallsPerTick: z.number().int().min(1).max(200),
    autoReview: z.object({ enabled: z.boolean(), model: z.string().max(200).optional() }),
    name: z.string().min(1).max(120),
    /** Add (or replace) one skill: always needs a human. */
    addSkill: PersistentSkillSchema,
    removeSkill: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  })
  .partial()
  .strict();
export type ConfigPatch = z.infer<typeof ConfigPatchSchema>;

export const ProposalSourceSchema = z.enum(["agent", "owner"]);
export const ProposalStatusSchema = z.enum(["pending", "approved", "rejected", "applied"]);

export const ConfigProposalSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  source: ProposalSourceSchema,
  kind: z.enum(["config", "skill"]),
  summary: z.string(),
  review: z.enum(["auto", "human"]),
  status: ProposalStatusSchema,
  patch: ConfigPatchSchema,
  baseVersion: z.number().int(),
  diff: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })).optional(),
  reason: z.string().max(2000).optional(),
  actor: z.string().optional(),
  decidedBy: z.string().optional(),
  decidedAt: z.number().optional(),
  note: z.string().max(2000).optional(),
});
export type ConfigProposal = z.infer<typeof ConfigProposalSchema>;

/** Apply a patch to a config (validated). Does not bump the version: the control plane does on commit. */
export function applyConfigPatch(config: PersistentAgentConfig, patch: ConfigPatch): PersistentAgentConfig {
  const { addSkill, removeSkill, quietHours, ...rest } = ConfigPatchSchema.parse(patch);
  const next: Record<string, unknown> = { ...config, ...rest };
  if (quietHours === null) delete next.quietHours;
  else if (quietHours) next.quietHours = quietHours;
  let skills = config.skills;
  if (removeSkill) skills = skills.filter((s) => s.name !== removeSkill);
  if (addSkill) skills = [...skills.filter((s) => s.name !== addSkill.name), addSkill];
  next.skills = skills;
  return PersistentAgentConfigSchema.parse(next);
}

/** Field-level diff of two configs (for proposal cards and the audit log). */
export function diffConfigs(before: PersistentAgentConfig, after: PersistentAgentConfig): Array<{ field: string; before: unknown; after: unknown }> {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const field of fields) {
    if (field === "version") continue;
    const a = (before as Record<string, unknown>)[field];
    const b = (after as Record<string, unknown>)[field];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field, before: a, after: b });
  }
  return out;
}

const WEEK_MS = 7 * 86_400_000;
const FREQUENCY_ORIGIN = Date.UTC(2026, 0, 5);

function scheduleFires(list: PersistentSchedule[]): Map<string, number> {
  return new Map(list.map((s) => [s.name, countFires(s.cron, FREQUENCY_ORIGIN, WEEK_MS)]));
}

/**
 * `"auto"` for a low-risk change (applied after auto-review) or `"human"` for anything that widens access:
 * new egress hosts or fewer denials, new credentials or credential hosts, a higher budget or tool-call cap, more
 * frequent heartbeats or schedules (including new schedules), a weaker reviewer, any skill change, ownership or
 * identity changes, and text that reads like an instruction override (memory/config poisoning, ASI06).
 */
export function classifyProposal(old: PersistentAgentConfig, next: PersistentAgentConfig): "auto" | "human" {
  if (next.agentId !== old.agentId || next.ownerUserId !== old.ownerUserId) return "human";
  if (next.enabled && !old.enabled) return "human";
  const oldAllow = new Set(old.egress.allow);
  if (next.egress.allow.some((h) => !oldAllow.has(h))) return "human";
  // An agent allowlist going from narrowed to empty means "inherit everything": a widening.
  if (old.egress.allow.length > 0 && next.egress.allow.length === 0) return "human";
  const newDeny = new Set(next.egress.deny);
  if (old.egress.deny.some((h) => !newDeny.has(h))) return "human";
  const oldCreds = new Map(old.credentials.map((c) => [c.name, new Set(c.hosts)]));
  for (const cred of next.credentials) {
    const hosts = oldCreds.get(cred.name);
    if (!hosts || cred.hosts.some((h) => !hosts.has(h))) return "human";
  }
  if (next.dailyBudgetUsd > old.dailyBudgetUsd) return "human";
  if (next.maxToolCallsPerTick > old.maxToolCallsPerTick) return "human";
  if (next.heartbeatMinutes < old.heartbeatMinutes) return "human";
  if (old.autoReview.enabled && !next.autoReview.enabled) return "human";
  if ((next.autoReview.model ?? "") !== (old.autoReview.model ?? "")) return "human";
  if (JSON.stringify(next.skills) !== JSON.stringify(old.skills)) return "human";
  const before = scheduleFires(old.schedules);
  const after = scheduleFires(next.schedules);
  for (const [name, fires] of after) {
    const previous = before.get(name);
    if (previous === undefined || fires > previous) return "human";
  }
  if (old.quietHours && !next.quietHours) return "human";
  const texts = [next.heartbeat, ...next.schedules.map((s) => s.prompt), next.name];
  if (texts.some((t) => assessInjection(t).verdict === "injection")) return "human";
  return "auto";
}

/** One-line summary of a patch (proposal cards, audit). */
export function summarizePatch(patch: ConfigPatch): string {
  const parts: string[] = [];
  for (const key of Object.keys(patch) as Array<keyof ConfigPatch>) {
    if (key === "addSkill") parts.push(`add skill "${patch.addSkill?.name}"`);
    else if (key === "removeSkill") parts.push(`remove skill "${patch.removeSkill}"`);
    else parts.push(`change ${key}`);
  }
  return parts.join(", ") || "no change";
}
