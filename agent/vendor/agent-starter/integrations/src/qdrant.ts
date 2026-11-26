import {
  type Embedder,
  HttpError,
  type MemoryHit,
  type RetrievalSource,
  TenantIsolationError,
  type VectorMatch,
  type VectorMetadataValue,
  type VectorQueryOptions,
  type VectorRecord,
  type VectorStore,
  fromHex,
  toHex,
} from "@agent-starter/core";

/**
 * Qdrant over its REST API (works from Workers: plain fetch + `api-key`).
 *
 * Qdrant point ids must be unsigned integers or UUIDs, so arbitrary string ids
 * (e.g. "tenant_a:doc-1#3") are mapped to deterministic UUIDv5s and the
 * original id is kept in the payload under `_agent_id` and returned on query.
 * Metadata filters become `filter.must` equality conditions (tenantId included).
 */

/** Namespace for UUIDv5 point ids. Changing it orphans existing points. */
export const QDRANT_ID_NAMESPACE = "5f0a2c3e-8b1d-4c6e-9a7f-2d4b6e8f0a1c";
export const QDRANT_ORIGINAL_ID_KEY = "_agent_id";
export const QDRANT_NAMESPACE_KEY = "_namespace";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 4122 UUIDv5 (SHA-1, name-based) using Web Crypto. */
export async function uuidV5(name: string, namespace: string = QDRANT_ID_NAMESPACE): Promise<string> {
  if (!UUID_PATTERN.test(namespace)) throw new Error(`Invalid UUID namespace "${namespace}"`);
  const ns = fromHex(namespace.replace(/-/g, ""));
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns);
  data.set(nameBytes, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  hash[6] = ((hash[6] as number) & 0x0f) | 0x50;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = toHex(hash);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Qdrant-acceptable point id for any string id: UUIDs pass through (lower-cased), everything else → UUIDv5. */
export async function qdrantPointId(id: string, namespace: string = QDRANT_ID_NAMESPACE): Promise<string> {
  return UUID_PATTERN.test(id) ? id.toLowerCase() : uuidV5(id, namespace);
}

export type QdrantCondition = { key: string; match: { value: string | number | boolean } } | { key: string; range: { gte: number; lte: number } };

export interface QdrantFilter {
  must: QdrantCondition[];
}

/**
 * Translate an equality filter (+ optional namespace) into Qdrant `filter.must`.
 * Strings, booleans and integers use `match.value`; non-integer numbers use a
 * degenerate `range` (Qdrant `match` only supports keyword/integer/bool).
 */
export function buildQdrantFilter(filter: Record<string, VectorMetadataValue> = {}, namespace?: string): QdrantFilter | undefined {
  const must: QdrantCondition[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === "number" && !Number.isInteger(value)) must.push({ key, range: { gte: value, lte: value } });
    else must.push({ key, match: { value } });
  }
  if (namespace) must.push({ key: QDRANT_NAMESPACE_KEY, match: { value: namespace } });
  return must.length > 0 ? { must } : undefined;
}

export interface QdrantVectorStoreOptions {
  /** e.g. https://xyz.eu-central-1-0.aws.cloud.qdrant.io:6333 */
  url: string;
  collection: string;
  apiKey?: string;
  /** Named vector to read/write (collections created with multiple named vectors). */
  vectorName?: string;
  idNamespace?: string;
  /** Wait for the write to be applied before returning. Default true. */
  wait?: boolean;
  fetch?: typeof fetch;
}

interface QdrantScoredPoint {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
}

export class QdrantVectorStore implements VectorStore {
  private readonly base: string;

  constructor(private readonly options: QdrantVectorStoreOptions) {
    this.base = `${options.url.replace(/\/+$/, "")}/collections/${encodeURIComponent(options.collection)}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(`${this.base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.options.apiKey ? { "api-key": this.options.apiKey } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw await HttpError.fromResponse(response, `Qdrant ${method} ${path || "/"}`);
    return (await response.json()) as T;
  }

  private waitQuery(): string {
    return `?wait=${this.options.wait === false ? "false" : "true"}`;
  }

  /** Create the collection if missing (and keyword payload indexes, e.g. ["tenantId"], for fast filtered search). */
  async ensureCollection(options: { dimensions: number; distance?: "Cosine" | "Dot" | "Euclid" | "Manhattan"; payloadIndexes?: string[] }): Promise<{ created: boolean }> {
    const doFetch = this.options.fetch ?? fetch;
    const existing = await doFetch(this.base, { method: "GET", headers: this.options.apiKey ? { "api-key": this.options.apiKey } : {} });
    let created = false;
    if (existing.status === 404) {
      const params = { size: options.dimensions, distance: options.distance ?? "Cosine" };
      await this.call("PUT", "", { vectors: this.options.vectorName ? { [this.options.vectorName]: params } : params });
      created = true;
    } else if (!existing.ok) {
      throw await HttpError.fromResponse(existing, "Qdrant GET collection");
    }
    for (const field of options.payloadIndexes ?? ["tenantId"]) {
      await this.call("PUT", `/index${this.waitQuery()}`, { field_name: field, field_schema: "keyword" });
    }
    return { created };
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const namespace = this.options.idNamespace ?? QDRANT_ID_NAMESPACE;
    const points = await Promise.all(
      records.map(async (record) => ({
        id: await qdrantPointId(record.id, namespace),
        vector: this.options.vectorName ? { [this.options.vectorName]: record.values } : record.values,
        payload: {
          ...record.metadata,
          [QDRANT_ORIGINAL_ID_KEY]: record.id,
          ...(record.namespace ? { [QDRANT_NAMESPACE_KEY]: record.namespace } : {}),
        },
      })),
    );
    await this.call("PUT", `/points${this.waitQuery()}`, { points });
  }

  async query(vector: number[], options: VectorQueryOptions): Promise<VectorMatch[]> {
    const filter = buildQdrantFilter(options.filter, options.namespace);
    const response = await this.call<{ result: QdrantScoredPoint[] }>("POST", "/points/search", {
      vector: this.options.vectorName ? { name: this.options.vectorName, vector } : vector,
      limit: options.topK,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
    return (response.result ?? []).map((point) => {
      const payload = point.payload ?? {};
      const metadata: Record<string, VectorMetadataValue> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (key === QDRANT_ORIGINAL_ID_KEY || key === QDRANT_NAMESPACE_KEY) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") metadata[key] = value;
      }
      const original = payload[QDRANT_ORIGINAL_ID_KEY];
      return { id: typeof original === "string" ? original : String(point.id), score: point.score, metadata };
    });
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const namespace = this.options.idNamespace ?? QDRANT_ID_NAMESPACE;
    const points = await Promise.all(ids.map((id) => qdrantPointId(id, namespace)));
    await this.call("POST", `/points/delete${this.waitQuery()}`, { points });
  }
}

export interface QdrantRetrievalSourceOptions {
  store: VectorStore;
  embedder: Embedder;
  /** Every search is force-filtered by this tenant and results are re-checked. */
  tenantId: string;
  name?: string;
  /** Payload key holding the chunk text. Default "text". */
  textKey?: string;
  filter?: Record<string, VectorMetadataValue>;
  namespace?: string;
  minScore?: number;
}

/** Core `RetrievalSource` over Qdrant (or any VectorStore) for `KnowledgeRetriever`. */
export function qdrantRetrievalSource(options: QdrantRetrievalSourceOptions): RetrievalSource {
  const name = options.name ?? "qdrant";
  const textKey = options.textKey ?? "text";
  return {
    name,
    async search(query, { topK }) {
      const [vector] = await options.embedder.embed([query]);
      if (!vector) return [];
      const matches = await options.store.query(vector, {
        topK,
        filter: { ...(options.filter ?? {}), tenantId: options.tenantId },
        ...(options.namespace ? { namespace: options.namespace } : {}),
      });
      const hits: MemoryHit[] = [];
      for (const match of matches) {
        if (match.metadata.tenantId !== options.tenantId) {
          throw new TenantIsolationError("Qdrant returned a point from another tenant.", { expected: options.tenantId, id: match.id });
        }
        if (options.minScore !== undefined && match.score < options.minScore) continue;
        const text = match.metadata[textKey];
        if (typeof text !== "string" || text.length === 0) continue;
        hits.push({ id: match.id, text, score: match.score, source: name, metadata: match.metadata });
      }
      return hits;
    },
  };
}
