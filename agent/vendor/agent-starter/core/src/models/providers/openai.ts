import { HttpError } from "../../errors.ts";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse, ModelStreamEvent, ReasoningEffort, ToolCall } from "../types.ts";

/** Default frontier model for Agent Starter: GPT-6.1 Terra at medium reasoning effort. */
export const DEFAULT_OPENAI_MODEL = "gpt-6.1-terra";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export interface OpenAIResponsesProviderOptions {
  apiKey: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /**
   * Override to route through Cloudflare AI Gateway:
   * https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai
   */
  baseUrl?: string;
  organization?: string;
  project?: string;
  /** Extra headers, e.g. `cf-aig-cache-ttl`, `cf-aig-metadata`, `cf-aig-authorization`. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Provider id used for circuit breaking/telemetry (lets you register two OpenAI accounts). */
  id?: string;
  /**
   * Default `prompt_cache_key` when a request sets none (e.g. derive from
   * `request.metadata.tenantId`). Keys are clamped to 64 characters.
   */
  promptCacheKey?: (request: ModelRequest) => string | undefined;
}

interface ResponsesOutputItem {
  type: string;
  id?: string;
  role?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type: string; text?: string }>;
  summary?: Array<{ type: string; text?: string }>;
}

interface ResponsesBody {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: ResponsesOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
}

/** OpenAI Responses API provider (fetch-only, runs on Workers, Node and Deno). */
export class OpenAIResponsesProvider implements ModelProvider {
  readonly id: string;
  readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAIResponsesProviderOptions) {
    if (!options.apiKey) throw new Error("OpenAIResponsesProvider requires an apiKey");
    this.id = options.id ?? "openai";
    this.defaultModel = options.model ?? DEFAULT_OPENAI_MODEL;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  buildBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const model = request.model ?? this.defaultModel;
    const effort = request.reasoningEffort ?? this.options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    const instructions = request.messages
      .filter((m): m is Extract<ChatMessage, { role: "system" }> => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const input: unknown[] = [];
    for (const message of request.messages) {
      if (message.role === "system") continue;
      if (message.role === "user") input.push({ role: "user", content: message.content });
      else if (message.role === "assistant") {
        if (message.content) input.push({ role: "assistant", content: message.content });
        for (const call of message.toolCalls ?? []) input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments });
      } else input.push({ type: "function_call_output", call_id: message.toolCallId, output: message.content });
    }
    const body: Record<string, unknown> = {
      model,
      input,
      store: false,
      stream,
      reasoning: { effort, summary: "auto" },
    };
    if (instructions) body.instructions = instructions;
    if (request.maxOutputTokens) body.max_output_tokens = request.maxOutputTokens;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
      body.tool_choice = typeof request.toolChoice === "object" ? { type: "function", name: request.toolChoice.name } : (request.toolChoice ?? "auto");
      body.parallel_tool_calls = true;
    }
    if (request.responseFormat?.type === "json_schema") {
      body.text = { format: { type: "json_schema", name: request.responseFormat.name, schema: request.responseFormat.schema, strict: request.responseFormat.strict ?? false } };
    } else if (request.responseFormat?.type === "json_object") {
      body.text = { format: { type: "json_object" } };
    }
    if (request.metadata) body.metadata = request.metadata;
    const cacheKey = request.promptCacheKey ?? this.options.promptCacheKey?.(request);
    if (cacheKey) body.prompt_cache_key = cacheKey.slice(0, 64);
    return body;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.options.apiKey}`,
      ...(this.options.organization ? { "openai-organization": this.options.organization } : {}),
      ...(this.options.project ? { "openai-project": this.options.project } : {}),
      ...this.options.headers,
    };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(request, false)),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) throw await HttpError.fromResponse(response, `OpenAI ${request.model ?? this.defaultModel}`);
    return this.parse((await response.json()) as ResponsesBody, request);
  }

  parse(body: ResponsesBody, request: ModelRequest): ModelResponse {
    let text = "";
    let reasoning = "";
    const toolCalls: ToolCall[] = [];
    for (const item of body.output ?? []) {
      if (item.type === "message") text += (item.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
      else if (item.type === "reasoning") reasoning += (item.summary ?? []).map((s) => s.text ?? "").join("\n");
      else if (item.type === "function_call") toolCalls.push({ id: item.call_id ?? item.id ?? "", name: item.name ?? "", arguments: item.arguments ?? "{}" });
    }
    const incomplete = body.status === "incomplete";
    return {
      text,
      toolCalls,
      ...(reasoning ? { reasoning } : {}),
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        reasoningTokens: body.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
      model: body.model ?? request.model ?? this.defaultModel,
      provider: this.id,
      finishReason: incomplete ? (body.incomplete_details?.reason === "content_filter" ? "content_filter" : "length") : toolCalls.length ? "tool_calls" : "stop",
      raw: body,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: { ...this.headers(), accept: "text/event-stream" },
      body: JSON.stringify(this.buildBody(request, true)),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok || !response.body) throw await HttpError.fromResponse(response, `OpenAI stream ${request.model ?? this.defaultModel}`);
    const callIds = new Map<string, { id: string; name: string }>();
    for await (const event of parseSse(response.body)) {
      if (!event.data || event.data === "[DONE]") continue;
      const payload = JSON.parse(event.data) as { type: string; delta?: string; item_id?: string; item?: ResponsesOutputItem; response?: ResponsesBody };
      switch (payload.type) {
        case "response.output_text.delta":
          yield { type: "text-delta", delta: payload.delta ?? "" };
          break;
        case "response.reasoning_summary_text.delta":
          yield { type: "reasoning-delta", delta: payload.delta ?? "" };
          break;
        case "response.output_item.added":
          if (payload.item?.type === "function_call" && payload.item.id) {
            const entry = { id: payload.item.call_id ?? payload.item.id, name: payload.item.name ?? "" };
            callIds.set(payload.item.id, entry);
            yield { type: "tool-call-delta", id: entry.id, name: entry.name, argumentsDelta: "" };
          }
          break;
        case "response.function_call_arguments.delta": {
          const entry = payload.item_id ? callIds.get(payload.item_id) : undefined;
          if (entry) yield { type: "tool-call-delta", id: entry.id, argumentsDelta: payload.delta ?? "" };
          break;
        }
        case "response.completed":
        case "response.incomplete":
          if (payload.response) yield { type: "done", response: this.parse(payload.response, request) };
          break;
        case "response.failed":
        case "error":
          throw new HttpError(500, `OpenAI stream error: ${event.data.slice(0, 500)}`, event.data);
        default:
          break;
      }
    }
  }
}

/** Minimal Server-Sent Events parser over a byte stream. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
      let event: string | undefined;
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) yield event ? { event, data: data.join("\n") } : { data: data.join("\n") };
    }
  }
}
