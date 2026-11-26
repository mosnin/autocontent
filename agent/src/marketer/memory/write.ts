import type { MemoryHit, TenantSecurityContext } from "@agent-starter/core";
import { decide, type DecisionRuntime } from "../decisions/run.ts";
import { type ExtractionSource, type FactExtractor, looksLasting, ruleExtractor, validateExtraction, EXTRACTION_LIMITS } from "./extract.ts";
import type { SourceKind } from "./facts.ts";
import type { MemoryStore, WriteResult } from "./store.ts";

/**
 * The write path (plan section 3.2, item 3 "hot facts"; decision point 11).
 *
 *   message → gate → extractor → validateExtraction (code) → store.write (code decides current / pending / refused)
 *
 * Mode `MEMORY_EXTRACTION_MODE` = `off | shadow | write`, default `shadow`:
 *  - off:    nothing runs. Explicit `remember_note` is the only way to save, exactly as before.
 *  - shadow: the gate and the extractor run and a log line says what would be written (counts and slots, never the
 *            text). Nothing is stored.
 *  - write:  valid facts are stored. Facts read from the person's message are `unconfirmed`; rule-bearing ones wait
 *            for the person (pending).
 * The gate is decision point 11 when a decision key is set, and the `looksLasting` rule otherwise. A gate that is
 * itself in shadow never causes a write: it caps this path at shadow (a shadowed decision changes no behaviour).
 * This path never blocks or fails a turn: it runs in the background and swallows its own errors.
 */

export type ExtractionMode = "off" | "shadow" | "write";

export function resolveExtractionMode(env: Record<string, unknown>): ExtractionMode {
  const raw = typeof env.MEMORY_EXTRACTION_MODE === "string" ? env.MEMORY_EXTRACTION_MODE.trim().toLowerCase() : "";
  return raw === "off" || raw === "write" || raw === "shadow" ? raw : "shadow";
}

export interface ExtractionLog {
  tenantId: string;
  mode: ExtractionMode;
  /** Who gated: the decision model, or the rule when no key is set. */
  gate: "model" | "rule";
  gated: boolean;
  extractor: string | null;
  candidates: number;
  valid: number;
  /** `type.predicate` of each valid candidate (no names, no values). */
  slots: string[];
  rejected: Record<string, number>;
  /** Store results in write mode, by status. */
  written: Record<string, number>;
  error?: string;
  at: number;
}

export interface WriteRuntime {
  env: Record<string, unknown>;
  store: MemoryStore;
  extractor?: FactExtractor;
  /** Decision runtime for point 11. Without it (or without a key) the rule gate is used. */
  decisions?: DecisionRuntime;
  log?: (entry: ExtractionLog) => void;
  now?: () => number;
}

export interface TurnInput {
  tenantId: string;
  message: string;
  /** Where the text came from. Chat turns are `message`; a caller ingesting a page passes `web` or `document`. */
  source: { kind: SourceKind; ref: string };
  signal?: AbortSignal;
}

const count = (into: Record<string, number>, key: string): void => {
  into[key] = (into[key] ?? 0) + 1;
};

/** Run the write path once for one piece of text. Resolves to the log entry (also handed to `runtime.log`). */
export async function extractAndStore(runtime: WriteRuntime, input: TurnInput): Promise<ExtractionLog> {
  const now = (runtime.now ?? Date.now)();
  const configured = resolveExtractionMode(runtime.env);
  const entry: ExtractionLog = { tenantId: input.tenantId, mode: configured, gate: "rule", gated: false, extractor: null, candidates: 0, valid: 0, slots: [], rejected: {}, written: {}, at: now };
  if (configured === "off") return entry;
  const message = input.message.slice(0, EXTRACTION_LIMITS.messageChars);
  try {
    let mode: ExtractionMode = configured;
    const gate = runtime.decisions ? await decide(runtime.decisions, "memory_gate", { state: { message }, tenantId: input.tenantId, ...(input.signal ? { signal: input.signal } : {}) }) : undefined;
    if (gate && gate.mode !== "off") {
      entry.gate = "model";
      if (gate.mode === "enforce") entry.gated = gate.action.action === "extract";
      else {
        // The gate is in shadow: act on nothing it says. Log what it proposed and never write.
        entry.gated = gate.proposed?.action === "extract";
        mode = "shadow";
      }
    } else {
      entry.gated = looksLasting(message);
    }
    entry.mode = mode;
    if (!entry.gated) return finish(runtime, entry);

    const extractor = runtime.extractor ?? ruleExtractor;
    entry.extractor = extractor.name;
    const raw = await extractor.extract(message, input.signal ? { signal: input.signal } : {});
    const source: ExtractionSource = { kind: input.source.kind, ref: input.source.ref, at: now };
    const result = validateExtraction(raw, message, source, now);
    entry.candidates = result.facts.length + result.rejected.length;
    entry.valid = result.facts.length;
    entry.slots = result.facts.map(({ fact }) => `${fact.subject.type}.${fact.predicate}`);
    for (const r of result.rejected) count(entry.rejected, r.reason);
    if (mode !== "write") return finish(runtime, entry);

    for (const { input: fact } of result.facts) {
      let outcome: WriteResult;
      try {
        outcome = await runtime.store.write(input.tenantId, fact, input.signal ? { signal: input.signal } : {});
      } catch {
        outcome = { status: "rejected" };
        count(entry.written, "error");
        continue;
      }
      count(entry.written, outcome.status);
    }
  } catch (error) {
    entry.error = error instanceof Error ? error.name : "error";
  }
  return finish(runtime, entry);
}

function finish(runtime: WriteRuntime, entry: ExtractionLog): ExtractionLog {
  try {
    runtime.log?.(entry);
  } catch {
    // logging never changes the outcome
  }
  return entry;
}

/** A stable reference for a chat turn when the harness gives the hook no message id: a hash of tenant + text + minute. */
export function turnRef(tenantId: string, message: string, at: number): string {
  let h = 2166136261;
  for (const ch of `${tenantId}\n${message}`) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return `chat:${Math.floor(at / 60_000).toString(36)}:${(h >>> 0).toString(36)}`;
}

/**
 * The turn hook for `observeTurns` (src/marketer/decisions/hooks.ts): starts the write path in the background and
 * returns no hits. `waitUntil` keeps the Worker alive for the background work.
 */
export function memoryWriteHook(runtime: () => WriteRuntime, waitUntil?: (promise: Promise<unknown>) => void): (tenant: TenantSecurityContext, message: string) => Promise<MemoryHit[]> {
  return async (tenant, message) => {
    try {
      const rt = runtime();
      if (resolveExtractionMode(rt.env) === "off") return [];
      const at = (rt.now ?? Date.now)();
      const work = extractAndStore(rt, { tenantId: tenant.tenantId, message, source: { kind: "message", ref: turnRef(tenant.tenantId, message, at) } }).catch(() => undefined);
      try {
        waitUntil?.(work);
      } catch {
        // no execution context: the promise still runs
      }
    } catch {
      // the write path never breaks a turn
    }
    return [];
  };
}
