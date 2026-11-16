import { redactDeep } from "../guardrails/pii.ts";
import { randomId } from "../util/crypto.ts";
import { truncate } from "../util/text.ts";

/**
 * Semantic attribute names for agent traces (aligned with OpenTelemetry GenAI
 * conventions where they exist). Every fiber step records the cognitive
 * trajectory: waking event, exact prompt, reasoning, sandbox code + output, and
 * the SQLite delta.
 */
export const SpanAttr = {
  tenantId: "agent.tenant_id",
  runId: "agent.run_id",
  agentName: "agent.name",
  eventPayload: "agent.event.payload",
  step: "agent.step",
  turn: "agent.turn",
  system: "gen_ai.system",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  prompt: "gen_ai.prompt",
  completion: "gen_ai.completion",
  reasoning: "gen_ai.reasoning",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  reasoningTokens: "gen_ai.usage.reasoning_tokens",
  costUsd: "agent.cost_usd",
  toolName: "gen_ai.tool.name",
  toolArgs: "gen_ai.tool.arguments",
  toolResult: "gen_ai.tool.result",
  sandboxCode: "sandbox.code",
  sandboxOutput: "sandbox.output",
  sandboxExitCode: "sandbox.exit_code",
  dbDelta: "db.delta",
  riskTier: "agent.risk_tier",
  errorCode: "error.code",
} as const;

export type SpanStatus = "ok" | "error" | "unset";
export type AttributeValue = string | number | boolean | undefined;

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "agent" | "llm" | "tool" | "retrieval" | "sandbox" | "internal";
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  statusMessage?: string;
  attributes: Record<string, AttributeValue>;
  events: Array<{ name: string; time: number; attributes?: Record<string, AttributeValue> }>;
}

export interface SpanExporter {
  export(spans: SpanData[]): Promise<void>;
}

export class Span {
  constructor(
    readonly data: SpanData,
    private readonly tracer: Tracer,
  ) {}

  setAttribute(key: string, value: unknown): this {
    this.data.attributes[key] = normalizeAttribute(value, this.tracer.maxAttributeChars);
    return this;
  }

  setAttributes(attributes: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(attributes)) this.setAttribute(k, v);
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.data.events.push({
      name,
      time: this.tracer.clock(),
      ...(attributes ? { attributes: Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, normalizeAttribute(v, this.tracer.maxAttributeChars)])) } : {}),
    });
    return this;
  }

  child(name: string, kind: SpanData["kind"] = "internal", attributes: Record<string, unknown> = {}): Span {
    return this.tracer.startSpan(name, { kind, parent: this, attributes });
  }

  end(status: SpanStatus = "ok", message?: string): void {
    if (this.data.endTime !== undefined) return;
    this.data.endTime = this.tracer.clock();
    this.data.status = status;
    if (message) this.data.statusMessage = message;
    this.tracer.finish(this);
  }

  fail(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.setAttribute(SpanAttr.errorCode, (err as { code?: string }).code ?? err.name);
    this.end("error", err.message);
  }
}

function normalizeAttribute(value: unknown, maxChars: number): AttributeValue {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = typeof value === "string" ? value : JSON.stringify(redactDeep(value));
  return truncate(text, maxChars);
}

export interface TracerOptions {
  exporters?: SpanExporter[];
  clock?: () => number;
  maxAttributeChars?: number;
  /** Redact secrets (keys/JWTs/private keys) from string attributes before export. */
  redact?: boolean;
  baseAttributes?: Record<string, AttributeValue>;
}

/** Minimal dependency-free tracer that buffers finished spans and flushes them to exporters (OTLP, Langfuse, console). */
export class Tracer {
  readonly clock: () => number;
  readonly maxAttributeChars: number;
  private readonly exporters: SpanExporter[];
  private readonly buffer: SpanData[] = [];
  private readonly redact: boolean;
  private readonly baseAttributes: Record<string, AttributeValue>;

  constructor(options: TracerOptions = {}) {
    this.exporters = options.exporters ?? [];
    this.clock = options.clock ?? Date.now;
    this.maxAttributeChars = options.maxAttributeChars ?? 16_000;
    this.redact = options.redact ?? true;
    this.baseAttributes = options.baseAttributes ?? {};
  }

  startSpan(name: string, options: { kind?: SpanData["kind"]; parent?: Span; traceId?: string; attributes?: Record<string, unknown> } = {}): Span {
    const span = new Span(
      {
        traceId: options.parent?.data.traceId ?? options.traceId ?? randomId(),
        spanId: randomId().slice(0, 16),
        ...(options.parent ? { parentSpanId: options.parent.data.spanId } : {}),
        name,
        kind: options.kind ?? "internal",
        startTime: this.clock(),
        status: "unset",
        attributes: { ...this.baseAttributes },
        events: [],
      },
      this,
    );
    if (options.attributes) span.setAttributes(options.attributes);
    return span;
  }

  async withSpan<T>(name: string, kind: SpanData["kind"], fn: (span: Span) => Promise<T>, parent?: Span): Promise<T> {
    const span = this.startSpan(name, { kind, ...(parent ? { parent } : {}) });
    try {
      const result = await fn(span);
      span.end("ok");
      return result;
    } catch (error) {
      span.fail(error);
      throw error;
    }
  }

  finish(span: Span): void {
    this.buffer.push(this.redact ? redactDeep(span.data) : span.data);
  }

  pending(): number {
    return this.buffer.length;
  }

  /** Flush buffered spans; call from `ctx.waitUntil()` so export never blocks a turn. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.exporters.length === 0) {
      this.buffer.length = 0;
      return;
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    await Promise.all(
      this.exporters.map(async (exporter) => {
        try {
          await exporter.export(batch);
        } catch (error) {
          console.error("[tracer] export failed", error);
        }
      }),
    );
  }
}

export class ConsoleSpanExporter implements SpanExporter {
  async export(spans: SpanData[]): Promise<void> {
    for (const span of spans) {
      console.log(`[trace ${span.traceId.slice(0, 8)}] ${span.kind}:${span.name} ${span.status} ${(span.endTime ?? span.startTime) - span.startTime}ms`);
    }
  }
}

export class MemorySpanExporter implements SpanExporter {
  readonly spans: SpanData[] = [];
  async export(spans: SpanData[]): Promise<void> {
    this.spans.push(...spans);
  }
}

/**
 * OTLP/HTTP JSON exporter. Works with any OpenTelemetry collector, Langfuse's
 * OTel endpoint, Arize Phoenix, Honeycomb, Grafana, etc.
 */
export class OtlpHttpSpanExporter implements SpanExporter {
  constructor(
    private readonly options: { endpoint: string; headers?: Record<string, string>; serviceName: string; fetch?: typeof fetch },
  ) {}

  async export(spans: SpanData[]): Promise<void> {
    const doFetch = this.options.fetch ?? fetch;
    const body = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: this.options.serviceName } }] },
          scopeSpans: [
            {
              scope: { name: "@agent-starter/core" },
              spans: spans.map((s) => ({
                traceId: s.traceId.padEnd(32, "0").slice(0, 32),
                spanId: s.spanId.padEnd(16, "0").slice(0, 16),
                ...(s.parentSpanId ? { parentSpanId: s.parentSpanId.padEnd(16, "0").slice(0, 16) } : {}),
                name: s.name,
                kind: s.kind === "llm" || s.kind === "tool" ? 3 : 1,
                startTimeUnixNano: String(BigInt(s.startTime) * 1_000_000n),
                endTimeUnixNano: String(BigInt(s.endTime ?? s.startTime) * 1_000_000n),
                attributes: toOtlpAttributes({ ...s.attributes, "agent.span_kind": s.kind }),
                events: s.events.map((e) => ({ name: e.name, timeUnixNano: String(BigInt(e.time) * 1_000_000n), attributes: toOtlpAttributes(e.attributes ?? {}) })),
                status: { code: s.status === "ok" ? 1 : s.status === "error" ? 2 : 0, ...(s.statusMessage ? { message: s.statusMessage } : {}) },
              })),
            },
          ],
        },
      ],
    };
    const response = await doFetch(this.options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.options.headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OTLP export failed: HTTP ${response.status}`);
  }
}

function toOtlpAttributes(attributes: Record<string, AttributeValue>) {
  return Object.entries(attributes)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => ({
      key,
      value: typeof value === "number" ? (Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }) : typeof value === "boolean" ? { boolValue: value } : { stringValue: String(value) },
    }));
}
