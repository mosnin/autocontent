import { sha256Hex } from "../util/crypto.ts";
import { cosineSimilarity } from "../util/text.ts";
import type {
  BlobObject,
  BlobPutOptions,
  BlobStore,
  Embedder,
  KeyValueStore,
  VectorMatch,
  VectorQueryOptions,
  VectorRecord,
  VectorStore,
} from "./ports.ts";

/** In-memory adapters for local development, tests and evals. */
export class MemoryBlobStore implements BlobStore {
  private readonly objects = new Map<string, { data: Uint8Array; etag: string; contentType?: string; metadata?: Record<string, string>; uploaded: Date }>();
  private version = 0;

  async get(key: string): Promise<BlobObject | null> {
    const entry = this.objects.get(key);
    if (!entry) return null;
    const data = entry.data;
    return {
      key,
      size: data.byteLength,
      etag: entry.etag,
      uploaded: entry.uploaded,
      ...(entry.contentType ? { contentType: entry.contentType } : {}),
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
      text: async () => new TextDecoder().decode(data),
      arrayBuffer: async () => data.slice().buffer,
    };
  }

  async put(key: string, value: string | ArrayBuffer | Uint8Array, options: BlobPutOptions = {}): Promise<{ key: string; etag: string }> {
    const existing = this.objects.get(key);
    if (options.onlyIfEtag !== undefined && existing?.etag !== options.onlyIfEtag) {
      throw new Error(`Precondition failed for ${key}`);
    }
    const data = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value.slice() : new Uint8Array(value.slice(0));
    const etag = `v${++this.version}`;
    this.objects.set(key, {
      data,
      etag,
      uploaded: new Date(),
      ...(options.contentType ? { contentType: options.contentType } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });
    return { key, etag };
  }

  async delete(key: string | string[]): Promise<void> {
    for (const k of Array.isArray(key) ? key : [key]) this.objects.delete(k);
  }

  async list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{ keys: string[]; cursor?: string; truncated: boolean }> {
    const all = [...this.objects.keys()].filter((k) => k.startsWith(options.prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const keys = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return truncated ? { keys, cursor: String(start + limit), truncated } : { keys, truncated };
  }
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, { value: string; expiresAt?: number }>();
  constructor(private readonly clock: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.clock()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options: { expirationTtlSeconds?: number } = {}): Promise<void> {
    this.data.set(key, options.expirationTtlSeconds ? { value, expiresAt: this.clock() + options.expirationTtlSeconds * 1000 } : { value });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

export class MemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.id, { ...record, values: [...record.values] });
  }

  async query(vector: number[], options: VectorQueryOptions): Promise<VectorMatch[]> {
    const matches: VectorMatch[] = [];
    for (const record of this.records.values()) {
      if (options.namespace !== undefined && record.namespace !== options.namespace) continue;
      if (options.filter && !Object.entries(options.filter).every(([k, v]) => record.metadata[k] === v)) continue;
      matches.push({ id: record.id, score: cosineSimilarity(vector, record.values), metadata: record.metadata });
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, options.topK);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }

  size(): number {
    return this.records.size;
  }
}

/**
 * Deterministic feature-hashing embedder. Not a semantic model, but stable and
 * dependency-free: used for offline development, tests and as a last-resort
 * fallback when no embedding provider is reachable.
 */
export class HashingEmbedder implements Embedder {
  readonly model = "hashing-bow-v1";
  constructor(readonly dimensions = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as string;
        this.add(vector, token, 1);
        if (i > 0) this.add(vector, `${tokens[i - 1]}_${token}`, 0.5);
      }
      const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
      return vector.map((v) => v / norm);
    });
  }

  private add(vector: number[], token: string, weight: number): void {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const index = Math.abs(h) % this.dimensions;
    vector[index] = (vector[index] ?? 0) + ((h & 1) === 0 ? weight : -weight);
  }
}

export async function contentHash(value: string | Uint8Array): Promise<string> {
  return sha256Hex(value);
}
