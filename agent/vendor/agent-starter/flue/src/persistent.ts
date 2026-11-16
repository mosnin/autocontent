import {
  type AgentIdentity,
  AutoReviewer,
  CredentialBroker,
  createEgressGuard,
  type EgressPolicy,
  type PersistentAgentConfig,
  PersistentAgentConfigSchema,
  type TurnSummary,
} from "@agent-starter/core";
import { observe } from "@flue/runtime";

/**
 * Options that turn a `useAgentStarter` agent into a persistent (always-on) agent. The control plane
 * (`PersistentAgentControl`) owns the config; this side only reads it, enforces it and reports turns back.
 */
export interface PersistentAgentOptions {
  identity: AgentIdentity;
  /** The current config (a value, or a getter that reads the control plane). Refreshed at every delivery. */
  config: PersistentAgentConfig | (() => PersistentAgentConfig | Promise<PersistentAgentConfig>);
  /** Second-model reviewer for every tool call. Without one (and review enabled) every call escalates to a human. */
  reviewer?: AutoReviewer | ((config: PersistentAgentConfig) => AutoReviewer | undefined);
  /** Named credentials, injected only for bound hosts (`CredentialBroker.fromConfig(config.credentials, …)`). */
  broker?: CredentialBroker | ((config: PersistentAgentConfig) => CredentialBroker | undefined);
  /** Managed egress policy (`createEgressGuard`). Without one nothing may be fetched (fail closed). */
  egress?: EgressPolicy | ((config: PersistentAgentConfig) => EgressPolicy | undefined);
  /** The kill switch, read live before every tool call (true = disabled; a throw counts as disabled). */
  killSwitch: () => Promise<boolean>;
  /** Receives each turn's summary (forward it to `PersistentAgentControl.recordTurn`). */
  onTurnSummary?: (summary: TurnSummary) => Promise<void>;
}

/** What the hook exposes on its context for a persistent agent. */
export interface PersistentContext {
  config: PersistentAgentConfig | null;
  killed: boolean;
  identity: AgentIdentity;
}

export const PERSISTENT_CONFIG_TTL_MS = 30_000;

export async function resolvePersistentConfig(option: PersistentAgentOptions["config"]): Promise<PersistentAgentConfig> {
  const value = typeof option === "function" ? await option() : option;
  return PersistentAgentConfigSchema.parse(value);
}

export function staticPersistentConfig(option: PersistentAgentOptions["config"]): PersistentAgentConfig | null {
  if (typeof option === "function") return null;
  const parsed = PersistentAgentConfigSchema.safeParse(option);
  return parsed.success ? parsed.data : null;
}

const pick = <T>(option: T | ((config: PersistentAgentConfig) => T | undefined) | undefined, config: PersistentAgentConfig): T | undefined =>
  typeof option === "function" ? (option as (c: PersistentAgentConfig) => T | undefined)(config) : option;

export function persistentEgress(options: PersistentAgentOptions, config: PersistentAgentConfig): EgressPolicy {
  return pick(options.egress, config) ?? createEgressGuard({ managedAllow: [] });
}

export function persistentBroker(options: PersistentAgentOptions, config: PersistentAgentConfig): CredentialBroker {
  return pick(options.broker, config) ?? new CredentialBroker([]);
}

/** The reviewer for this config: none when review is off, a model-less (always escalating) one when none is given. */
export function persistentReviewer(options: PersistentAgentOptions, config: PersistentAgentConfig): AutoReviewer | null {
  if (!config.autoReview.enabled) return null;
  return pick(options.reviewer, config) ?? new AutoReviewer();
}

/** The policy text the reviewer reads (no secrets: credential names and hosts only). */
export function renderPersistentPolicy(config: PersistentAgentConfig, identity: AgentIdentity): string {
  return [
    `Agent ${identity.principal} acting for ${identity.actingFor} ("${config.name}").`,
    `Egress (agent narrowing): ${config.egress.allow.join(", ") || "platform allowlist"}; denied: ${config.egress.deny.join(", ") || "platform defaults"}.`,
    `Credentials: ${config.credentials.map((c) => `${c.name} → ${c.hosts.join(", ")}`).join("; ") || "none"}.`,
    `Daily budget $${config.dailyBudgetUsd}; at most ${config.maxToolCallsPerTick} tool calls per tick.`,
    "The agent may not change its own configuration except through propose_config_change / propose_skill.",
  ].join("\n");
}

/** Every http(s) URL in an argument whose key mentions "url" (url, urls[], targetUrl, …), at any depth. */
export function urlArguments(args: unknown, depth = 0): string[] {
  if (depth > 6 || !args || typeof args !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    const urlKey = /url/i.test(key);
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (urlKey && typeof v === "string" && /^\s*https?:/i.test(v)) out.push(v.trim());
      else if (v && typeof v === "object") out.push(...urlArguments(v, depth + 1));
    }
  }
  return out;
}

/** Text of a successful `agent` model turn (the reply), or null. */
export function agentTurnText(event: unknown): string | null {
  const e = event as { type?: string; purpose?: string; isError?: boolean; response?: { output?: { content?: Array<{ type: string; text?: string }> } } } | null;
  if (!e || e.type !== "turn" || e.isError || (e.purpose ?? "agent") !== "agent") return null;
  const text = (e.response?.output?.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  return text || null;
}

/** Last reply text per persistent run (for the HEARTBEAT_OK short-circuit; Flue's finish hook has no reply text). */
export const lastReplies = new Map<string, string>();
const watchedRuns = new Set<string>();
let replyMonitorInstalled = false;

export function watchReplies(runId: string): void {
  watchedRuns.add(runId);
  if (watchedRuns.size > 5_000) watchedRuns.delete(watchedRuns.values().next().value as string);
  if (replyMonitorInstalled) return;
  replyMonitorInstalled = true;
  observe((event, ctx) => {
    try {
      const id = (event as unknown as { instanceId?: string }).instanceId ?? ctx.id;
      if (!watchedRuns.has(id)) return;
      const text = agentTurnText(event);
      if (text !== null) lastReplies.set(id, text.slice(0, 2000));
    } catch {
      // Observation must never break the runtime.
    }
  });
}

/** In-flight turn of a persistent run (per isolate), collected for the turn summary. */
export interface PersistentTurnState {
  turnId: string;
  trigger: string;
  startedAt: number;
  costAtStart: number;
  toolCalls: string[];
  reviews: TurnSummary["reviews"];
  killed: boolean;
}
