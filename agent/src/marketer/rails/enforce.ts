import { AgentError, HttpError, RISK_ORDER, type RiskTier } from "@agent-starter/core";
import { railsArgsHash } from "./canonical.ts";
import { type KillScope, railsEntry, type RailsToolEntry } from "./registry.ts";

/**
 * The agent-side enforcement point (docs/rails/enforcement-point.md).
 *
 * Every HIGH and CRITICAL Marketer tool reaches the API through `writeTool`, and `writeTool` calls
 * `enforceAgentDispatch` right before the request, after the harness has validated the arguments and a person has
 * approved the call (the harness binds that approval to the call id, tool and argument hash). Here we re-read
 * current facts, in order:
 *
 *  1. tier: the tool is in the rails table and its declared tier is not below the reviewed one;
 *  2. kill switch: `MARKETER_RAILS_KILL_SWITCH` from the Worker env, read now (`all`, `publish`, `spend`;
 *     an unreadable value means `all`); calls that only reduce exposure are never blocked;
 *  3. caps: argument ceilings from the table (arithmetic in code);
 *  4. approval: the call runs live and is gated by the harness (HIGH/CRITICAL always park; CRITICAL carries
 *     `requiresApproval`); the argument hash is the approval's own hash and goes into the dispatch log.
 *
 * The backend runs its own enforcement point (`marketer.rails.enforce_dispatch`) with its own current facts: the
 * agent side is the first wall, never the only one.
 *
 * `run` performs the request and turns an unknown outcome (timeout, network drop, 5xx, the backend's 502
 * `outcome_unknown`) into `IndeterminateOutcomeError`: never retried (HIGH/CRITICAL tools run with
 * `maxAttempts: 1`), recorded UNKNOWN by the harness ledger, and the model is told to hand it to a person.
 */

export interface RailsCallContext {
  mode?: "live" | "shadow" | "dry-run";
  services?: Record<string, unknown>;
  log?: (level: "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => void;
}

export const KILL_SWITCH_ENV = "MARKETER_RAILS_KILL_SWITCH";

/** Parse the kill-switch variable. Unset/empty/"off" = none; anything we cannot read = all (fail closed). */
export function parseKillSwitch(raw: unknown): Set<"all" | KillScope> {
  if (raw === undefined || raw === null) return new Set();
  if (typeof raw !== "string") return new Set(["all"]);
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "off" || value === "none") return new Set();
  const out = new Set<"all" | KillScope>();
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (part === "all" || part === "publish" || part === "spend") out.add(part);
    else return new Set(["all"]);
  }
  return out;
}

/** The side effect may or may not have happened. Not an AgentError on purpose: the harness ledger records UNKNOWN. */
export class IndeterminateOutcomeError extends Error {
  readonly outcome = "indeterminate" as const;
  constructor(
    readonly tool: string,
    cause: unknown,
  ) {
    super(
      `OUTCOME_UNKNOWN: we cannot confirm that ${tool} went through (${describe(cause)}). Do not call it again. ` +
        "Tell the person to check the platform and the workspace inbox, where it is listed for them to resolve.",
      { cause },
    );
    this.name = "IndeterminateOutcomeError";
  }
}

function describe(error: unknown): string {
  if (error instanceof HttpError) return `HTTP ${error.status}`;
  if (error instanceof AgentError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown error";
}

/**
 * True when the error proves the request did not take effect: any 4xx except 408 (a complete answer: rejected,
 * conflicting, rate limited), or a typed, non-retryable refusal raised before sending. Everything else is unknown.
 */
export function isDefiniteRejection(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 400 && error.status < 500 && error.status !== 408;
  if (error instanceof AgentError) return !error.retryable && error.code !== "TIMEOUT";
  return false;
}

export interface RailsVerdict {
  allowed: boolean;
  code: "ok" | "unregistered" | "tier_mismatch" | "not_live" | "kill_switch" | "cap_exceeded";
  reason: string;
}

/** The pure truth table (unit-tested row by row in test/marketer-rails.test.ts). */
export function evaluateAgentDispatch(input: {
  tool: string;
  declaredRisk: RiskTier;
  args: Record<string, unknown>;
  mode: string;
  killSwitch: Set<"all" | KillScope>;
  entry: RailsToolEntry | undefined;
}): RailsVerdict {
  const { tool, declaredRisk, args, entry } = input;
  if (!entry) return { allowed: false, code: "unregistered", reason: `${tool} is not in the rails table` };
  if (RISK_ORDER[declaredRisk] < RISK_ORDER[entry.tier]) return { allowed: false, code: "tier_mismatch", reason: `${tool} is declared ${declaredRisk} but reviewed as ${entry.tier}` };
  if (input.mode !== "live") return { allowed: false, code: "not_live", reason: `${tool} only dispatches in live mode` };
  const reduces = typeof entry.reducesExposure === "function" ? entry.reducesExposure(args) : entry.reducesExposure === true;
  if (!reduces) {
    const engaged = [...input.killSwitch].filter((s) => s === "all" || (entry.scopes as readonly string[]).includes(s));
    if (engaged.length) return { allowed: false, code: "kill_switch", reason: `kill switch engaged (${engaged.sort().join(", ")})` };
  }
  const capped = entry.caps?.(args) ?? null;
  if (capped) return { allowed: false, code: "cap_exceeded", reason: capped };
  return { allowed: true, code: "ok", reason: "" };
}

export interface AgentDispatch {
  tool: string;
  tier: RiskTier;
  argsHash: string;
  run<T>(send: () => Promise<T>): Promise<T>;
}

/** Check, then return a handle that performs and classifies the request. Throws `TOOL_NOT_ALLOWED` on a refusal. */
export async function enforceAgentDispatch(input: { tool: string; declaredRisk: RiskTier; args: unknown; ctx: RailsCallContext }): Promise<AgentDispatch> {
  const { tool, declaredRisk, ctx } = input;
  const args = (input.args && typeof input.args === "object" ? input.args : {}) as Record<string, unknown>;
  const env = (ctx.services?.env ?? {}) as Record<string, unknown>;
  const entry = railsEntry(tool);
  const verdict = evaluateAgentDispatch({ tool, declaredRisk, args, mode: ctx.mode ?? "live", killSwitch: parseKillSwitch(env[KILL_SWITCH_ENV]), entry });
  const argsHash = await railsArgsHash(input.args);
  const tier = entry?.tier ?? declaredRisk;
  if (!verdict.allowed) {
    ctx.log?.("warn", "rails.denied", { tool, tier, code: verdict.code, argsHash });
    throw new AgentError("TOOL_NOT_ALLOWED", `RAILS_${verdict.code.toUpperCase()}: ${verdict.reason}. Report this to the person; do not retry.`, { details: { rails: verdict.code } });
  }
  ctx.log?.("info", "rails.dispatch", { tool, tier, backendAction: entry?.backendAction, argsHash });
  return {
    tool,
    tier,
    argsHash,
    async run<T>(send: () => Promise<T>): Promise<T> {
      try {
        const result = await send();
        ctx.log?.("info", "rails.outcome", { tool, outcome: "succeeded", argsHash });
        return result;
      } catch (error) {
        if (isDefiniteRejection(error)) {
          ctx.log?.("info", "rails.outcome", { tool, outcome: "failed", argsHash });
          throw error;
        }
        ctx.log?.("error", "rails.outcome", { tool, outcome: "indeterminate", argsHash });
        throw new IndeterminateOutcomeError(tool, error);
      }
    },
  };
}
