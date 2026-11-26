import { z } from "zod";
import { randomId } from "../util/crypto.ts";

export const RunStatusSchema = z.enum([
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
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const LogTypeSchema = z.enum(["info", "success", "warning", "error", "cognitive"]);
export type LogType = z.infer<typeof LogTypeSchema>;

export const TelemetryEventTypeSchema = z.enum(["log", "turn", "model", "tool", "approval", "status", "budget", "plan", "memory", "message", "error", "sandbox"]);

/**
 * The single real-time contract between agents and UIs/webhooks. The React
 * hooks, the webhook relay, Pusher channels and DO WebSocket broadcasts all carry
 * exactly this shape.
 */
export const TelemetryEventSchema = z.object({
  id: z.string(),
  type: TelemetryEventTypeSchema,
  runId: z.string(),
  tenantId: z.string(),
  roomId: z.string().optional(),
  senderId: z.string(),
  senderRole: z.string(),
  content: z.string(),
  logType: LogTypeSchema,
  status: RunStatusSchema.optional(),
  turnCount: z.number().int().nonnegative(),
  accumulatedCost: z.number().nonnegative(),
  runtimeSeconds: z.number().nonnegative(),
  timestamp: z.number(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

export interface TelemetrySink {
  publish(event: TelemetryEvent): Promise<void>;
}

export class FanoutTelemetrySink implements TelemetrySink {
  constructor(
    private readonly sinks: TelemetrySink[],
    private readonly onError: (error: unknown, sink: TelemetrySink) => void = (error) => console.error("[telemetry] sink failed", error),
  ) {}

  async publish(event: TelemetryEvent): Promise<void> {
    await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.publish(event);
        } catch (error) {
          this.onError(error, sink);
        }
      }),
    );
  }
}

export class MemoryTelemetrySink implements TelemetrySink {
  readonly events: TelemetryEvent[] = [];
  async publish(event: TelemetryEvent): Promise<void> {
    this.events.push(event);
  }
}

export class ConsoleTelemetrySink implements TelemetrySink {
  async publish(event: TelemetryEvent): Promise<void> {
    const line = `[${new Date(event.timestamp).toISOString()}] ${event.type}/${event.logType} ${event.senderRole}: ${event.content}`;
    if (event.logType === "error") console.error(line);
    else console.log(line);
  }
}

export interface TelemetryContext {
  runId: string;
  tenantId: string;
  roomId?: string;
  senderId: string;
  senderRole: string;
}

export interface RunCounters {
  turnCount: number;
  accumulatedCost: number;
  startedAt: number;
}

/** Stamps run context and counters onto every event so emitters only supply what changed. */
export class TelemetryEmitter {
  constructor(
    private readonly sink: TelemetrySink,
    private readonly context: TelemetryContext,
    private readonly counters: () => RunCounters,
    private readonly clock: () => number = Date.now,
  ) {}

  with(overrides: Partial<TelemetryContext>): TelemetryEmitter {
    return new TelemetryEmitter(this.sink, { ...this.context, ...overrides }, this.counters, this.clock);
  }

  async emit(event: {
    type: TelemetryEvent["type"];
    content: string;
    logType?: LogType;
    status?: RunStatus;
    data?: Record<string, unknown>;
    senderId?: string;
    senderRole?: string;
  }): Promise<TelemetryEvent> {
    const counters = this.counters();
    const now = this.clock();
    const full: TelemetryEvent = {
      id: randomId("evt"),
      type: event.type,
      runId: this.context.runId,
      tenantId: this.context.tenantId,
      ...(this.context.roomId ? { roomId: this.context.roomId } : {}),
      senderId: event.senderId ?? this.context.senderId,
      senderRole: event.senderRole ?? this.context.senderRole,
      content: event.content,
      logType: event.logType ?? "info",
      ...(event.status ? { status: event.status } : {}),
      turnCount: counters.turnCount,
      accumulatedCost: Number(counters.accumulatedCost.toFixed(6)),
      runtimeSeconds: Math.max(0, Math.round((now - counters.startedAt) / 1000)),
      timestamp: now,
      ...(event.data ? { data: event.data } : {}),
    };
    await this.sink.publish(full);
    return full;
  }
}
