/** Provider-neutral model contracts used by every cognitive module and the agent loop. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text as emitted by the model (healed + validated later). */
  arguments: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string; name?: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; reasoning?: string }
  | { role: "tool"; content: string; toolCallId: string; name: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema object for the tool input. */
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  responseFormat?: { type: "json_schema"; name: string; schema: Record<string, unknown>; strict?: boolean } | { type: "json_object" };
  /** Opaque metadata forwarded to gateways (tenant, run) for analytics and caching rules. */
  metadata?: Record<string, string>;
  /**
   * Provider prompt-cache routing hint (OpenAI `prompt_cache_key`): requests
   * sharing a key and a long common prefix hit the provider's prompt cache.
   * Use a stable, tenant-scoped value such as `${tenantId}:${agent}`.
   */
  promptCacheKey?: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  /** Reasoning summary when the provider exposes one (raw chain-of-thought is never assumed). */
  reasoning?: string;
  model: string;
  provider: string;
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "error" | "unknown";
  cached?: boolean;
  raw?: unknown;
}

export type ModelStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-call-delta"; id: string; name?: string; argumentsDelta: string }
  | { type: "done"; response: ModelResponse };

export interface ModelProvider {
  /** Stable identifier, e.g. "openai", "workers-ai". Used for circuit breaking and telemetry. */
  readonly id: string;
  readonly defaultModel: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0),
  };
}
