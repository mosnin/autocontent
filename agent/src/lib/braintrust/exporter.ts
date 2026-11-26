import { OtlpHttpSpanExporter, parseConversationInstanceId, type SpanData, type SpanExporter } from "@agent-starter/core";
import { type DecisionCall, type RunAnnotations, traceSpanIdFor } from "./annotations.ts";
import { type BraintrustConfig, braintrustHeaders, type ContentMode, tracesEndpoint } from "./config.ts";
import { maskSpan } from "./mask.ts";

/**
 * Braintrust OTLP exporter (docs/observability/braintrust.md). It sits in `traceExporters()` beside Langfuse and the
 * generic OTLP exporter and receives each finished run trace from the Flue trace recorder. For every trace it:
 *
 *  1. resolves the content mode (global BRAINTRUST_CONTENT, lowered to `metadata` by the workspace setting);
 *  2. adds what the recorder does not know: identity on the root (agent, tenant_id, actor_id, conversation_id, role,
 *     env, release), the scores (`rails_blocked`, `decision_fallback`, `approval`) and one GenAI span per
 *     decision-model call;
 *  3. masks every span with the one masking function (mask.ts);
 *  4. shapes spans for Braintrust: model turns as GenAI chat spans (`gen_ai.prompt_json`, usage, model), tool calls as
 *     `execute_tool` spans, agent spans as tasks with `braintrust.input` / `braintrust.output`;
 *  5. gives the root span its deterministic id (annotations.ts `traceSpanIdFor`), the `traceSpanId` the delivered
 *     message carries;
 *  6. POSTs OTLP/JSON to `{BRAINTRUST_API_URL}/otel/v1/traces` with a timeout.
 *
 * It never throws: a failure is logged once per isolate and dropped (rule 2); rejected spans in a 200
 * (`partialSuccess.rejectedSpans`) are counted and logged once.
 */

export interface BraintrustExporterOptions {
  config: BraintrustConfig;
  /** service.name, also the `env` attribute on root spans. */
  serviceName: string;
  /** CODE_VERSION, the `release` attribute on root spans. */
  release?: string;
  /** The workspace's content setting (60 s cache, unreadable ⇒ metadata). Omitted: the global mode alone. */
  workspaceContent?: (tenantId: string) => Promise<ContentMode>;
  /** Run annotations (identity, scores, decision calls). */
  annotations?: (instanceId: string, submissionId: string | undefined) => RunAnnotations;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (message: string) => void;
}

export const braintrustExportStats = { batches: 0, spans: 0, rejectedSpans: 0, failures: 0 };
const logged = { failure: false, rejected: false };

/** Tests only. */
export function resetBraintrustExportStats(): void {
  Object.assign(braintrustExportStats, { batches: 0, spans: 0, rejectedSpans: 0, failures: 0 });
  logged.failure = false;
  logged.rejected = false;
}

const RAILS_BLOCKED = /PENDING_APPROVAL|TOOL_NOT_ALLOWED|AUTO_REVIEW_BLOCKED|RAILS_[A-Z_]+|SECURITY_EXCEPTION_HALT/;

/** Did the rails refuse or park this tool call? Read from the raw result before masking. */
export function railsBlocked(span: SpanData): boolean {
  if (span.kind !== "tool" && span.kind !== "sandbox") return false;
  const result = span.attributes["gen_ai.tool.result"];
  return (typeof result === "string" && RAILS_BLOCKED.test(result)) || (typeof span.statusMessage === "string" && RAILS_BLOCKED.test(span.statusMessage));
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

function randomSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === "0000000000000000" ? "0000000000000001" : hex;
}

function decisionSpan(call: DecisionCall, root: SpanData): SpanData {
  const end = Number.isFinite(call.at) ? call.at : (root.endTime ?? root.startTime);
  return {
    traceId: root.traceId,
    spanId: randomSpanId(),
    parentSpanId: root.spanId,
    name: `decision ${call.point}`,
    kind: "llm",
    startTime: Math.max(0, end - Math.max(0, call.latencyMs)),
    endTime: end,
    status: call.failure ? "error" : "ok",
    ...(call.failure ? { statusMessage: `decision model failed: ${call.failure}` } : {}),
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.system": "openrouter",
      "gen_ai.request.model": call.model ?? undefined,
      "gen_ai.usage.total_tokens": call.tokens,
      "agent.cost_usd": call.cost,
      "decision.point": call.point,
      "decision.mode": call.mode,
      "decision.fallback_used": call.fallbackUsed,
      "decision.failure": call.failure ?? undefined,
      ...(call.failure ? { "error.code": call.failure } : {}),
    },
    events: [],
  };
}

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

type PromptMessage = { role?: string; content?: unknown; name?: string; toolCalls?: Array<{ name?: string; arguments?: unknown }>; isError?: boolean };

/** The recorder's prompt view (`{ system, messages, tools }`) as OpenAI-style messages for `gen_ai.prompt_json`. */
export function promptMessages(prompt: unknown): unknown[] | undefined {
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return undefined;
  const p = prompt as { system?: unknown; messages?: unknown };
  if (!Array.isArray(p.messages)) return undefined;
  const out: unknown[] = [];
  if (typeof p.system === "string" && p.system) out.push({ role: "system", content: p.system });
  for (const raw of p.messages as PromptMessage[]) {
    if (!raw || typeof raw !== "object") continue;
    const role = raw.role === "tool" ? "tool" : raw.role === "assistant" ? "assistant" : raw.role === "system" ? "system" : "user";
    const calls = Array.isArray(raw.toolCalls) ? raw.toolCalls.map((c) => ({ type: "function", function: { name: c?.name ?? "", arguments: typeof c?.arguments === "string" ? c.arguments : JSON.stringify(c?.arguments ?? {}) } })) : [];
    out.push({ role, content: typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content ?? ""), ...(role === "tool" && raw.name ? { name: raw.name } : {}), ...(calls.length ? { tool_calls: calls } : {}) });
  }
  return out;
}

/** Braintrust shape of one already-masked span. */
function shape(span: SpanData): SpanData {
  const a: SpanData["attributes"] = { ...span.attributes };
  const move = (from: string, to: string, json: boolean) => {
    const value = a[from];
    delete a[from];
    if (value === undefined) return;
    if (json && parseJson(value) !== undefined) a[`${to}_json`] = value as string;
    else a[to] = value;
  };
  if (span.kind === "llm") {
    a["gen_ai.operation.name"] ??= "chat";
    const messages = promptMessages(parseJson(a["gen_ai.prompt"]));
    if (messages) {
      a["gen_ai.prompt_json"] = JSON.stringify(messages);
      delete a["gen_ai.prompt"];
    }
    const completion = parseJson(a["gen_ai.completion"]);
    if (Array.isArray(completion)) {
      a["gen_ai.completion_json"] = JSON.stringify([{ role: "assistant", content: "", tool_calls: completion.map((c: { name?: string; arguments?: unknown }) => ({ type: "function", function: { name: c?.name ?? "", arguments: JSON.stringify(c?.arguments ?? {}) } })) }]);
      delete a["gen_ai.completion"];
    }
  } else if (span.kind === "tool" || span.kind === "sandbox") {
    a["gen_ai.operation.name"] = "execute_tool";
    move(span.kind === "sandbox" ? "sandbox.code" : "gen_ai.tool.arguments", "braintrust.input", true);
    move(span.kind === "sandbox" ? "sandbox.output" : "gen_ai.tool.result", "braintrust.output", true);
  } else if (span.kind === "agent") {
    a["braintrust.span_attributes"] = JSON.stringify({ type: "task" });
    move("agent.event.payload", "braintrust.input", false);
    move("gen_ai.completion", "braintrust.output", true);
  }
  return { ...span, attributes: a };
}

/** Root span identity (rule 6: opaque ids only; masking still replaces an email-shaped id). */
function identityAttributes(root: SpanData, annotations: RunAnnotations | undefined, options: BraintrustExporterOptions, mode: ContentMode): SpanData["attributes"] {
  const runId = str(root.attributes["agent.run_id"]);
  const conversation = runId && parseConversationInstanceId(runId) ? runId : undefined;
  return {
    agent: str(root.attributes["agent.name"]),
    tenant_id: str(root.attributes["agent.tenant_id"]),
    actor_id: annotations?.identity?.actorId,
    conversation_id: conversation,
    role: annotations?.identity?.role,
    env: options.serviceName,
    release: options.release,
    "marketer.content_mode": mode,
  };
}

export class BraintrustSpanExporter implements SpanExporter {
  constructor(private readonly options: BraintrustExporterOptions) {}

  async export(spans: SpanData[]): Promise<void> {
    try {
      await this.send(spans);
    } catch (error) {
      this.failed(error);
    }
  }

  /** The OTLP-ready spans for one batch (exposed for tests). */
  async prepare(spans: SpanData[]): Promise<SpanData[]> {
    const traces = new Map<string, SpanData[]>();
    for (const span of spans) {
      const list = traces.get(span.traceId) ?? [];
      list.push(span);
      traces.set(span.traceId, list);
    }
    const out: SpanData[] = [];
    for (const group of traces.values()) out.push(...(await this.prepareTrace(group)));
    return out;
  }

  private async prepareTrace(group: SpanData[]): Promise<SpanData[]> {
    const root = group.find((s) => !s.parentSpanId);
    const tenantId = str(root?.attributes["agent.tenant_id"]) ?? str(group[0]?.attributes["agent.tenant_id"]);
    const mode = await this.mode(tenantId);
    const runId = str(root?.attributes["agent.run_id"]);
    const submissionId = str(root?.attributes["flue.submission_id"]);
    let annotations: RunAnnotations | undefined;
    try {
      annotations = root && runId && this.options.annotations ? this.options.annotations(runId, submissionId) : undefined;
    } catch {
      annotations = undefined;
    }
    const spans: SpanData[] = group.map((span) => {
      if (span !== root) return span;
      const scores: Record<string, number> = { ...(annotations?.scores ?? {}), rails_blocked: group.some(railsBlocked) ? 1 : 0 };
      return { ...span, attributes: { ...span.attributes, ...identityAttributes(span, annotations, this.options, mode), "braintrust.scores": JSON.stringify(scores) } };
    });
    if (root && annotations?.decisions.length) spans.push(...annotations.decisions.map((d) => decisionSpan(d, root)));

    const shaped = spans.map((s) => shape(maskSpan(s, mode)));

    // Root span id: deterministic, so it equals the traceSpanId already delivered with the reply.
    const ids = new Map<string, string>();
    if (root && runId && submissionId) ids.set(root.spanId, traceSpanIdFor(runId, submissionId));
    if (ids.size === 0) return shaped;
    return shaped.map((s) => ({
      ...s,
      spanId: ids.get(s.spanId) ?? s.spanId,
      ...(s.parentSpanId ? { parentSpanId: ids.get(s.parentSpanId) ?? s.parentSpanId } : {}),
    }));
  }

  private async mode(tenantId: string | undefined): Promise<ContentMode> {
    const global = this.options.config.content;
    if (global === "metadata" || !this.options.workspaceContent) return global;
    if (!tenantId || tenantId === "unknown") return "metadata";
    try {
      return (await this.options.workspaceContent(tenantId)) === "redacted" ? "redacted" : "metadata";
    } catch {
      return "metadata";
    }
  }

  private async send(spans: SpanData[]): Promise<void> {
    if (!spans.length) return;
    const prepared = await this.prepare(spans);
    if (!prepared.length) return;
    const doFetch = this.options.fetch ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? 5_000;
    let response: Response | undefined;
    const timedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      response = await doFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      return response;
    }) as typeof fetch;
    const otlp = new OtlpHttpSpanExporter({ endpoint: tracesEndpoint(this.options.config), headers: braintrustHeaders(this.options.config), serviceName: this.options.serviceName, fetch: timedFetch });
    await otlp.export(prepared);
    braintrustExportStats.batches += 1;
    braintrustExportStats.spans += prepared.length;
    const body = (await response?.json().catch(() => undefined)) as { partialSuccess?: { rejectedSpans?: unknown; errorMessage?: unknown } } | undefined;
    const rejected = Number(body?.partialSuccess?.rejectedSpans ?? 0);
    if (Number.isFinite(rejected) && rejected > 0) {
      braintrustExportStats.rejectedSpans += rejected;
      if (!logged.rejected) {
        logged.rejected = true;
        this.log(`[braintrust] ${rejected} span(s) rejected by the OTLP endpoint (counted in braintrustExportStats; further rejections are not logged)`);
      }
    }
  }

  private failed(error: unknown): void {
    braintrustExportStats.failures += 1;
    if (logged.failure) return;
    logged.failure = true;
    const message = error instanceof Error ? error.message : String(error);
    // The message is ours (HTTP status, timeout); it never carries the key or span content.
    this.log(`[braintrust] trace export failed: ${message.slice(0, 200)} (dropped; further failures are not logged)`);
  }

  private log(message: string): void {
    try {
      (this.options.log ?? ((m: string) => console.warn(m)))(message);
    } catch {
      // logging never throws into the tracer
    }
  }
}
