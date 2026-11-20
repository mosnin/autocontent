import { wrapUntrusted } from "../guardrails/injection.ts";
import type { MemoryHit } from "./vector-memory.ts";
import type { Reranker } from "./reranker.ts";

/** Any retrieval backend: Vectorize memory, Cloudflare AI Search, Qdrant, a SaaS search API, ... */
export interface RetrievalSource {
  name: string;
  search(query: string, options: { topK: number }): Promise<MemoryHit[]>;
}

export interface RetrieveOptions {
  topK?: number;
  perSourceTopK?: number;
  minScore?: number;
  maxChars?: number;
}

/**
 * Fan-out retrieval across sources, de-duplicate, re-rank jointly, and render a
 * citation-numbered context block (wrapped as untrusted data).
 */
export class KnowledgeRetriever {
  constructor(
    private readonly sources: RetrievalSource[],
    private readonly reranker?: Reranker,
  ) {}

  async retrieve(query: string, options: RetrieveOptions = {}): Promise<MemoryHit[]> {
    const perSource = options.perSourceTopK ?? 8;
    const settled = await Promise.allSettled(this.sources.map((s) => s.search(query, { topK: perSource })));
    const seen = new Set<string>();
    const hits: MemoryHit[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const hit of result.value) {
        const key = hit.text.slice(0, 200).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(hit);
      }
    }
    const topK = options.topK ?? 5;
    if (this.reranker && hits.length > 1) return this.reranker.rerank(query, hits, { topK, ...(options.minScore !== undefined ? { threshold: options.minScore } : {}) });
    return hits.filter((h) => h.score >= (options.minScore ?? 0)).sort((a, b) => b.score - a.score).slice(0, topK);
  }

  static render(hits: MemoryHit[], maxChars = 6000): string {
    if (hits.length === 0) return "";
    let used = 0;
    const lines: string[] = [];
    hits.forEach((hit, i) => {
      if (used >= maxChars) return;
      const label = String(hit.metadata.title ?? hit.metadata.documentId ?? hit.metadata.url ?? hit.id);
      const body = hit.text.slice(0, Math.max(200, maxChars - used));
      used += body.length;
      lines.push(`[${i + 1}] (${hit.source}: ${label})\n${body}`);
    });
    return wrapUntrusted(`Retrieved knowledge. Cite sources as [n]. If the answer is not here, say so.\n\n${lines.join("\n\n")}`, "retrieval");
  }
}
