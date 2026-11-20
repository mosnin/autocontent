import type {
  BlobObject,
  BlobPutOptions,
  BlobStore,
  KeyValueStore,
  SqlStore,
  SqlValue,
  VectorMatch,
  VectorMetadataValue,
  VectorQueryOptions,
  VectorRecord,
  VectorStore,
} from "@agent-starter/core";

/**
 * Durable Object SQLite → core SqlStore. Pass `ctx.storage.transactionSync`
 * when you have the full DurableObjectStorage; inside Flue tools only `sql` is
 * exposed (getCloudflareContext), and synchronous write blocks are already
 * committed atomically by the DO's implicit per-turn transaction.
 */
export class DurableObjectSqlStore implements SqlStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly transactionSync?: <T>(fn: () => T) => T,
  ) {}

  static fromState(state: DurableObjectState): DurableObjectSqlStore {
    return new DurableObjectSqlStore(state.storage.sql, (fn) => state.storage.transactionSync(fn));
  }

  exec<T = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): T[] {
    const params = bindings.map((b) => (typeof b === "bigint" ? Number(b) : b instanceof Uint8Array ? b.slice().buffer : b));
    return this.sql.exec(query, ...params).toArray() as T[];
  }

  transaction<T>(fn: () => T): T {
    return this.transactionSync ? this.transactionSync(fn) : fn();
  }
}

/** R2 bucket → core BlobStore (zero-egress artifact delivery, workspaces, eval datasets, snapshots). */
export class R2BlobStore implements BlobStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly options: { publicBaseUrl?: string } = {},
  ) {}

  async get(key: string): Promise<BlobObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      key,
      size: object.size,
      etag: object.etag,
      uploaded: object.uploaded,
      ...(object.httpMetadata?.contentType ? { contentType: object.httpMetadata.contentType } : {}),
      ...(object.customMetadata ? { metadata: object.customMetadata } : {}),
      text: () => object.text(),
      arrayBuffer: () => object.arrayBuffer(),
    };
  }

  async put(key: string, value: string | ArrayBuffer | Uint8Array, options: BlobPutOptions = {}) {
    const result = await this.bucket.put(key, value, {
      ...(options.contentType ? { httpMetadata: { contentType: options.contentType } } : {}),
      ...(options.metadata ? { customMetadata: options.metadata } : {}),
      ...(options.onlyIfEtag ? { onlyIf: { etagMatches: options.onlyIfEtag } } : {}),
    });
    if (!result) throw new Error(`R2 precondition failed for ${key}`);
    return { key, etag: result.etag };
  }

  async delete(key: string | string[]): Promise<void> {
    await this.bucket.delete(key);
  }

  async list(options: { prefix: string; limit?: number; cursor?: string }) {
    const result = await this.bucket.list({ prefix: options.prefix, limit: options.limit ?? 1000, ...(options.cursor ? { cursor: options.cursor } : {}) });
    return result.truncated ? { keys: result.objects.map((o) => o.key), cursor: result.cursor, truncated: true } : { keys: result.objects.map((o) => o.key), truncated: false };
  }

  url(key: string): string | undefined {
    return this.options.publicBaseUrl ? `${this.options.publicBaseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}` : undefined;
  }
}

/** Workers KV → core KeyValueStore (tenant config cache, rate-limit buckets, semantic cache). */
export class KVStore implements KeyValueStore {
  constructor(private readonly kv: KVNamespace) {}

  get(key: string, options: { cacheTtlSeconds?: number } = {}): Promise<string | null> {
    return this.kv.get(key, options.cacheTtlSeconds ? { type: "text", cacheTtl: Math.max(30, options.cacheTtlSeconds) } : { type: "text" });
  }

  put(key: string, value: string, options: { expirationTtlSeconds?: number } = {}): Promise<void> {
    return this.kv.put(key, value, options.expirationTtlSeconds ? { expirationTtl: Math.max(60, options.expirationTtlSeconds) } : {});
  }

  delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page: KVNamespaceListResult<unknown, string> = await this.kv.list({ prefix, ...(cursor ? { cursor } : {}) });
      keys.push(...page.keys.map((k) => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return keys;
  }
}

/** Vectorize hard limit for vector ids and namespaces (bytes). */
export const VECTORIZE_MAX_ID_BYTES = 64;
/** Metadata key that keeps the caller's original id when it had to be hashed. */
export const VECTORIZE_ORIGINAL_ID_KEY = "_asId";

const byteLength = (value: string) => new TextEncoder().encode(value).length;

/**
 * Deterministic Vectorize id: ids that fit (≤ 64 bytes) are kept verbatim;
 * longer ids (e.g. `t:<tenant>:<doc>#chunk-12`) become `h:` + base64url
 * SHA-256 (45 chars) instead of being truncated, so distinct chunks can never
 * overwrite each other.
 */
export async function vectorizeId(id: string): Promise<string> {
  if (byteLength(id) <= VECTORIZE_MAX_ID_BYTES) return id;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `h:${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/**
 * Cloudflare Vectorize → core VectorStore. Metadata filtering on `tenantId`
 * requires a metadata index: `wrangler vectorize create-metadata-index <index>
 * --property-name=tenantId --type=string` (the infra bootstrap script does this).
 * Ids and namespaces longer than 64 bytes are hashed (never truncated); the
 * original id travels in metadata (`_asId`) and is restored on query.
 */
export class VectorizeStore implements VectorStore {
  constructor(private readonly index: Vectorize | VectorizeIndex) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500);
      const vectors = await Promise.all(
        batch.map(async (r) => {
          const id = await vectorizeId(r.id);
          return {
            id,
            values: r.values,
            ...(r.namespace ? { namespace: await vectorizeId(r.namespace) } : {}),
            metadata: id === r.id ? r.metadata : { ...r.metadata, [VECTORIZE_ORIGINAL_ID_KEY]: r.id },
          };
        }),
      );
      await this.index.upsert(vectors);
    }
  }

  async query(vector: number[], options: VectorQueryOptions): Promise<VectorMatch[]> {
    const result = await this.index.query(vector, {
      topK: Math.min(options.topK, 50),
      returnMetadata: "all",
      ...(options.namespace ? { namespace: await vectorizeId(options.namespace) } : {}),
      ...(options.filter ? { filter: options.filter } : {}),
    });
    return result.matches.map((m) => {
      const { [VECTORIZE_ORIGINAL_ID_KEY]: original, ...metadata } = (m.metadata ?? {}) as Record<string, VectorMetadataValue>;
      return { id: typeof original === "string" ? original : m.id, score: m.score, metadata };
    });
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length) await this.index.deleteByIds(await Promise.all(ids.map((id) => vectorizeId(id))));
  }
}
