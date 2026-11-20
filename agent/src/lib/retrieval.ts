import type { MemoryHit, RetrievalSource, TenantSecurityContext } from "@agent-starter/core";

/** Owner value for memories every user of the tenant may read (shared notes, ingested knowledge). */
export const SHARED_MEMORY_OWNER = "tenant";

interface RecallingMemory {
  recall(query: string, options: { topK?: number; filter?: Record<string, string | number | boolean> }): Promise<MemoryHit[]>;
}

/**
 * Tenant memory as a retrieval source that only returns what the acting user may read (SEC-03): their own
 * memories (`userId` = the user) and tenant-shared ones (`userId` = "tenant"). Private notes of other users
 * (remember_note stores `userId` metadata) never reach another user's context, an anonymous widget
 * visitor or a background job. Vectorize filters are exact-match, so it runs one filtered query per
 * owner (needs the `userId` metadata index) and re-checks every hit's owner on the way out.
 */
export function userScopedMemorySource(memory: RecallingMemory, tenant: Pick<TenantSecurityContext, "userId">, name = "memory"): RetrievalSource {
  const owners = [...new Set([tenant.userId, SHARED_MEMORY_OWNER].filter((owner): owner is string => typeof owner === "string" && owner.length > 0))];
  return {
    name,
    search: async (query, { topK }) => {
      const results = await Promise.all(owners.map((owner) => memory.recall(query, { topK, filter: { userId: owner } })));
      const seen = new Set<string>();
      const hits: MemoryHit[] = [];
      for (const hit of results.flat()) {
        if (seen.has(hit.id) || !owners.includes(String(hit.metadata?.userId ?? ""))) continue;
        seen.add(hit.id);
        hits.push(hit);
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, topK);
    },
  };
}
