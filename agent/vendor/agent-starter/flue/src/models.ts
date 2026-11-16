import { AsyncLocalStorage } from "node:async_hooks";
import { cosineSimilarity, type Embedder, type KeyValueStore, parseAgentInstanceId, parseConversationInstanceId, sha256Hex, stableStringify } from "@agent-starter/core";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  createProvider,
  lazyStream,
  type Message,
  type Model,
  type Provider,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { instrument, setProvider } from "@flue/runtime";

/**
 * OpenAI models newer than the model catalog bundled with the Pi version that
 * @flue/runtime 2.3.0 is compatible with (pi-ai 1.4.0). Metadata is copied from
 * the newer Pi catalog (pricing per 1M tokens, context window, reasoning levels).
 */
export const EXTENDED_OPENAI_MODELS = [
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, tiers: [{ inputTokensAbove: 272000, input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5 }] },
    contextWindow: 272000,
    maxTokens: 128000,
    thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
    compat: {
      supportsStrictMode: true,
      supportsOpenAIGrammarTools: true,
      supportsAdditionalTools: true,
      supportsToolSearch: true,
      supportsMidConvoSystemMessages: true,
      supportsExplicitPromptCacheMode: true,
      supportsMidConvoEffort: true,
    },
    type: "chat",
  },
] as const;

export interface ExtendedModelsOptions {
  /**
   * Route OpenAI calls through another base URL, typically Cloudflare AI Gateway
   * (`aiGatewayOpenAIBaseUrl({ accountId, gatewayId })`). Every OpenAI model's
   * `baseUrl` is rewritten. Default: api.openai.com.
   */
  baseUrl?: string;
  /**
   * Extra headers on every OpenAI request, e.g. `cf-aig-authorization`, `cf-aig-cache-ttl`, `cf-aig-metadata`.
   * With `cf-aig-cache-ttl` (AI Gateway response caching), every request also gets a tenant-scoped
   * `cf-aig-cache-key`, or `cf-aig-skip-cache` when no scope is known, so cached responses never cross tenants.
   */
  headers?: Record<string, string>;
  /** Semantic prompt cache on the Flue model path (R-MOD-07): see `ModelCacheOptions`. */
  semanticCache?: ModelCacheOptions;
  /** Partition for gateway and semantic caching: "tenant" (default) or "user" (one user of a tenant). */
  cacheScope?: ModelCacheScopeMode;
}

/** Cloudflare AI Gateway base URL for the OpenAI provider: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai */
export function aiGatewayOpenAIBaseUrl(options: { accountId: string; gatewayId: string }): string {
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(options.accountId)}/${encodeURIComponent(options.gatewayId)}/openai`;
}

/**
 * AI Gateway headers: `cf-aig-authorization` for authenticated gateways,
 * `cf-aig-cache-ttl` to enable gateway response caching (seconds), and
 * `cf-aig-metadata` for per-request analytics (keep it free of PII).
 */
export function aiGatewayOpenAIHeaders(options: { token?: string; cacheTtlSeconds?: number; metadata?: Record<string, string | number | boolean> } = {}): Record<string, string> {
  return {
    ...(options.token ? { "cf-aig-authorization": `Bearer ${options.token}` } : {}),
    ...(options.cacheTtlSeconds ? { "cf-aig-cache-ttl": String(options.cacheTtlSeconds) } : {}),
    ...(options.metadata ? { "cf-aig-metadata": JSON.stringify(options.metadata) } : {}),
  };
}

/** Build the `openai` provider = every built-in OpenAI chat model + the extended models above (optionally behind a gateway and caches). */
export function createExtendedOpenAIProvider(options: ExtendedModelsOptions = {}): Provider<"openai-responses"> {
  const base = openaiProvider();
  const builtIn = base.getModels();
  const known = new Set(builtIn.map((m) => m.id));
  const extra = EXTENDED_OPENAI_MODELS.filter((m) => !known.has(m.id));
  const all = [...builtIn, ...(extra as unknown as typeof builtIn)];
  const baseUrl = options.baseUrl?.replace(/\/+$/, "");
  return createProvider({
    id: base.id,
    name: base.name,
    ...(baseUrl ? { baseUrl } : base.baseUrl ? { baseUrl: base.baseUrl } : {}),
    ...(options.headers && Object.keys(options.headers).length ? { headers: options.headers } : {}),
    auth: base.auth,
    models: baseUrl ? all.map((m) => ({ ...m, baseUrl })) : all,
    api: withModelCache(openAIResponsesApi(), {
      ...(options.semanticCache ? { semantic: options.semanticCache } : {}),
      gatewayCache: Boolean(options.headers?.["cf-aig-cache-ttl"]),
      ...(options.cacheScope ? { scope: options.cacheScope } : {}),
    }),
  });
}

let registered: string | null = null;
let registeredCache: ModelCacheOptions | undefined;

/**
 * Register the extended OpenAI catalog with Flue so `openai/gpt-6.1-terra`
 * (the Agent Starter default, medium reasoning) resolves. Call once at module
 * top level in `src/app.ts` (generated apps already do). Pass `baseUrl` /
 * `headers` to send every OpenAI call through Cloudflare AI Gateway
 * (analytics, caching, rate limiting). Calling again with different options
 * re-registers the provider.
 */
export function registerExtendedModels(options: ExtendedModelsOptions = {}): void {
  const key = JSON.stringify({ b: options.baseUrl ?? "", h: options.headers ?? {}, s: options.cacheScope ?? "tenant" });
  if (registered === key && registeredCache === options.semanticCache) return;
  if (options.semanticCache || options.headers?.["cf-aig-cache-ttl"]) installModelScope();
  setProvider(createExtendedOpenAIProvider(options));
  registered = key;
  registeredCache = options.semanticCache;
}

/* ------------------------------------------------------------------ *
 * Tenant-safe model caching (R-MOD-07)
 * ------------------------------------------------------------------ */

export type ModelCacheScopeMode = "tenant" | "user";

export interface ModelCacheOptions {
  /** Cached completions + per-context candidate lists. Resolved per call (bindings exist only at request time). */
  kv: () => KeyValueStore | undefined;
  /** Embeddings for near-duplicate hits (e.g. `new WorkersAIEmbedder(env.AI, "@cf/baai/bge-small-en-v1.5")`). Omit for exact hits only. */
  embedder?: () => Embedder | undefined;
  /** Cosine similarity required for a near-duplicate hit. Default 0.96. */
  threshold?: number;
  /** Lifetime of a cached completion. Default 3600 s. */
  ttlSeconds?: number;
  /** Only cache these model ids (default: every model of the provider). */
  models?: string[];
  /** Near-duplicate candidates kept per context (embeddings are stored rounded to 4 decimals). Default 20. */
  maxCandidates?: number;
  /** Tenant of an agent instance id (default: `parseAgentInstanceId(id).tenantId`). */
  tenantOf?: (instanceId: string) => string | undefined;
  /** hit / miss / store / bypass notifications (metrics, tests). */
  onEvent?: (event: ModelCacheEvent) => void;
}

export interface ModelCacheEvent {
  type: "hit" | "miss" | "store" | "bypass";
  model: string;
  /** The partition key (JSON tuple: tenant, user, instance or session). Absent on bypass. */
  scope?: string;
  /** Present on near-duplicate hits. */
  similarity?: number;
  reason?: string;
}

const scopeStorage = new AsyncLocalStorage<{ instanceId: string }>();
let scopeInstalled = false;

/**
 * Make the agent instance behind each model call visible to providers: a Flue execution
 * interceptor runs every model operation inside an AsyncLocalStorage scope carrying
 * `ctx.instanceId` (`${agent}--${tenant}--…`). Idempotent; `registerExtendedModels` calls it
 * when a cache is configured.
 */
export function installModelScope(): void {
  if (scopeInstalled) return;
  scopeInstalled = true;
  instrument({
    key: Symbol.for("@agent-starter/flue/model-scope"),
    observe: () => undefined,
    interceptor: (operation, ctx, next) => (operation.type === "model" && ctx.instanceId ? scopeStorage.run({ instanceId: ctx.instanceId }, next) : next()),
    dispose: () => {
      scopeInstalled = false;
    },
  });
}

/** Run `fn` as if a model call of agent instance `instanceId` (tests, non-Flue callers). */
export function withModelScope<T>(instanceId: string, fn: () => T): T {
  return scopeStorage.run({ instanceId }, fn);
}

/** The agent instance of the model call in progress, if known. */
export function currentModelInstance(): string | undefined {
  return scopeStorage.getStore()?.instanceId;
}

/**
 * The cache partition for the current call. Tenant comes from the agent instance id
 * (server-minted, never from the model or the prompt). Without one, Flue's per-conversation
 * affinity key (`options.sessionId`) is used: a single conversation, so still never
 * cross-tenant. Neither → null (no caching).
 */
export function resolveModelCacheScope(options: { sessionId?: unknown } | undefined, mode: ModelCacheScopeMode = "tenant", tenantOf?: (instanceId: string) => string | undefined): string | null {
  const instanceId = currentModelInstance();
  if (instanceId) {
    const tenantId = tenantOf ? tenantOf(instanceId) : parseAgentInstanceId(instanceId)?.tenantId;
    if (!tenantId) return stableStringify(["instance", instanceId]);
    if (mode === "tenant") return stableStringify(["tenant", tenantId]);
    const owner = parseConversationInstanceId(instanceId)?.owner;
    return owner ? stableStringify(["user", tenantId, owner]) : stableStringify(["instance", instanceId]);
  }
  return typeof options?.sessionId === "string" && options.sessionId ? stableStringify(["session", options.sessionId]) : null;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

type Part = { type: string; text?: string; data?: string; mimeType?: string; name?: string; arguments?: unknown; thinking?: string };

function normalizeParts(content: string | readonly Part[]): unknown {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type !== "thinking")
    .map((c) => (c.type === "text" ? { t: c.text ?? "" } : c.type === "image" ? { img: `${c.mimeType ?? ""}:${c.data?.length ?? 0}:${fnv1a(c.data ?? "")}` } : c.type === "toolCall" ? { call: c.name, args: c.arguments ?? {} } : { other: c.type }));
}

/**
 * The per-conversation line `useAgentStarter` adds to the system prompt (`[RUN CONTEXT] tenant=… user=…
 * conversation=… objective=…`). It is left out of cache keys: the cache partition (tenant, or tenant + user
 * in "user" mode) already carries the identity, and hashing the conversation id would make every
 * conversation a cache miss (R-MOD-07).
 */
export const RUN_CONTEXT_PREFIX = "[RUN CONTEXT]";
const VOLATILE_LINE = /^\[RUN CONTEXT\][^\n]*(?:\n|$)/gm;
const stableText = (text: string) => text.replace(VOLATILE_LINE, "");

function stableParts(content: string | readonly Part[]): string | Part[] {
  if (typeof content === "string") return stableText(content);
  return content.map((c) => (c.type === "text" && typeof c.text === "string" ? { ...c, text: stableText(c.text) } : c));
}

/** What the model saw, minus volatile fields (timestamps, usage, response/tool-call ids, hidden reasoning, the run-context line). */
function normalizeMessage(message: Message): unknown {
  switch (message.role) {
    case "system":
      return {
        role: "system",
        content: normalizeParts(stableParts(message.content as string | Part[])),
        sections: message.sections ? Object.fromEntries(Object.entries(message.sections).map(([name, value]) => [name, typeof value === "string" ? stableText(value) : value])) : null,
        toolsAdded: (message.toolsAdded ?? []).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
        toolsRemoved: (message.toolsRemoved ?? []).map((t) => t.name),
      };
    case "user":
      return { role: "user", content: normalizeParts(message.content as string | Part[]) };
    case "assistant":
      return { role: "assistant", content: normalizeParts(message.content as Part[]) };
    default:
      return { role: "toolResult", tool: (message as { toolName?: string }).toolName, content: normalizeParts((message as { content: Part[] }).content), error: (message as { isError?: boolean }).isError ?? false };
  }
}

function userText(message: Message | undefined): string | null {
  if (!message || message.role !== "user") return null;
  if (typeof message.content === "string") return message.content;
  if (message.content.some((c) => c.type === "image")) return null;
  return message.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

/** Numbers, ids and emails in a message: a near-duplicate hit must carry exactly the same ones ("order 1234" ≠ "order 1235"). */
function identifierDigest(text: string): string {
  const tokens = text.toLowerCase().match(/[\w.+-]*\d[\w.+-]*|[\w.+-]+@[\w.-]+/g) ?? [];
  return [...new Set(tokens)].sort().join("|");
}

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function cachedResponseStream(model: Model<Api>, text: string, exactHash: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text }], api: model.api, provider: model.provider, model: model.id, responseId: `semcache_${exactHash.slice(0, 24)}`, usage: ZERO_USAGE, stopReason: "stop", timestamp: Date.now() };
  const partial: AssistantMessage = { ...message, content: [] };
  stream.push({ type: "start", partial });
  partial.content.push({ type: "text", text: "" });
  stream.push({ type: "text_start", contentIndex: 0, partial });
  (partial.content[0] as { text: string }).text = text;
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

interface CacheEntry {
  v: 1;
  text: string;
  storedAt: number;
}

interface CandidateList {
  v: 1;
  items: Array<{ exactHash: string; vector: number[]; digest: string; storedAt: number }>;
}

export interface WithModelCacheOptions {
  /** Semantic prompt cache (KV + optional embeddings). */
  semantic?: ModelCacheOptions;
  /** AI Gateway response caching is on (`cf-aig-cache-ttl`): add a tenant-scoped `cf-aig-cache-key` per request, or `cf-aig-skip-cache` without a scope. */
  gatewayCache?: boolean;
  scope?: ModelCacheScopeMode;
}

/**
 * Wrap a pi-ai API implementation (`ProviderStreams`) with tenant-safe caching:
 *
 * - **Semantic cache**: a turn whose last message is a user message is served from cache when the
 *   SAME partition (tenant by default) saw the same system prompt, tool set and history before, and
 *   the last user message is identical (exact) or ≥ `threshold` similar with the same numbers/ids
 *   (near-duplicate). Only final text answers are stored (no tool calls, no errors, no truncation),
 *   so a hit never replays a side effect. Hits cost nothing (`usage` zero, `responseId: semcache_…`).
 * - **AI Gateway cache**: requests carry `cf-aig-cache-key = sha256(partition + request)`, so gateway
 *   hits stay inside the partition; with no partition, `cf-aig-skip-cache: true`.
 *
 * Any cache failure falls through to the provider. Used by `createExtendedOpenAIProvider`; wrap other
 * providers (e.g. an OpenAI-compatible one) the same way before `setProvider`.
 */
export function withModelCache(api: ProviderStreams, options: WithModelCacheOptions): ProviderStreams {
  const semantic = options.semantic;
  if (!semantic && !options.gatewayCache) return api;
  const mode = options.scope ?? "tenant";
  const threshold = semantic?.threshold ?? 0.96;
  const ttl = semantic?.ttlSeconds ?? 3600;
  const maxCandidates = Math.max(1, semantic?.maxCandidates ?? 20);
  const emit = (event: ModelCacheEvent) => {
    try {
      semantic?.onEvent?.(event);
    } catch {
      /* metrics must never break a model call */
    }
  };

  const wrap = <O extends StreamOptions | SimpleStreamOptions>(call: (model: Model<Api>, context: TranscriptContext, opts?: O) => AssistantMessageEventStream) => {
    return (model: Model<Api>, context: TranscriptContext, opts?: O): AssistantMessageEventStream => {
      const scope = resolveModelCacheScope(opts, mode, semantic?.tenantOf);
      const messages = context.messages;
      const last = messages.at(-1);
      const lastText = userText(last);
      const deferred = Boolean((opts as SimpleStreamOptions | undefined)?.deferred);
      const semanticOn = Boolean(semantic && scope && lastText !== null && last?.role === "user" && !deferred && (!semantic.models || semantic.models.includes(model.id)));
      if (semantic && !semanticOn) emit({ type: "bypass", model: model.id, reason: !scope ? "no tenant scope" : deferred ? "deferred request" : "last message is not a plain user message" });
      if (!semanticOn && !options.gatewayCache) return call(model, context, opts);
      return lazyStream(model, async () => {
        const settings = {
          v: 1,
          scope,
          provider: model.provider,
          model: model.id,
          api: model.api,
          reasoning: (opts as SimpleStreamOptions | undefined)?.reasoning ?? null,
          toolChoice: (opts as SimpleStreamOptions | undefined)?.toolChoice ?? null,
          maxTokens: opts?.maxTokens ?? null,
          temperature: opts?.temperature ?? null,
          samplingParams: opts?.samplingParams ?? null,
        };
        let request = opts;
        if (options.gatewayCache) {
          const headers: Record<string, string | null> = { ...(opts?.headers ?? {}) };
          if (scope) headers["cf-aig-cache-key"] = `as-${(await sha256Hex(stableStringify({ ...settings, messages: messages.map(normalizeMessage) }))).slice(0, 48)}`;
          else headers["cf-aig-skip-cache"] = "true";
          request = { ...(opts ?? {}), headers } as O;
        }
        if (!semanticOn || !semantic || !scope || lastText === null || !last) return call(model, context, request);

        const kv = (() => {
          try {
            return semantic.kv();
          } catch {
            return undefined;
          }
        })();
        if (!kv) {
          emit({ type: "bypass", model: model.id, scope, reason: "no cache store" });
          return call(model, context, request);
        }
        const contextHash = await sha256Hex(stableStringify({ ...settings, prior: messages.slice(0, -1).map(normalizeMessage) }));
        const exactHash = await sha256Hex(stableStringify({ contextHash, last: normalizeMessage(last) }));
        const read = async (hash: string): Promise<CacheEntry | null> => {
          const raw = await kv.get(`semcache:v1:${hash}`);
          if (!raw) return null;
          const entry = JSON.parse(raw) as CacheEntry;
          return Date.now() - entry.storedAt <= ttl * 1000 && entry.text ? entry : null;
        };
        let vector: number[] | undefined;
        const digest = identifierDigest(lastText);
        try {
          const exact = await read(exactHash);
          if (exact) {
            emit({ type: "hit", model: model.id, scope });
            return cachedResponseStream(model, exact.text, exactHash);
          }
          const embedder = semantic.embedder?.();
          if (embedder && lastText.trim()) {
            [vector] = await embedder.embed([lastText]);
            const raw = vector ? await kv.get(`semcache:v1:ctx:${contextHash}`) : null;
            if (vector && raw) {
              const list = JSON.parse(raw) as CandidateList;
              let best: { exactHash: string; score: number } | undefined;
              for (const item of list.items ?? []) {
                if (item.digest !== digest || Date.now() - item.storedAt > ttl * 1000) continue;
                const score = cosineSimilarity(vector, item.vector);
                if (!best || score > best.score) best = { exactHash: item.exactHash, score };
              }
              const near = best && best.score >= threshold ? await read(best.exactHash) : null;
              if (near && best) {
                emit({ type: "hit", model: model.id, scope, similarity: Number(best.score.toFixed(4)) });
                return cachedResponseStream(model, near.text, best.exactHash);
              }
            }
          }
        } catch {
          /* cache read failures fall through to the provider */
        }
        emit({ type: "miss", model: model.id, scope });
        const stream = call(model, context, request);
        void stream
          .result()
          .then(async (result) => {
            const text = result.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
            if (result.stopReason !== "stop" || result.errorMessage || !text.trim() || result.content.some((c) => c.type === "toolCall")) return;
            const storedAt = Date.now();
            await kv.put(`semcache:v1:${exactHash}`, JSON.stringify({ v: 1, text, storedAt } satisfies CacheEntry), { expirationTtlSeconds: ttl });
            if (vector) {
              const raw = await kv.get(`semcache:v1:ctx:${contextHash}`);
              const list: CandidateList = raw ? (JSON.parse(raw) as CandidateList) : { v: 1, items: [] };
              const items = [{ exactHash, vector: vector.map((x) => Math.round(x * 1e4) / 1e4), digest, storedAt }, ...(list.items ?? []).filter((i) => i.exactHash !== exactHash && storedAt - i.storedAt <= ttl * 1000)].slice(0, maxCandidates);
              await kv.put(`semcache:v1:ctx:${contextHash}`, JSON.stringify({ v: 1, items } satisfies CandidateList), { expirationTtlSeconds: ttl });
            }
            emit({ type: "store", model: model.id, scope });
          })
          .catch(() => undefined);
        return stream as AsyncIterable<AssistantMessageEvent>;
      });
    };
  };

  return {
    ...api,
    stream: wrap<StreamOptions>((model, context, opts) => api.stream(model, context, opts)),
    streamSimple: wrap<SimpleStreamOptions>((model, context, opts) => api.streamSimple(model, context, opts)),
  };
}
