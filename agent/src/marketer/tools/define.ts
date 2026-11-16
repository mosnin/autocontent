import { type AnyAgentTool, defineAgentTool, type RiskTier, type SideEffect } from "@agent-starter/core";
import type * as v from "valibot";
import { type MarketerRequest, marketerApi } from "../api.ts";

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
    simulate: (args) => ({ simulated: true, wouldHaveCalled: spec.request(args as v.InferOutput<S>) }),
    execute: (args, ctx) => marketerApi(ctx, spec.request(args as v.InferOutput<S>)),
  }) as unknown as AnyAgentTool;
}

/** Names of a tool list (rosters, grants, tests). */
export const toolNames = (tools: readonly AnyAgentTool[]): string[] => tools.map((t) => t.name);
