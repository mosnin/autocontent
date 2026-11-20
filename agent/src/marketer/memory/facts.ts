import { assessInjection } from "@agent-starter/core";
import { type EntityType, entityKey, isEntityType, predicateSpec } from "./ontology.ts";
import { containsSecret, redactSecrets, secretKinds } from "./redact.ts";

/**
 * Temporal facts with provenance (plan section 3.2, item 2; ADR 0009 "facts are invalidated, never deleted").
 *
 * A fact is `subject · predicate · value-or-object` with a source, a trust level, a confidence and a validity window.
 * This module is pure: `validateFact` checks a candidate against the ontology, the caps and the redaction rule, and
 * `planWrite` / `planConfirm` / `planCorrect` / `planForget` say what a write does to the facts already in the slot.
 * Stores apply the plan (`InMemoryMemoryStore` here, the backend in SQL with the same rules); see
 * docs/memory/lifecycle.md for the state diagram.
 */

// ── Caps (per fact and per tenant) ─────────────────────────────────────────────────────────────────────────────

export const MEMORY_LIMITS = {
  nameChars: 120,
  valueChars: 500,
  excerptChars: 300,
  refChars: 200,
  /** Current + pending facts one tenant may hold. A write past it is refused (never evicts silently). */
  activeFactsPerTenant: 2000,
  /** Every row of a tenant, history and tombstones included. */
  totalFactsPerTenant: 20000,
  learningsPerTenant: 500,
} as const;

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Where a fact came from. `person` is the account owner acting in the app (the Memory page); `message` is something
 * the person wrote in chat, read by the extractor; everything else is content the person did not write.
 */
export const SOURCE_KINDS = ["person", "message", "approval", "job", "metric", "tool", "document", "web"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * - `trusted`: stated or confirmed by the person in the app.
 * - `unconfirmed`: read from the person's own chat message by the extractor, or produced by the platform's own
 *   jobs and metrics. Usable context, not yet confirmed.
 * - `untrusted`: read from web pages, documents or tool output. Data only.
 */
export type Trust = "trusted" | "unconfirmed" | "untrusted";
const TRUST_RANK: Record<Trust, number> = { untrusted: 0, unconfirmed: 1, trusted: 2 };

/** Trust is derived from the source in code. An extractor, a tool argument or a request body never sets it. */
export function trustFor(kind: SourceKind): Trust {
  if (kind === "person") return "trusted";
  if (kind === "web" || kind === "document" || kind === "tool") return "untrusted";
  return "unconfirmed";
}

export interface EntityRef {
  type: EntityType;
  name: string;
  key: string;
}

export interface FactSource {
  kind: SourceKind;
  /** The message, tool call, document or URL the fact was read from. */
  ref: string;
  at: number;
  /** A short redacted quote, so a person can see why Marketer believes this. */
  excerpt?: string;
}

export type InvalidReason = "superseded" | "corrected" | "forgotten" | "merged" | "dismissed";

export interface Fact {
  id: string;
  tenantId: string;
  subject: EntityRef;
  predicate: string;
  kind: "attribute" | "relation";
  /** Attribute facts. Null on relations and on tombstones. */
  value: string | null;
  /** Relation facts. */
  object: EntityRef | null;
  source: FactSource;
  trust: Trust;
  confidence: number;
  validFrom: number;
  /** Set when the fact stopped being true or was forgotten. A fact with `invalidAt` is never retrieved. */
  invalidAt: number | null;
  invalidReason: InvalidReason | null;
  supersededBy: string | null;
  /** Waiting for a person: a rule-bearing fact from a non-person source, or a lower-trust value that disagrees. */
  pending: boolean;
  /** The current fact this pending one disagrees with. */
  challenges: string | null;
  /** Kept on a tombstone so the same value is not silently learned again from a non-person source. */
  valueHash: string;
  createdAt: number;
}

export interface FactInput {
  subject: { type: string; name: string };
  predicate: string;
  value?: string | null;
  object?: { type: string; name: string } | null;
  source: { kind: SourceKind; ref: string; at?: number; excerpt?: string };
  confidence?: number;
  validFrom?: number;
}

export type FactState = "current" | "pending" | "superseded" | "forgotten";

export function factState(fact: Fact): FactState {
  if (fact.invalidAt !== null) return fact.invalidReason === "forgotten" || fact.invalidReason === "dismissed" ? "forgotten" : "superseded";
  return fact.pending ? "pending" : "current";
}

export const isCurrent = (fact: Fact): boolean => fact.invalidAt === null && !fact.pending;

/** The slot a fact lives in: the tenant's subject + predicate. */
export function slotKey(fact: Pick<Fact, "subject" | "predicate">): string {
  return `${fact.subject.type}:${fact.subject.key}:${fact.predicate}`;
}

/** What a fact says, normalised for comparison (case, spacing and trailing punctuation do not make a new fact). */
export function normalizeValue(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.!;,]+$/g, "")
    .trim();
}

/** FNV-1a over the fact's content: equality key for duplicates and tombstones (not a secret, not reversible text). */
export function contentHash(value: string | null, object: Pick<EntityRef, "type" | "key"> | null): string {
  const text = object ? `rel:${object.type}:${object.key}` : `val:${normalizeValue(value ?? "")}`;
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = (Math.imul(b, 33) ^ c) | 0;
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────────

export type RejectReason = "unknown_entity_type" | "unknown_predicate" | "invalid_object" | "invalid_value" | "too_long" | "empty" | "secret" | "instruction_like" | "invalid_source";

export interface ValidFact {
  subject: EntityRef;
  predicate: string;
  kind: "attribute" | "relation";
  value: string | null;
  object: EntityRef | null;
  source: FactSource;
  trust: Trust;
  confidence: number;
  validFrom: number;
  ruleBearing: boolean;
  cardinality: "one" | "many";
  valueHash: string;
}

export type Validation = { ok: true; fact: ValidFact } | { ok: false; reason: RejectReason; detail: string };

const reject = (reason: RejectReason, detail: string): Validation => ({ ok: false, reason, detail });
const clean = (text: unknown): string => (typeof text === "string" ? text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "");

function entityRef(input: unknown, label: string): { ref: EntityRef } | { error: Validation } {
  const raw = (input ?? {}) as { type?: unknown; name?: unknown };
  if (!isEntityType(raw.type)) return { error: reject(label === "subject" ? "unknown_entity_type" : "invalid_object", `${label} type ${JSON.stringify(raw.type)} is not in the ontology`) };
  const name = clean(raw.name);
  if (!name) return { error: reject("empty", `${label} name is empty`) };
  if (name.length > MEMORY_LIMITS.nameChars) return { error: reject("too_long", `${label} name is longer than ${MEMORY_LIMITS.nameChars} characters`) };
  if (containsSecret(name)) return { error: reject("secret", `${label} name looks like a credential (${secretKinds(name).join(", ")})`) };
  return { ref: { type: raw.type, name, key: entityKey(name) } };
}

/**
 * Check one candidate fact in code: ontology (types, predicate, object type, closed vocabularies), size caps, the
 * redaction rule and instruction-like text. `now` stamps the source and the validity start when the input has none.
 */
export function validateFact(input: FactInput, now: number): Validation {
  const kind = input?.source?.kind;
  if (!(SOURCE_KINDS as readonly string[]).includes(kind)) return reject("invalid_source", "source.kind is not a known source");
  const ref = clean(input.source.ref);
  if (!ref) return reject("invalid_source", "source.ref is required: every fact names where it came from");
  if (ref.length > MEMORY_LIMITS.refChars) return reject("too_long", "source.ref is too long");

  const subject = entityRef(input.subject, "subject");
  if ("error" in subject) return subject.error;
  const predicate = clean(input.predicate).toLowerCase();
  const spec = predicateSpec(subject.ref.type, predicate);
  if (!spec) return reject("unknown_predicate", `"${predicate}" is not a predicate of ${subject.ref.type}`);

  let value: string | null = null;
  let object: EntityRef | null = null;
  if (spec.kind === "relation") {
    const target = entityRef(input.object, "object");
    if ("error" in target) return target.error;
    if (!spec.to.includes(target.ref.type)) return reject("invalid_object", `${predicate} cannot point at a ${target.ref.type}`);
    object = target.ref;
  } else {
    value = clean(input.value);
    if (!value) return reject("empty", "value is empty");
    if (value.length > MEMORY_LIMITS.valueChars) return reject("too_long", `value is longer than ${MEMORY_LIMITS.valueChars} characters`);
    if (containsSecret(value)) return reject("secret", `value looks like a credential (${secretKinds(value).join(", ")}); memory never stores secrets`);
    if (spec.values) {
      const normal = normalizeValue(value);
      if (!spec.values.includes(normal)) return reject("invalid_value", `${predicate} must be one of ${spec.values.join(", ")}`);
      value = normal;
    }
  }
  const trust = trustFor(kind);
  // Text from a non-person source that reads like an instruction is a poisoning attempt, not a fact.
  const text = `${subject.ref.name} ${value ?? object?.name ?? ""}`;
  if (trust !== "trusted" && assessInjection(text).verdict !== "safe") return reject("instruction_like", "the text reads like an instruction, not a fact");

  const excerptRaw = clean(input.source.excerpt);
  const excerpt = excerptRaw ? redactSecrets(excerptRaw).slice(0, MEMORY_LIMITS.excerptChars) : undefined;
  const at = Number.isFinite(input.source.at) ? Number(input.source.at) : now;
  const confidence = Math.min(1, Math.max(0, Number.isFinite(input.confidence) ? Number(input.confidence) : trust === "trusted" ? 1 : 0.6));
  const validFrom = Number.isFinite(input.validFrom) ? Math.min(Number(input.validFrom), now) : now;
  return {
    ok: true,
    fact: {
      subject: subject.ref,
      predicate,
      kind: spec.kind,
      value,
      object,
      source: { kind, ref, at, ...(excerpt ? { excerpt } : {}) },
      trust,
      confidence,
      validFrom,
      ruleBearing: spec.ruleBearing === true,
      cardinality: spec.cardinality,
      valueHash: contentHash(value, object),
    },
  };
}

// ── Lifecycle plans ────────────────────────────────────────────────────────────────────────────────────────────

export type WriteStatus = "created" | "superseded" | "pending" | "duplicate" | "refused";

export interface Invalidation {
  id: string;
  at: number;
  reason: InvalidReason;
  supersededBy: string | null;
}

export interface WritePlan {
  status: WriteStatus;
  /** Why a write was refused or held (`forgotten`, `tenant_full`, `needs_person`, `lower_trust`). */
  reason?: "forgotten" | "tenant_full" | "needs_person" | "lower_trust";
  insert?: Fact;
  invalidate: Invalidation[];
  /** The fact the caller should treat as the result (the new one, or the existing duplicate). */
  factId?: string;
}

export interface SlotView {
  /** Every fact of the tenant in the candidate's slot, history and tombstones included. */
  slot: readonly Fact[];
  activeCount: number;
  totalCount: number;
}

function build(tenantId: string, id: string, v: ValidFact, now: number, extra: Partial<Fact> = {}): Fact {
  return {
    id,
    tenantId,
    subject: v.subject,
    predicate: v.predicate,
    kind: v.kind,
    value: v.value,
    object: v.object,
    source: v.source,
    trust: v.trust,
    confidence: v.confidence,
    validFrom: v.validFrom,
    invalidAt: null,
    invalidReason: null,
    supersededBy: null,
    pending: false,
    challenges: null,
    valueHash: v.valueHash,
    createdAt: now,
    ...extra,
  };
}

/**
 * What writing `candidate` does, given the tenant's facts in its slot.
 *
 *  1. Same content as a live fact: a duplicate (nothing written).
 *  2. Same content as something the person forgot, from a non-person source: refused. Forget sticks.
 *  3. Rule-bearing fact from a non-person source: stored pending. Only a person makes it a rule.
 *  4. `one` slot with a different current value: the new fact supersedes it when its trust is at least the current
 *     fact's; otherwise it is stored pending as a challenge and a person decides.
 *  5. Otherwise it becomes current.
 * The old fact is never deleted: it gets `invalidAt`, a reason and `supersededBy`.
 */
export function planWrite(tenantId: string, candidate: ValidFact, view: SlotView, id: string, now: number): WritePlan {
  const live = view.slot.filter((f) => f.invalidAt === null);
  const same = live.find((f) => f.valueHash === candidate.valueHash);
  if (same) {
    // A person restating a pending or lower-trust fact confirms it; anything else is a plain duplicate.
    if (candidate.trust === "trusted" && (same.pending || same.trust !== "trusted")) return planConfirm(same, view, now);
    return { status: "duplicate", invalidate: [], factId: same.id };
  }
  if (candidate.trust !== "trusted" && view.slot.some((f) => (f.invalidReason === "forgotten" || f.invalidReason === "dismissed") && f.valueHash === candidate.valueHash)) return { status: "refused", reason: "forgotten", invalidate: [] };
  if (view.activeCount >= MEMORY_LIMITS.activeFactsPerTenant || view.totalCount >= MEMORY_LIMITS.totalFactsPerTenant) return { status: "refused", reason: "tenant_full", invalidate: [] };

  const holders = candidate.cardinality === "one" ? live.filter((f) => !f.pending) : [];
  const strongest = holders.reduce<Fact | undefined>((best, f) => (!best || TRUST_RANK[f.trust] > TRUST_RANK[best.trust] ? f : best), undefined);

  if (candidate.ruleBearing && candidate.trust !== "trusted") {
    return { status: "pending", reason: "needs_person", insert: build(tenantId, id, candidate, now, { pending: true, challenges: strongest?.id ?? null }), invalidate: [], factId: id };
  }
  if (strongest && TRUST_RANK[candidate.trust] < TRUST_RANK[strongest.trust]) {
    return { status: "pending", reason: "lower_trust", insert: build(tenantId, id, candidate, now, { pending: true, challenges: strongest.id }), invalidate: [], factId: id };
  }
  const at = Math.max(candidate.validFrom, 0);
  return {
    status: holders.length ? "superseded" : "created",
    insert: build(tenantId, id, candidate, now),
    invalidate: holders.map((f) => ({ id: f.id, at, reason: "superseded" as const, supersededBy: id })),
    factId: id,
  };
}

/**
 * A person confirms a fact: it becomes trusted and current. In a `one` slot it supersedes whatever was current.
 * Returns the patch as a plan (`insert` carries the updated fact, same id).
 */
export function planConfirm(fact: Fact, view: SlotView, now: number): WritePlan {
  if (fact.invalidAt !== null) return { status: "refused", invalidate: [], factId: fact.id };
  const spec = predicateSpec(fact.subject.type, fact.predicate);
  const holders = spec?.cardinality === "one" ? view.slot.filter((f) => f.id !== fact.id && f.invalidAt === null && !f.pending) : [];
  const updated: Fact = { ...fact, trust: "trusted", pending: false, challenges: null, confidence: 1, validFrom: fact.pending ? now : fact.validFrom };
  return { status: holders.length ? "superseded" : "created", insert: updated, invalidate: holders.map((f) => ({ id: f.id, at: now, reason: "superseded" as const, supersededBy: fact.id })), factId: fact.id };
}

/**
 * A person corrects a fact: the corrected value is a new trusted fact and the old one is invalidated with the reason
 * `corrected` (or `merged` when the corrected value already exists in the slot). `candidate` must come from a
 * `person` source.
 */
export function planCorrect(tenantId: string, target: Fact, candidate: ValidFact, view: SlotView, id: string, now: number): WritePlan {
  if (target.invalidAt !== null || candidate.trust !== "trusted") return { status: "refused", invalidate: [], factId: target.id };
  const plan = planWrite(tenantId, candidate, view, id, now);
  if (plan.status === "refused" || !plan.factId || plan.factId === target.id) return plan;
  const reason: InvalidReason = plan.insert?.id === id ? "corrected" : "merged";
  const invalidate = [...plan.invalidate.filter((i) => i.id !== target.id), { id: target.id, at: now, reason, supersededBy: plan.factId }];
  return { ...plan, status: "superseded", invalidate };
}

/** A person forgets (or dismisses a pending) fact: a tombstone. The content is removed; the slot, times and hash stay. */
export function planForget(fact: Fact, now: number): { tombstone: Fact } | undefined {
  if (fact.invalidReason === "forgotten" || fact.invalidReason === "dismissed") return undefined;
  const reason: InvalidReason = fact.pending && fact.invalidAt === null ? "dismissed" : "forgotten";
  const { excerpt: _excerpt, ...source } = fact.source;
  return {
    tombstone: {
      ...fact,
      value: null,
      object: fact.object ? { type: fact.object.type, name: "", key: "" } : null,
      source: { ...source, ref: "" },
      invalidAt: fact.invalidAt ?? now,
      invalidReason: reason,
      pending: false,
      challenges: null,
    },
  };
}

/** Render a fact as one line of text (retrieval, tools, the Memory page's plain form). */
export function factLine(fact: Pick<Fact, "subject" | "predicate" | "value" | "object">): string {
  const subject = `${fact.subject.type} "${fact.subject.name}"`;
  return fact.object ? `${subject} ${fact.predicate.replace(/_/g, " ")} ${fact.object.type} "${fact.object.name}"` : `${subject} ${fact.predicate.replace(/_/g, " ")}: ${fact.value ?? ""}`;
}
