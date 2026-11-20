import { AgentError } from "../errors.ts";
import type { Embedder, KeyValueStore, VectorStore } from "../storage/ports.ts";
import { sha256Hex, stableStringify } from "../util/crypto.ts";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse } from "./types.ts";

export interface SemanticCacheOptions {
  kv: KeyValueStore;
  embedder?: Embedder;
  vectors?: VectorStore;
  /** Cosine similarity required to serve a semantic hit. Default 0.96. */
  threshold?: number;
  ttlSeconds?: number;
  /**
   * "tenant" (default) isolates hits per tenant and requires `tenantId`.
   * "global" shares hits across tenants for identical prompts: opt in only for
   * prompts that never contain tenant data (e.g. public FAQ bots).
   */
  scope?: "global" | "tenant";
  tenantId?: string;
}

interface CachedEntry {
  response: ModelResponse;
  storedAt: number;
}

/**
 * Semantic prompt cache ("margin defender"). Exact hits are served by hash; near
 * duplicates are served when the final user turn is ≥ threshold similar AND the
 * preceding context (system prompt + history) is byte-identical. Requests that
 * expose tools or produce tool calls are never cached (stale side effects).
 */
export class SemanticCache {
  private readonly threshold: number;
  private readonly ttl: number;

  constructor(private readonly options: SemanticCacheOptions) {
    if ((options.scope ?? "tenant") === "tenant" && !options.tenantId) {
      throw new AgentError("CONFIG_INVALID", 'SemanticCache is tenant-scoped by default: pass tenantId, or scope: "global" for prompts that never contain tenant data.');
    }
    this.threshold = options.threshold ?? 0.96;
    this.ttl = options.ttlSeconds ?? 3600;
  }

  private cacheable(request: ModelRequest): boolean {
    return !request.tools?.length && request.messages.some((m) => m.role === "user");
  }

  private async keys(request: ModelRequest): Promise<{ contextHash: string; exactHash: string; lastUser: string }> {
    const lastUserIndex = request.messages.map((m) => m.role).lastIndexOf("user");
    const context = request.messages.slice(0, lastUserIndex);
    const lastUser = (request.messages[lastUserIndex] as Extract<ChatMessage, { role: "user" }>).content;
    const scope = this.options.scope === "global" ? "global" : `tenant:${this.options.tenantId}`;
    const base = { scope, model: request.model ?? "", effort: request.reasoningEffort ?? "", format: request.responseFormat ?? null };
    const contextHash = await sha256Hex(stableStringify({ ...base, context }));
    const exactHash = await sha256Hex(stableStringify({ ...base, context, lastUser }));
    return { contextHash, exactHash, lastUser };
  }

  async lookup(request: ModelRequest): Promise<ModelResponse | null> {
    if (!this.cacheable(request)) return null;
    const { contextHash, exactHash, lastUser } = await this.keys(request);
    const exact = await this.read(`semcache:exact:${exactHash}`);
    if (exact) return exact;
    if (!this.options.embedder || !this.options.vectors) return null;
    const [vector] = await this.options.embedder.embed([lastUser]);
    if (!vector) return null;
    const [best] = await this.options.vectors.query(vector, { topK: 1, filter: { contextHash } });
    if (!best || best.score < this.threshold) return null;
    return this.read(`semcache:exact:${String(best.metadata.exactHash)}`);
  }

  async store(request: ModelRequest, response: ModelResponse): Promise<void> {
    if (!this.cacheable(request) || response.toolCalls.length > 0 || response.finishReason !== "stop" || !response.text) return;
    const { contextHash, exactHash, lastUser } = await this.keys(request);
    const entry: CachedEntry = { response: { ...response, raw: undefined }, storedAt: Date.now() };
    await this.options.kv.put(`semcache:exact:${exactHash}`, JSON.stringify(entry), { expirationTtlSeconds: this.ttl });
    if (this.options.embedder && this.options.vectors) {
      const [vector] = await this.options.embedder.embed([lastUser]);
      if (vector) await this.options.vectors.upsert([{ id: `semcache:${exactHash.slice(0, 48)}`, values: vector, metadata: { contextHash, exactHash, storedAt: entry.storedAt } }]);
    }
  }

  private async read(key: string): Promise<ModelResponse | null> {
    const raw = await this.options.kv.get(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    if (Date.now() - entry.storedAt > this.ttl * 1000) return null;
    return { ...entry.response, cached: true };
  }
}

/** Provider decorator that consults the semantic cache before paying for a completion. */
export class CachedModelProvider implements ModelProvider {
  readonly id: string;
  readonly defaultModel: string;

  constructor(
    private readonly inner: ModelProvider,
    private readonly cache: SemanticCache,
  ) {
    this.id = inner.id;
    this.defaultModel = inner.defaultModel;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const hit = await this.cache.lookup(request).catch(() => null);
    if (hit) return hit;
    const response = await this.inner.generate(request);
    await this.cache.store(request, response).catch(() => undefined);
    return response;
  }
}
