import { type AnyAgentTool, defineAgentTool, type RiskTier, type SideEffect } from "@agent-starter/core";
import type * as v from "valibot";
import { type MarketerRequest, marketerApi, READ_ATTEMPT_TIMEOUT_MS } from "../api.ts";
import { MarketerNotSentError } from "../errors.ts";
import { enforceAgentDispatch, railsEntry } from "../rails/index.ts";

type Schema = v.GenericSchema<unknown, unknown>;

/** The client gives up this long before the executor's own timeout, so the model reads the typed error, not a bare TIMEOUT. */
const CLIENT_MARGIN_MS = 2_000;

/**
 * A LOW-risk read of the Marketer API. Output is account data written partly by people and third parties (titles,
 * captions, platform errors), so it reaches the model as untrusted data.
 *
 * Retries live in ONE place, the API client: bounded, jittered, inside the tool's deadline, and stopped by the
 * circuit breaker (src/marketer/api.ts). The executor's own retry is off (`maxAttempts: 1`), otherwise the two
 * would multiply (3 x 3 requests) and outlast the breaker.
 */
export function readTool<S extends Schema>(spec: { name: string; description: string; input: S; timeoutMs?: number; maxOutputChars?: number; request: (args: v.InferOutput<S>) => MarketerRequest }): AnyAgentTool {
  const timeoutMs = spec.timeoutMs ?? 25_000;
  const deadlineMs = Math.max(1_000, timeoutMs - CLIENT_MARGIN_MS);
  return defineAgentTool({
    name: spec.name,
    description: spec.description,
    input: spec.input,
    risk: "LOW",
    sideEffect: "read",
    idempotent: true,
    timeoutMs,
    retry: { maxAttempts: 1 },
    outputTrust: "untrusted",
    ...(spec.maxOutputChars ? { maxOutputChars: spec.maxOutputChars } : {}),
    execute: (args, ctx) => marketerApi(ctx, { deadlineMs, timeoutMs: Math.min(READ_ATTEMPT_TIMEOUT_MS, deadlineMs), ...spec.request(args as v.InferOutput<S>) }),
  }) as unknown as AnyAgentTool;
}

/**
 * A mutating call of the Marketer API. The risk tier is the caller's honest call (risk table in AGENTS.md):
 * MEDIUM = costs credits / creates drafts, HIGH = publishes, approves, spends or edits brand identity,
 * CRITICAL = moves real ad money. `idempotent` only when a replay is harmless by the endpoint's own semantics
 * (full-replace PUTs, atomic claims that 409 on repeat): the backend does not dedupe on `idempotency-key` yet, so
 * everything else runs through the SQL idempotency ledger exactly once (an interrupted call is UNKNOWN, never re-run).
 *
 * No write is ever retried automatically, at any tier (`retry: { maxAttempts: 1 }`, and the client sends a write
 * once): the backend does not dedupe, so a retried maker would spend credits twice. A write that was sent and not
 * answered surfaces as OUTCOME_UNKNOWN. Every write carries the run's idempotency key; without one it is not sent.
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
  const timeoutMs = spec.timeoutMs ?? 30_000;
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
    timeoutMs,
    // API responses echo account data (titles, captions, provider errors): data, not instructions.
    outputTrust: "untrusted",
    // An outcome we cannot confirm is handed to a person, never retried (indeterminate-outcomes ADR 0006). This holds
    // for every write, also the ones marked idempotent: that flag only says a replay after a crash is harmless.
    retry: { maxAttempts: 1 },
    simulate: (args) => ({ simulated: true, wouldHaveCalled: spec.request(args as v.InferOutput<S>) }),
    execute: async (args, ctx) => {
      if (!ctx.idempotencyKey) throw new MarketerNotSentError(`${spec.name} has no idempotency key for this call.`);
      const request = { timeoutMs: Math.max(1_000, timeoutMs - CLIENT_MARGIN_MS), ...spec.request(args as v.InferOutput<S>) };
      if (!railed) return marketerApi(ctx, request);
      const dispatch = await enforceAgentDispatch({ tool: spec.name, declaredRisk: spec.risk, args, ctx });
      return dispatch.run(() => marketerApi(ctx, request));
    },
  }) as unknown as AnyAgentTool;
}

/** Names of a tool list (rosters, grants, tests). */
export const toolNames = (tools: readonly AnyAgentTool[]): string[] => tools.map((t) => t.name);
