import { AgentError } from "../errors.ts";
import type { BlobObject, BlobPutOptions, BlobStore } from "../storage/ports.ts";
import { TenantScopedBlobStore } from "../tenancy/tenancy.ts";

/**
 * Workspace boundary of a persistent agent: every write lands under `tenants/<tenantId>/agents/<agentId>/`; keys
 * under `managed/` resolve to the tenant's managed assets (`tenants/<tenantId>/managed/`) and are read-only.
 * Path traversal is refused by the tenant-scoped store underneath.
 */
export const MANAGED_PREFIX = "managed/";

export function persistentWorkspacePrefix(tenantId: string, agentId: string): string {
  return `tenants/${tenantId}/agents/${agentId}/`;
}

export class PersistentWorkspace implements BlobStore {
  private readonly own: TenantScopedBlobStore;
  private readonly managed: TenantScopedBlobStore;

  constructor(inner: BlobStore, tenantId: string, agentId: string) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(agentId)) throw new AgentError("TENANT_ISOLATION_VIOLATION", "Invalid persistent agent id");
    this.own = new TenantScopedBlobStore(inner, tenantId, `agents/${agentId}`);
    this.managed = new TenantScopedBlobStore(inner, tenantId, "managed");
  }

  get prefix(): string {
    return this.own.prefix;
  }

  private route(key: string): { store: TenantScopedBlobStore; key: string; managed: boolean } {
    const clean = key.replace(/^\/+/, "");
    return clean.startsWith(MANAGED_PREFIX) ? { store: this.managed, key: clean.slice(MANAGED_PREFIX.length), managed: true } : { store: this.own, key: clean, managed: false };
  }

  private writable(key: string): string {
    const target = this.route(key);
    if (target.managed) throw new AgentError("TOOL_NOT_ALLOWED", `Managed assets are read-only: ${key.slice(0, 200)}`);
    return target.key;
  }

  async get(key: string): Promise<BlobObject | null> {
    const target = this.route(key);
    const object = await target.store.get(target.key);
    return object ? { ...object, key } : null;
  }

  async put(key: string, value: string | ArrayBuffer | Uint8Array, options?: BlobPutOptions) {
    return this.own.put(this.writable(key), value, options);
  }

  async delete(key: string | string[]): Promise<void> {
    return this.own.delete(Array.isArray(key) ? key.map((k) => this.writable(k)) : this.writable(key));
  }

  async list(options: { prefix: string; limit?: number; cursor?: string }) {
    const target = this.route(options.prefix ?? "");
    const result = await target.store.list({ ...options, prefix: target.key });
    return target.managed ? { ...result, keys: result.keys.map((k) => `${MANAGED_PREFIX}${k}`) } : result;
  }
}
