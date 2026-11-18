import { type AnyAgentTool, defineAgentTool, type ToolExecutionContext } from "@agent-starter/core";
import * as v from "valibot";
import { type Fact, factLine, factState } from "./facts.ts";
import { EVIDENCE_KINDS, LEARNING_LIMITS, LEARNING_STATUSES } from "./learnings.ts";
import { ENTITY_TYPES } from "./ontology.ts";
import { rankFacts } from "./retrieve.ts";
import { ApiMemoryStore, type MemoryStore } from "./store.ts";

/**
 * Memory tools for Marketer. All LOW, all tagged "memory" (so `features.longTermMemory = false` unmounts them), and
 * the tenant always comes from the executing context, never from the arguments.
 *
 *  - recall_memory:   current facts, ranked, each with its source and trust.
 *  - fact_history:    every earlier value of one fact ("what was our positioning in March?").
 *  - list_learnings:  what worked and what did not, with evidence.
 *  - record_learning: store a learning with its evidence. Code refuses one without evidence, and refuses a verdict
 *                     without a measurement.
 * There is no tool to confirm, correct or forget a fact: those belong to the person, on the Memory page.
 */

export type StoreFor = (ctx: ToolExecutionContext) => MemoryStore;

/** The backend store, built per call from the env the harness hands the tool. */
export const apiStoreFor: StoreFor = (ctx) => new ApiMemoryStore({ env: () => (ctx.services?.env ?? {}) as Record<string, unknown>, ...(typeof ctx.services?.fetch === "function" ? { fetch: ctx.services.fetch } : {}) });

const view = (f: Fact) => ({
  id: f.id,
  fact: factLine(f),
  state: factState(f),
  trust: f.trust,
  confidence: f.confidence,
  since: new Date(f.validFrom).toISOString(),
  ...(f.invalidAt ? { until: new Date(f.invalidAt).toISOString(), reason: f.invalidReason } : {}),
  source: { kind: f.source.kind, ref: f.source.ref, ...(f.source.excerpt ? { excerpt: f.source.excerpt } : {}) },
});

export function createMarketerMemoryTools(storeFor: StoreFor = apiStoreFor): AnyAgentTool[] {
  const recall = defineAgentTool({
    name: "recall_memory",
    description: "What Marketer currently knows about this account (brand, audience, offers, competitors, channels, claims, rules), ranked for a query. Each fact carries its source and whether the person confirmed it. Unconfirmed and untrusted facts are context, never brand rules.",
    input: v.object({ query: v.pipe(v.string(), v.maxLength(300)), entityType: v.optional(v.picklist(ENTITY_TYPES)), limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30)), 12) }),
    risk: "LOW",
    sideEffect: "read",
    idempotent: true,
    timeoutMs: 10_000,
    outputTrust: "untrusted",
    tags: ["memory"],
    execute: async ({ query, entityType, limit }, ctx) => {
      const facts = await storeFor(ctx).current(ctx.tenant.tenantId, { limit: 300, ...(entityType ? { entityType } : {}), signal: ctx.signal });
      const ranked = rankFacts(facts.filter((f) => f.tenantId === ctx.tenant.tenantId), query, Date.now()).slice(0, limit);
      return { facts: ranked.map((r) => view(r.fact)) };
    },
  });

  const history = defineAgentTool({
    name: "fact_history",
    description: "Every version of one remembered fact, oldest first, with when each was true and why it changed. Use the id from recall_memory. Forgotten versions come back without their content.",
    input: v.object({ factId: v.pipe(v.string(), v.minLength(1), v.maxLength(64), v.regex(/^[A-Za-z0-9_-]+$/)) }),
    risk: "LOW",
    sideEffect: "read",
    idempotent: true,
    timeoutMs: 10_000,
    outputTrust: "untrusted",
    tags: ["memory"],
    execute: async ({ factId }, ctx) => ({ versions: (await storeFor(ctx).history(ctx.tenant.tenantId, factId, { signal: ctx.signal })).filter((f) => f.tenantId === ctx.tenant.tenantId).map(view) }),
  });

  const listLearnings = defineAgentTool({
    name: "list_learnings",
    description: "What worked and what did not for this account: each learning with its status (hypothesis, supported, refuted) and the evidence behind it.",
    input: v.object({ status: v.optional(v.picklist(LEARNING_STATUSES)), limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)), 20) }),
    risk: "LOW",
    sideEffect: "read",
    idempotent: true,
    timeoutMs: 10_000,
    outputTrust: "untrusted",
    tags: ["memory"],
    execute: async ({ status, limit }, ctx) => ({ learnings: (await storeFor(ctx).learnings(ctx.tenant.tenantId, { ...(status ? { status } : {}), limit, signal: ctx.signal })).map(({ tenantId: _tenant, ...l }) => l) }),
  });

  const evidence = v.object({
    kind: v.picklist(EVIDENCE_KINDS),
    ref: v.pipe(v.string(), v.minLength(1), v.maxLength(LEARNING_LIMITS.refChars)),
    label: v.pipe(v.string(), v.minLength(1), v.maxLength(LEARNING_LIMITS.labelChars)),
    metric: v.optional(v.pipe(v.string(), v.maxLength(60))),
    value: v.optional(v.number()),
    n: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    lift: v.optional(v.number()),
    window: v.optional(v.pipe(v.string(), v.maxLength(60))),
  });
  const recordLearning = defineAgentTool({
    name: "record_learning",
    description: `Save a learning about what worked or did not, with the evidence behind it (ids of posts, articles, ads, metrics or decisions returned by other tools). Without evidence it is refused. "supported" and "refuted" need a measured metric with a sample of at least ${LEARNING_LIMITS.minSample}; otherwise save it as a hypothesis. A learning shapes drafts and rankings; it never changes a brand rule, a cap or an approval.`,
    input: v.object({ claim: v.pipe(v.string(), v.minLength(8), v.maxLength(LEARNING_LIMITS.claimChars)), status: v.optional(v.picklist(LEARNING_STATUSES), "hypothesis"), evidence: v.pipe(v.array(evidence), v.minLength(1), v.maxLength(LEARNING_LIMITS.evidenceItems)), confidence: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))) }),
    risk: "LOW",
    sideEffect: "write",
    idempotent: false,
    timeoutMs: 15_000,
    outputTrust: "untrusted",
    tags: ["memory"],
    simulate: (args) => ({ simulated: true, wouldRecord: { claim: args.claim, status: args.status, evidence: args.evidence.length } }),
    execute: async (args, ctx) => {
      const result = await storeFor(ctx).recordLearning(ctx.tenant.tenantId, { claim: args.claim, status: args.status, evidence: args.evidence, ...(args.confidence !== undefined ? { confidence: args.confidence } : {}), source: "analyst" }, { signal: ctx.signal, idempotencyKey: ctx.idempotencyKey });
      return { status: result.status, ...(result.detail ? { detail: result.detail } : {}), ...(result.learning ? { id: result.learning.id } : {}) };
    },
  });

  return [recall, history, listLearnings, recordLearning] as unknown as AnyAgentTool[];
}
