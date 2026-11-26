import { type Embedder, HttpError, type MemoryHit, type ModelProvider, type ModelRequest, type ModelResponse, type RetrievalSource, TenantIdSchema, type ToolCall } from "@agent-starter/core";

/** Structural view of the `env.AI` binding (kept loose so model ids are not limited to the typed catalog). */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  autorag?(name: string): AiSearchInstance;
}

export interface AiSearchInstance {
  search(params: { query: string; max_num_results?: number; rewrite_query?: boolean; ranking_options?: { score_threshold?: number }; filters?: unknown }): Promise<{
    data?: Array<{ file_id?: string; filename?: string; score?: number; attributes?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }>;
  }>;
}

export interface GatewayRunOptions {
  id: string;
  skipCache?: boolean;
  cacheTtl?: number;
  metadata?: Record<string, string | number | boolean>;
}

export const DEFAULT_FIRST_LINE_MODEL = "@cf/meta/llama-3.1-8b-instruct";
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const DEFAULT_RERANKER_MODEL = "@cf/baai/bge-reranker-base";

/**
 * Workers AI chat provider (edge GPUs, no API key). The first line of the
 * model router: routing, classification, compaction, critique, healing.
 * Handles both the native `{ response, tool_calls }` and OpenAI-compatible
 * `{ choices }` result shapes.
 */
export class WorkersAIProvider implements ModelProvider {
  readonly id: string;
  readonly defaultModel: string;

  constructor(
    private readonly ai: AiBinding,
    private readonly options: { model?: string; gateway?: GatewayRunOptions; id?: string } = {},
  ) {
    this.id = options.id ?? "workers-ai";
    this.defaultModel = options.model ?? DEFAULT_FIRST_LINE_MODEL;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel;
    const inputs: Record<string, unknown> = {
      messages: request.messages.map((m) => {
        if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, name: m.name, content: m.content };
        if (m.role === "assistant" && m.toolCalls?.length)
          return { role: "assistant", content: m.content, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) };
        return { role: m.role, content: m.content };
      }),
    };
    if (request.temperature !== undefined) inputs.temperature = request.temperature;
    if (request.maxOutputTokens) inputs.max_tokens = request.maxOutputTokens;
    if (request.tools?.length) inputs.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    if (request.responseFormat?.type === "json_schema") inputs.response_format = { type: "json_schema", json_schema: request.responseFormat.schema };
    else if (request.responseFormat?.type === "json_object") inputs.response_format = { type: "json_object" };
    if (request.reasoningEffort) inputs.reasoning = { effort: request.reasoningEffort };

    let raw: unknown;
    try {
      raw = await this.ai.run(model, inputs, this.options.gateway ? { gateway: this.options.gateway } : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /429|capacity|rate/i.test(message) ? 429 : /timeout/i.test(message) ? 408 : 500;
      throw new HttpError(status, `Workers AI ${model}: ${message}`, message);
    }
    return parseWorkersAIResult(raw, model, this.id);
  }
}

export function parseWorkersAIResult(raw: unknown, model: string, provider: string): ModelResponse {
  const result = (raw ?? {}) as {
    response?: unknown;
    tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown; function?: { name: string; arguments: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  };
  let text: string;
  let reasoning: string | undefined;
  let toolCalls: ToolCall[];
  let finish: string | undefined;
  if (result.choices?.length) {
    const choice = result.choices[0];
    text = choice?.message?.content ?? "";
    reasoning = choice?.message?.reasoning_content;
    finish = choice?.finish_reason;
    toolCalls = (choice?.message?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
  } else {
    text = typeof result.response === "string" ? result.response : result.response === undefined ? "" : JSON.stringify(result.response);
    toolCalls = (result.tool_calls ?? []).map((c, i) => ({
      id: c.id ?? `wai_${i}_${Date.now().toString(36)}`,
      name: c.name ?? c.function?.name ?? "",
      arguments: typeof c.arguments === "string" ? c.arguments : c.function?.arguments ?? JSON.stringify(c.arguments ?? {}),
    }));
  }
  return {
    text,
    toolCalls,
    ...(reasoning ? { reasoning } : {}),
    usage: { inputTokens: result.usage?.prompt_tokens ?? 0, outputTokens: result.usage?.completion_tokens ?? 0, reasoningTokens: 0, cachedInputTokens: 0 },
    model,
    provider,
    finishReason: toolCalls.length ? "tool_calls" : finish === "length" ? "length" : "stop",
    raw,
  };
}

/** Workers AI embeddings (bge-base: 768 dims; bge-small: 384; bge-large: 1024). */
export class WorkersAIEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(
    private readonly ai: AiBinding,
    readonly model: string = DEFAULT_EMBEDDING_MODEL,
  ) {
    this.dimensions = /small/.test(model) ? 384 : /large/.test(model) ? 1024 : 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100).map((t) => t.slice(0, 2000));
      const result = (await this.ai.run(this.model, { text: batch })) as { data?: number[][] };
      out.push(...(result.data ?? []));
    }
    return out;
  }
}

/** Cross-encoder scores from Workers AI `bge-reranker-base` (plug into core CrossEncoderReranker). */
export function workersAICrossEncoder(ai: AiBinding, model = DEFAULT_RERANKER_MODEL) {
  return async (query: string, documents: string[]): Promise<number[]> => {
    const result = (await ai.run(model, { query, contexts: documents.map((text) => ({ text: text.slice(0, 2000) })) })) as { response?: Array<{ id: number; score: number }> };
    const scores = new Array<number>(documents.length).fill(0);
    for (const item of result.response ?? []) if (item.id >= 0 && item.id < scores.length) scores[item.id] = item.score;
    return scores;
  };
}

/**
 * Object key of a tenant's knowledge document in the R2 bucket an AI Search instance indexes:
 * `<tenantId>/<name>`, flat (path separators in `name` become `__`), because AiSearchSource filters on the
 * exact folder `<tenantId>/` (an AI Search `eq` folder filter does not match subfolders).
 */
export function tenantDocumentKey(tenantId: string, name: string): string {
  TenantIdSchema.parse(tenantId);
  const flat = name
    .trim()
    .split(/[\\/]+/)
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("__")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 200);
  if (!flat) throw new Error(`Invalid knowledge document name "${name}".`);
  return `${tenantId}/${flat}`;
}

/** Minimal R2 surface for knowledge ingestion (an `R2Bucket` binding satisfies it). */
export interface KnowledgeBucket {
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
}

/**
 * Ingest one tenant document for AI Search: writes it under the tenant's folder in the instance's source
 * bucket (AI Search picks it up on its next sync). Keep this bucket separate from the workspace bucket,
 * and call it only with a server-derived tenant id (session claims, signed webhook path), never model input.
 */
export async function putTenantDocument(bucket: KnowledgeBucket, tenantId: string, name: string, body: string | ArrayBuffer | ArrayBufferView, options: { contentType?: string } = {}): Promise<{ key: string }> {
  const key = tenantDocumentKey(tenantId, name);
  await bucket.put(key, body, { httpMetadata: { contentType: options.contentType ?? "text/markdown; charset=utf-8" }, customMetadata: { tenantId } });
  return { key };
}

/**
 * Cloudflare AI Search (formerly AutoRAG) as a retrieval source: managed
 * ingestion + chunking + hybrid retrieval over your R2 docs/website. With
 * `tenantId`, the query is filtered to the tenant's folder (`<tenantId>/`, see
 * tenantDocumentKey) and any hit that reports another folder is dropped.
 */
export class AiSearchSource implements RetrievalSource {
  readonly name: string;
  constructor(
    private readonly ai: AiBinding,
    private readonly instance: string,
    private readonly options: { tenantId?: string; scoreThreshold?: number; rewriteQuery?: boolean } = {},
  ) {
    this.name = `ai-search:${instance}`;
  }

  async search(query: string, options: { topK: number }): Promise<MemoryHit[]> {
    if (!this.ai.autorag) throw new Error("The AI binding does not expose AI Search (autorag). Check the binding and compatibility date.");
    const result = await this.ai.autorag(this.instance).search({
      query,
      max_num_results: Math.min(options.topK, 50),
      rewrite_query: this.options.rewriteQuery ?? true,
      ranking_options: { score_threshold: this.options.scoreThreshold ?? 0.3 },
      ...(this.options.tenantId ? { filters: { type: "eq", key: "folder", value: `${this.options.tenantId}/` } } : {}),
    });
    const folder = this.options.tenantId ? `${this.options.tenantId}/` : undefined;
    const ownFolder = (item: { filename?: string; attributes?: Record<string, unknown> }) => {
      if (!folder) return true;
      const reported = item.attributes?.folder;
      if (typeof reported === "string") return reported === folder;
      return !item.filename?.includes("/") || item.filename.startsWith(folder);
    };
    return (result.data ?? []).filter(ownFolder).map((item, i) => ({
      id: item.file_id ?? `${this.instance}:${i}`,
      text: (item.content ?? []).map((c) => c.text ?? "").join("\n"),
      score: item.score ?? 0,
      source: this.name,
      metadata: { title: item.filename ?? "", ...(this.options.tenantId ? { tenantId: this.options.tenantId } : {}) },
    }));
  }
}

/** Base URL for routing provider SDK traffic through Cloudflare AI Gateway (analytics, caching, rate limits, fallbacks). */
export function aiGatewayBaseUrl(accountId: string, gatewayId: string, provider: "openai" | "workers-ai" | "anthropic" | "compat" | string): string {
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/${provider}`;
}

/** AI Gateway request headers: cache TTL / skip, metadata for analytics, and authenticated gateways. */
export function aiGatewayHeaders(options: { cacheTtlSeconds?: number; skipCache?: boolean; metadata?: Record<string, string | number | boolean>; gatewayToken?: string; eventId?: string }): Record<string, string> {
  return {
    ...(options.cacheTtlSeconds !== undefined ? { "cf-aig-cache-ttl": String(options.cacheTtlSeconds) } : {}),
    ...(options.skipCache ? { "cf-aig-skip-cache": "true" } : {}),
    ...(options.metadata ? { "cf-aig-metadata": JSON.stringify(options.metadata) } : {}),
    ...(options.gatewayToken ? { "cf-aig-authorization": `Bearer ${options.gatewayToken}` } : {}),
    ...(options.eventId ? { "cf-aig-event-id": options.eventId } : {}),
  };
}
