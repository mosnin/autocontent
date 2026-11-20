import { type Fact, factLine, isCurrent, slotKey, type Trust } from "./facts.ts";
import { predicateSpec } from "./ontology.ts";

/**
 * Consolidation (plan section 3.2, item 3 "cold"): a pure pass over one tenant's facts that
 *  - merges duplicates (same slot, same content): one fact is kept, the others are invalidated as `merged`;
 *  - flags contradictions and turns each into a question for the person. It never picks a winner itself.
 *
 * `consolidate` has no I/O. `runConsolidation` applies the merges through a store and returns the questions; wire it
 * to a schedule as described in docs/memory/consolidation.md.
 */

export interface Merge {
  slot: string;
  keep: string;
  drop: string[];
}

export type ContradictionKind = "slot_conflict" | "pending_challenge" | "rule_conflict";

export interface Contradiction {
  kind: ContradictionKind;
  slot: string;
  factIds: string[];
  /** A question for the person's inbox. */
  question: string;
}

export interface ConsolidationPlan {
  merges: Merge[];
  contradictions: Contradiction[];
}

const RANK: Record<Trust, number> = { untrusted: 0, unconfirmed: 1, trusted: 2 };

/** The fact to keep among duplicates: current before pending, then most trusted, then oldest (it has the history). */
function keeper(group: readonly Fact[]): Fact {
  return [...group].sort((a, b) => Number(a.pending) - Number(b.pending) || RANK[b.trust] - RANK[a.trust] || a.validFrom - b.validFrom || a.id.localeCompare(b.id))[0]!;
}

export function consolidate(facts: readonly Fact[]): ConsolidationPlan {
  const live = facts.filter((f) => f.invalidAt === null);
  const merges: Merge[] = [];
  const contradictions: Contradiction[] = [];
  const dropped = new Set<string>();

  const bySlot = new Map<string, Fact[]>();
  for (const f of live) bySlot.set(slotKey(f), [...(bySlot.get(slotKey(f)) ?? []), f]);

  for (const [slot, group] of [...bySlot].sort(([a], [b]) => a.localeCompare(b))) {
    // 1. Duplicates: same content in the same slot.
    const byContent = new Map<string, Fact[]>();
    for (const f of group) byContent.set(f.valueHash, [...(byContent.get(f.valueHash) ?? []), f]);
    for (const same of byContent.values()) {
      if (same.length < 2) continue;
      const keep = keeper(same);
      const drop = same.filter((f) => f.id !== keep.id).map((f) => f.id);
      drop.forEach((id) => dropped.add(id));
      merges.push({ slot, keep: keep.id, drop });
    }
    const rest = group.filter((f) => !dropped.has(f.id));
    const first = rest[0];
    if (!first) continue;
    // 2. A single-valued slot holding two different current values.
    const current = rest.filter(isCurrent);
    if (predicateSpec(first.subject.type, first.predicate)?.cardinality === "one" && current.length > 1) {
      contradictions.push({ kind: "slot_conflict", slot, factIds: current.map((f) => f.id), question: `Memory holds ${current.length} different values for ${first.subject.type} "${first.subject.name}" ${first.predicate.replace(/_/g, " ")}: ${current.map((f) => `"${f.value ?? f.object?.name ?? ""}"`).join(" vs ")}. Which one is right?` });
    }
    // 3. A lower-trust value waiting against the current one.
    for (const p of rest.filter((f) => f.pending && f.challenges)) {
      const holder = current.find((f) => f.id === p.challenges);
      if (holder) contradictions.push({ kind: "pending_challenge", slot, factIds: [holder.id, p.id], question: `Memory says ${factLine(holder)}, but a newer ${p.trust} source says "${p.value ?? p.object?.name ?? ""}". Keep the current value or accept the new one?` });
    }
  }

  // 4. A rule forbids something the brand currently claims or has approved.
  const current = live.filter((f) => isCurrent(f) && !dropped.has(f.id));
  for (const ban of current.filter((f) => f.predicate === "forbids" && f.object)) {
    const target = ban.object!;
    const clash = current.filter((f) => (f.predicate === "makes" && f.object?.type === target.type && f.object.key === target.key) || (f.subject.type === target.type && f.subject.key === target.key && f.predicate === "status" && f.value === "approved"));
    if (clash.length) contradictions.push({ kind: "rule_conflict", slot: slotKey(ban), factIds: [ban.id, ...clash.map((f) => f.id)], question: `A rule forbids ${target.type} "${target.name}", but memory also says it is in use or approved. Which should Marketer follow?` });
  }
  return { merges, contradictions };
}

/** What a store must offer to be consolidated. Both stores in store.ts do. */
export interface ConsolidationStore {
  /** Every live fact of the tenant (current and pending). */
  all(tenantId: string): Promise<Fact[]>;
  /** Invalidate `drop` as merged into `keep`. The store re-checks that they are duplicates of one another. */
  merge(tenantId: string, keep: string, drop: readonly string[]): Promise<number>;
}

export interface ConsolidationReport {
  tenantId: string;
  inspected: number;
  merged: number;
  contradictions: Contradiction[];
}

/** One consolidation pass for one tenant. Safe to repeat: a second run finds nothing left to merge. */
export async function runConsolidation(store: ConsolidationStore, tenantId: string): Promise<ConsolidationReport> {
  const facts = (await store.all(tenantId)).filter((f) => f.tenantId === tenantId);
  const plan = consolidate(facts);
  let merged = 0;
  for (const m of plan.merges) merged += await store.merge(tenantId, m.keep, m.drop);
  return { tenantId, inspected: facts.length, merged, contradictions: plan.contradictions };
}
