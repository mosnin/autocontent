import { HttpError } from "../../errors.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "../types.ts";

export interface ChatCompletionsProviderOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

interface ChatCompletionsBody {
  model?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
}

/**
 * Generic OpenAI-compatible Chat Completions provider. Covers Workers AI's REST
 * endpoint (`/ai/v1`), AI Gateway "compat" routes, Groq, Together, OpenRouter,
 * vLLM and Ollama — useful as fallback targets in the model router.
 */
export class ChatCompletionsProvider implements ModelProvider {
  readonly id: string;
  readonly defaultModel: string;

  constructor(private readonly options: ChatCompletionsProviderOptions) {
    this.id = options.id;
    this.defaultModel = options.model;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const doFetch = this.options.fetch ?? fetch;
    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: request.messages.map((m) => {
        if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
        if (m.role === "assistant")
          return {
            role: "assistant",
            content: m.content || null,
            ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) } : {}),
          };
        return { role: m.role, content: m.content };
      }),
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = typeof request.toolChoice === "object" ? { type: "function", function: { name: request.toolChoice.name } } : (request.toolChoice ?? "auto");
    }
    if (request.responseFormat?.type === "json_schema") body.response_format = { type: "json_schema", json_schema: { name: request.responseFormat.name, schema: request.responseFormat.schema } };
    else if (request.responseFormat?.type === "json_object") body.response_format = { type: "json_object" };
    if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;

    const response = await doFetch(`${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}), ...this.options.headers },
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) throw await HttpError.fromResponse(response, `${this.id} ${body.model as string}`);
    const json = (await response.json()) as ChatCompletionsBody;
    const choice = json.choices?.[0];
    const toolCalls = (choice?.message?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
    const finish = choice?.finish_reason;
    return {
      text: choice?.message?.content ?? "",
      toolCalls,
      ...(choice?.message?.reasoning_content ? { reasoning: choice.message.reasoning_content } : {}),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        cachedInputTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      model: json.model ?? (body.model as string),
      provider: this.id,
      finishReason: finish === "tool_calls" || toolCalls.length ? "tool_calls" : finish === "length" ? "length" : finish === "content_filter" ? "content_filter" : "stop",
      raw: json,
    };
  }
}
