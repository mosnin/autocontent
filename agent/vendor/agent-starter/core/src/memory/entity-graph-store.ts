import { TenantIsolationError } from "../errors.ts";
import { assessInjection, wrapUntrusted } from "../guardrails/injection.ts";
import type { KeyValueStore } from "../storage/ports.ts";
import { TenantIdSchema, type TenantSecurityContext } from "../tenancy/tenancy.ts";
import { slugify } from "../util/text.ts";
import { type EntityGraphMemory, type EntityRecord, entitySlug, type RelationshipRecord } from "./entity-graph.ts";

/**
 * Tenant-scoped, cross-session relational memory (spec "Global Cross-Session
 * Memory"). A store is bound to ONE tenant (optionally one user) when it is
 * created, so every job, chat and background run of that tenant sees the same
 * graph and no call can reach another tenant's graph.
 */

/** One change to the graph, reported to `onDelta` (the Flue tracer records these as `db.delta`). */
export interface GraphDelta {
  op: "upsert_entity" | "set_attribute" | "connect";
  entityId: string;
  key?: string;
  targetId?: string;
  relationshipType?: string;
}

export interface EntitySummary {
  id: string;
  type: string;
  name: string;
  updatedAt: number;
}

/** One remembered fact: an entity, its attributes and optionally a relationship, written in one go. */
export interface FactInput {
  entity: { type: string; name: string; description?: string };
  attributes?: Record<string, { value: string; confidence?: number }>;
  relation?: { target: { type: string; name: string; description?: string }; type: string; confidence?: number };
}

export interface EntityGraphStore {
  readonly tenantId: string;
  /** Set when the graph is private to one user of the tenant. */
  readonly userId?: string;
  entityId(type: string, name: string): string;
  saveEntity(type: string, name: string, description?: string): Promise<string>;
  saveAttribute(entityId: string, key: string, value: string, confidence?: number): Promise<void>;
  connect(sourceId: string, targetId: string, relationshipType: string, confidence?: number): Promise<void>;
  /** Save an entity, its attributes and a relationship with as few writes as possible (one per document on KV). */
  upsertFact(fact: FactInput): Promise<{ entityId: string; targetId?: string }>;
  getEntity(entityId: string): Promise<EntityRecord | null>;
  findEntities(query: string, limit?: number): Promise<EntityRecord[]>;
  /** Most recently updated entities first. */
  entities(limit?: number): Promise<EntitySummary[]>;
  neighborhood(entityId: string, depth?: 1 | 2): Promise<RelationshipRecord[]>;
  renderContext(entityId: string, depth?: 1 | 2): Promise<string>;
}

function assertOwned(tenantId: string, entityId: string): void {
  if (!entityId.startsWith(`${tenantId}:`)) throw new TenantIsolationError(`Entity ${entityId} does not belong to tenant ${tenantId}`, { entityId });
}

/** Async adapter over the SQLite `EntityGraphMemory` (a Durable Object's own SQLite: shared by whatever that DO serves). */
export class SqlEntityGraphStore implements EntityGraphStore {
  readonly tenantId: string;

  constructor(
    private readonly graph: EntityGraphMemory,
    private readonly options: { onDelta?: (delta: GraphDelta) => void } = {},
  ) {
    this.tenantId = graph.tenantId;
  }

  entityId(type: string, name: string): string {
    return this.graph.entityId(type, name);
  }

  async saveEntity(type: string, name: string, description?: string): Promise<string> {
    const id = this.graph.saveEntity(type, name, description);
    this.options.onDelta?.({ op: "upsert_entity", entityId: id });
    return id;
  }

  async saveAttribute(entityId: string, key: string, value: string, confidence = 1): Promise<void> {
    this.graph.saveAttribute(entityId, key, value, confidence);
    this.options.onDelta?.({ op: "set_attribute", entityId, key });
  }

  async connect(sourceId: string, targetId: string, relationshipType: string, confidence = 1): Promise<void> {
    this.graph.connect(sourceId, targetId, relationshipType, confidence);
    this.options.onDelta?.({ op: "connect", entityId: sourceId, targetId, relationshipType });
  }

  async upsertFact(fact: FactInput): Promise<{ entityId: string; targetId?: string }> {
    const entityId = await this.saveEntity(fact.entity.type, fact.entity.name, fact.entity.description);
    for (const [key, a] of Object.entries(fact.attributes ?? {})) await this.saveAttribute(entityId, key, a.value, a.confidence ?? 1);
    if (!fact.relation) return { entityId };
    const targetId = await this.saveEntity(fact.relation.target.type, fact.relation.target.name, fact.relation.target.description);
    await this.connect(entityId, targetId, fact.relation.type, fact.relation.confidence ?? 1);
    return { entityId, targetId };
  }

  async getEntity(entityId: string): Promise<EntityRecord | null> {
    return this.graph.getEntity(entityId);
  }

  async findEntities(query: string, limit = 10): Promise<EntityRecord[]> {
    return this.graph.findEntities(query, limit);
  }

  async entities(limit = 500): Promise<EntitySummary[]> {
    return this.graph.listEntities(limit);
  }

  async neighborhood(entityId: string, depth: 1 | 2 = 1): Promise<RelationshipRecord[]> {
    return this.graph.neighborhood(entityId, depth);
  }

  async renderContext(entityId: string, depth: 1 | 2 = 1): Promise<string> {
    return this.graph.renderContext(entityId, depth);
  }
}

interface EntityDoc {
  v: 1;
  id: string;
  type: string;
  name: string;
  description: string | null;
  attributes: Record<string, { value: string; confidence: number; updatedAt: number }>;
  edges: Array<{ sourceId: string; targetId: string; type: string; confidence: number; createdAt: number }>;
  createdAt: number;
  updatedAt: number;
}

interface IndexDoc {
  v: 1;
  entities: EntitySummary[];
}

export interface KvEntityGraphStoreOptions {
  kv: KeyValueStore;
  tenantId: string;
  /** Make the graph private to one user of the tenant (default: shared by the whole tenant). */
  userId?: string;
  /** Most entities kept per graph; the least recently updated are evicted. Default 1000. */
  maxEntities?: number;
  /** Most relationships kept per entity (oldest dropped). Default 200. */
  maxEdgesPerEntity?: number;
  /** Retention: entity documents expire this long after their last update. Default: no expiry. */
  ttlSeconds?: number;
  /** Key prefix. Default "eg". */
  prefix?: string;
  /** Wait before the single retry of a failed write (Workers KV allows about one write per second per key). Default 1100 ms. */
  retryDelayMs?: number;
  /** An existing entity's index entry is rewritten at most this often (recency). Default 60 s. */
  indexRefreshMs?: number;
  clock?: () => number;
  onDelta?: (delta: GraphDelta) => void;
}

/**
 * Tenant-scoped entity graph on a key-value store (Workers KV in production).
 * Keys: `<prefix>/<tenantId>/t/…` (whole tenant) or `<prefix>/<tenantId>/u/<encoded user>/…`
 * (one user). `/` never appears in a tenant id and user ids are URI-encoded, so two
 * scopes can never share a key. Writes are last-writer-wins per document (KV is
 * eventually consistent): fine for memory, not for counters. Workers KV allows about
 * one write per second per key, so each document is written once per operation
 * (`upsertFact` batches a whole fact), the index only when an entity is new, renamed or
 * stale, and a failed write is retried once after `retryDelayMs` on a fresh read.
 */
export class KvEntityGraphStore implements EntityGraphStore {
  readonly tenantId: string;
  readonly userId?: string;
  private readonly base: string;
  private readonly clock: () => number;
  private readonly maxEntities: number;
  private readonly maxEdges: number;
  private readonly retryDelayMs: number;
  private readonly indexRefreshMs: number;

  constructor(private readonly options: KvEntityGraphStoreOptions) {
    this.tenantId = TenantIdSchema.parse(options.tenantId);
    if (options.userId !== undefined) {
      if (!options.userId) throw new TenantIsolationError("A user-scoped entity graph needs a user id.");
      this.userId = options.userId;
    }
    const scope = options.userId ? `u/${encodeURIComponent(options.userId)}` : "t";
    this.base = `${options.prefix ?? "eg"}/${this.tenantId}/${scope}/`;
    this.clock = options.clock ?? Date.now;
    this.maxEntities = Math.max(1, options.maxEntities ?? 1000);
    this.maxEdges = Math.max(1, options.maxEdgesPerEntity ?? 200);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 1100);
    this.indexRefreshMs = Math.max(0, options.indexRefreshMs ?? 60_000);
  }

  /** Read-modify-write once; on failure (e.g. a KV per-key rate limit) wait and redo it from a fresh read. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      return fn();
    }
  }

  /** Apply `change` to an entity document (created when `create` is given and it does not exist) and write it once. */
  private async mutateDoc(entityId: string, change: (doc: EntityDoc, now: number) => void, create?: { type: string; name: string }): Promise<{ doc: EntityDoc; created: boolean } | null> {
    return this.withRetry(async () => {
      const existing = await this.readDoc(entityId);
      if (!existing && !create) return null;
      const now = this.clock();
      const doc: EntityDoc = existing ?? { v: 1, id: entityId, type: create?.type ?? "entity", name: create?.name ?? entityId, description: null, attributes: {}, edges: [], createdAt: now, updatedAt: now };
      change(doc, now);
      doc.updatedAt = now;
      await this.writeDoc(doc);
      return { doc, created: !existing };
    });
  }

  private link(doc: EntityDoc, sourceId: string, targetId: string, type: string, confidence: number, now: number): void {
    const existing = doc.edges.find((e) => e.sourceId === sourceId && e.targetId === targetId && e.type === type);
    if (existing) existing.confidence = Math.max(existing.confidence, confidence);
    else doc.edges.push({ sourceId, targetId, type, confidence, createdAt: now });
    if (doc.edges.length > this.maxEdges) doc.edges.splice(0, doc.edges.length - this.maxEdges);
  }

  entityId(type: string, name: string): string {
    return `${this.tenantId}:${slugify(type) || "entity"}:${entitySlug(name)}`;
  }

  private docKey(entityId: string): string {
    return `${this.base}e/${encodeURIComponent(entityId)}`;
  }

  private async readDoc(entityId: string): Promise<EntityDoc | null> {
    assertOwned(this.tenantId, entityId);
    const raw = await this.options.kv.get(this.docKey(entityId));
    if (!raw) return null;
    try {
      const doc = JSON.parse(raw) as EntityDoc;
      return doc.id === entityId ? doc : null;
    } catch {
      return null;
    }
  }

  private async writeDoc(doc: EntityDoc): Promise<void> {
    await this.options.kv.put(this.docKey(doc.id), JSON.stringify(doc), this.options.ttlSeconds ? { expirationTtlSeconds: this.options.ttlSeconds } : undefined);
  }

  private async readIndex(): Promise<IndexDoc> {
    const raw = await this.options.kv.get(`${this.base}index`);
    if (!raw) return { v: 1, entities: [] };
    try {
      const parsed = JSON.parse(raw) as IndexDoc;
      return Array.isArray(parsed.entities) ? parsed : { v: 1, entities: [] };
    } catch {
      return { v: 1, entities: [] };
    }
  }

  /** Record entities in the index in ONE write, skipping entries that are already current (name, type, recent). */
  private async touchIndex(summaries: EntitySummary[]): Promise<void> {
    if (summaries.length === 0) return;
    const peek = await this.readIndex();
    const stale = summaries.filter((s) => {
      const known = peek.entities.find((e) => e.id === s.id);
      return !known || known.name !== s.name || known.type !== s.type || s.updatedAt - known.updatedAt >= this.indexRefreshMs;
    });
    if (stale.length === 0) return;
    const evicted = await this.withRetry(async () => {
      const index = await this.readIndex();
      const ids = new Set(stale.map((s) => s.id));
      const entities = [...stale, ...index.entities.filter((e) => !ids.has(e.id))].sort((a, b) => b.updatedAt - a.updatedAt);
      const dropped = entities.splice(this.maxEntities);
      await this.options.kv.put(`${this.base}index`, JSON.stringify({ v: 1, entities } satisfies IndexDoc));
      return dropped;
    });
    await Promise.all(evicted.map((e) => this.options.kv.delete(this.docKey(e.id)).catch(() => undefined)));
  }

  async saveEntity(type: string, name: string, description?: string): Promise<string> {
    const id = this.entityId(type, name);
    const result = await this.mutateDoc(
      id,
      (doc) => {
        doc.name = name;
        if (description !== undefined) doc.description = description;
      },
      { type, name },
    );
    if (result) await this.touchIndex([{ id, type: result.doc.type, name, updatedAt: result.doc.updatedAt }]);
    this.options.onDelta?.({ op: "upsert_entity", entityId: id });
    return id;
  }

  async saveAttribute(entityId: string, key: string, value: string, confidence = 1): Promise<void> {
    const result = await this.mutateDoc(entityId, (doc, now) => {
      doc.attributes[key] = { value, confidence, updatedAt: now };
    });
    if (!result) throw new Error(`Unknown entity ${entityId}; save it first.`);
    this.options.onDelta?.({ op: "set_attribute", entityId, key });
  }

  async connect(sourceId: string, targetId: string, relationshipType: string, confidence = 1): Promise<void> {
    assertOwned(this.tenantId, sourceId);
    assertOwned(this.tenantId, targetId);
    const [source, target] = await Promise.all([this.readDoc(sourceId), this.readDoc(targetId)]);
    if (!source || !target) throw new Error(`Both entities must exist before they can be connected (${!source ? sourceId : targetId} is unknown).`);
    await Promise.all([
      this.mutateDoc(sourceId, (doc, now) => this.link(doc, sourceId, targetId, relationshipType, confidence, now)),
      ...(targetId !== sourceId ? [this.mutateDoc(targetId, (doc, now) => this.link(doc, sourceId, targetId, relationshipType, confidence, now))] : []),
    ]);
    this.options.onDelta?.({ op: "connect", entityId: sourceId, targetId, relationshipType });
  }

  async upsertFact(fact: FactInput): Promise<{ entityId: string; targetId?: string }> {
    const entityId = this.entityId(fact.entity.type, fact.entity.name);
    const targetId = fact.relation ? this.entityId(fact.relation.target.type, fact.relation.target.name) : undefined;
    const relation = fact.relation;
    const writes = [
      this.mutateDoc(
        entityId,
        (doc, now) => {
          doc.name = fact.entity.name;
          if (fact.entity.description !== undefined) doc.description = fact.entity.description;
          for (const [key, a] of Object.entries(fact.attributes ?? {})) doc.attributes[key] = { value: a.value, confidence: a.confidence ?? 1, updatedAt: now };
          if (relation && targetId) this.link(doc, entityId, targetId, relation.type, relation.confidence ?? 1, now);
        },
        { type: fact.entity.type, name: fact.entity.name },
      ),
      ...(relation && targetId && targetId !== entityId
        ? [
            this.mutateDoc(
              targetId,
              (doc, now) => {
                doc.name = relation.target.name;
                if (relation.target.description !== undefined) doc.description = relation.target.description;
                this.link(doc, entityId, targetId, relation.type, relation.confidence ?? 1, now);
              },
              { type: relation.target.type, name: relation.target.name },
            ),
          ]
        : []),
    ];
    const results = await Promise.all(writes);
    await this.touchIndex(results.filter((r): r is { doc: EntityDoc; created: boolean } => r !== null).map((r) => ({ id: r.doc.id, type: r.doc.type, name: r.doc.name, updatedAt: r.doc.updatedAt })));
    this.options.onDelta?.({ op: "upsert_entity", entityId });
    for (const key of Object.keys(fact.attributes ?? {})) this.options.onDelta?.({ op: "set_attribute", entityId, key });
    if (relation && targetId) {
      this.options.onDelta?.({ op: "upsert_entity", entityId: targetId });
      this.options.onDelta?.({ op: "connect", entityId, targetId, relationshipType: relation.type });
    }
    return targetId ? { entityId, targetId } : { entityId };
  }

  async getEntity(entityId: string): Promise<EntityRecord | null> {
    const doc = await this.readDoc(entityId);
    if (!doc) return null;
    const attributes: EntityRecord["attributes"] = {};
    for (const [key, a] of Object.entries(doc.attributes)) attributes[key] = { value: a.value, confidence: a.confidence };
    return { id: doc.id, type: doc.type, name: doc.name, description: doc.description, attributes };
  }

  async entities(limit = 500): Promise<EntitySummary[]> {
    return (await this.readIndex()).entities.slice(0, Math.max(0, limit));
  }

  async findEntities(query: string, limit = 10): Promise<EntityRecord[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const index = (await this.readIndex()).entities;
    const byName = index.filter((e) => e.name.toLowerCase().includes(q));
    let ids = byName.map((e) => e.id);
    if (ids.length < limit) {
      // Fall back to descriptions/attributes of the most recent entities (bounded reads).
      const rest = index.filter((e) => !ids.includes(e.id)).slice(0, 50);
      const docs = await Promise.all(rest.map((e) => this.readDoc(e.id)));
      for (const doc of docs) {
        if (!doc) continue;
        const haystack = [doc.description ?? "", ...Object.values(doc.attributes).map((a) => a.value)].join(" ").toLowerCase();
        if (haystack.includes(q)) ids.push(doc.id);
      }
    }
    ids = ids.slice(0, limit);
    return (await Promise.all(ids.map((id) => this.getEntity(id)))).filter((e): e is EntityRecord => e !== null);
  }

  async neighborhood(entityId: string, depth: 1 | 2 = 1): Promise<RelationshipRecord[]> {
    const docs = new Map<string, EntityDoc | null>();
    const load = async (id: string) => {
      if (!docs.has(id)) docs.set(id, id.startsWith(`${this.tenantId}:`) ? await this.readDoc(id) : null);
      return docs.get(id) ?? null;
    };
    const seen = new Set<string>();
    const out: RelationshipRecord[] = [];
    const expand = async (id: string): Promise<string[]> => {
      const doc = await load(id);
      if (!doc) return [];
      const next: string[] = [];
      await Promise.all(doc.edges.flatMap((e) => [load(e.sourceId), load(e.targetId)]));
      for (const edge of doc.edges) {
        const key = `${edge.sourceId}|${edge.type}|${edge.targetId}`;
        const source = docs.get(edge.sourceId);
        const target = docs.get(edge.targetId);
        if (seen.has(key) || !source || !target) continue;
        seen.add(key);
        out.push({ sourceId: source.id, sourceName: source.name, relationshipType: edge.type, targetId: target.id, targetName: target.name, targetType: target.type, confidence: edge.confidence });
        next.push(edge.sourceId === id ? edge.targetId : edge.sourceId);
      }
      return next;
    };
    const neighbors = await expand(entityId);
    if (depth === 2) for (const neighbor of new Set(neighbors.filter((n) => n !== entityId))) await expand(neighbor);
    return out;
  }

  async renderContext(entityId: string, depth: 1 | 2 = 1): Promise<string> {
    const entity = await this.getEntity(entityId);
    if (!entity) return "";
    const attrs = Object.entries(entity.attributes).map(([k, v]) => `${k}=${v.value}`).join(", ");
    const edges = (await this.neighborhood(entityId, depth)).map((r) => `- ${r.sourceName} —${r.relationshipType}→ ${r.targetName} (${r.targetType})`);
    return [`[RELATIONAL MEMORY: ${entity.name} (${entity.type})]`, entity.description ?? "", attrs ? `Attributes: ${attrs}` : "", ...edges].filter(Boolean).join("\n");
  }
}

export interface EntityContextOptions {
  /** Most entities injected for one turn. Default 3. */
  maxEntities?: number;
  /** Relationship hops rendered per entity. Default 1. */
  depth?: 1 | 2;
  /** Hard cap on the injected text. Default 2000 characters. */
  maxChars?: number;
  /** Entities scanned for mentions (most recently updated first). Default 500. */
  scanLimit?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
   
  if (/^[\x00-\x7F]+$/.test(needle)) return needle.length >= 3 && new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`, "i").test(text);
  return needle.length >= 2 && text.toLowerCase().includes(needle);
}

/**
 * Relational context for the entities a message mentions, ready to inject before
 * the model reads the turn (the hook calls this in its start hook). Returns "" when
 * nothing known is mentioned. Facts were written by the model from conversations,
 * so they are rendered single-line, instruction-like lines are dropped and the
 * block is wrapped as untrusted data.
 */
export async function entityContextFor(store: EntityGraphStore, tenant: TenantSecurityContext | string, text: string, options: EntityContextOptions = {}): Promise<string> {
  const tenantId = typeof tenant === "string" ? tenant : tenant.tenantId;
  if (store.tenantId !== tenantId) throw new TenantIsolationError("Entity graph store belongs to another tenant.", { tenant: tenantId });
  if (typeof tenant !== "string" && store.userId !== undefined && store.userId !== tenant.userId) throw new TenantIsolationError("Entity graph store belongs to another user.", { tenant: tenantId });
  if (!text.trim()) return "";
  const known = await store.entities(options.scanLimit ?? 500);
  const hits = known
    .filter((e) => mentions(text, e.name))
    .sort((a, b) => b.name.length - a.name.length || b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, options.maxEntities ?? 3));
  if (hits.length === 0) return "";
   
  const clean = (value: string, max = 300) => value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const safe = (value: string) => value !== "" && assessInjection(value).verdict !== "injection";
  const blocks: string[] = [];
  for (const hit of hits) {
    const entity = await store.getEntity(hit.id);
    if (!entity || !safe(clean(entity.name))) continue;
    const description = clean(entity.description ?? "");
    const attrs = Object.entries(entity.attributes)
      .map(([k, a]) => `${clean(k, 40)}=${clean(a.value)}`)
      .filter(safe);
    const edges = (await store.neighborhood(hit.id, options.depth ?? 1))
      .map((r) => `- ${clean(r.sourceName, 120)} —${clean(r.relationshipType, 60)}→ ${clean(r.targetName, 120)} (${clean(r.targetType, 40)})`)
      .filter(safe)
      .slice(0, 25);
    blocks.push([`[${clean(entity.name, 120)} (${clean(entity.type, 40)})]`, safe(description) ? description : "", attrs.length ? `Attributes: ${attrs.join(", ")}` : "", ...edges].filter(Boolean).join("\n"));
  }
  if (blocks.length === 0) return "";
  const maxChars = options.maxChars ?? 2000;
  let body = blocks.join("\n\n");
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}…`;
  return `Known facts about entities mentioned in this message (relational memory; may be outdated):\n${wrapUntrusted(body, "relational-memory")}`;
}
