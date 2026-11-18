import { type MarketerCallContext, marketerApi, seg } from "../api.ts";
import { type Fact, type FactInput, type FactSource, type InvalidReason, isCurrent, type RejectReason, type SlotView, type Trust, type WritePlan, type WriteStatus, MEMORY_LIMITS, planConfirm, planCorrect, planForget, planWrite, slotKey, validateFact } from "./facts.ts";
import { type Evidence, type Learning, type LearningInput, type LearningStatus, learningsFull, statusAllowed, validateLearning } from "./learnings.ts";
import type { EntityType } from "./ontology.ts";

/**
 * Where facts and learnings live.
 *
 *  - `MemoryStore` is what the agent uses: read the tenant's current facts, read a fact's history, write a fact,
 *    read and record learnings. Every method takes the tenant id from the caller's server-derived context; there is
 *    no method that reads "all tenants" and no argument that can widen the scope.
 *  - `ApiMemoryStore` talks to the backend (`/api/v1/memory/*`), which keeps the rows in Postgres and applies the
 *    same lifecycle rules in one transaction (src/marketer/repos/memory.py).
 *  - `InMemoryMemoryStore` is the reference implementation of those rules (tests, local runs). It also carries the
 *    person-only operations (confirm, correct, forget) that in production only the app can call.
 */

export type Actor = "agent" | "person" | "system";

export interface WriteResult {
  status: WriteStatus | "rejected";
  /** Why it was rejected, refused or held for a person. */
  reason?: RejectReason | NonNullable<WritePlan["reason"]>;
  detail?: string;
  fact?: Fact;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  at: number;
  actor: Actor;
  action: "fact.created" | "fact.superseded" | "fact.pending" | "fact.confirmed" | "fact.corrected" | "fact.forgotten" | "fact.merged" | "learning.recorded" | "learning.status";
  factId?: string;
  learningId?: string;
  /** Never the fact's content: the slot and the reason only, so an audit entry cannot leak what was forgotten. */
  detail: string;
}

export interface ReadOptions {
  limit?: number;
  entityType?: EntityType;
  signal?: AbortSignal;
}

export interface MemoryStore {
  /** The tenant's current facts: not superseded, not forgotten, not waiting for a person. */
  current(tenantId: string, options?: ReadOptions): Promise<Fact[]>;
  /** Every version of the fact's slot, oldest first. Forgotten versions come back without their content. */
  history(tenantId: string, factId: string, options?: { signal?: AbortSignal }): Promise<Fact[]>;
  write(tenantId: string, input: FactInput, options?: { signal?: AbortSignal; idempotencyKey?: string }): Promise<WriteResult>;
  learnings(tenantId: string, options?: { status?: LearningStatus; limit?: number; signal?: AbortSignal }): Promise<Learning[]>;
  recordLearning(tenantId: string, input: LearningInput, options?: { signal?: AbortSignal; idempotencyKey?: string }): Promise<{ status: "recorded" | "rejected" | "refused"; detail?: string; learning?: Learning }>;
}

const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:|-]{0,127}$/;

export function assertTenant(tenantId: string): string {
  if (typeof tenantId !== "string" || !TENANT_ID.test(tenantId)) throw new Error("memory: no valid tenant in the execution context");
  return tenantId;
}

// ── Reference implementation ───────────────────────────────────────────────────────────────────────────────────

export class InMemoryMemoryStore implements MemoryStore {
  private readonly facts = new Map<string, Fact[]>();
  private readonly learned = new Map<string, Learning[]>();
  private readonly log = new Map<string, AuditEntry[]>();
  private seq = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  private rows(tenantId: string): Fact[] {
    const key = assertTenant(tenantId);
    let rows = this.facts.get(key);
    if (!rows) this.facts.set(key, (rows = []));
    return rows;
  }

  private nextId(prefix: string): string {
    return `${prefix}_${(++this.seq).toString(36).padStart(6, "0")}`;
  }

  private audit(tenantId: string, actor: Actor, action: AuditEntry["action"], detail: string, ids: { factId?: string; learningId?: string } = {}): void {
    const entries = this.log.get(tenantId) ?? [];
    entries.push({ id: this.nextId("aud"), tenantId, at: this.clock(), actor, action, detail, ...ids });
    this.log.set(tenantId, entries);
  }

  private view(tenantId: string, slot: string): SlotView {
    const rows = this.rows(tenantId);
    return { slot: rows.filter((f) => slotKey(f) === slot), activeCount: rows.filter((f) => f.invalidAt === null).length, totalCount: rows.length };
  }

  private apply(tenantId: string, plan: WritePlan): void {
    const rows = this.rows(tenantId);
    for (const inv of plan.invalidate) {
      const index = rows.findIndex((f) => f.id === inv.id);
      const old = rows[index];
      if (old && old.invalidAt === null) rows[index] = { ...old, invalidAt: inv.at, invalidReason: inv.reason, supersededBy: inv.supersededBy, pending: false };
    }
    if (plan.insert) {
      const index = rows.findIndex((f) => f.id === plan.insert!.id);
      if (index >= 0) rows[index] = plan.insert;
      else rows.push(plan.insert);
    }
  }

  async current(tenantId: string, options: ReadOptions = {}): Promise<Fact[]> {
    const rows = this.rows(tenantId).filter((f) => isCurrent(f) && (!options.entityType || f.subject.type === options.entityType));
    return rows.sort((a, b) => b.validFrom - a.validFrom).slice(0, options.limit ?? 500).map(copy);
  }

  /** Facts waiting for a person (the Memory page's "Needs you"). */
  async pending(tenantId: string): Promise<Fact[]> {
    return this.rows(tenantId)
      .filter((f) => f.invalidAt === null && f.pending)
      .map(copy);
  }

  async history(tenantId: string, factId: string): Promise<Fact[]> {
    const rows = this.rows(tenantId);
    const fact = rows.find((f) => f.id === factId);
    if (!fact) return [];
    const slot = slotKey(fact);
    return rows
      .filter((f) => slotKey(f) === slot)
      .sort((a, b) => a.validFrom - b.validFrom || a.createdAt - b.createdAt)
      .map(copy);
  }

  async write(tenantId: string, input: FactInput, options: { actor?: Actor } = {}): Promise<WriteResult> {
    const actor = options.actor ?? "agent";
    const now = this.clock();
    // Only the app (a signed-in person) may write as `person`: the agent can never mint a trusted fact.
    if (actor !== "person" && input?.source?.kind === "person") return { status: "rejected", reason: "invalid_source", detail: "only a person can write a person-sourced fact" };
    const valid = validateFact(input, now);
    if (!valid.ok) return { status: "rejected", reason: valid.reason, detail: valid.detail };
    const slot = slotKey(valid.fact);
    const plan = planWrite(assertTenant(tenantId), valid.fact, this.view(tenantId, slot), this.nextId("fact"), now);
    return this.commit(tenantId, actor, plan, slot);
  }

  private commit(tenantId: string, actor: Actor, plan: WritePlan, slot: string, action?: AuditEntry["action"]): WriteResult {
    if (plan.status === "refused") return { status: "refused", ...(plan.reason ? { reason: plan.reason } : {}) };
    this.apply(tenantId, plan);
    const fact = this.rows(tenantId).find((f) => f.id === plan.factId);
    if (plan.status !== "duplicate" && plan.factId) {
      for (const inv of plan.invalidate) this.audit(tenantId, actor, inv.reason === "merged" ? "fact.merged" : "fact.superseded", `${slot}: ${inv.reason} by ${inv.supersededBy ?? "-"}`, { factId: inv.id });
      this.audit(tenantId, actor, action ?? (plan.status === "pending" ? "fact.pending" : "fact.created"), `${slot}${plan.reason ? ` (${plan.reason})` : ""}`, { factId: plan.factId });
    }
    return { status: plan.status, ...(plan.reason ? { reason: plan.reason } : {}), ...(fact ? { fact: copy(fact) } : {}) };
  }

  /** Person only: confirm a pending or unconfirmed fact. */
  async confirm(tenantId: string, factId: string): Promise<WriteResult> {
    const fact = this.rows(tenantId).find((f) => f.id === factId);
    if (!fact) return { status: "refused" };
    const slot = slotKey(fact);
    return this.commit(tenantId, "person", planConfirm(fact, this.view(tenantId, slot), this.clock()), slot, "fact.confirmed");
  }

  /** Person only: replace a fact's value. The old value stays in history. */
  async correct(tenantId: string, factId: string, change: { value?: string; object?: { type: string; name: string } }): Promise<WriteResult> {
    const now = this.clock();
    const fact = this.rows(tenantId).find((f) => f.id === factId);
    if (!fact) return { status: "refused" };
    const valid = validateFact({ subject: fact.subject, predicate: fact.predicate, value: change.value ?? null, object: change.object ?? null, source: { kind: "person", ref: `memory-page:${factId}`, at: now } }, now);
    if (!valid.ok) return { status: "rejected", reason: valid.reason, detail: valid.detail };
    const slot = slotKey(fact);
    return this.commit(tenantId, "person", planCorrect(tenantId, fact, valid.fact, this.view(tenantId, slot), this.nextId("fact"), now), slot, "fact.corrected");
  }

  /** Person only: forget a fact. A tombstone stays (slot, times, content hash); the content is gone. */
  async forget(tenantId: string, factId: string): Promise<boolean> {
    const rows = this.rows(tenantId);
    const index = rows.findIndex((f) => f.id === factId);
    const fact = rows[index];
    if (!fact) return false;
    const plan = planForget(fact, this.clock());
    if (!plan) return false;
    rows[index] = plan.tombstone;
    this.audit(tenantId, "person", "fact.forgotten", `${slotKey(fact)}: ${plan.tombstone.invalidReason}`, { factId });
    return true;
  }

  async learnings(tenantId: string, options: { status?: LearningStatus; limit?: number } = {}): Promise<Learning[]> {
    const rows = this.learned.get(assertTenant(tenantId)) ?? [];
    return rows
      .filter((l) => !options.status || l.status === options.status)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, options.limit ?? 100)
      .map((l) => ({ ...l, evidence: l.evidence.map((e) => ({ ...e })) }));
  }

  async recordLearning(tenantId: string, input: LearningInput, options: { actor?: Actor } = {}): Promise<{ status: "recorded" | "rejected" | "refused"; detail?: string; learning?: Learning }> {
    const valid = validateLearning(input);
    if (!valid.ok) return { status: "rejected", detail: valid.detail };
    const rows = this.learned.get(assertTenant(tenantId)) ?? [];
    if (learningsFull(rows.length)) return { status: "refused", detail: "this account's learnings are full" };
    const now = this.clock();
    const learning: Learning = { id: this.nextId("learn"), tenantId, ...valid.learning, source: options.actor === "person" ? "person" : valid.learning.source, createdAt: now, updatedAt: now };
    this.learned.set(tenantId, [...rows, learning]);
    this.audit(tenantId, options.actor ?? "agent", "learning.recorded", learning.status, { learningId: learning.id });
    return { status: "recorded", learning };
  }

  /** Change a learning's status, optionally adding evidence. A verdict still needs a measurement. */
  async setLearningStatus(tenantId: string, learningId: string, status: LearningStatus, evidence: readonly Evidence[] = [], actor: Actor = "agent"): Promise<boolean> {
    const rows = this.learned.get(assertTenant(tenantId)) ?? [];
    const learning = rows.find((l) => l.id === learningId);
    if (!learning) return false;
    const merged = [...learning.evidence, ...evidence];
    if (!statusAllowed(status, merged)) return false;
    Object.assign(learning, { status, evidence: merged, updatedAt: this.clock() });
    this.audit(tenantId, actor, "learning.status", status, { learningId });
    return true;
  }

  async auditLog(tenantId: string): Promise<AuditEntry[]> {
    return [...(this.log.get(assertTenant(tenantId)) ?? [])];
  }

  /** Every row of the tenant (consolidation, tests). */
  async all(tenantId: string): Promise<Fact[]> {
    return this.rows(tenantId).map(copy);
  }

  /** Apply a consolidation merge (consolidate.ts): `drop` is invalidated as merged into `keep`. */
  async merge(tenantId: string, keep: string, drop: readonly string[]): Promise<number> {
    const rows = this.rows(tenantId);
    if (!rows.some((f) => f.id === keep && f.invalidAt === null)) return 0;
    let merged = 0;
    for (const id of drop) {
      const index = rows.findIndex((f) => f.id === id && f.invalidAt === null);
      const old = rows[index];
      if (!old || id === keep) continue;
      rows[index] = { ...old, invalidAt: this.clock(), invalidReason: "merged", supersededBy: keep, pending: false };
      this.audit(tenantId, "system", "fact.merged", `${slotKey(old)}: merged into ${keep}`, { factId: id });
      merged++;
    }
    return merged;
  }
}

const copy = (fact: Fact): Fact => ({ ...fact, subject: { ...fact.subject }, object: fact.object ? { ...fact.object } : null, source: { ...fact.source } });

// ── Backend store ──────────────────────────────────────────────────────────────────────────────────────────────

/** The backend's wire shape (snake_case, ISO times). */
export interface FactWire {
  id: string;
  subject_type: string;
  subject_name: string;
  subject_key: string;
  predicate: string;
  kind: "attribute" | "relation";
  value: string | null;
  object_type: string | null;
  object_name: string | null;
  object_key: string | null;
  source_kind: string;
  source_ref: string;
  source_at: string;
  source_excerpt: string | null;
  trust: Trust;
  confidence: number;
  valid_from: string;
  invalid_at: string | null;
  invalid_reason: InvalidReason | null;
  superseded_by: string | null;
  pending: boolean;
  challenges: string | null;
  value_hash?: string;
  created_at: string;
}

export interface LearningWire {
  id: string;
  claim: string;
  status: LearningStatus;
  evidence: Evidence[];
  confidence: number;
  source: Learning["source"];
  created_at: string;
  updated_at: string;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

export function factFromWire(tenantId: string, w: FactWire): Fact {
  const source: FactSource = { kind: w.source_kind as FactSource["kind"], ref: w.source_ref, at: ms(w.source_at), ...(w.source_excerpt ? { excerpt: w.source_excerpt } : {}) };
  return {
    id: w.id,
    tenantId,
    subject: { type: w.subject_type as EntityType, name: w.subject_name, key: w.subject_key },
    predicate: w.predicate,
    kind: w.kind,
    value: w.value,
    object: w.object_type ? { type: w.object_type as EntityType, name: w.object_name ?? "", key: w.object_key ?? "" } : null,
    source,
    trust: w.trust,
    confidence: w.confidence,
    validFrom: ms(w.valid_from),
    invalidAt: w.invalid_at ? ms(w.invalid_at) : null,
    invalidReason: w.invalid_reason,
    supersededBy: w.superseded_by,
    pending: w.pending,
    challenges: w.challenges,
    valueHash: w.value_hash ?? "",
    createdAt: ms(w.created_at),
  };
}

export function learningFromWire(tenantId: string, w: LearningWire): Learning {
  return { id: w.id, tenantId, claim: w.claim, status: w.status, evidence: Array.isArray(w.evidence) ? w.evidence : [], confidence: w.confidence, source: w.source, createdAt: ms(w.created_at), updatedAt: ms(w.updated_at) };
}

export interface ApiMemoryStoreOptions {
  /** The Worker env (PRIMARY_SAAS_API_URL, SAAS_SERVICE_TOKEN), read at use time. */
  env: () => Record<string, unknown>;
  /** Brokered fetch of a persistent agent, when there is one. */
  fetch?: unknown;
  timeoutMs?: number;
}

/**
 * Facts in the backend. The tenant goes out as `x-tenant-id` from the caller's context (src/marketer/api.ts) and the
 * backend scopes every query to it; the body never names a tenant. The backend validates again (ontology, caps,
 * redaction) and refuses person-only operations from the agent's service token.
 */
export class ApiMemoryStore implements MemoryStore {
  constructor(private readonly options: ApiMemoryStoreOptions) {}

  private ctx(tenantId: string, signal?: AbortSignal, idempotencyKey?: string): MarketerCallContext {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 4000);
    return {
      tenant: { tenantId: assertTenant(tenantId) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      services: { env: this.options.env(), ...(this.options.fetch ? { fetch: this.options.fetch } : {}) },
    };
  }

  async current(tenantId: string, options: ReadOptions = {}): Promise<Fact[]> {
    const page = await marketerApi<{ items: FactWire[] }>(this.ctx(tenantId, options.signal), { method: "GET", path: "/memory/facts", query: { state: "current", limit: Math.min(options.limit ?? 200, 500), entity_type: options.entityType } });
    // Defense in depth: whatever the backend returns, only current facts reach the model.
    return (page?.items ?? []).map((w) => factFromWire(tenantId, w)).filter(isCurrent);
  }

  async history(tenantId: string, factId: string, options: { signal?: AbortSignal } = {}): Promise<Fact[]> {
    const page = await marketerApi<{ items: FactWire[] }>(this.ctx(tenantId, options.signal), { method: "GET", path: `/memory/facts/${seg(factId)}/history` });
    return (page?.items ?? []).map((w) => factFromWire(tenantId, w));
  }

  async write(tenantId: string, input: FactInput, options: { signal?: AbortSignal; idempotencyKey?: string } = {}): Promise<WriteResult> {
    // Validate here first: a rejected fact never leaves the Worker.
    const valid = validateFact(input, Date.now());
    if (!valid.ok) return { status: "rejected", reason: valid.reason, detail: valid.detail };
    if (valid.fact.source.kind === "person") return { status: "rejected", reason: "invalid_source", detail: "only a person can write a person-sourced fact" };
    const f = valid.fact;
    const body = {
      subject: { type: f.subject.type, name: f.subject.name },
      predicate: f.predicate,
      ...(f.object ? { object: { type: f.object.type, name: f.object.name } } : { value: f.value }),
      source: { kind: f.source.kind, ref: f.source.ref, at: new Date(f.source.at).toISOString(), ...(f.source.excerpt ? { excerpt: f.source.excerpt } : {}) },
      confidence: f.confidence,
    };
    const result = await marketerApi<{ status: WriteResult["status"]; reason?: WriteResult["reason"]; fact?: FactWire | null }>(this.ctx(tenantId, options.signal, options.idempotencyKey), { method: "POST", path: "/memory/facts", body });
    return { status: result.status, ...(result.reason ? { reason: result.reason } : {}), ...(result.fact ? { fact: factFromWire(tenantId, result.fact) } : {}) };
  }

  async learnings(tenantId: string, options: { status?: LearningStatus; limit?: number; signal?: AbortSignal } = {}): Promise<Learning[]> {
    const page = await marketerApi<{ items: LearningWire[] }>(this.ctx(tenantId, options.signal), { method: "GET", path: "/memory/learnings", query: { status: options.status, limit: Math.min(options.limit ?? 50, 200) } });
    return (page?.items ?? []).map((w) => learningFromWire(tenantId, w));
  }

  async recordLearning(tenantId: string, input: LearningInput, options: { signal?: AbortSignal; idempotencyKey?: string } = {}): Promise<{ status: "recorded" | "rejected" | "refused"; detail?: string; learning?: Learning }> {
    const valid = validateLearning(input);
    if (!valid.ok) return { status: "rejected", detail: valid.detail };
    const { claim, status, evidence, confidence } = valid.learning;
    const row = await marketerApi<LearningWire>(this.ctx(tenantId, options.signal, options.idempotencyKey), { method: "POST", path: "/memory/learnings", body: { claim, status, evidence, confidence } });
    return { status: "recorded", learning: learningFromWire(tenantId, row) };
  }
}

export { MEMORY_LIMITS };
