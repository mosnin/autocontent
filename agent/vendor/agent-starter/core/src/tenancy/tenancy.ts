import { z } from "zod";
import { TenantIsolationError, TenantLockdownError } from "../errors.ts";
import type { BlobObject, BlobPutOptions, BlobStore, KeyValueStore, VectorMatch, VectorQueryOptions, VectorRecord, VectorStore } from "../storage/ports.ts";

/**
 * Tenant ids: 1–128 chars of `[A-Za-z0-9_.:-]`, starting with a letter/digit,
 * never containing `--` and never ending in `-` (both would make the
 * `${agent}--${tenantId}--${session}` instance id ambiguous).
 */
export const TENANT_ID_PATTERN = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9_.:-]{0,126}[A-Za-z0-9_.:])?$/;

export const TenantIdSchema = z.string().regex(TENANT_ID_PATTERN, { message: "Invalid or malformed tenant id." });

/** Every autonomous job and tool call carries this context; tools never trust model-supplied tenant ids. */
export const TenantSecurityContextSchema = z.object({
  tenantId: TenantIdSchema,
  userId: z.string().min(1, { message: "Executing user id must be provided for audit tracking." }),
  environment: z.enum(["production", "staging", "development", "test"]).default("production"),
  roles: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
});
export type TenantSecurityContext = z.infer<typeof TenantSecurityContextSchema>;

export const RiskTierSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

/** Per-tenant limits and feature flags, cached at the edge (KV) and synced from the primary SaaS. */
export const TenantConfigSchema = z.object({
  tier: z.enum(["free", "growth", "enterprise"]),
  maxTurnsPerSession: z.number().int().positive(),
  maxBudgetUsd: z.number().positive(),
  maxTokensPerSession: z.number().int().positive().optional(),
  allowedModelProfiles: z.array(z.string()).min(1),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).default([]),
  rateLimit: z.object({ eventsPerMinute: z.number().int().positive(), burst: z.number().int().positive() }).default({ eventsPerMinute: 60, burst: 20 }),
  autonomy: z
    .object({
      confidenceThreshold: z.number().min(0).max(1).default(0.85),
      maxAutonomousTier: RiskTierSchema.default("MEDIUM"),
    })
    .default({ confidenceThreshold: 0.85, maxAutonomousTier: "MEDIUM" }),
  features: z
    .object({
      autonomousBrowserUse: z.boolean().default(false),
      multiAgentGroupChat: z.boolean().default(false),
      computerUse: z.boolean().default(false),
      codeExecution: z.boolean().default(false),
      longTermMemory: z.boolean().default(true),
      outboundEmail: z.boolean().default(false),
      /**
       * Voice calls (LiveKit voice module). Parses to `false` when absent (off in the secure default);
       * optional in the TypeScript type so configs written before the flag existed still type-check.
       */
      voice: z.boolean().default(false).optional(),
    })
    .default({ autonomousBrowserUse: false, multiAgentGroupChat: false, computerUse: false, codeExecution: false, longTermMemory: true, outboundEmail: false, voice: false }),
});
export type TenantConfig = z.infer<typeof TenantConfigSchema>;

/** Secure fallback used when a tenant has no stored config: tight limits protect against cost spikes. */
export const SECURE_DEFAULT_TENANT_CONFIG: TenantConfig = TenantConfigSchema.parse({
  tier: "free",
  maxTurnsPerSession: 5,
  maxBudgetUsd: 0.15,
  allowedModelProfiles: ["first-line"],
  deniedTools: [],
});

export interface TenantConfigProviderOptions {
  kv: KeyValueStore;
  /** In-isolate cache TTL; KV itself is also edge-cached. */
  cacheTtlMs?: number;
  fallback?: TenantConfig;
  clock?: () => number;
  keyPrefix?: string;
}

/**
 * Reads tenant configuration from edge KV in ~ms. Missing config → secure
 * freemium fallback. Malformed config → hard lockdown (never guess limits).
 */
export class TenantConfigProvider {
  private readonly cache = new Map<string, { config: TenantConfig; expiresAt: number }>();
  private readonly ttl: number;
  private readonly clock: () => number;
  private readonly prefix: string;

  constructor(private readonly options: TenantConfigProviderOptions) {
    this.ttl = options.cacheTtlMs ?? 60_000;
    this.clock = options.clock ?? Date.now;
    this.prefix = options.keyPrefix ?? "config:";
  }

  async get(tenantId: string): Promise<TenantConfig> {
    TenantIdSchema.parse(tenantId);
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.clock()) return cached.config;
    const raw = await this.options.kv.get(`${this.prefix}${tenantId}`, { cacheTtlSeconds: 300 });
    let config: TenantConfig;
    if (raw === null) {
      config = this.options.fallback ?? SECURE_DEFAULT_TENANT_CONFIG;
    } else {
      try {
        config = TenantConfigSchema.parse(JSON.parse(raw));
      } catch (error) {
        throw new TenantLockdownError(tenantId, error);
      }
    }
    this.cache.set(tenantId, { config, expiresAt: this.clock() + this.ttl });
    return config;
  }

  /** Called by the SaaS → edge sync endpoint when a tenant changes settings. */
  async set(tenantId: string, config: unknown): Promise<TenantConfig> {
    TenantIdSchema.parse(tenantId);
    const parsed = TenantConfigSchema.parse(config);
    await this.options.kv.put(`${this.prefix}${tenantId}`, JSON.stringify(parsed));
    this.cache.set(tenantId, { config: parsed, expiresAt: this.clock() + this.ttl });
    return parsed;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}

const TENANT_KEYS = new Set(["tenantid", "tenant_id", "tenant", "orgid", "org_id", "organizationid", "organization_id", "workspaceid", "workspace_id"]);

/**
 * Deep-scan a payload (tool args, event body) for tenant references. Any reference
 * that differs from the executing tenant is a hard authorization error.
 */
export function assertPayloadTenant(payload: unknown, tenantId: string, path = "$"): void {
  if (payload === null || payload === undefined) return;
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertPayloadTenant(item, tenantId, `${path}[${index}]`));
    return;
  }
  if (typeof payload !== "object") return;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (TENANT_KEYS.has(key.toLowerCase()) && (typeof value === "string" || typeof value === "number") && String(value) !== tenantId) {
      throw new TenantIsolationError(`Cross-tenant reference blocked at ${path}.${key}`, { expected: tenantId, path: `${path}.${key}` });
    }
    assertPayloadTenant(value, tenantId, `${path}.${key}`);
  }
}

export function assertSameTenant(context: { tenantId: string }, resourceTenantId: string, resource = "resource"): void {
  if (context.tenantId !== resourceTenantId) {
    throw new TenantIsolationError(`Access to ${resource} owned by another tenant was denied.`, { resource });
  }
}

/** Normalize a relative storage key and reject traversal / absolute paths. */
export function safeRelativeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new TenantIsolationError(`Unsafe storage key "${key}"`, { key });
  }
  return normalized;
}

/** Blob store view confined to `tenants/{tenantId}/` — cross-tenant keys are impossible to address. */
export class TenantScopedBlobStore implements BlobStore {
  readonly prefix: string;
  constructor(
    private readonly inner: BlobStore,
    readonly tenantId: string,
    subPrefix = "",
  ) {
    TenantIdSchema.parse(tenantId);
    this.prefix = `tenants/${tenantId}/${subPrefix ? `${safeRelativeKey(subPrefix)}/` : ""}`;
  }

  private key(key: string): string {
    return this.prefix + safeRelativeKey(key);
  }

  async get(key: string): Promise<BlobObject | null> {
    const object = await this.inner.get(this.key(key));
    return object ? { ...object, key } : null;
  }

  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: BlobPutOptions) {
    return this.inner.put(this.key(key), value, options);
  }

  delete(key: string | string[]): Promise<void> {
    return this.inner.delete(Array.isArray(key) ? key.map((k) => this.key(k)) : this.key(key));
  }

  async list(options: { prefix: string; limit?: number; cursor?: string }) {
    const prefix = options.prefix ? this.prefix + options.prefix.replace(/^\/+/, "") : this.prefix;
    const result = await this.inner.list({ ...options, prefix });
    return { ...result, keys: result.keys.map((k) => k.slice(this.prefix.length)) };
  }

  url(key: string): string | undefined {
    return this.inner.url?.(this.key(key));
  }
}

/** Vector store view that stamps and force-filters `tenantId` on every write and query. */
export class TenantScopedVectorStore implements VectorStore {
  constructor(
    private readonly inner: VectorStore,
    readonly tenantId: string,
  ) {
    TenantIdSchema.parse(tenantId);
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    await this.inner.upsert(
      records.map((record) => {
        if (record.metadata.tenantId !== undefined && record.metadata.tenantId !== this.tenantId) {
          throw new TenantIsolationError("Vector record tenant mismatch", { id: record.id });
        }
        const id = record.id.startsWith(`t:${this.tenantId}:`) ? record.id : `t:${this.tenantId}:${record.id}`;
        return { ...record, id, namespace: record.namespace ?? this.tenantId, metadata: { ...record.metadata, tenantId: this.tenantId } };
      }),
    );
  }

  async query(vector: number[], options: VectorQueryOptions): Promise<VectorMatch[]> {
    if (options.filter?.tenantId !== undefined && options.filter.tenantId !== this.tenantId) {
      throw new TenantIsolationError("Cross-tenant vector query blocked");
    }
    const matches = await this.inner.query(vector, { ...options, namespace: options.namespace ?? this.tenantId, filter: { ...options.filter, tenantId: this.tenantId } });
    // Defense in depth: never return a foreign row even if the backend ignored the filter.
    return matches.filter((m) => m.metadata.tenantId === this.tenantId);
  }

  deleteByIds(ids: string[]): Promise<void> {
    return this.inner.deleteByIds(ids.map((id) => (id.startsWith(`t:${this.tenantId}:`) ? id : `t:${this.tenantId}:${id}`)));
  }
}
