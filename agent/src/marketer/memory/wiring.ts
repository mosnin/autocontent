import type { MemoryHit, TenantSecurityContext } from "@agent-starter/core";
import { waitUntil } from "cloudflare:workers";
import { bindings, decisionRuntime, telemetrySinks } from "../../lib/platform.ts";
import { decisionKey } from "../decisions/client.ts";
import { openRouterExtractor } from "./extract.ts";
import { memoryReadHook } from "./retrieve.ts";
import { ApiMemoryStore } from "./store.ts";
import { type ExtractionLog, memoryWriteHook, resolveExtractionMode } from "./write.ts";

/**
 * Platform wiring for Marketer's memory (the only file here that imports src/lib/platform.ts, so everything else
 * loads in plain Node tests). Agents add `memoryTurnHooks(agent, id)` to the hooks they pass to `observeTurns`.
 *
 * With no Marketer API configured there are no hooks at all: retrieval is exactly what it was.
 */

type TurnHook = (tenant: TenantSecurityContext, message: string) => Promise<MemoryHit[]>;

function store(): ApiMemoryStore {
  return new ApiMemoryStore({ env: () => bindings() as unknown as Record<string, unknown> });
}

function logExtraction(agent: string, runId: string | undefined, entry: ExtractionLog): void {
  const event = {
    id: `memory_${entry.at.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    type: "log" as const,
    runId: runId ?? "memory",
    tenantId: entry.tenantId,
    senderId: agent,
    senderRole: "memory",
    content: `memory extraction (${entry.mode}): gate ${entry.gate} ${entry.gated ? "passed" : "skipped"}, ${entry.valid}/${entry.candidates} valid`,
    logType: entry.error ? ("warning" as const) : ("info" as const),
    turnCount: 0,
    accumulatedCost: 0,
    runtimeSeconds: 0,
    timestamp: entry.at,
    data: { memory: entry },
  };
  try {
    waitUntil(Promise.all(telemetrySinks().map((sink) => sink.publish(event).catch(() => undefined))));
  } catch {
    // telemetry is best-effort
  }
}

/** The read hook (current facts into the turn) and the write hook (gate → extract → store), for `observeTurns`. */
export function memoryTurnHooks(agent: string, runId?: string): TurnHook[] {
  const b = bindings() as unknown as Record<string, unknown>;
  const configured = typeof b.PRIMARY_SAAS_API_URL === "string" && /^https?:\/\//.test(b.PRIMARY_SAAS_API_URL) && typeof b.SAAS_SERVICE_TOKEN === "string" && b.SAAS_SERVICE_TOKEN.length > 0;
  if (!configured) return [];
  const hooks: TurnHook[] = [memoryReadHook(() => ({ store: store() }))];
  if (resolveExtractionMode(b) !== "off") {
    hooks.push(
      memoryWriteHook(() => {
        const env = bindings() as unknown as Record<string, unknown>;
        const extractor = openRouterExtractor(env);
        return {
          env,
          store: store(),
          ...(extractor ? { extractor } : {}),
          // Point 11 gates when a decision key is set; otherwise the rule gate does.
          ...(decisionKey(env) ? { decisions: decisionRuntime(agent, runId) } : {}),
          log: (entry) => logExtraction(agent, runId, entry),
        };
      }, waitUntil),
    );
  }
  return hooks;
}
