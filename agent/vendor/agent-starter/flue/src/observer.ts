import { parseAgentInstanceId, randomId, type Span, SpanAttr, type SpanData, type SpanExporter, type TelemetryEvent, type TelemetrySink, Tracer } from "@agent-starter/core";
import { type FlueObservation, observe } from "@flue/runtime";
import { modelHealth } from "./runtime.ts";

export interface ObserverOptions {
  /** Sinks receive TelemetryEvents mapped from Flue observations (webhook relay, Pusher, Langfuse bridge...). */
  sinks?: (env: Record<string, unknown>) => TelemetrySink[];
  /** Resolve the tenant for an agent instance id (default: `parseAgentInstanceId(id).tenantId`, else "unknown"). */
  tenantOf?: (instanceId: string) => string;
  onError?: (error: unknown) => void;
  /** Raw hook for every observation (e.g. update the run registry on submission_running / submission_settled). */
  onEvent?: (event: Record<string, unknown> & { type: string }, context: { instanceId: string; agentName: string; tenantId: string; env: Record<string, unknown> }) => void | Promise<void>;
  /**
   * Per-step structured traces (R-OBS-01): one trace per submission with the waking payload, the exact
   * prompt of every model turn, reasoning, tool args/outputs, codemode code + console output and the
   * DB deltas tools report through `recordDbDelta()`. Exported to Langfuse / OTLP span exporters.
   */
  tracing?: ObserverTracingOptions;
}

export interface ObserverTracingOptions {
  /** Span exporters for an event's env (bindings): `OtlpHttpSpanExporter`, `LangfuseSpanExporter`. Return [] to skip tracing. */
  exporters: (env: Record<string, unknown>) => SpanExporter[];
  /** What to record (everything by default). Turn `prompt` / `toolIo` off for data you must not ship to a tracing backend. */
  capture?: { eventPayload?: boolean; prompt?: boolean; reasoning?: boolean; toolIo?: boolean; dbDelta?: boolean };
  /** Tools whose input is sandbox code or a command and output is console output. Default `run_code` (codemode), `execute_sandbox_command` (VM), `run_command` (coder). */
  sandboxTools?: string[];
  /** Characters kept per attribute. Default 16000. */
  maxAttributeChars?: number;
  /** Redact keys/JWTs/private keys before export. Default true. */
  redact?: boolean;
  /** Receives each export promise (e.g. a `waitUntil`). Default: fire and forget (errors go to `onError`). */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Open run traces kept in memory; the oldest is flushed when exceeded. Default 200. */
  maxOpenRuns?: number;
  clock?: () => number;
}

/** A change a tool made to durable state, attached to the current trace step as `db.delta`. */
export type DbDelta = Record<string, string | number | boolean | null | undefined>;

function defaultTenantOf(instanceId: string): string {
  return parseAgentInstanceId(instanceId)?.tenantId ?? "unknown";
}

const recorders = new Set<FlueTraceRecorder>();

/**
 * Attach a durable-state change (row upserted, attribute set, file committed...) to the
 * trace of `runId`: on the span of tool call `toolCallId` (pass `ctx.toolCallId` from a tool),
 * else on the only open tool span, else on the run's root span. Always listed in the root's
 * `db.delta` attribute. A no-op when tracing is off or the run has no open trace.
 */
export function recordDbDelta(runId: string, delta: DbDelta, toolCallId?: string): void {
  for (const recorder of recorders) recorder.recordDbDelta(runId, delta, toolCallId);
}

/**
 * Process-wide Flue observer (register once at `app.ts` module scope):
 *  - feeds provider failures/successes into the circuit breaker that
 *    `useAgentStarter` reads to pick fallback models;
 *  - maps model turns, tool calls and settlements to TelemetryEvents for
 *    dashboards, webhooks and alerting (submission failures → error events);
 *  - with `tracing`, records per-step traces and exports them to Langfuse / OTLP.
 */
export function installAgentStarterObserver(options: ObserverOptions = {}): () => void {
  const tenantOf = options.tenantOf ?? defaultTenantOf;
  const recorder = options.tracing ? new FlueTraceRecorder(options.tracing, options.onError) : undefined;
  if (recorder) recorders.add(recorder);
  const stop = observe((event: FlueObservation, ctx) => {
    try {
      const anyEvent = event as unknown as Record<string, unknown> & { type: string };
      if (anyEvent.type === "turn") {
        const request = anyEvent.request as { providerId?: string; requestedModel?: string } | undefined;
        const provider = request?.providerId;
        if (provider) {
          if (anyEvent.isError) modelHealth.recordFailure(provider);
          else modelHealth.recordSuccess(provider);
        }
      }
      const context = { instanceId: ctx.id, agentName: ctx.agentName ?? "agent", tenantId: tenantOf(ctx.id), env: ctx.env as Record<string, unknown> };
      if (recorder) {
        try {
          recorder.record(anyEvent, context);
        } catch (error) {
          options.onError?.(error);
        }
      }
      if (options.onEvent) {
        void Promise.resolve(options.onEvent(anyEvent, context)).catch((error: unknown) => options.onError?.(error));
      }
      if (!options.sinks) return;
      const mapped = mapObservation(anyEvent, ctx.id, context.tenantId, context.agentName);
      if (!mapped) return;
      for (const sink of options.sinks(context.env)) {
        void sink.publish(mapped).catch((error: unknown) => options.onError?.(error));
      }
    } catch (error) {
      options.onError?.(error);
    }
  });
  return () => {
    stop();
    if (recorder) {
      recorders.delete(recorder);
      recorder.flushAll();
    }
  };
}

export function mapObservation(event: Record<string, unknown> & { type: string }, instanceId: string, tenantId: string, agentName: string): TelemetryEvent | null {
  const base = { id: randomId("evt"), runId: instanceId, tenantId, senderId: agentName, senderRole: agentName, turnCount: 0, accumulatedCost: 0, runtimeSeconds: 0, timestamp: Date.now() };
  switch (event.type) {
    case "turn": {
      const response = event.response as { usage?: { totalTokens?: number; cost?: { total?: number } }; error?: { message?: string } } | undefined;
      const request = event.request as { requestedModel?: string } | undefined;
      return {
        ...base,
        type: "model",
        content: event.isError ? `Model call failed (${request?.requestedModel ?? "?"}): ${response?.error?.message ?? "error"}` : `Model call ${request?.requestedModel ?? ""}: ${response?.usage?.totalTokens ?? 0} tokens`,
        logType: event.isError ? "error" : "cognitive",
        accumulatedCost: response?.usage?.cost?.total ?? 0,
        data: { tokens: response?.usage?.totalTokens ?? 0, costUsd: response?.usage?.cost?.total ?? 0, model: request?.requestedModel ?? null },
      };
    }
    case "tool":
      return { ...base, type: "tool", content: `${String(event.toolName)} ${event.isError ? "failed" : "completed"} in ${String(event.durationMs ?? 0)}ms`, logType: event.isError ? "error" : "success", data: { tool: event.toolName, toolCallId: event.toolCallId } };
    case "submission_settled": {
      const outcome = String(event.outcome);
      const error = event.error as { message?: string } | undefined;
      return { ...base, type: "status", content: `Submission ${outcome}${error?.message ? `: ${error.message}` : ""}`, logType: outcome === "completed" ? "success" : "error", status: outcome === "completed" ? "COMPLETED" : outcome === "aborted" ? "TERMINATED" : "FAILED" };
    }
    case "task_start":
      return { ...base, type: "log", content: `Subagent task started: ${String(event.agent ?? "general")}`, logType: "cognitive" };
    case "compaction":
      return { ...base, type: "memory", content: `Context compacted (${String(event.messagesBefore)} → ${String(event.messagesAfter)} messages)`, logType: "cognitive" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Per-step tracing (R-OBS-01)
 * ------------------------------------------------------------------ */

type Content = { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown; data?: string; mimeType?: string };
type LlmMessage = { role?: string; content?: string | Content[]; toolName?: string; isError?: boolean };

interface RunTrace {
  tracer: Tracer;
  root: Span;
  rootOperationId?: string;
  operations: Map<string, Span>;
  turns: Map<string, Span>;
  tools: Map<string, Span>;
  tasks: Map<string, Span>;
  compaction?: Span;
  openTools: string[];
  openTasks: string[];
  payloadSet: boolean;
  deltas: DbDelta[];
  lastSeen: number;
}

const DEFAULT_SANDBOX_TOOLS = ["run_code", "execute_sandbox_command", "run_command"];

function textOf(content: string | Content[] | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : c.type === "image" ? `[image ${c.mimeType ?? ""}]` : "")).filter(Boolean).join("\n");
}

/** Compact, replayable view of a model request: system prompt, messages (text, tool calls, tool results) and tool names. */
export function promptOf(input: { systemPrompt?: string; messages?: LlmMessage[]; tools?: Array<{ name?: string }> } | undefined): Record<string, unknown> {
  const messages = (input?.messages ?? []).map((m) => {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const calls = m.content.filter((c) => c.type === "toolCall").map((c) => ({ name: c.name, arguments: c.arguments }));
      return { role: "assistant", content: textOf(m.content), ...(calls.length ? { toolCalls: calls } : {}) };
    }
    if (m.role === "toolResult") return { role: "tool", name: m.toolName, content: textOf(m.content), ...(m.isError ? { isError: true } : {}) };
    return { role: m.role ?? "user", content: textOf(m.content) };
  });
  return { system: input?.systemPrompt ?? "", messages, tools: (input?.tools ?? []).map((t) => t.name) };
}

/**
 * Maps Flue observations to spans: one trace per submission/operation (`agent` root with the waking
 * payload), an `llm` span per model turn (exact prompt, completion, reasoning, tokens, cost, cache hit),
 * a `tool` (or `sandbox`) span per tool call, `agent` spans for subagent tasks and an `internal` span
 * per compaction. Finished traces are flushed to the exporters for that env.
 */
export class FlueTraceRecorder {
  private readonly runs = new Map<string, RunTrace>();
  private readonly capture: Required<NonNullable<ObserverTracingOptions["capture"]>>;
  private readonly sandboxTools: Set<string>;
  private readonly clock: () => number;

  constructor(
    private readonly options: ObserverTracingOptions,
    private readonly onError?: (error: unknown) => void,
  ) {
    this.capture = { eventPayload: true, prompt: true, reasoning: true, toolIo: true, dbDelta: true, ...options.capture };
    this.sandboxTools = new Set(options.sandboxTools ?? DEFAULT_SANDBOX_TOOLS);
    this.clock = options.clock ?? Date.now;
  }

  /** Open traces (for tests and diagnostics). */
  openRuns(): number {
    return this.runs.size;
  }

  record(event: Record<string, unknown> & { type: string }, context: { instanceId: string; agentName: string; tenantId: string; env: Record<string, unknown> }): void {
    const id = context.instanceId;
    switch (event.type) {
      case "submission_running": {
        const run = this.runs.get(id) ?? this.start(context, event);
        run.root.setAttribute("flue.submission_id", event.submissionId);
        return;
      }
      case "operation_start": {
        const opId = String(event.operationId ?? "");
        let run = this.runs.get(id);
        if (!run) {
          run = this.start(context, event);
          run.rootOperationId = opId;
          run.operations.set(opId, run.root);
          return;
        }
        if (!run.rootOperationId && !event.taskId && run.openTasks.length === 0) {
          run.rootOperationId = opId;
          run.operations.set(opId, run.root);
          return;
        }
        run.operations.set(opId, run.tracer.startSpan(`operation:${String(event.operationKind ?? "prompt")}`, { kind: "agent", parent: this.taskParent(run, event) }));
        return;
      }
      case "turn_request": {
        const run = this.runs.get(id) ?? this.start(context, event);
        const request = event.request as { providerId?: string; requestedModel?: string; reasoningLevel?: string; maxTokens?: number; input?: Parameters<typeof promptOf>[0] } | undefined;
        const span = run.tracer.startSpan(`chat ${request?.requestedModel ?? "model"}`, {
          kind: "llm",
          parent: this.parentOf(run, event),
          attributes: {
            [SpanAttr.system]: request?.providerId,
            [SpanAttr.requestModel]: request?.requestedModel,
            [SpanAttr.turn]: event.turnId,
            "gen_ai.request.reasoning_level": request?.reasoningLevel,
            "flue.turn_purpose": event.purpose,
            ...(this.capture.prompt ? { [SpanAttr.prompt]: promptOf(request?.input) } : {}),
          },
        });
        run.turns.set(String(event.turnId), span);
        if (!run.payloadSet && this.capture.eventPayload && event.purpose === "agent") {
          const lastUser = [...(request?.input?.messages ?? [])].reverse().find((m) => m.role === "user");
          if (lastUser) {
            run.root.setAttribute(SpanAttr.eventPayload, textOf(lastUser.content));
            run.payloadSet = true;
          }
        }
        return;
      }
      case "turn": {
        const run = this.runs.get(id) ?? this.start(context, event);
        const response = event.response as { responseId?: string; responseModel?: string; output?: { content?: Content[] }; usage?: { input?: number; output?: number; cacheRead?: number; cost?: { total?: number } }; finishReason?: string; error?: { message?: string } } | undefined;
        const request = event.request as { requestedModel?: string } | undefined;
        const span = run.turns.get(String(event.turnId)) ?? run.tracer.startSpan(`chat ${request?.requestedModel ?? "model"}`, { kind: "llm", parent: this.parentOf(run, event) });
        run.turns.delete(String(event.turnId));
        const content = response?.output?.content ?? [];
        const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        const calls = content.filter((c) => c.type === "toolCall").map((c) => ({ name: c.name, arguments: c.arguments }));
        const reasoning = content.filter((c) => c.type === "thinking").map((c) => c.thinking ?? "").join("\n");
        span.setAttributes({
          [SpanAttr.responseModel]: response?.responseModel ?? request?.requestedModel,
          [SpanAttr.inputTokens]: response?.usage?.input,
          [SpanAttr.outputTokens]: response?.usage?.output,
          [SpanAttr.costUsd]: response?.usage?.cost?.total,
          "gen_ai.usage.cache_read.input_tokens": response?.usage?.cacheRead,
          "gen_ai.response.finish_reasons": response?.finishReason,
          "agent.semantic_cache_hit": typeof response?.responseId === "string" && response.responseId.startsWith("semcache_") ? true : undefined,
          ...(this.capture.prompt ? { [SpanAttr.completion]: text || (calls.length ? calls : undefined) } : {}),
          ...(this.capture.reasoning && reasoning ? { [SpanAttr.reasoning]: reasoning } : {}),
        });
        if (event.isError) span.end("error", response?.error?.message ?? "model call failed");
        else span.end("ok");
        return;
      }
      case "tool_start": {
        const run = this.runs.get(id) ?? this.start(context, event);
        const name = String(event.toolName ?? "tool");
        const sandbox = this.sandboxTools.has(name);
        const args = event.args;
        const fields = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
        const code = sandbox ? (fields.code ?? fields.script ?? fields.command ?? args) : args;
        const span = run.tracer.startSpan(`${sandbox ? "sandbox" : "tool"}:${name}`, {
          kind: sandbox ? "sandbox" : "tool",
          parent: this.parentOf(run, event),
          attributes: { [SpanAttr.toolName]: name, "gen_ai.tool.call.id": event.toolCallId, ...(this.capture.toolIo ? (sandbox ? { [SpanAttr.sandboxCode]: code } : { [SpanAttr.toolArgs]: args }) : {}) },
        });
        run.tools.set(String(event.toolCallId), span);
        run.openTools.push(String(event.toolCallId));
        return;
      }
      case "tool": {
        const run = this.runs.get(id);
        if (!run) return;
        const callId = String(event.toolCallId);
        const span = run.tools.get(callId);
        if (!span) return;
        run.tools.delete(callId);
        run.openTools = run.openTools.filter((t) => t !== callId);
        if (this.capture.toolIo) span.setAttribute(span.data.kind === "sandbox" ? SpanAttr.sandboxOutput : SpanAttr.toolResult, event.result);
        if (event.isError) span.end("error", typeof event.result === "string" ? event.result.slice(0, 300) : "tool failed");
        else span.end("ok");
        return;
      }
      case "task_start": {
        const run = this.runs.get(id) ?? this.start(context, event);
        const span = run.tracer.startSpan(`task:${String(event.agent ?? "general")}`, { kind: "agent", parent: this.parentOf(run, event), attributes: this.capture.eventPayload ? { [SpanAttr.eventPayload]: event.prompt } : {} });
        run.tasks.set(String(event.taskId), span);
        run.openTasks.push(String(event.taskId));
        return;
      }
      case "task": {
        const run = this.runs.get(id);
        const span = run?.tasks.get(String(event.taskId));
        if (!run || !span) return;
        run.tasks.delete(String(event.taskId));
        run.openTasks = run.openTasks.filter((t) => t !== String(event.taskId));
        if (this.capture.prompt) span.setAttribute(SpanAttr.completion, event.result);
        if (event.isError) span.end("error", "subagent task failed");
        else span.end("ok");
        return;
      }
      case "compaction_start": {
        const run = this.runs.get(id) ?? this.start(context, event);
        run.compaction = run.tracer.startSpan("compaction", { kind: "internal", parent: this.parentOf(run, event), attributes: { "agent.compaction.reason": event.reason, "agent.compaction.estimated_tokens": event.estimatedTokens } });
        return;
      }
      case "compaction": {
        const run = this.runs.get(id);
        const span = run?.compaction;
        if (!run || !span) return;
        run.compaction = undefined;
        span.setAttributes({ "agent.compaction.messages_before": event.messagesBefore, "agent.compaction.messages_after": event.messagesAfter });
        if (event.isError) span.end("error", "compaction failed");
        else span.end("ok");
        return;
      }
      case "operation": {
        const run = this.runs.get(id);
        if (!run) return;
        const opId = String(event.operationId ?? "");
        const span = run.operations.get(opId);
        if (!span) return;
        run.operations.delete(opId);
        const input = event.agentInput as { text?: string } | undefined;
        const output = event.agentOutput as { type?: string; text?: string; data?: unknown } | undefined;
        if (this.capture.eventPayload && input?.text && (span !== run.root || !run.payloadSet)) {
          span.setAttribute(SpanAttr.eventPayload, input.text);
          if (span === run.root) run.payloadSet = true;
        }
        if (this.capture.prompt && output) span.setAttribute(SpanAttr.completion, output.type === "data" ? output.data : output.text);
        if (span === run.root) {
          this.finish(id, run, event.isError ? "error" : "ok", event.isError ? "operation failed" : undefined);
          return;
        }
        if (event.isError) span.end("error", "operation failed");
        else span.end("ok");
        return;
      }
      case "submission_settled": {
        const run = this.runs.get(id);
        if (!run) return;
        const outcome = String(event.outcome);
        const error = event.error as { message?: string } | undefined;
        run.root.setAttribute("flue.submission_outcome", outcome);
        this.finish(id, run, outcome === "completed" ? "ok" : "error", error?.message ?? (outcome === "completed" ? undefined : outcome));
        return;
      }
      default:
        return;
    }
  }

  recordDbDelta(runId: string, delta: DbDelta, toolCallId?: string): void {
    if (!this.capture.dbDelta) return;
    const run = this.runs.get(runId);
    if (!run) return;
    const toolId = toolCallId && run.tools.has(toolCallId) ? toolCallId : run.openTools.length === 1 ? run.openTools[0] : undefined;
    const span = (toolId ? run.tools.get(toolId) : undefined) ?? run.root;
    span.addEvent(SpanAttr.dbDelta, delta);
    if (run.deltas.length < 100) run.deltas.push(delta);
  }

  /** Flush every open trace (shutdown). */
  flushAll(): void {
    for (const [id, run] of [...this.runs]) this.finish(id, run, "unset", "trace flushed before the run settled");
  }

  private start(context: { instanceId: string; agentName: string; tenantId: string; env: Record<string, unknown> }, event: Record<string, unknown>): RunTrace {
    const max = Math.max(1, this.options.maxOpenRuns ?? 200);
    while (this.runs.size >= max) {
      const oldest = [...this.runs.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (!oldest) break;
      this.finish(oldest[0], oldest[1], "unset", "trace evicted before the run settled");
    }
    let exporters: SpanExporter[] = [];
    try {
      exporters = this.options.exporters(context.env);
    } catch (error) {
      this.onError?.(error);
    }
    const tracer = new Tracer({
      exporters,
      clock: this.clock,
      ...(this.options.maxAttributeChars ? { maxAttributeChars: this.options.maxAttributeChars } : {}),
      ...(this.options.redact === false ? { redact: false } : {}),
      baseAttributes: { [SpanAttr.tenantId]: context.tenantId, [SpanAttr.runId]: context.instanceId, [SpanAttr.agentName]: context.agentName },
    });
    const root = tracer.startSpan(`agent ${context.agentName}`, { kind: "agent", attributes: { ...(event.submissionId ? { "flue.submission_id": event.submissionId } : {}) } });
    const run: RunTrace = { tracer, root, operations: new Map(), turns: new Map(), tools: new Map(), tasks: new Map(), openTools: [], openTasks: [], payloadSet: false, deltas: [], lastSeen: this.clock() };
    this.runs.set(context.instanceId, run);
    return run;
  }

  private parentOf(run: RunTrace, event: Record<string, unknown>): Span {
    run.lastSeen = this.clock();
    const op = event.operationId ? run.operations.get(String(event.operationId)) : undefined;
    return op ?? this.taskParent(run, event);
  }

  private taskParent(run: RunTrace, event: Record<string, unknown>): Span {
    const task = event.taskId ? run.tasks.get(String(event.taskId)) : run.openTasks.length ? run.tasks.get(run.openTasks.at(-1) as string) : undefined;
    return task ?? run.root;
  }

  private finish(id: string, run: RunTrace, status: SpanData["status"], message?: string): void {
    this.runs.delete(id);
    for (const span of [...run.tools.values(), ...run.turns.values(), ...run.tasks.values(), ...(run.compaction ? [run.compaction] : []), ...run.operations.values()]) {
      if (span !== run.root) span.end("error", "unfinished when the run ended");
    }
    if (run.deltas.length) run.root.setAttribute(SpanAttr.dbDelta, run.deltas);
    run.root.end(status, message);
    const flushed = run.tracer.flush().catch((error: unknown) => this.onError?.(error));
    if (this.options.waitUntil) this.options.waitUntil(flushed);
    else void flushed;
  }
}
