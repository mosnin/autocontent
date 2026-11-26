import { z } from "zod";
import type { RunStatus, TelemetryEvent, TelemetryMetrics } from "../types.ts";

/**
 * Runtime mirror of `TelemetryEventSchema` from `@agent-starter/core`. This
 * package only imports core types (core is a dev dependency), so the schema is
 * restated here; the type assertion below fails compilation if it drifts.
 */
export const runStatusSchema = z.enum([
  "IDLE",
  "QUEUED",
  "RUNNING",
  "PROVISIONING",
  "PENDING_APPROVAL",
  "PAUSED_OVERSIGHT",
  "STOPPING",
  "HALTED",
  "COMPLETED",
  "FAILED",
  "TERMINATED",
]);

export const telemetryEventSchema = z.object({
  id: z.string(),
  type: z.enum(["log", "turn", "model", "tool", "approval", "status", "budget", "plan", "memory", "message", "error", "sandbox"]),
  runId: z.string(),
  tenantId: z.string(),
  roomId: z.string().optional(),
  senderId: z.string(),
  senderRole: z.string(),
  content: z.string(),
  logType: z.enum(["info", "success", "warning", "error", "cognitive"]),
  status: runStatusSchema.optional(),
  turnCount: z.number().int().nonnegative(),
  accumulatedCost: z.number().nonnegative(),
  runtimeSeconds: z.number().nonnegative(),
  timestamp: z.number(),
  data: z.record(z.string(), z.unknown()).optional(),
});

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;
/** Compile-time guard: the local schema must infer exactly core's `TelemetryEvent`. */
export type TelemetrySchemaMatchesCore = AssertTrue<Equals<z.infer<typeof telemetryEventSchema>, TelemetryEvent>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Candidate event objects inside one transport payload. */
function candidates(payload: unknown): unknown[] {
  let value = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [payload];
    }
  }
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    if (Array.isArray(value.events)) return value.events;
    if (isRecord(value.event)) return [value.event];
  }
  return [value];
}

export interface ParsedTelemetry {
  events: TelemetryEvent[];
  invalid: { value: unknown; error: Error }[];
}

/**
 * Validates one transport payload (a JSON string or parsed value holding an
 * event, an array of events, `{ events: [...] }` or `{ event }`). Invalid
 * entries are returned separately so callers can drop and report them.
 */
export function parseTelemetryPayload(payload: unknown): ParsedTelemetry {
  const result: ParsedTelemetry = { events: [], invalid: [] };
  for (const candidate of candidates(payload)) {
    const parsed = telemetryEventSchema.safeParse(candidate);
    if (parsed.success) result.events.push(parsed.data);
    else result.invalid.push({ value: candidate, error: new Error(z.prettifyError(parsed.error)) });
  }
  return result;
}

/**
 * Inserts events into a timestamp-ordered list, skipping ids already in
 * `seen` (which is updated in place). Returns the same array when nothing new
 * arrived so React state updates can bail out.
 */
export function mergeTelemetry(existing: TelemetryEvent[], incoming: TelemetryEvent[], seen: Set<string>, maxEvents: number): TelemetryEvent[] {
  let next: TelemetryEvent[] | undefined;
  for (const event of incoming) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    next ??= existing.slice();
    const last = next[next.length - 1];
    if (!last || last.timestamp <= event.timestamp) {
      next.push(event);
      continue;
    }
    let low = 0;
    let high = next.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const probe = next[mid];
      if (probe && probe.timestamp <= event.timestamp) low = mid + 1;
      else high = mid;
    }
    next.splice(low, 0, event);
  }
  if (!next) return existing;
  if (next.length > maxEvents) next = next.slice(next.length - maxEvents);
  const seenLimit = Math.max(maxEvents * 4, 1000);
  if (seen.size > seenLimit) {
    let excess = seen.size - seenLimit;
    for (const id of seen) {
      if (excess-- <= 0) break;
      seen.delete(id);
    }
  }
  return next;
}

/** De-duplicates events by id, keeping first occurrences, ordered by timestamp. */
export function dedupeTelemetry(events: readonly TelemetryEvent[]): TelemetryEvent[] {
  return mergeTelemetry([], [...events], new Set(), Number.POSITIVE_INFINITY);
}

/** `data.vmSeconds` (the run's billed VM seconds from its ledger) when an event carries it. */
function eventVmSeconds(event: TelemetryEvent): number {
  const value = event.data?.vmSeconds;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Run counters from a telemetry stream. Each event carries its run's running
 * totals, so per run the maximum wins; turns, cost and VM seconds then sum
 * across runs (a swarm room) and runtime takes the longest run.
 */
export function computeTelemetryMetrics(events: readonly TelemetryEvent[]): TelemetryMetrics {
  const perRun = new Map<string, TelemetryMetrics>();
  for (const event of events) {
    const current = perRun.get(event.runId);
    if (!current) {
      perRun.set(event.runId, { turns: event.turnCount, costUsd: event.accumulatedCost, runtimeSeconds: event.runtimeSeconds, vmSeconds: eventVmSeconds(event) });
      continue;
    }
    current.turns = Math.max(current.turns, event.turnCount);
    current.costUsd = Math.max(current.costUsd, event.accumulatedCost);
    current.runtimeSeconds = Math.max(current.runtimeSeconds, event.runtimeSeconds);
    current.vmSeconds = Math.max(current.vmSeconds, eventVmSeconds(event));
  }
  const metrics: TelemetryMetrics = { turns: 0, costUsd: 0, runtimeSeconds: 0, vmSeconds: 0 };
  for (const run of perRun.values()) {
    metrics.turns += run.turns;
    metrics.costUsd += run.costUsd;
    metrics.vmSeconds += run.vmSeconds;
    metrics.runtimeSeconds = Math.max(metrics.runtimeSeconds, run.runtimeSeconds);
  }
  metrics.costUsd = Number(metrics.costUsd.toFixed(6));
  metrics.vmSeconds = Number(metrics.vmSeconds.toFixed(3));
  return metrics;
}

/** The most recent run status reported by the stream, if any. */
export function latestRunStatus(events: readonly TelemetryEvent[]): RunStatus | undefined {
  return latestStatusEvent(events)?.status;
}

function latestStatusEvent(events: readonly TelemetryEvent[]): (TelemetryEvent & { status: RunStatus }) | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.status) return event as TelemetryEvent & { status: RunStatus };
  }
  return undefined;
}

/** Statuses a live submission lifts to RUNNING (it is working, whatever the last report said). */
const IDLE_LIKE: ReadonlySet<RunStatus> = new Set(["IDLE", "QUEUED", "COMPLETED"]);

export interface DeriveRunStatusOptions {
  /**
   * The run registry's view (e.g. `GET /api/jobs/:id` → `{ status, updatedAt }`): PENDING_APPROVAL, HALTED,
   * TERMINATED… The newer of this and the stream's latest status wins; without `updatedAt` the registry wins.
   */
  registry?: { status: RunStatus; updatedAt?: number } | null;
  /** A submission is streaming right now (e.g. `useAgentChat().isBusy`): lifts IDLE / QUEUED / COMPLETED to RUNNING. */
  busy?: boolean;
}

/**
 * One run status for dashboards from the telemetry stream and the run registry, so a run parked on a
 * human shows `PENDING_APPROVAL` (and its oversight card) and a paused run shows `HALTED` (and Resume),
 * instead of a status inferred from whether a response is streaming. Default `IDLE`.
 */
export function deriveRunStatus(events: readonly TelemetryEvent[], options: DeriveRunStatusOptions = {}): RunStatus {
  const streamed = latestStatusEvent(events);
  const registry = options.registry;
  let status: RunStatus | undefined = streamed?.status;
  if (registry && (!streamed || registry.updatedAt === undefined || registry.updatedAt >= streamed.timestamp)) status = registry.status;
  if (options.busy && (!status || IDLE_LIKE.has(status))) return "RUNNING";
  return status ?? "IDLE";
}

const PUSHER_ROOM_SEPARATOR = "-room-";

/**
 * The private Pusher channel the server's `PusherPublisher` sends a run's (or room's) telemetry to:
 * `private-tenant-<tenant>-room-<roomId ?? runId>`, with `:` in tenant ids written as `=` (Pusher forbids `:`).
 * Mirrors `tenantChannelName` in `@agent-starter/integrations`; subscribe through the app's `POST /api/pusher/auth`.
 */
export function pusherTelemetryChannel(tenantId: string, runOrRoomId: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(tenantId) || tenantId.includes(PUSHER_ROOM_SEPARATOR)) throw new Error(`Tenant id "${tenantId}" cannot be used in a Pusher channel name.`);
  if (!runOrRoomId || runOrRoomId.includes(PUSHER_ROOM_SEPARATOR)) throw new Error(`Run or room id "${runOrRoomId}" cannot be used in a Pusher channel name.`);
  const channel = `private-tenant-${tenantId.replace(/:/g, "=")}${PUSHER_ROOM_SEPARATOR}${runOrRoomId}`;
  if (!/^[A-Za-z0-9_\-=@,.;]{1,164}$/.test(channel)) throw new Error(`Channel "${channel}" is not a valid Pusher channel name.`);
  return channel;
}
