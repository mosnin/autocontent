import { z } from "zod";
import { completeJson } from "../models/structured.ts";
import type { ModelProvider } from "../models/types.ts";
import type { SqlStore } from "../storage/ports.ts";
import { slugify } from "../util/text.ts";

export interface EntityRecord {
  id: string;
  type: string;
  name: string;
  description: string | null;
  attributes: Record<string, { value: string; confidence: number }>;
}

export interface RelationshipRecord {
  sourceId: string;
  sourceName: string;
  relationshipType: string;
  targetId: string;
  targetName: string;
  targetType: string;
  confidence: number;
}

/**
 * Stable id segment for an entity name: the slug, or (for names with no ASCII
 * letters/digits, e.g. "张伟") a hash of the normalized name, so such names never
 * collapse into one shared empty-slug id.
 */
export function entitySlug(name: string): string {
  const slug = slugify(name);
  if (slug.replace(/-/g, "")) return slug;
  let hash = 0x811c9dc5;
  for (const ch of name.normalize("NFKC").trim().toLowerCase()) {
    hash ^= ch.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `u${hash.toString(16).padStart(8, "0")}`;
}

const ExtractionSchema = z.object({
  entities: z.array(z.object({ type: z.string().max(40), name: z.string().max(120), description: z.string().max(300).optional(), attributes: z.record(z.string(), z.string().max(300)).optional() })).max(25),
  relationships: z.array(z.object({ source: z.string().max(120), type: z.string().max(60), target: z.string().max(120), confidence: z.number().min(0).max(1).optional() })).max(40),
});

/**
 * Cross-session relational memory (knowledge graph) stored in the agent's
 * co-located SQLite. Vector search finds similar text; the graph remembers that
 * "Contact A works for Client B on Project C" and how that evolves over jobs.
 * Every id is tenant-prefixed, and every query filters by tenant.
 */
export class EntityGraphMemory {
  constructor(
    private readonly sql: SqlStore,
    readonly tenantId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  entityId(type: string, name: string): string {
    return `${this.tenantId}:${slugify(type) || "entity"}:${entitySlug(name)}`;
  }

  saveEntity(type: string, name: string, description?: string): string {
    const id = this.entityId(type, name);
    const now = this.clock();
    this.sql.exec(
      `INSERT INTO as_memory_entities (id, tenant_id, type, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET description = COALESCE(excluded.description, as_memory_entities.description), name = excluded.name, updated_at = excluded.updated_at`,
      id,
      this.tenantId,
      type,
      name,
      description ?? null,
      now,
      now,
    );
    return id;
  }

  saveAttribute(entityId: string, key: string, value: string, confidence = 1): void {
    this.assertOwned(entityId);
    this.sql.exec(
      `INSERT INTO as_memory_attributes (entity_id, key, value, confidence, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(entity_id, key) DO UPDATE SET value = excluded.value, confidence = excluded.confidence, updated_at = excluded.updated_at`,
      entityId,
      key,
      value,
      confidence,
      this.clock(),
    );
  }

  connect(sourceId: string, targetId: string, relationshipType: string, confidence = 1): void {
    this.assertOwned(sourceId);
    this.assertOwned(targetId);
    this.sql.exec(
      `INSERT INTO as_memory_relationships (source_id, target_id, relationship_type, confidence, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id, target_id, relationship_type) DO UPDATE SET confidence = MAX(confidence, excluded.confidence)`,
      sourceId,
      targetId,
      relationshipType,
      confidence,
      this.clock(),
    );
  }

  getEntity(entityId: string): EntityRecord | null {
    const row = this.sql.exec<{ id: string; type: string; name: string; description: string | null }>(
      `SELECT id, type, name, description FROM as_memory_entities WHERE id = ? AND tenant_id = ?`,
      entityId,
      this.tenantId,
    )[0];
    if (!row) return null;
    const attributes: EntityRecord["attributes"] = {};
    for (const a of this.sql.exec<{ key: string; value: string; confidence: number }>(`SELECT key, value, confidence FROM as_memory_attributes WHERE entity_id = ?`, entityId)) {
      attributes[a.key] = { value: a.value, confidence: Number(a.confidence) };
    }
    return { ...row, attributes };
  }

  findEntities(query: string, limit = 10): EntityRecord[] {
    const like = `%${query.replace(/[%_]/g, "")}%`;
    return this.sql
      .exec<{ id: string }>(`SELECT id FROM as_memory_entities WHERE tenant_id = ? AND (name LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT ?`, this.tenantId, like, like, limit)
      .map((r) => this.getEntity(r.id))
      .filter((e): e is EntityRecord => e !== null);
  }

  /** Entities of this tenant, most recently updated first (id, type, name, updatedAt). */
  listEntities(limit = 500): Array<{ id: string; type: string; name: string; updatedAt: number }> {
    return this.sql
      .exec<{ id: string; type: string; name: string; updated_at: number }>(`SELECT id, type, name, updated_at FROM as_memory_entities WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ?`, this.tenantId, limit)
      .map((r) => ({ id: r.id, type: r.type, name: r.name, updatedAt: Number(r.updated_at) }));
  }

  /** The semantic web around an entity (1–2 hops), ready to inject into a prompt. */
  neighborhood(entityId: string, depth: 1 | 2 = 1): RelationshipRecord[] {
    const query = `SELECT r.source_id, s.name AS source_name, r.relationship_type, r.target_id, t.name AS target_name, t.type AS target_type, r.confidence
      FROM as_memory_relationships r
      JOIN as_memory_entities s ON r.source_id = s.id
      JOIN as_memory_entities t ON r.target_id = t.id
      WHERE (r.source_id = ? OR r.target_id = ?) AND s.tenant_id = ? AND t.tenant_id = ?`;
    type Row = { source_id: string; source_name: string; relationship_type: string; target_id: string; target_name: string; target_type: string; confidence: number };
    const map = (r: Row): RelationshipRecord => ({
      sourceId: r.source_id,
      sourceName: r.source_name,
      relationshipType: r.relationship_type,
      targetId: r.target_id,
      targetName: r.target_name,
      targetType: r.target_type,
      confidence: Number(r.confidence),
    });
    const first = this.sql.exec<Row>(query, entityId, entityId, this.tenantId, this.tenantId).map(map);
    if (depth === 1) return first;
    const seen = new Set(first.map((r) => `${r.sourceId}|${r.relationshipType}|${r.targetId}`));
    const second: RelationshipRecord[] = [];
    for (const neighbor of new Set(first.flatMap((r) => [r.sourceId, r.targetId]).filter((id) => id !== entityId))) {
      for (const r of this.sql.exec<Row>(query, neighbor, neighbor, this.tenantId, this.tenantId).map(map)) {
        const key = `${r.sourceId}|${r.relationshipType}|${r.targetId}`;
        if (!seen.has(key)) {
          seen.add(key);
          second.push(r);
        }
      }
    }
    return [...first, ...second];
  }

  renderContext(entityId: string, depth: 1 | 2 = 1): string {
    const entity = this.getEntity(entityId);
    if (!entity) return "";
    const attrs = Object.entries(entity.attributes).map(([k, v]) => `${k}=${v.value}`).join(", ");
    const edges = this.neighborhood(entityId, depth).map((r) => `- ${r.sourceName} —${r.relationshipType}→ ${r.targetName} (${r.targetType})`);
    return [`[RELATIONAL MEMORY: ${entity.name} (${entity.type})]`, entity.description ?? "", attrs ? `Attributes: ${attrs}` : "", ...edges].filter(Boolean).join("\n");
  }

  /** Extract entities/relationships from text with a cheap model and upsert them. */
  async ingest(text: string, model: ModelProvider): Promise<{ entities: number; relationships: number }> {
    const { value } = await completeJson(model, ExtractionSchema, {
      system: "Extract durable real-world entities (people, organizations, projects, integrations, workflows, products) and explicit relationships between them. Only include facts stated in the text.",
      prompt: text.slice(0, 8000),
      schemaName: "entity_extraction",
      maxOutputTokens: 1200,
    });
    const ids = new Map<string, string>();
    for (const entity of value.entities) {
      const id = this.saveEntity(entity.type, entity.name, entity.description);
      ids.set(entity.name.toLowerCase(), id);
      for (const [k, v] of Object.entries(entity.attributes ?? {})) this.saveAttribute(id, k, v, 0.8);
    }
    let relationships = 0;
    for (const rel of value.relationships) {
      const source = ids.get(rel.source.toLowerCase());
      const target = ids.get(rel.target.toLowerCase());
      if (source && target) {
        this.connect(source, target, slugify(rel.type).replace(/-/g, "_"), rel.confidence ?? 0.8);
        relationships++;
      }
    }
    return { entities: value.entities.length, relationships };
  }

  private assertOwned(entityId: string): void {
    if (!entityId.startsWith(`${this.tenantId}:`)) throw new Error(`Entity ${entityId} does not belong to tenant ${this.tenantId}`);
  }
}
