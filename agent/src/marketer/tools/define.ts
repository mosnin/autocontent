import { type AnyAgentTool, defineAgentTool, type RiskTier, type SideEffect } from "@agent-starter/core";
import type * as v from "valibot";
import { type MarketerRequest, marketerApi } from "../api.ts";
import { enforceAgentDispatch, railsEntry } from "../rails/index.ts";

type Schema = v.GenericSchema<unknown, unknown>;

/**
 * A LOW-risk read of the Marketer API (idempotent, retried on transient failures). Output is account data written
 * partly by people and third parties (titles, captions, platform errors), so it reaches the model as untrusted data.
 */
export function readTool<S extends Schema>(spec: { name: string; description: string; input: S; timeoutMs?: number; maxOutputChars?: number; request: (args: v.InferOutput<S>) => MarketerRequest }): AnyAgentTool {
  return defineAgentTool({
    name: spec.name,
    description: spec.description,
    input: spec.input,
    risk: "LOW",
    sideEffect: "read",
    idempotent: true,
    timeoutMs: spec.timeoutMs ?? 15_000,
    outputTrust: "untrusted",
    ...(spec.maxOutputChars ? { maxOutputChars: spec.maxOutputChars } : {}),
    execute: (args, ctx) => marketerApi(ctx, spec.request(args as v.InferOutput<S>)),
  }) as unknown as AnyAgentTool;
}

/**
 * A mutating call of the Marketer API. The risk tier is the caller's honest call (risk table in AGENTS.md):
 * MEDIUM = costs credits / creates drafts, HIGH = publishes, approves, spends or edits brand identity,
 * CRITICAL = moves real ad money. `idempotent` only when a replay is harmless by the endpoint's own semantics
 * (full-replace PUTs, atomic claims that 409 on repeat): the backend does not dedupe on `idempotency-key` yet, so
 * everything else runs through the SQL idempotency ledger exactly once (an interrupted call is UNKNOWN, never re-run).
 *
 * HIGH and CRITICAL tools are on the execution rails (docs/rails/enforcement-point.md): they must be listed in
 * `src/marketer/rails/registry.ts` (defining one that is not throws), every dispatch passes `enforceAgentDispatch`
 * (tier, kill switch, caps, live + approved), they are never retried automatically, and an unknown outcome surfaces
 * as OUTCOME_UNKNOWN instead of a retry.
 */
export function writeTool<S extends Schema>(spec: {
  name: string;
  description: string;
  input: S;
  risk: Exclude<RiskTier, "LOW">;
  sideEffect?: Extract<SideEffect, "write" | "external">;
  idempotent?: boolean;
  requiresApproval?: boolean;
  timeoutMs?: number;
  tags?: string[];
  request: (args: v.InferOutput<S>) => MarketerRequest;
}): AnyAgentTool {
  const railed = spec.risk === "HIGH" || spec.risk === "CRITICAL";
  if (railed) {
    const entry = railsEntry(spec.name);
    if (!entry) throw new Error(`HIGH/CRITICAL tool "${spec.name}" is not in the rails table (src/marketer/rails/registry.ts).`);
    if (entry.tier !== spec.risk) throw new Error(`Tool "${spec.name}" is ${spec.risk} but the rails table reviews it as ${entry.tier}.`);
    if (entry.tier === "CRITICAL" && !spec.requiresApproval) throw new Error(`CRITICAL tool "${spec.name}" must set requiresApproval.`);
  }
  return defineAgentTool({
    name: spec.name,
    description: spec.description,
    input: spec.input,
    risk: spec.risk,
    sideEffect: spec.sideEffect ?? "write",
    idempotent: spec.idempotent ?? false,
    ...(spec.requiresApproval ? { requiresApproval: true } : {}),
    ...(spec.tags ? { tags: spec.tags } : {}),
    timeoutMs: spec.timeoutMs ?? 30_000,
    // API responses echo account data (titles, captions, provider errors): data, not instructions.
    outputTrust: "untrusted",
    // Rails: an outcome we cannot confirm is handed to a person, never retried (indeterminate-outcomes ADR 0006).
    ...(railed ? { retry: { maxAttempts: 1 } } : {}),
    simulate: (args) => ({ simulated: true, wouldHaveCalled: spec.request(args as v.InferOutput<S>) }),
    execute: async (args, ctx) => {
      const request = spec.request(args as v.InferOutput<S>);
      if (!railed) return marketerApi(ctx, request);
      const dispatch = await enforceAgentDispatch({ tool: spec.name, declaredRisk: spec.risk, args, ctx });
      return dispatch.run(() => marketerApi(ctx, request));
    },
  }) as unknown as AnyAgentTool;
}

/** Names of a tool list (rosters, grants, tests). */
export const toolNames = (tools: readonly AnyAgentTool[]): string[] => tools.map((t) => t.name);
