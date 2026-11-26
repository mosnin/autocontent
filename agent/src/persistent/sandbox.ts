import { type ConfigProposal, type MemoryEntry, type PersistentControlPort, provenanceFor, randomId, UNTRUSTED_MEMORY_TTL_SECONDS } from "@agent-starter/core";

/**
 * Control port for an instance that has no control plane (the eval harness and local experiments: a fresh
 * conversation without the `persistent` initialData). Nothing is stored and nothing is applied: proposals come
 * back pending and unpersisted, memory writes keep their provenance but are dropped, recall finds nothing. It never
 * widens anything, so an eval run cannot change a real agent.
 */
export function sandboxControlPort(): PersistentControlPort {
  return {
    async propose(input): Promise<ConfigProposal> {
      return { id: randomId("prop"), createdAt: Date.now(), source: "agent", kind: input.patch.addSkill ? "skill" : "config", summary: "Not stored: this instance has no control plane.", review: "human", status: "pending", patch: input.patch, baseVersion: 0, reason: input.reason, actor: input.actor };
    },
    async memoryWrite(input): Promise<MemoryEntry> {
      const { source, trust } = provenanceFor(input.source, input.derivedFromUntrusted ? { derivedFromUntrusted: true } : {});
      const now = Date.now();
      return { id: randomId("mem"), text: input.text, source, trust, createdAt: now, expiresAt: trust === "untrusted" ? now + (input.ttlSeconds ?? UNTRUSTED_MEMORY_TTL_SECONDS) * 1000 : null, tags: input.tags ?? [] };
    },
    async memoryRecall(): Promise<string> {
      return "No memories (this instance has no control plane).";
    },
  };
}
