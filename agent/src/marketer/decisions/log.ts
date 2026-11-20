import type { TelemetryEvent, TelemetrySink } from "@agent-starter/core";
import type { DecisionMode, DecisionPoint } from "./questions.ts";

/**
 * Every decision is logged: point, model, questions version, a hash of the state (never the raw state, so no PII),
 * the answers, whether the fallback was used, latency, cost and the action taken.
 *
 * Two destinations, both best-effort and non-blocking (logging never changes or delays a decision):
 *  - telemetry: the platform's sinks (signed webhook to the SaaS with the durable outbox, Pusher), type "log";
 *  - the backend `decision_log` table: `POST {PRIMARY_SAAS_API_URL}/api/v1/decisions/log` with the agent service
 *    token, when both are configured. A 404 (endpoint not deployed yet) or any other failure is ignored.
 */

export interface DecisionLogEntry {
  point: DecisionPoint;
  mode: DecisionMode;
  model: string | null;
  questionsVersion: string;
  stateHash: string;
  answers: Record<string, unknown> | null;
  fallbackUsed: boolean;
  /** Failure kind when the model did not answer (timeout, http, no_cost, ...). */
  failure: string | null;
  latencyMs: number;
  cost: number;
  actionTaken: unknown;
  /** What the table proposed (equal to actionTaken in enforce; logged next to the rule in shadow). */
  proposed: unknown;
  tenantId: string;
  runId: string | null;
  agent: string | null;
  at: number;
}

export interface DecisionLogger {
  write(entry: DecisionLogEntry): void;
}

export interface DecisionLogOptions {
  telemetry?: () => readonly TelemetrySink[];
  backend?: { apiUrl?: string; token?: string; fetch?: typeof fetch; timeoutMs?: number };
  /** Keep the isolate alive for the background writes (Workers `ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export const DECISION_LOG_PATH = "/api/v1/decisions/log";

/** Stable JSON (sorted keys) so the same state always hashes the same. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(",")}}`;
}

/** SHA-256 of the canonical state, hex. The raw state is never logged. */
export async function stateHash(state: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(state));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function decisionTelemetryEvent(entry: DecisionLogEntry): TelemetryEvent {
  return {
    id: `decision_${entry.at.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    type: "log",
    runId: entry.runId ?? "decisions",
    tenantId: entry.tenantId,
    senderId: entry.agent ?? "decisions",
    senderRole: "decision-model",
    content: `decision ${entry.point} (${entry.mode}): ${entry.fallbackUsed ? `fallback${entry.failure ? ` after ${entry.failure}` : ""}` : "answered"}`,
    logType: entry.failure ? "warning" : "info",
    turnCount: 0,
    accumulatedCost: entry.cost,
    runtimeSeconds: entry.latencyMs / 1000,
    timestamp: entry.at,
    data: { decision: entry },
  };
}

export function createDecisionLogger(options: DecisionLogOptions = {}): DecisionLogger {
  const background = (promise: Promise<unknown>) => {
    const safe = promise.catch(() => undefined);
    try {
      options.waitUntil?.(safe);
    } catch {
      // no execution context (tests, module scope): the promise still runs
    }
  };
  return {
    write(entry) {
      try {
        const sinks = options.telemetry?.() ?? [];
        if (sinks.length) {
          const event = decisionTelemetryEvent(entry);
          background(Promise.all(sinks.map((sink) => sink.publish(event).catch(() => undefined))));
        }
      } catch {
        // telemetry is best-effort
      }
      const backend = options.backend;
      const base = backend?.apiUrl?.trim().replace(/\/+$/, "");
      const token = backend?.token?.trim();
      if (base && /^https?:\/\//.test(base) && token && /^[A-Za-z0-9][A-Za-z0-9_.:|-]{0,127}$/.test(entry.tenantId)) {
        const fetchImpl = backend?.fetch ?? fetch;
        background(
          fetchImpl(`${base}${DECISION_LOG_PATH}`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-tenant-id": entry.tenantId },
            body: JSON.stringify(entry),
            signal: AbortSignal.timeout(backend?.timeoutMs ?? 3000),
          }),
        );
      }
    },
  };
}

/** A logger that drops everything (tests, harness). */
export const NOOP_DECISION_LOGGER: DecisionLogger = { write: () => undefined };
