import type { AiBinding } from "@agent-starter/cloudflare";

/**
 * Worker bindings, vars and secrets. Base bindings are always present; module
 * bindings are optional so every module combination type-checks.
 * Regenerate exact binding types with `pnpm cf-typegen` if you prefer.
 */
export interface Env {
  // --- Base bindings -------------------------------------------------------
  AI: AiBinding;
  TENANT_CONFIG: KVNamespace;
  AGENT_CACHE: KVNamespace;
  WORKSPACE_BUCKET: R2Bucket;
  AGENT_MEMORY_INDEX: VectorizeIndex;
  RUN_REGISTRY: DurableObjectNamespace;

  // --- Module bindings -----------------------------------------------------
  EVENTS_QUEUE?: Queue;
  EVENTS_QUEUE_NAME?: string;
  /** Dead-letter queue of EVENTS_QUEUE (background module consumes it into R2 for drain/replay). */
  EVENTS_DLQ_NAME?: string;
  AGENT_BUS?: Queue;
  AGENT_BUS_NAME?: string;
  AGENT_BUS_DLQ_NAME?: string;
  GROUP_CHAT_ROOM?: DurableObjectNamespace;
  LOADER?: unknown;
  OAUTH_KV?: KVNamespace;
  WIDGET_KEYS?: KVNamespace;
  /** Voice module: per-call session Durable Object (minute ledger, budget stop). */
  VOICE_SESSIONS?: DurableObjectNamespace;
  /** Persistent module: one control plane per persistent agent (config, alarm, kill switch, audit). */
  PERSISTENT_CONTROL?: DurableObjectNamespace;

  // --- Vars ----------------------------------------------------------------
  SERVICE_NAME: string;
  CODE_VERSION: string;
  PUBLIC_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  AGENT_MODEL: string;
  AGENT_FALLBACK_MODELS: string;
  FIRST_LINE_MODEL: string;
  AI_SEARCH_INSTANCE: string;
  /**
   * Marketer API origin (FastAPI backend, e.g. https://api.marketer.sh; tools append /api/v1/...). Every Marketer tool
   * (src/marketer/api.ts) calls it with SAAS_SERVICE_TOKEN and `x-tenant-id` = the session's tenant (Clerk user id).
   */
  PRIMARY_SAAS_API_URL: string;
  PRIMARY_SAAS_WEBHOOK_URL: string;
  CF_ACCOUNT_ID?: string;
  BOAT_GOLDEN_SNAPSHOT_ID?: string;
  BOAT_USD_PER_SECOND?: string;
  /** boat.dev region for new VMs (e.g. "eu-central"); empty = the provider default. */
  BOAT_REGION?: string;
  OPS_ALERT_EMAIL?: string;
  /** Cloudflare AI Gateway id: when set with CF_ACCOUNT_ID, OpenAI calls go through the gateway (analytics, caching, rate limits). */
  AI_GATEWAY_ID?: string;
  /** Data residency: Durable Object jurisdiction for platform DOs ("eu" | "fedramp" | "fedramp-high" | "us"); empty = global. */
  DO_JURISDICTION?: string;
  /** Data residency: location hint for platform DOs (e.g. "weur", "enam"); empty = nearest. */
  DO_LOCATION_HINT?: string;
  /** Optional SaaS warehouse endpoint for buffered cost-ledger sync (WarehouseSync). */
  WAREHOUSE_SYNC_URL?: string;
  /** AI Gateway response-cache TTL in seconds (`cf-aig-cache-ttl`); empty = 3600, "0" disables caching. */
  AI_GATEWAY_CACHE_TTL?: string;
  /** OTLP/HTTP traces endpoint of an OpenTelemetry collector (e.g. https://otel.example.com/v1/traces); empty = no OTLP export. */
  OTLP_TRACES_ENDPOINT?: string;
  /** Eval harness: "true" only on a dedicated eval deployment allows `mode: "live"` (real side effects). */
  EVAL_ALLOW_LIVE?: string;
  /** Eval harness: comma list of the only tenants eval cases may run in (empty = any). */
  EVAL_TENANTS?: string;
  /** Background module: share of jobs forked into a shadow twin ("0.05" = 5 %, "0" = off). */
  SHADOW_SAMPLE_RATE?: string;
  /** Background module: model the shadow twin runs on (empty = the production model). */
  SHADOW_MODEL?: string;
  /**
   * Execution-rails kill switch, read at every HIGH / CRITICAL dispatch (src/marketer/rails/enforce.ts): empty / "off"
   * = none; "publish", "spend" (comma list) or "all" stop those dispatches; anything unreadable means "all". Calls
   * that only reduce exposure (pause, reject) are never blocked. A var, not a secret: `wrangler deploy --var` flips it.
   */
  MARKETER_RAILS_KILL_SWITCH?: string;
  /** Decision endpoint (empty = https://openrouter.ai/api/alpha/decisions). */
  OPENROUTER_DECISIONS_URL?: string;
  /** Pinned, dated decision model slug (empty = DEFAULT_DECISION_MODEL in src/marketer/decisions/questions.ts). Never a "-latest" alias. */
  DECISION_MODEL?: string;
  /** Per-point modes, e.g. "routing=shadow,approval_risk=enforce" (off | shadow | enforce). Unset = each point's default (shadow). */
  DECISION_MODES?: string;
  /**
   * Recall (src/marketer/recall, docs/memory/supermemory.md): Supermemory API origin. Empty = https://api.supermemory.ai;
   * a self-hosted (`supermemory local`) or enterprise endpoint otherwise. https, or http on loopback only.
   */
  SUPERMEMORY_BASE_URL?: string;
  /**
   * Braintrust (docs/observability/braintrust.md): the project traces, feedback and evals go to, one per environment.
   * Nothing is sent unless BRAINTRUST_API_KEY (secret) and this are both set.
   */
  BRAINTRUST_PROJECT_ID?: string;
  /** Braintrust data plane: empty = https://api.braintrust.dev; EU https://api-eu.braintrust.dev; or a self-hosted URL. */
  BRAINTRUST_API_URL?: string;
  /** How much text traces carry: "redacted" (default: masked prompts and outputs) or "metadata" (none). A workspace can lower it to "metadata". */
  BRAINTRUST_CONTENT?: string;

  // --- Secrets (wrangler secret put / .dev.vars) ------------------------------
  OPENAI_API_KEY: string;
  /** Shared with the Marketer web app (../web), which mints session tokens for the signed-in Clerk user (tid = sub = user id). */
  SESSION_SIGNING_SECRET: string;
  SESSION_SIGNING_SECRET_PREVIOUS?: string;
  APPROVAL_SIGNING_SECRET: string;
  WEBHOOK_SIGNING_SECRET: string;
  /** Optional per-purpose signing secrets; each falls back to WEBHOOK_SIGNING_SECRET (src/lib/policy.ts signingSecret). */
  INBOUND_WEBHOOK_SECRET?: string;
  OUTBOUND_WEBHOOK_SECRET?: string;
  TENANT_SYNC_SECRET?: string;
  EVAL_HARNESS_SECRET?: string;
  /**
   * Marketer API service token. MUST equal the backend's MARKETER_AGENT_SERVICE_TOKEN (backend/auth.py agent delegation:
   * with `x-tenant-id` the backend acts as that existing user, role "user", never admin). Persistent agents never see
   * it: the credential broker injects it as the `saas` credential for the PRIMARY_SAAS_API_URL host only.
   */
  SAAS_SERVICE_TOKEN?: string;
  CF_API_TOKEN?: string;
  /** Token for an authenticated AI Gateway (sent as cf-aig-authorization). */
  AI_GATEWAY_TOKEN?: string;
  SENDRAVEN_API_KEY?: string;
  BOAT_DEV_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  PUSHER_APP_ID?: string;
  PUSHER_KEY?: string;
  PUSHER_SECRET?: string;
  PUSHER_CLUSTER?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;
  /** Bearer token for OTLP_TRACES_ENDPOINT (sent as `authorization: Bearer …`). */
  OTLP_TRACES_TOKEN?: string;
  MANYCHAT_WEBHOOK_SECRET?: string;
  /** web_search providers (Jina / Firecrawl); the tool degrades gracefully without them. */
  JINA_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  /** Coding module: GitHub import / push / pull requests. */
  GITHUB_TOKEN?: string;
  /**
   * Decision models (src/marketer/decisions): OpenRouter key, server-side only. Unset = every decision point is off and
   * the agents behave exactly as without decision models.
   */
  OPENROUTER_API_KEY?: string;
  /**
   * Recall: Supermemory API key (`wrangler secret put SUPERMEMORY_API_KEY`), separate per environment. Read only by
   * src/marketer/recall/client.ts. Unset = no recall, exactly as before.
   */
  SUPERMEMORY_API_KEY?: string;
  /** Recall: 32+ random bytes, the SAME value as the backend's. Namespaces are HMACs of identity under it. */
  MEMORY_NAMESPACE_SECRET?: string;
  /** Braintrust API key (`wrangler secret put BRAINTRUST_API_KEY`), one per environment. Never sent to the browser. */
  BRAINTRUST_API_KEY?: string;

  /** Voice module (LiveKit). */
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  VOICE_AGENT_SECRET?: string;
  VOICE_AGENT_SECRET_PREVIOUS?: string;

  // --- Voice module vars -------------------------------------------------------
  LIVEKIT_URL?: string;
  LIVEKIT_AGENT_NAME?: string;
  VOICE_AGENTS?: string;
  VOICE_MODEL?: string;
  VOICE_DEV_ENABLED?: string;
  /** Agents an anonymous voice-widget visitor may call (comma list of visitor-enabled agents); empty = none. */
  VOICE_WIDGET_AGENTS?: string;

  // --- Coding module vars ------------------------------------------------------
  GITHUB_REPOSITORY?: string;
  /** Coding module: tenants allowed to use GITHUB_REPOSITORY (comma list); others need their own repo mapping. */
  GITHUB_REPOSITORY_TENANTS?: string;
  CODER_TEST_COMMAND?: string;
  CODER_LINT_COMMAND?: string;
  CODER_SETUP_COMMAND?: string;
}
