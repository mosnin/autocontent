import { type AttributeValue, HttpError, SpanAttr, type SpanData, type SpanExporter, type TelemetryEvent, type TelemetrySink } from "@agent-starter/core";

/**
 * Dependency-free Langfuse exporter over the public ingestion API
 * (`POST {baseUrl}/api/public/ingestion`, HTTP Basic publicKey:secretKey).
 * Each flush becomes one or more batches of `trace-create` (one per trace),
 * `generation-create` (LLM spans, with token usage + cost), `span-create`
 * (everything else) and `event-create` (span events).
 */

export interface LangfuseExporterOptions {
  publicKey: string;
  secretKey: string;
  /** https://cloud.langfuse.com (EU), https://us.cloud.langfuse.com (US) or your self-hosted URL. */
  baseUrl?: string;
  environment?: string;
  release?: string;
  /** Events per ingestion request. Default 100. */
  maxBatchSize?: number;
  fetch?: typeof fetch;
  clock?: () => number;
  /** Called with per-event failures reported in the 207 response; default throws. */
  onPartialFailure?: (errors: LangfuseIngestionError[]) => void;
}

export interface LangfuseIngestionError {
  id: string;
  status: number;
  message?: string;
  error?: unknown;
}

export interface LangfuseIngestionEvent {
  id: string;
  timestamp: string;
  type: "trace-create" | "span-create" | "generation-create" | "event-create";
  body: Record<string, unknown>;
}

const CONSUMED_ATTRIBUTES = new Set<string>([
  SpanAttr.prompt,
  SpanAttr.completion,
  SpanAttr.toolArgs,
  SpanAttr.toolResult,
  SpanAttr.sandboxCode,
  SpanAttr.sandboxOutput,
  SpanAttr.eventPayload,
  SpanAttr.inputTokens,
  SpanAttr.outputTokens,
  SpanAttr.reasoningTokens,
  SpanAttr.costUsd,
  SpanAttr.requestModel,
  SpanAttr.responseModel,
]);

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Attribute strings that hold serialized JSON are sent as structured values so Langfuse renders them. */
function parseMaybeJson(value: AttributeValue): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function numberAttr(attributes: Record<string, AttributeValue>, key: string): number | undefined {
  const value = attributes[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function stringAttr(attributes: Record<string, AttributeValue>, key: string): string | undefined {
  const value = attributes[key];
  return value === undefined ? undefined : String(value);
}

function metadataOf(span: SpanData): Record<string, unknown> {
  const metadata: Record<string, unknown> = { "agent.span_kind": span.kind };
  for (const [key, value] of Object.entries(span.attributes)) {
    if (value !== undefined && !CONSUMED_ATTRIBUTES.has(key)) metadata[key] = value;
  }
  return metadata;
}

function ioOf(span: SpanData): { input?: unknown; output?: unknown } {
  const a = span.attributes;
  const pairs: Record<SpanData["kind"], [string, string]> = {
    llm: [SpanAttr.prompt, SpanAttr.completion],
    tool: [SpanAttr.toolArgs, SpanAttr.toolResult],
    sandbox: [SpanAttr.sandboxCode, SpanAttr.sandboxOutput],
    agent: [SpanAttr.eventPayload, SpanAttr.completion],
    retrieval: [SpanAttr.prompt, SpanAttr.toolResult],
    internal: [SpanAttr.toolArgs, SpanAttr.toolResult],
  };
  const [inKey, outKey] = pairs[span.kind];
  const input = a[inKey];
  const output = a[outKey];
  return { ...(input !== undefined ? { input: parseMaybeJson(input) } : {}), ...(output !== undefined ? { output: parseMaybeJson(output) } : {}) };
}

/** Convert finished spans into Langfuse ingestion events (pure; exported for testing and custom transports). */
export function spansToLangfuseEvents(spans: SpanData[], options: { environment?: string; release?: string; now?: number } = {}): LangfuseIngestionEvent[] {
  const now = iso(options.now ?? Date.now());
  const env = options.environment ? { environment: options.environment } : {};
  const events: LangfuseIngestionEvent[] = [];
  const traces = new Map<string, SpanData[]>();
  for (const span of spans) traces.set(span.traceId, [...(traces.get(span.traceId) ?? []), span]);

  for (const [traceId, traceSpans] of traces) {
    const root = traceSpans.find((s) => !s.parentSpanId) ?? traceSpans[0];
    if (!root) continue;
    const tenantId = stringAttr(root.attributes, SpanAttr.tenantId);
    const runId = stringAttr(root.attributes, SpanAttr.runId);
    const agentName = stringAttr(root.attributes, SpanAttr.agentName);
    const start = Math.min(...traceSpans.map((s) => s.startTime));
    events.push({
      id: `${traceId}-trace-${start}`,
      timestamp: now,
      type: "trace-create",
      body: {
        id: traceId,
        timestamp: iso(start),
        name: agentName ?? root.name,
        ...(runId ? { sessionId: runId } : {}),
        metadata: { ...(tenantId ? { tenantId } : {}), ...(agentName ? { agentName } : {}) },
        tags: [...(tenantId ? [`tenant:${tenantId}`] : []), ...(agentName ? [`agent:${agentName}`] : [])],
        ...(root.parentSpanId ? {} : ioOf(root)),
        ...(options.release ? { release: options.release } : {}),
        ...env,
      },
    });
  }

  for (const span of spans) {
    const common: Record<string, unknown> = {
      id: span.spanId,
      traceId: span.traceId,
      name: span.name,
      startTime: iso(span.startTime),
      ...(span.endTime !== undefined ? { endTime: iso(span.endTime) } : {}),
      ...(span.parentSpanId ? { parentObservationId: span.parentSpanId } : {}),
      level: span.status === "error" ? "ERROR" : "DEFAULT",
      ...(span.statusMessage ? { statusMessage: span.statusMessage } : {}),
      metadata: metadataOf(span),
      ...ioOf(span),
      ...env,
    };
    if (span.kind === "llm") {
      const input = numberAttr(span.attributes, SpanAttr.inputTokens);
      const output = numberAttr(span.attributes, SpanAttr.outputTokens);
      const reasoning = numberAttr(span.attributes, SpanAttr.reasoningTokens);
      const cost = numberAttr(span.attributes, SpanAttr.costUsd);
      const model = stringAttr(span.attributes, SpanAttr.responseModel) ?? stringAttr(span.attributes, SpanAttr.requestModel);
      const usageDetails: Record<string, number> = {};
      if (input !== undefined) usageDetails.input = input;
      if (output !== undefined) usageDetails.output = output;
      if (reasoning !== undefined) usageDetails.reasoning = reasoning;
      if (input !== undefined || output !== undefined) usageDetails.total = (input ?? 0) + (output ?? 0) + (reasoning ?? 0);
      events.push({
        id: `${span.spanId}-generation`,
        timestamp: now,
        type: "generation-create",
        body: {
          ...common,
          ...(model ? { model } : {}),
          ...(Object.keys(usageDetails).length ? { usageDetails } : {}),
          ...(cost !== undefined ? { costDetails: { total: cost } } : {}),
        },
      });
    } else {
      events.push({ id: `${span.spanId}-span`, timestamp: now, type: "span-create", body: common });
    }
    span.events.forEach((event, index) => {
      events.push({
        id: `${span.spanId}-event-${index}`,
        timestamp: now,
        type: "event-create",
        body: {
          id: `${span.spanId}-e${index}`,
          traceId: span.traceId,
          parentObservationId: span.spanId,
          name: event.name,
          startTime: iso(event.time),
          ...(event.attributes ? { metadata: event.attributes } : {}),
          ...env,
        },
      });
    });
  }
  return events;
}

export class LangfuseSpanExporter implements SpanExporter {
  private readonly endpoint: string;
  private readonly authorization: string;

  constructor(private readonly options: LangfuseExporterOptions) {
    this.endpoint = `${(options.baseUrl ?? "https://cloud.langfuse.com").replace(/\/+$/, "")}/api/public/ingestion`;
    this.authorization = `Basic ${btoa(`${options.publicKey}:${options.secretKey}`)}`;
  }

  async export(spans: SpanData[]): Promise<void> {
    if (spans.length === 0) return;
    const events = spansToLangfuseEvents(spans, {
      ...(this.options.environment ? { environment: this.options.environment } : {}),
      ...(this.options.release ? { release: this.options.release } : {}),
      now: (this.options.clock ?? Date.now)(),
    });
    const size = Math.max(1, this.options.maxBatchSize ?? 100);
    const failures: LangfuseIngestionError[] = [];
    for (let i = 0; i < events.length; i += size) {
      const batch = events.slice(i, i + size);
      const response = await (this.options.fetch ?? fetch)(this.endpoint, {
        method: "POST",
        headers: { authorization: this.authorization, "content-type": "application/json" },
        body: JSON.stringify({ batch, metadata: { sdk_integration: "agent-starter", batch_size: batch.length } }),
      });
      if (!response.ok) throw await HttpError.fromResponse(response, "Langfuse ingestion");
      const result = (await response.json().catch(() => ({}))) as { errors?: LangfuseIngestionError[] };
      if (Array.isArray(result.errors)) failures.push(...result.errors);
    }
    if (failures.length > 0) {
      if (this.options.onPartialFailure) this.options.onPartialFailure(failures);
      else throw new Error(`Langfuse rejected ${failures.length} event(s): ${failures.slice(0, 3).map((f) => `${f.id} (${f.status}${f.message ? `: ${f.message}` : ""})`).join("; ")}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * TelemetryEvent → Langfuse (dual-streamed next to webhooks / Pusher)
 * ------------------------------------------------------------------ */

const SPAN_KIND: Partial<Record<TelemetryEvent["type"], SpanData["kind"]>> = { model: "llm", tool: "tool", sandbox: "sandbox", memory: "retrieval", turn: "agent", message: "agent" };

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * Map one telemetry event (the real-time contract every agent emits) to a finished
 * span: one Langfuse trace per run (`runId` = trace id and session id), model
 * events become generations with model/tokens/cost, tool events become tool spans,
 * everything else a span with the event text in metadata.
 */
export function telemetryEventToSpan(event: TelemetryEvent): SpanData {
  const data = event.data ?? {};
  const durationMs = num(data.durationMs) ?? 0;
  const attributes: Record<string, AttributeValue> = {
    [SpanAttr.tenantId]: event.tenantId,
    [SpanAttr.runId]: event.runId,
    [SpanAttr.agentName]: event.senderRole,
    "agent.event_type": event.type,
    "agent.log_type": event.logType,
    "agent.content": event.content.slice(0, 2000),
    "agent.turn_count": event.turnCount,
    "agent.accumulated_cost_usd": event.accumulatedCost,
    ...(event.roomId ? { "agent.room_id": event.roomId } : {}),
    ...(event.status ? { "agent.status": event.status } : {}),
  };
  if (event.type === "model") {
    const model = str(data.model);
    if (model) attributes[SpanAttr.requestModel] = model;
    const input = num(data.inputTokens);
    const output = num(data.outputTokens);
    if (input !== undefined) attributes[SpanAttr.inputTokens] = input;
    if (output !== undefined) attributes[SpanAttr.outputTokens] = output;
    if (input === undefined && output === undefined && num(data.tokens) !== undefined) attributes["agent.total_tokens"] = num(data.tokens);
    const cost = num(data.costUsd);
    if (cost !== undefined) attributes[SpanAttr.costUsd] = cost;
  }
  if (event.type === "tool") {
    const tool = str(data.tool);
    if (tool) attributes[SpanAttr.toolName] = tool;
  }
  const name = event.type === "tool" ? `tool:${str(data.tool) ?? "unknown"}` : event.type === "model" ? `model:${str(data.model) ?? "call"}` : event.type;
  return {
    traceId: event.runId,
    spanId: event.id,
    name,
    kind: SPAN_KIND[event.type] ?? "internal",
    startTime: event.timestamp - durationMs,
    endTime: event.timestamp,
    status: event.logType === "error" ? "error" : "ok",
    ...(event.logType === "error" ? { statusMessage: event.content.slice(0, 500) } : {}),
    attributes,
    events: [],
  };
}

export interface LangfuseTelemetrySinkOptions extends LangfuseExporterOptions {
  /** Export through another SpanExporter (tests, OTLP); default: a LangfuseSpanExporter built from these options. */
  exporter?: SpanExporter;
  /** Event types to skip (e.g. high-volume "log"). Default: none. */
  skip?: Array<TelemetryEvent["type"]>;
}

/**
 * TelemetrySink that streams agent telemetry events to Langfuse as standalone spans.
 * Optional: generated projects export per-step traces to Langfuse through
 * `LangfuseSpanExporter` (platform `traceExporters()`), and their `telemetrySinks()`
 * do not include this sink. Add it there only if you also want event-level spans
 * (ops alerts, status changes) outside the traces. Partial ingestion failures are
 * logged, never thrown into the agent.
 */
export class LangfuseTelemetrySink implements TelemetrySink {
  private readonly exporter: SpanExporter;
  private readonly skip: Set<string>;

  constructor(options: LangfuseTelemetrySinkOptions) {
    this.exporter = options.exporter ?? new LangfuseSpanExporter({ onPartialFailure: (errors) => console.warn(`[langfuse] ${errors.length} event(s) rejected`), ...options });
    this.skip = new Set(options.skip ?? []);
  }

  async publish(event: TelemetryEvent): Promise<void> {
    if (this.skip.has(event.type)) return;
    await this.exporter.export([telemetryEventToSpan(event)]);
  }
}
