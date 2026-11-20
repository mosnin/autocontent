import { z } from "zod";
import { assessInjection, wrapUntrusted } from "../guardrails/injection.ts";
import { redactSensitive } from "../guardrails/pii.ts";
import type { MigrationSet } from "../storage/migrations.ts";
import type { SqlStore } from "../storage/ports.ts";
import { randomId } from "../util/crypto.ts";

/**
 * Memory with provenance (OWASP ASI06, memory poisoning). Every write records where it came from (`source`) and
 * whether it is `trusted`. Only the owner writing directly (not derived from untrusted input) is trusted; agent
 * output, tool output and external content are untrusted, are wrapped as untrusted when recalled, expire after
 * `UNTRUSTED_MEMORY_TTL_SECONDS` by default, and are never promoted to trusted. Snapshots allow rollback.
 */
export type MemorySource = "owner" | "agent" | "external" | `tool:${string}`;
export type MemoryTrust = "trusted" | "untrusted";

export interface MemoryProvenance {
  source: MemorySource;
  trust: MemoryTrust;
}

export const MemorySourceSchema = z.union([z.enum(["owner", "agent", "external"]), z.string().regex(/^tool:[a-zA-Z0-9_-]{1,64}$/)]) as unknown as z.ZodType<MemorySource>;

export const UNTRUSTED_MEMORY_TTL_SECONDS = 30 * 86_400;

/** The trust level a write gets: trusted only for the owner's own words; anything else (or derived) is untrusted. */
export function provenanceFor(source: MemorySource, options: { derivedFromUntrusted?: boolean } = {}): MemoryProvenance {
  return { source, trust: source === "owner" && !options.derivedFromUntrusted ? "trusted" : "untrusted" };
}

/** Render a recalled memory for the model: untrusted entries are wrapped as untrusted content. */
export function renderRecalledMemory(text: string, provenance: MemoryProvenance): string {
  return provenance.trust === "trusted" ? text : wrapUntrusted(text, `memory:${provenance.source}`);
}

export interface MemoryEntry {
  id: string;
  text: string;
  source: MemorySource;
  trust: MemoryTrust;
  createdAt: number;
  expiresAt: number | null;
  tags: string[];
}

export interface MemorySnapshot {
  id: string;
  takenAt: number;
  entries: number;
}

export interface MemoryWriteInput {
  text: string;
  source: MemorySource;
  derivedFromUntrusted?: boolean;
  tags?: string[];
  ttlSeconds?: number;
}

export const PERSISTENT_MEMORY_MIGRATIONS: MigrationSet = {
  namespace: "agent-starter-persistent-memory",
  migrations: [
    {
      version: 1,
      name: "memory-with-provenance",
      up: [
        `CREATE TABLE IF NOT EXISTS as_pmem (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          source TEXT NOT NULL,
          trust TEXT NOT NULL CHECK (trust IN ('trusted', 'untrusted')),
          tags TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          expires_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS as_pmem_created ON as_pmem(created_at)`,
        `CREATE TABLE IF NOT EXISTS as_pmem_snapshots (id TEXT PRIMARY KEY, taken_at INTEGER NOT NULL, entries_json TEXT NOT NULL)`,
      ],
      down: [`DROP TABLE IF EXISTS as_pmem_snapshots`, `DROP TABLE IF EXISTS as_pmem`],
    },
  ],
};

type Row = { id: string; text: string; source: string; trust: string; tags: string; created_at: number; expires_at: number | null };

const toEntry = (r: Row): MemoryEntry => ({ id: r.id, text: r.text, source: r.source as MemorySource, trust: r.trust as MemoryTrust, createdAt: Number(r.created_at), expiresAt: r.expires_at === null ? null : Number(r.expires_at), tags: JSON.parse(r.tags || "[]") as string[] });

/**
 * SQLite-backed provenance memory for one persistent agent (lives in its control-plane Durable Object). Run
 * `PERSISTENT_MEMORY_MIGRATIONS` first. Text is redacted before storage; instruction-like text from an untrusted
 * source is refused.
 */
export class PersistentMemoryStore {
  constructor(
    private readonly sql: SqlStore,
    private readonly options: { untrustedTtlSeconds?: number; maxEntries?: number; maxSnapshots?: number; clock?: () => number } = {},
  ) {}

  private now(): number {
    return (this.options.clock ?? Date.now)();
  }

  write(input: MemoryWriteInput): MemoryEntry {
    const provenance = provenanceFor(input.source, input.derivedFromUntrusted ? { derivedFromUntrusted: true } : {});
    const text = redactSensitive(input.text.slice(0, 4000), { kinds: ["api_key", "jwt", "private_key", "credit_card", "ssn", "iban"] }).text.trim();
    if (!text) throw new Error("Empty memory");
    if (provenance.trust === "untrusted" && assessInjection(text).verdict === "injection") throw new Error("Refusing to store instruction-like text from an untrusted source.");
    const now = this.now();
    const ttl = input.ttlSeconds ?? (provenance.trust === "untrusted" ? (this.options.untrustedTtlSeconds ?? UNTRUSTED_MEMORY_TTL_SECONDS) : undefined);
    const entry: MemoryEntry = { id: randomId("mem"), text, ...provenance, createdAt: now, expiresAt: ttl ? now + ttl * 1000 : null, tags: (input.tags ?? []).slice(0, 10).map((t) => t.slice(0, 40)) };
    this.sql.exec(`INSERT INTO as_pmem (id, text, source, trust, tags, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, entry.id, entry.text, entry.source, entry.trust, JSON.stringify(entry.tags), entry.createdAt, entry.expiresAt);
    const max = this.options.maxEntries ?? 2000;
    this.sql.exec(`DELETE FROM as_pmem WHERE id IN (SELECT id FROM as_pmem ORDER BY created_at DESC LIMIT -1 OFFSET ?)`, max);
    return entry;
  }

  /** Live entries matching every word of `query` (case-insensitive), newest first. */
  recall(query: string, limit = 8): MemoryEntry[] {
    this.prune();
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
    const where = words.map(() => `LOWER(text) LIKE ? ESCAPE '\\'`).join(" AND ");
    const binds = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const rows = this.sql.exec<Row>(`SELECT * FROM as_pmem ${where ? `WHERE ${where}` : ""} ORDER BY created_at DESC LIMIT ?`, ...binds, Math.min(50, Math.max(1, limit)));
    return rows.map(toEntry);
  }

  /** Recall rendered for the model: untrusted entries wrapped. */
  recallRendered(query: string, limit = 8): string {
    const hits = this.recall(query, limit);
    return hits.length ? hits.map((e) => renderRecalledMemory(e.text, e)).join("\n") : `Nothing remembered about "${query.slice(0, 80)}".`;
  }

  list(limit = 100): MemoryEntry[] {
    this.prune();
    return this.sql.exec<Row>(`SELECT * FROM as_pmem ORDER BY created_at DESC LIMIT ?`, Math.min(1000, limit)).map(toEntry);
  }

  /** Delete expired entries. Returns how many were removed. */
  prune(): number {
    const before = Number(this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_pmem`)[0]?.n ?? 0);
    this.sql.exec(`DELETE FROM as_pmem WHERE expires_at IS NOT NULL AND expires_at <= ?`, this.now());
    return before - Number(this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_pmem`)[0]?.n ?? 0);
  }

  snapshot(): MemorySnapshot {
    const entries = this.sql.exec<Row>(`SELECT * FROM as_pmem ORDER BY created_at`).map(toEntry);
    const snapshot: MemorySnapshot = { id: randomId("snap"), takenAt: this.now(), entries: entries.length };
    this.sql.exec(`INSERT INTO as_pmem_snapshots (id, taken_at, entries_json) VALUES (?, ?, ?)`, snapshot.id, snapshot.takenAt, JSON.stringify(entries));
    this.sql.exec(`DELETE FROM as_pmem_snapshots WHERE id IN (SELECT id FROM as_pmem_snapshots ORDER BY taken_at DESC LIMIT -1 OFFSET ?)`, this.options.maxSnapshots ?? 20);
    return snapshot;
  }

  snapshots(): MemorySnapshot[] {
    return this.sql.exec<{ id: string; taken_at: number; entries_json: string }>(`SELECT id, taken_at, entries_json FROM as_pmem_snapshots ORDER BY taken_at DESC`).map((r) => ({ id: r.id, takenAt: Number(r.taken_at), entries: (JSON.parse(r.entries_json) as unknown[]).length }));
  }

  /** Replace all memory with a snapshot's entries (provenance preserved). Returns the restored count. */
  rollback(snapshotId: string): number {
    const row = this.sql.exec<{ entries_json: string }>(`SELECT entries_json FROM as_pmem_snapshots WHERE id = ?`, snapshotId)[0];
    if (!row) throw new Error(`Unknown snapshot ${snapshotId}`);
    const entries = JSON.parse(row.entries_json) as MemoryEntry[];
    this.sql.exec(`DELETE FROM as_pmem`);
    for (const e of entries) {
      this.sql.exec(`INSERT INTO as_pmem (id, text, source, trust, tags, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, e.id, e.text, e.source, e.trust, JSON.stringify(e.tags ?? []), e.createdAt, e.expiresAt);
    }
    return entries.length;
  }
}
