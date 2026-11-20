/**
 * Storage ports. The engine never imports a platform SDK directly; Cloudflare,
 * Node and in-memory adapters implement these interfaces.
 */
export type SqlValue = string | number | bigint | null | ArrayBuffer | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

/**
 * Synchronous SQL surface modelled on Durable Object SQLite (`ctx.storage.sql`).
 * Node's `node:sqlite` and better-sqlite3 satisfy the same shape.
 */
export interface SqlStore {
  exec<T = SqlRow>(query: string, ...bindings: SqlValue[]): T[];
  /** Run `fn` atomically. Adapters map this to `ctx.storage.transactionSync` / BEGIN..COMMIT. */
  transaction<T>(fn: () => T): T;
}

export interface BlobObject {
  key: string;
  size: number;
  etag?: string;
  uploaded?: Date;
  contentType?: string;
  metadata?: Record<string, string>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface BlobPutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  /** Only write if the current etag matches (optimistic concurrency). */
  onlyIfEtag?: string;
}

export interface BlobStore {
  get(key: string): Promise<BlobObject | null>;
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: BlobPutOptions): Promise<{ key: string; etag?: string }>;
  delete(key: string | string[]): Promise<void>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{ keys: string[]; cursor?: string; truncated: boolean }>;
  /** Public or signed URL for zero-egress delivery, when the backing store supports it. */
  url?(key: string): string | undefined;
}

export interface KeyValueStore {
  get(key: string, options?: { cacheTtlSeconds?: number }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list?(prefix: string): Promise<string[]>;
}

export type VectorMetadataValue = string | number | boolean;

export interface VectorRecord {
  id: string;
  values: number[];
  namespace?: string;
  metadata: Record<string, VectorMetadataValue>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata: Record<string, VectorMetadataValue>;
}

export interface VectorQueryOptions {
  topK: number;
  namespace?: string;
  /** Equality filter on metadata. Adapters translate to the backend's syntax. */
  filter?: Record<string, VectorMetadataValue>;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(vector: number[], options: VectorQueryOptions): Promise<VectorMatch[]>;
  deleteByIds(ids: string[]): Promise<void>;
}

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
