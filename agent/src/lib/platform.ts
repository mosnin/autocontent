import { AiSearchSource, KVStore, R2BlobStore, type RunCounters, VectorizeStore, WorkersAIEmbedder, WorkersAIProvider, workersAICrossEncoder } from "@agent-starter/cloudflare";
import {
  type AgentStarterConfig,
  CrossEncoderReranker,
  DEFAULT_RERANK_THRESHOLD,
  type EntityGraphStore,
  KnowledgeRetriever,
  KvEntityGraphStore,
  type ModelProvider,
  ModelRouter,
  type Notifier,
  OpenAIResponsesProvider,
  OtlpHttpSpanExporter,
  parseAgentInstanceId,
  type RateLimitDecision,
  type RetrievalSource,
  type RiskTier,
  type SessionClaims,
  type SpanExporter,
  type TelemetrySink,
  type TenantConfig,
  TenantConfigProvider,
  type TenantSecurityContext,
  TokenBucketRateLimiter,
  type VectorStore,
  VectorMemory,
  WebhookRelay,
} from "@agent-starter/core";
import { type AgentStarterOptions, aiGatewayOpenAIBaseUrl, aiGatewayOpenAIHeaders, type ExtendedModelsOptions, type ObserverOptions } from "@agent-starter/flue";
import {
  ComposioToolset,
  createComposioClient,
  FirecrawlClient,
  JinaReader,
  LangfuseSpanExporter,
  PusherPublisher,
  QdrantVectorStore,
  SendRavenNotifier,
  type WebSearchProvider,
  webSearchProvidersFromEnv,
} from "@agent-starter/integrations";
import { waitUntil, env as workerEnv } from "cloudflare:workers";
import type { Context } from "hono";
import appConfig from "../../agent-starter.config.ts";
import type { Env } from "../env.ts";
import { createDecisionLogger } from "../marketer/decisions/log.ts";
import type { DecisionRuntime } from "../marketer/decisions/run.ts";
import { alertingNotifier, type OpsAlert, publishOpsAlert } from "./alerts.ts";
import { createArtifactRoutes, signArtifactUrl } from "./artifacts.ts";
import { createIntegrationRoutes, gatewayCacheTtlSeconds, isHarnessIdentity, mcpServersFromConfig } from "./integrations.ts";
import { deliverWithOutbox, OutboxWebhookSink, type WebhookOutbox } from "./outbox.ts";
import { applyPlatformPolicy, effectiveBudget, RATE_LIMIT_PREFIXES, type SigningSecretVars, signingSecret, stricterTier, workersAiModel } from "./policy.ts";
import { createPusherAuthRoute } from "./pusher-auth.ts";
import type { AgentRunRegistry } from "./registry.ts";
import { userScopedMemorySource } from "./retrieval.ts";
import { createHookHeartbeat, createRunStatusObserver, workflowStateKey } from "./run-status.ts";
import { recordSubmissionEvent } from "./submissions.ts";

/** Worker bindings, readable from agents, tools and hooks (call at use time, never at module scope). */
export const bindings = (): Env => workerEnv as unknown as Env;

/** The domain adaptation config (agent-starter.config.ts): models, budget ceiling, autonomy, authorized tools, MCP servers. */
export const config = appConfig;

/* ------------------------------------------------------------------ *
 * Config accessors: agents, routes and crons read agent-starter.config.ts through these, never through
 * hard-coded numbers, so editing the config changes the running app.
 * ------------------------------------------------------------------ */

export type IntegrationName = keyof AgentStarterConfig["integrations"];

/** Is an optional provider switched on in agent-starter.config.ts? (It also needs its key: see each wiring below.) */
export function integrationEnabled(name: IntegrationName): boolean {
  return config.integrations[name] === true;
}

/** Hard per-job / per-conversation ceilings (budget.hardCeilingUsd, budget.maxReasoningTurnsPerJob) as hook limits. */
export function budgetLimits(): { maxCostUsd: number; maxTurns: number } {
  return { maxCostUsd: config.budget.hardCeilingUsd, maxTurns: config.budget.maxReasoningTurnsPerJob };
}

/**
 * Autonomy from the config, held at an agent's own ceiling when it has one: `autonomyPolicy("MEDIUM")` is the
 * config's tier or MEDIUM, whichever is stricter (a tighter config always wins, a looser one never loosens the agent).
 */
export function autonomyPolicy(agentCap?: RiskTier): { confidenceThreshold: number; maxAutonomousTier: RiskTier } {
  return { confidenceThreshold: config.autonomy.confidenceThreshold, maxAutonomousTier: stricterTier(config.autonomy.maxAutonomousTier, agentCap) };
}

/**
 * What a tenant's job actually runs with (dashboards: GET /api/jobs/:id): the stricter of the config ceilings
 * and the tenant's own limits. Falls back to the config alone when the tenant config cannot be read.
 */
export async function tenantBudget(tenantId: string): Promise<{ budgetUsd: number; maxTurns: number }> {
  return effectiveBudget(config, await loadTenantConfig(tenantId).catch(() => undefined));
}

const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Models come from agent-starter.config.ts; the AGENT_MODEL / AGENT_FALLBACK_MODELS / FIRST_LINE_MODEL vars override per deployment. */
export function modelOptions(): NonNullable<AgentStarterOptions["model"]> {
  const b = bindings();
  const m = config.models;
  return {
    primary: b.AGENT_MODEL || m.frontier,
    fallbacks: b.AGENT_FALLBACK_MODELS ? list(b.AGENT_FALLBACK_MODELS) : m.fallbacks,
    firstLine: b.FIRST_LINE_MODEL || m.firstLine,
    thinkingLevel: m.reasoningEffort,
    compaction: m.compaction,
  };
}

/** Platform vars beyond src/env.ts (optional; unset = defaults). */
type PlatformVars = Env & SigningSecretVars & { AI_GATEWAY_CACHE_TTL?: string; OTLP_TRACES_ENDPOINT?: string; OTLP_TRACES_TOKEN?: string; QDRANT_URL?: string; QDRANT_API_KEY?: string; QDRANT_COLLECTION?: string };

/**
 * Options for `registerExtendedModels` (top of src/app.ts, module scope, so it reads plain vars and
 * never throws). Model response caching (R-MOD-07), never across tenants:
 *  - the semantic prompt cache on the Flue model path, always on: exact and near-duplicate hits
 *    (cosine ≥ 0.96, 1 h) within the same conversation context, partitioned by tenant, stored in AGENT_CACHE;
 *  - Cloudflare AI Gateway in front of OpenAI (analytics, caching, rate limits) when CF_ACCOUNT_ID +
 *    AI_GATEWAY_ID are set, with gateway response caching (`cf-aig-cache-ttl` from AI_GATEWAY_CACHE_TTL,
 *    default 3600 s, "0" disables; a tenant-scoped `cf-aig-cache-key` is added per request).
 * Without a gateway, calls go to api.openai.com directly.
 */
export function modelGateway(): ExtendedModelsOptions | undefined {
  try {
    const semanticCache = { kv: () => new KVStore(bindings().AGENT_CACHE), embedder: () => new WorkersAIEmbedder(bindings().AI, "@cf/baai/bge-small-en-v1.5") };
    const b = bindings() as PlatformVars;
    if (!b.CF_ACCOUNT_ID || !b.AI_GATEWAY_ID) return { semanticCache };
    const cacheTtlSeconds = gatewayCacheTtlSeconds(b.AI_GATEWAY_CACHE_TTL);
    const headers = aiGatewayOpenAIHeaders({ ...(b.AI_GATEWAY_TOKEN ? { token: b.AI_GATEWAY_TOKEN } : {}), ...(cacheTtlSeconds ? { cacheTtlSeconds } : {}) });
    return { baseUrl: aiGatewayOpenAIBaseUrl({ accountId: b.CF_ACCOUNT_ID, gatewayId: b.AI_GATEWAY_ID }), ...(Object.keys(headers).length ? { headers } : {}), semanticCache };
  } catch {
    return undefined;
  }
}

/** Edge-cached tenant limits & feature flags (KV, synced from the SaaS). Missing → secure freemium defaults (seed dev: `pnpm seed:dev`). */
export const tenantConfigs = () => new TenantConfigProvider({ kv: new KVStore(bindings().TENANT_CONFIG) });

/**
 * Tenant config with the platform policy applied (budget ceilings + authorizedTools from
 * agent-starter.config.ts, see src/lib/policy.ts): what every agent runs with.
 */
export async function loadTenantConfig(tenantId: string): Promise<TenantConfig> {
  return applyPlatformPolicy(await tenantConfigs().get(tenantId), config);
}

/**
 * Per-tenant token bucket over AGENT_CACHE that honours TenantConfig.rateLimit
 * (eventsPerMinute / burst). Two separate buckets, so an event is never charged twice (R7):
 *  - "events" (`rl:tenant:`): createIngestionHandler at the edge (429 + retry-after);
 *  - "turns" (`rl:tenant-turns:`): agent wake-ups in the queue consumer (coalesced turns; a denied
 *    turn is re-enqueued with a delay, never retried, so deferrals do not burn queue attempts).
 */
export class TenantRateLimiter extends TokenBucketRateLimiter {
  private readonly configs: TenantConfigProvider;

  constructor(env: Env = bindings(), configs: TenantConfigProvider = new TenantConfigProvider({ kv: new KVStore(env.TENANT_CONFIG) }), scope: "events" | "turns" = "events") {
    super(new KVStore(env.AGENT_CACHE), { ratePerMinute: 60, burst: 20, prefix: RATE_LIMIT_PREFIXES[scope] });
    this.configs = configs;
  }

  override async take(key: string, cost = 1, override?: { ratePerMinute: number; burst: number }): Promise<RateLimitDecision> {
    const limit = override ?? (await this.configs.get(key).then((c) => ({ ratePerMinute: c.rateLimit.eventsPerMinute, burst: c.rateLimit.burst })).catch(() => undefined));
    return super.take(key, cost, limit);
  }
}

/**
 * agentAuth wiring for every mounted agent (src/app.ts):
 *  - chatRateLimiter: per-tenant token bucket on new chat turns (429 + retry-after); the tenant's
 *    TenantConfig.rateLimit overrides the defaults through agentAuth's `tenantConfig` option;
 *  - seedInitialData: the tenant's config (policy applied) recorded when a conversation is created,
 *    so its first reply does not render on the secure freemium defaults.
 */
export const chatRateLimiter = (c: Context) => new TokenBucketRateLimiter(new KVStore((c.env as Env).AGENT_CACHE), { ratePerMinute: 30, burst: 10, prefix: RATE_LIMIT_PREFIXES.chat });

export async function seedInitialData(claims: Pick<SessionClaims, "tid">): Promise<{ tenantConfig?: TenantConfig }> {
  const tenantConfig = await loadTenantConfig(claims.tid).catch(() => undefined);
  return tenantConfig ? { tenantConfig } : {};
}

/** initialData of a server-side dispatch (job, room summon, bus delivery, delegation). */
export type DispatchInitialData<X extends object = object> = X & { tenantId: string; userId: string; roles: string[]; tenantConfig?: TenantConfig };

/**
 * initialData for every server-dispatched submission (background jobs, POST /api/jobs, room summons, bus
 * deliveries, delegation). It carries the tenant's config with the platform policy applied, so the first
 * render of a new instance uses the tenant's real limits and model profiles instead of the secure freemium
 * defaults (Flue picks the model at render, before useAgentStart loads the config). `extra` adds or
 * overrides fields (userId, roles, objective, mode, ...); defaults: userId "system:dispatch", roles ["system"].
 * A config read failure leaves tenantConfig out (the hook then loads it at execution time as before).
 */
export async function dispatchInitialData<X extends { userId?: string; roles?: string[] } & object>(tenantId: string, extra?: X): Promise<DispatchInitialData<X>> {
  const tenantConfig = await loadTenantConfig(tenantId).catch(() => undefined);
  return { userId: "system:dispatch", roles: ["system"], ...(extra ?? ({} as X)), tenantId, ...(tenantConfig ? { tenantConfig } : {}) } as DispatchInitialData<X>;
}

/**
 * Workers AI first-line model (`models.firstLine`, or the FIRST_LINE_MODEL var): routing, compaction,
 * critique, injection second opinions. A first-line model that is not a Workers AI model keeps the
 * provider's default Workers AI model here (the hook still renders with the configured spec).
 */
export const utilityModel = () => {
  const model = workersAiModel(modelOptions().firstLine);
  return new WorkersAIProvider(bindings().AI, model ? { model } : {});
};

/**
 * Frontier re-planning model (R-COG-03, spec: re-plan on Terra): the primary OpenAI model (`models.frontier` /
 * AGENT_MODEL) through AI Gateway when configured. The hook uses it while at least a quarter of the cost limit
 * remains, otherwise the utility model. Undefined (utility model only) without OPENAI_API_KEY or for a
 * non-OpenAI primary.
 */
export function replanModel(): ModelProvider | undefined {
  const b = bindings();
  const primary = modelOptions().primary ?? config.models.frontier;
  if (!b.OPENAI_API_KEY || !primary.startsWith("openai/")) return undefined;
  const gateway = modelGateway();
  return new OpenAIResponsesProvider({ apiKey: b.OPENAI_API_KEY, model: primary.slice("openai/".length), reasoningEffort: config.models.reasoningEffort, ...(gateway?.baseUrl ? { baseUrl: gateway.baseUrl } : {}), ...(gateway?.headers ? { headers: gateway.headers } : {}) });
}

/**
 * SIMPLE (first-line model) or COMPLEX (frontier) for one delivery, by the Workers AI utility model. Used at the
 * edge (agentAuth `classify` in src/app.ts: signals and voice turns) and by the events queue for every
 * coalesced background turn (src/background/jobs.ts stamps it as the signal's `route` attribute). Falls back to
 * COMPLEX, so a classifier outage never downgrades a hard turn.
 */
export const classifyDelivery = (text: string) =>
  new ModelRouter({ profiles: { utility: { provider: utilityModel(), label: "first-line" } }, defaultProfile: "utility", firstLineProfile: "utility" }).classify(text, ["SIMPLE", "COMPLEX"] as const, {
    fallback: "COMPLEX",
    instructions: "SIMPLE = greetings, FAQ lookups, short factual answers, a single obvious tool call. COMPLEX = multi-step reasoning, planning, code, analysis, ambiguous or high-stakes requests.",
  });

export const workspaceBlobs = () => new R2BlobStore(bindings().WORKSPACE_BUCKET);

/**
 * Relevance (0..1, CrossEncoderReranker applies a sigmoid to the bge-reranker logits) below which retrieved passages
 * are dropped: core's DEFAULT_RERANK_THRESHOLD (0.65, the spec's value).
 */
export const RERANK_THRESHOLD = DEFAULT_RERANK_THRESHOLD;

/** `models.reranker` from agent-starter.config.ts as a re-ranker (top 5 above RERANK_THRESHOLD). */
const reranker = () => new CrossEncoderReranker(workersAICrossEncoder(bindings().AI, config.models.reranker), { topK: 5 });

/**
 * The memory vector store: Vectorize (AGENT_MEMORY_INDEX), or Qdrant when `integrations.qdrant` is on and
 * QDRANT_URL is set (collection QDRANT_COLLECTION, default "<SERVICE_NAME>-memory", created with the embedding
 * model's dimensions and a `tenantId` payload index: QdrantVectorStore.ensureCollection).
 */
function memoryVectors(): VectorStore {
  const b = bindings() as PlatformVars;
  if (integrationEnabled("qdrant") && b.QDRANT_URL) {
    return new QdrantVectorStore({ url: b.QDRANT_URL, collection: b.QDRANT_COLLECTION || `${b.SERVICE_NAME}-memory`, ...(b.QDRANT_API_KEY ? { apiKey: b.QDRANT_API_KEY } : {}) });
  }
  return new VectorizeStore(b.AGENT_MEMORY_INDEX);
}

/**
 * Tenant-isolated long-term semantic memory: Vectorize (or Qdrant) + `models.embedding` embeddings + `models.reranker`
 * re-ranking. Changing `models.embedding` to a model with other dimensions needs a new index (infra script: 768 dims).
 */
export function vectorMemory(tenantId: string): VectorMemory {
  const b = bindings();
  return new VectorMemory({ vectors: memoryVectors(), embedder: new WorkersAIEmbedder(b.AI, config.models.embedding), tenantId, reranker: reranker() });
}

/**
 * Retrieval injected before each user message: tenant memory the acting user may read (their own
 * memories + tenant-shared ones, never another user's private notes: SEC-03) + Cloudflare AI Search
 * (if configured), jointly re-ranked.
 */
export function retriever(tenant: TenantSecurityContext): KnowledgeRetriever {
  const b = bindings();
  const sources: RetrievalSource[] = [userScopedMemorySource(vectorMemory(tenant.tenantId), tenant)];
  if (b.AI_SEARCH_INSTANCE) sources.push(new AiSearchSource(b.AI, b.AI_SEARCH_INSTANCE, { tenantId: tenant.tenantId }));
  return new KnowledgeRetriever(sources, reranker());
}

/**
 * Cross-session entity graph (remember_fact / recall_entity, auto-injected as context for the turn's
 * subject). Background jobs and other harness identities share the tenant's graph (contacts, accounts);
 * a signed-in user or widget visitor gets a graph private to them, so personal facts never reach
 * another user (same rule as retrieval).
 */
export function entityGraph(tenant: TenantSecurityContext): EntityGraphStore {
  const kv = new KVStore(bindings().AGENT_CACHE);
  return isHarnessIdentity(tenant) ? new KvEntityGraphStore({ kv, tenantId: tenant.tenantId }) : new KvEntityGraphStore({ kv, tenantId: tenant.tenantId, userId: tenant.userId });
}

/** Agent-threaded email (SendRaven) for approvals and alerts; undefined unless `integrations.sendraven` is on and SENDRAVEN_API_KEY is set. */
export function notifier(): Notifier | undefined {
  const b = bindings();
  if (!integrationEnabled("sendraven") || !b.SENDRAVEN_API_KEY) return undefined;
  return new SendRavenNotifier({ apiKey: b.SENDRAVEN_API_KEY, from: `Agents <agents@${new URL(b.PUBLIC_BASE_URL).hostname}>`, threads: new KVStore(b.AGENT_CACHE) });
}

/**
 * Human-in-the-loop approvals. `bindToRecipient` (background jobs): the signed links are bound to the
 * recipient (the tenant admin / ops inbox) and are never written into the agent's own stream, so the
 * job cannot approve its own HIGH / CRITICAL calls. Chat keeps the in-app oversight card: the
 * signed-in user is the human in the loop, and its (unbound) links are never mailed anywhere.
 */
export function approvals(options: { bindToRecipient?: boolean; approverId?: (tenant: TenantSecurityContext) => string | undefined } = {}): NonNullable<AgentStarterOptions["approvals"]> {
  return {
    secret: () => bindings().APPROVAL_SIGNING_SECRET,
    baseUrl: () => bindings().PUBLIC_BASE_URL,
    // Out-of-band mail ONLY for recipient-bound links. An unbound link is a bearer token: whoever holds it decides.
    // In a chat the signed-in user decides in the in-app card; mailing the same links to the ops inbox would let
    // that mailbox approve any account's publish. Bound links only work in the approver's own session.
    notifier: options.bindToRecipient ? notifier : () => undefined,
    // Route approvals to your tenant's admin (look it up from your SaaS) — defaults to the ops inbox.
    recipient: () => bindings().OPS_ALERT_EMAIL,
    ...(options.bindToRecipient ? { bindToRecipient: true } : {}),
    ...(options.approverId ? { approverId: options.approverId } : {}),
  };
}

/**
 * Who may decide a tenant's recipient-bound approvals (background jobs): the session subject the approval
 * route requires. Replace with your SaaS's tenant-admin lookup; the default is the ops inbox address
 * (OPS_ALERT_EMAIL), which must then be the subject of the approver's session token.
 */
export function tenantApprover(_tenant: TenantSecurityContext): string | undefined {
  return bindings().OPS_ALERT_EMAIL || undefined;
}

/**
 * The durable webhook outbox (src/lib/outbox.ts) in the run registry DO: signed deliveries to the SaaS that
 * still fail after their immediate retries are stored there and retried by the minute cron.
 */
export function webhookOutbox(env: Env = bindings()): WebhookOutbox {
  return { enqueue: (entry) => registry(env).outboxEnqueue(entry) };
}

/**
 * Signed webhook to the SaaS (PRIMARY_SAAS_WEBHOOK_URL, OUTBOUND_WEBHOOK_SECRET) with the durable outbox behind
 * it: job results (`notify_saas`), reports and anything else that must not be lost. Undefined when not configured.
 */
export async function sendToSaas(payload: Record<string, unknown>, meta: { tenantId: string; eventId?: string; eventType?: string }): Promise<{ delivered: boolean; queued?: boolean; error?: string }> {
  const b = bindings();
  const secret = signingSecret(b as PlatformVars, "outbound");
  if (!b.PRIMARY_SAAS_WEBHOOK_URL || !secret) return { delivered: false, error: "PRIMARY_SAAS_WEBHOOK_URL / signing secret not configured" };
  return deliverWithOutbox(new WebhookRelay({ url: b.PRIMARY_SAAS_WEBHOOK_URL, secret }), webhookOutbox(b), b.PRIMARY_SAAS_WEBHOOK_URL, payload, meta);
}

/**
 * Signed, expiring download link (7 days) for one of the tenant's artifacts (`tenants/<tenant>/artifacts/...`,
 * written by save_artifact), served by GET /artifacts/:tenantId/* (src/lib/artifacts.ts). Null for any key that
 * is not this tenant's artifact.
 */
export async function artifactUrl(tenantId: string, key: string): Promise<string | null> {
  const b = bindings();
  const secret = signingSecret(b as PlatformVars, "artifacts");
  return secret ? signArtifactUrl({ baseUrl: b.PUBLIC_BASE_URL, secret, tenantId, key }) : null;
}

/** GET /artifacts/:tenantId/* (mounted in src/app.ts): serves a tenant artifact from the workspace bucket to a valid signed link. */
export const artifactRoutes = createArtifactRoutes<Env>({
  secrets: (env) => [signingSecret(env as PlatformVars, "artifacts") ?? ""].filter(Boolean),
  blobs: (env) => new R2BlobStore(env.WORKSPACE_BUCKET),
});

/** Pusher keys when `integrations.pusher` is on and PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET are set. */
export function pusherConfig(env: Env = bindings()): { appId: string; key: string; secret: string; cluster: string } | undefined {
  if (!integrationEnabled("pusher") || !env.PUSHER_APP_ID || !env.PUSHER_KEY || !env.PUSHER_SECRET) return undefined;
  return { appId: env.PUSHER_APP_ID, key: env.PUSHER_KEY, secret: env.PUSHER_SECRET, cluster: env.PUSHER_CLUSTER ?? "mt1" };
}

/**
 * Real-time + webhook fan-out for every TelemetryEvent: signed webhooks to the SaaS (durable outbox on
 * failure) and Pusher channels (`agent-turn-executed` on `private-tenant-<tenant>-room-<room | run>`).
 * Langfuse / OTLP receive the per-step traces instead (traceExporters).
 */
export function telemetrySinks(): TelemetrySink[] {
  const b = bindings();
  const sinks: TelemetrySink[] = [];
  const relaySecret = signingSecret(b as PlatformVars, "outbound");
  if (b.PRIMARY_SAAS_WEBHOOK_URL && relaySecret) sinks.push(new OutboxWebhookSink(new WebhookRelay({ url: b.PRIMARY_SAAS_WEBHOOK_URL, secret: relaySecret }), b.PRIMARY_SAAS_WEBHOOK_URL, () => webhookOutbox(b)));
  const pusher = pusherConfig(b);
  if (pusher) sinks.push(new PusherPublisher(pusher));
  return sinks;
}

/**
 * Decision models (src/marketer/decisions): the runtime every decision point uses. Env is read at use time; the log
 * goes to the telemetry sinks and, best-effort, to the backend decision_log. No OPENROUTER_API_KEY = every point off.
 */
export function decisionRuntime(agent: string, runId?: string): DecisionRuntime {
  const b = bindings();
  return {
    env: b as unknown as DecisionRuntime["env"],
    agent,
    ...(runId ? { runId } : {}),
    logger: createDecisionLogger({ telemetry: () => telemetrySinks(), backend: { apiUrl: b.PRIMARY_SAAS_API_URL, token: b.SAAS_SERVICE_TOKEN }, waitUntil }),
  };
}

/** POST /api/pusher/auth for dashboards (mounted in src/app.ts; 404 until Pusher is configured): src/lib/pusher-auth.ts. */
export const pusherAuthRoutes = createPusherAuthRoute<Env>({
  keys: (env) => pusherConfig(env),
  sessionSecrets: (env) => [env.SESSION_SIGNING_SECRET, env.SESSION_SIGNING_SECRET_PREVIOUS ?? ""].filter(Boolean),
});

/**
 * Web reading and search providers for agents that browse (`createWebTools` / `createWebSearchTool`), gated by
 * `integrations.jina` / `integrations.firecrawl`: Jina reads pages without a key (JINA_API_KEY raises limits and
 * enables search), Firecrawl needs FIRECRAWL_API_KEY.
 */
export function webReaders(): { jina?: JinaReader; firecrawl?: FirecrawlClient } {
  const b = bindings();
  return {
    ...(integrationEnabled("jina") ? { jina: new JinaReader(b.JINA_API_KEY ? { apiKey: b.JINA_API_KEY } : {}) } : {}),
    ...(integrationEnabled("firecrawl") && b.FIRECRAWL_API_KEY ? { firecrawl: new FirecrawlClient({ apiKey: b.FIRECRAWL_API_KEY }) } : {}),
  };
}

export function webSearchProviders(): WebSearchProvider[] {
  const b = bindings();
  return webSearchProvidersFromEnv({ ...(integrationEnabled("jina") ? { JINA_API_KEY: b.JINA_API_KEY } : {}), ...(integrationEnabled("firecrawl") ? { FIRECRAWL_API_KEY: b.FIRECRAWL_API_KEY } : {}) });
}

/**
 * Per-step structured traces (R-OBS-01/02): one trace per submission with the waking payload, the exact
 * prompt of each model turn, reasoning, tool arguments/outputs, codemode code + console output and the DB
 * deltas tools report (secrets redacted before export). Exported to Langfuse when `integrations.langfuse` is on
 * and LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY are set, and to any OpenTelemetry collector when
 * OTLP_TRACES_ENDPOINT is set (OTLP_TRACES_TOKEN as bearer). Nothing configured → no tracing.
 */
export function traceExporters(env: Env = bindings()): SpanExporter[] {
  const b = env as PlatformVars;
  const exporters: SpanExporter[] = [];
  if (integrationEnabled("langfuse") && b.LANGFUSE_PUBLIC_KEY && b.LANGFUSE_SECRET_KEY) {
    exporters.push(new LangfuseSpanExporter({ publicKey: b.LANGFUSE_PUBLIC_KEY, secretKey: b.LANGFUSE_SECRET_KEY, ...(b.LANGFUSE_BASE_URL ? { baseUrl: b.LANGFUSE_BASE_URL } : {}), release: b.CODE_VERSION, environment: b.SERVICE_NAME, onPartialFailure: (errors) => console.warn(`[langfuse] ${errors.length} span(s) rejected`) }));
  }
  if (b.OTLP_TRACES_ENDPOINT) {
    exporters.push(new OtlpHttpSpanExporter({ endpoint: b.OTLP_TRACES_ENDPOINT, serviceName: b.SERVICE_NAME, ...(b.OTLP_TRACES_TOKEN ? { headers: { authorization: `Bearer ${b.OTLP_TRACES_TOKEN}` } } : {}) }));
  }
  return exporters;
}

/**
 * Operational alert (AGENT_CRITICAL_HALT, BUDGET_LIMIT_BREACHED, SHADOW_DIVERGENCE, ...) as telemetry: the
 * telemetry sinks (signed webhook to the SaaS with the durable outbox, Pusher), with `data.alert = code`.
 * Langfuse gets per-step traces, not alerts (traceExporters). Email is separate (notifier()). Never throws.
 */
export async function emitOpsAlert(alert: OpsAlert): Promise<void> {
  await publishOpsAlert(telemetrySinks(), alert).catch((error: unknown) => console.warn("[alert] publish failed", error));
}

/**
 * The global run registry Durable Object (liveness ledger for the heartbeat sentinel).
 * Data residency: DO_JURISDICTION ("eu", "fedramp", ...) pins it to a jurisdiction and
 * DO_LOCATION_HINT places it near your users. Set both before the first deploy:
 * a different jurisdiction is a different (empty) registry.
 */
export function registry(env: Env = bindings()) {
  let ns = env.RUN_REGISTRY as unknown as DurableObjectNamespace<AgentRunRegistry>;
  if (env.DO_JURISDICTION) ns = ns.jurisdiction(env.DO_JURISDICTION as DurableObjectJurisdiction);
  return ns.get(ns.idFromName("global"), env.DO_LOCATION_HINT ? { locationHint: env.DO_LOCATION_HINT as DurableObjectLocationHint } : undefined);
}

/**
 * Latest counters the hook reported per run (this isolate); sent with registry.complete() when the
 * submission settles and dropped right after (R21), so the map only holds runs with work in flight.
 */
const latestCounters = new Map<string, RunCounters>();
const MAX_TRACKED_RUNS = 2_000;
const heartbeats = new Map<string, ReturnType<typeof createHookHeartbeat<RunCounters>>>();

function rememberCounters(runId: string, counters: RunCounters): void {
  latestCounters.delete(runId);
  latestCounters.set(runId, counters);
  // Runs whose settle this isolate never sees (evicted, crashed) must not accumulate.
  while (latestCounters.size > MAX_TRACKED_RUNS) {
    const oldest = latestCounters.keys().next().value;
    if (oldest === undefined) break;
    latestCounters.delete(oldest);
  }
}

/**
 * The hook's heartbeat (before/after every tool call, at each response start): records the counters and
 * beats the registry at most every 15 s per run, fire-and-forget, so a slow registry never adds latency
 * to tool calls (R16). The observer's own beats (turns, tools, long tool calls) keep the run alive.
 */
export function heartbeat(agentName: string): NonNullable<AgentStarterOptions["heartbeat"]> {
  let beat = heartbeats.get(agentName);
  if (!beat) {
    beat = createHookHeartbeat<RunCounters>({
      registry: () => registry(),
      agent: agentName,
      tenantOf: (runId) => parseAgentInstanceId(runId)?.tenantId ?? "unknown",
      onCounters: (runId, counters) => rememberCounters(runId, counters),
      onError: (error) => console.warn("[heartbeat]", error),
    });
    heartbeats.set(agentName, beat);
  }
  const send = beat;
  return (runId, counters) => send(runId, counters as RunCounters);
}

/**
 * Observer wiring for app.ts: telemetry sinks + run status in the registry
 * (src/lib/run-status.ts: RUNNING with heartbeats on turns/tools and during long tool calls,
 * PENDING_APPROVAL while a human is asked, QUEUED while a delegated task is out, IDLE / FAILED /
 * HALTED on settle) + the submission ledger the heartbeat sentinel reads (src/lib/submissions.ts)
 * + the workflow state marker job routing reads (`wf:<instanceId>`).
 */
export function observerOptions(): ObserverOptions {
  return {
    sinks: () => telemetrySinks(),
    onEvent: createRunStatusObserver<Record<string, unknown>, RunCounters>({
      registry: (env) => registry(env as unknown as Env),
      counters: (instanceId) => {
        const counters = latestCounters.get(instanceId);
        latestCounters.delete(instanceId);
        return counters;
      },
      onSubmission: (env, instanceId, event) => recordSubmissionEvent(env as unknown as Env, instanceId, event),
      onWorkflowState: async (env, instanceId, state) => {
        await (env as unknown as Env).AGENT_CACHE.put(workflowStateKey(instanceId), state, { expirationTtl: 30 * 86_400 });
      },
      onSettled: (instanceId) => {
        for (const beat of heartbeats.values()) beat.forget(instanceId);
      },
    }),
    tracing: { exporters: (env) => traceExporters(env as unknown as Env) },
    onError: (error) => console.error("[observer]", error),
  };
}

/**
 * Composio actions for every agent when `integrations.composio` is on in agent-starter.config.ts and
 * COMPOSIO_API_KEY is set (per-user sessions `${tenantId}:${userId}`, firewall + risk tiers, meta tools off).
 * Users connect accounts with POST /api/integrations/composio/authorize.
 */
let composio: { apiKey: string; toolset: ComposioToolset } | undefined;
export function composioToolset(): ComposioToolset | undefined {
  const b = bindings();
  if (!integrationEnabled("composio") || !b.COMPOSIO_API_KEY) return undefined;
  // One toolset per isolate (it caches per-user sessions); rebuilt when the key rotates.
  if (composio?.apiKey !== b.COMPOSIO_API_KEY) composio = { apiKey: b.COMPOSIO_API_KEY, toolset: new ComposioToolset({ client: createComposioClient({ apiKey: b.COMPOSIO_API_KEY }), promptInjectionHook: true }) };
  return composio.toolset;
}

/** Account-connect route for Composio toolkits (signed-in users only; widget visitors are refused). */
export const integrationRoutes = createIntegrationRoutes<Env>({
  toolset: () => composioToolset(),
  sessionSecrets: (env) => [env.SESSION_SIGNING_SECRET, env.SESSION_SIGNING_SECRET_PREVIOUS ?? ""].filter(Boolean),
  callbackUrl: (env) => env.PUBLIC_BASE_URL,
});

/**
 * Everything `useAgentStarter` needs from the platform. Agents spread this and add
 * their own tools/policies:
 *   useAgentStarter({ ...platform("support", id), tools: [...], planning: true })
 */
export function platform(agentName: string, id: string): AgentStarterOptions {
  const servers = mcpServersFromConfig(config.mcpServers, (name) => {
    const value = (bindings() as unknown as Record<string, unknown>)[name];
    return typeof value === "string" ? value : undefined;
  });
  return {
    id,
    agentName,
    model: modelOptions(),
    loadTenantConfig,
    utilityModel,
    replanModel,
    retriever,
    entityGraph,
    approvals: approvals(),
    telemetry: () => telemetrySinks(),
    heartbeat: heartbeat(agentName),
    // Blue/green (R-OPS-04): a conversation started on another major CODE_VERSION is locked, not run on new code.
    version: { current: () => bindings().CODE_VERSION },
    autonomy: autonomyPolicy(),
    ...(servers.length ? { mcp: servers } : {}),
    ...(integrationEnabled("composio") ? { composio: { toolset: composioToolset } } : {}),
    // First budget breach of a scope: tenant-scoped R2 snapshot, a BUDGET_LIMIT_BREACHED alert to the
    // telemetry sinks (signed webhook to the SaaS, Pusher) and an email to the ops inbox when configured.
    budgetBreach: {
      snapshots: workspaceBlobs,
      notifier: () => alertingNotifier({ code: "BUDGET_LIMIT_BREACHED", agent: agentName, sinks: telemetrySinks, email: notifier, runIdOf: () => id }),
      recipient: () => bindings().OPS_ALERT_EMAIL || "ops-alerts",
    },
  };
}
