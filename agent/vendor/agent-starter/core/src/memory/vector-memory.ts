import { type RedactionKind, redactSensitive } from "../guardrails/pii.ts";
import { TenantScopedVectorStore } from "../tenancy/tenancy.ts";
import type { Embedder, VectorStore } from "../storage/ports.ts";
import type { Reranker } from "./reranker.ts";
import { type MemoryProvenance, renderRecalledMemory, UNTRUSTED_MEMORY_TTL_SECONDS } from "../persistent/memory.ts";

export interface ChunkBlock {
  chunkId: string;
  text: string;
  index: number;
  metadata: { tenantId: string; documentId: string; charCount: number; wordCount: number; heading?: string };
}

/**
 * Sliding-window chunker with overlap that prefers paragraph/sentence/word
 * boundaries and carries the nearest markdown heading into each chunk so
 * retrieval keeps its context. Every chunk is tenant-tagged.
 */
export class VectorChunker {
  constructor(
    private readonly tenantId: string,
    private readonly options: { maxChars?: number; overlapChars?: number; minChars?: number } = {},
  ) {}

  chunk(rawText: string, documentId: string): ChunkBlock[] {
    const maxChars = this.options.maxChars ?? 800;
    const overlap = Math.min(this.options.overlapChars ?? 150, Math.floor(maxChars / 2));
    const minChars = this.options.minChars ?? 30;
    const text = rawText.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const headings: Array<{ at: number; title: string }> = [];
    for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) headings.push({ at: match.index ?? 0, title: (match[1] ?? "").trim() });
    const headingAt = (pos: number) => [...headings].reverse().find((h) => h.at <= pos)?.title;

    const chunks: ChunkBlock[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + maxChars);
      if (end < text.length) {
        const window = text.slice(start, end);
        const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
        if (breakAt > maxChars * 0.5) end = start + breakAt + 1;
        else {
          const space = window.lastIndexOf(" ");
          if (space > maxChars * 0.6) end = start + space;
        }
      }
      const slice = text.slice(start, end).trim();
      if (slice.length >= minChars || (chunks.length === 0 && slice.length > 0)) {
        const heading = headingAt(start);
        chunks.push({
          chunkId: `${documentId}#${chunks.length}`,
          text: slice,
          index: chunks.length,
          metadata: { tenantId: this.tenantId, documentId, charCount: slice.length, wordCount: slice.split(/\s+/).length, ...(heading ? { heading } : {}) },
        });
      }
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
    return chunks;
  }
}

export interface MemoryHit {
  id: string;
  text: string;
  score: number;
  source: string;
  metadata: Record<string, string | number | boolean>;
}

export interface VectorMemoryOptions {
  vectors: VectorStore;
  embedder: Embedder;
  tenantId: string;
  reranker?: Reranker;
  maxMetadataChars?: number;
  /**
   * Redact secrets/PII before text is embedded and stored. `true` uses
   * DEFAULT_MEMORY_REDACTION; pass kinds to choose; `false` stores verbatim.
   * Default: true (memories outlive conversations, so secrets must not land there).
   */
  redact?: boolean | RedactionKind[];
  /** Default time-to-live for memories (seconds). Expired hits are never recalled. Omit for no expiry. */
  ttlSeconds?: number;
  clock?: () => number;
}

/** What `memorize` strips by default: credentials, payment data and national ids. Emails/phones are kept (often the point of a note). */
export const DEFAULT_MEMORY_REDACTION: RedactionKind[] = ["api_key", "jwt", "private_key", "credit_card", "ssn", "iban"];

/**
 * Long-term semantic memory over Vectorize (or any VectorStore) with hard
 * multi-tenant isolation: ids are tenant-prefixed and every query is force-
 * filtered by tenantId (and re-checked on the way out). Text is redacted before
 * embedding, memories can expire (`ttlSeconds`) and whole documents can be
 * forgotten (`forgetDocument`).
 */
export class VectorMemory {
  private readonly store: TenantScopedVectorStore;
  private readonly chunker: VectorChunker;
  private readonly clock: () => number;

  constructor(private readonly options: VectorMemoryOptions) {
    this.store = new TenantScopedVectorStore(options.vectors, options.tenantId);
    this.chunker = new VectorChunker(options.tenantId);
    this.clock = options.clock ?? Date.now;
  }

  /** Apply the configured redaction to text that is about to be memorized. */
  redact(text: string): { text: string; redacted: number } {
    const setting = this.options.redact ?? true;
    if (setting === false) return { text, redacted: 0 };
    const result = redactSensitive(text, { kinds: setting === true ? DEFAULT_MEMORY_REDACTION : setting });
    return { text: result.text, redacted: result.findings.reduce((n, f) => n + f.count, 0) };
  }

  async memorize(documentId: string, text: string, metadata: Record<string, string | number | boolean> = {}, options: { ttlSeconds?: number; provenance?: MemoryProvenance } = {}): Promise<number> {
    const clean = this.redact(text).text;
    const chunks = this.chunker.chunk(clean, documentId);
    if (chunks.length === 0) return 0;
    const vectors = await this.options.embedder.embed(chunks.map((c) => (c.metadata.heading ? `${c.metadata.heading}\n${c.text}` : c.text)));
    const maxChars = this.options.maxMetadataChars ?? 4000;
    // Provenance (ASI06): untrusted memories expire by default and are recalled wrapped as untrusted.
    const ttl = options.ttlSeconds ?? this.options.ttlSeconds ?? (options.provenance?.trust === "untrusted" ? UNTRUSTED_MEMORY_TTL_SECONDS : undefined);
    const now = this.clock();
    await this.store.upsert(
      chunks.map((chunk, i) => ({
        id: chunk.chunkId,
        values: vectors[i] ?? [],
        metadata: {
          ...metadata,
          ...(options.provenance ? { source: options.provenance.source, trust: options.provenance.trust } : {}),
          documentId,
          rawText: chunk.text.slice(0, maxChars),
          chunkIndex: chunk.index,
          chunkCount: chunks.length,
          savedAt: now,
          ...(ttl ? { expiresAt: now + ttl * 1000 } : {}),
          ...(chunk.metadata.heading ? { heading: chunk.metadata.heading } : {}),
        },
      })),
    );
    return chunks.length;
  }

  async recall(query: string, options: { topK?: number; candidates?: number; minScore?: number; filter?: Record<string, string | number | boolean> } = {}): Promise<MemoryHit[]> {
    const [vector] = await this.options.embedder.embed([query]);
    if (!vector) return [];
    const candidates = options.candidates ?? Math.max((options.topK ?? 4) * 3, 10);
    const matches = await this.store.query(vector, { topK: candidates, ...(options.filter ? { filter: options.filter } : {}) });
    const now = this.clock();
    let hits: MemoryHit[] = matches
      .filter((m) => typeof m.metadata.expiresAt !== "number" || m.metadata.expiresAt > now)
      .map((m) => ({ id: m.id, text: recalledText(m.metadata), score: m.score, source: "vector", metadata: m.metadata }))
      .filter((h) => h.text);
    if (this.options.reranker && hits.length > 1) hits = await this.options.reranker.rerank(query, hits, { topK: options.topK ?? 4, ...(options.minScore !== undefined ? { threshold: options.minScore } : {}) });
    else hits = hits.filter((h) => h.score >= (options.minScore ?? 0)).slice(0, options.topK ?? 4);
    return hits;
  }

  forget(ids: string[]): Promise<void> {
    return this.store.deleteByIds(ids);
  }

  /** Delete every chunk of a memorized document (chunk ids are `${documentId}#${index}`). */
  forgetDocument(documentId: string, maxChunks = 256): Promise<void> {
    return this.store.deleteByIds(Array.from({ length: maxChunks }, (_, i) => `${documentId}#${i}`));
  }
}

/** Raw text of a stored memory; entries marked `trust: "untrusted"` come back wrapped as untrusted content. */
function recalledText(metadata: Record<string, string | number | boolean>): string {
  const raw = String(metadata.rawText ?? "");
  if (!raw || metadata.trust !== "untrusted") return raw;
  return renderRecalledMemory(raw, { source: String(metadata.source ?? "external") as MemoryProvenance["source"], trust: "untrusted" });
}
