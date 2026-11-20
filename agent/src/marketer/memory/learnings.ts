import { assessInjection } from "@agent-starter/core";
import { MEMORY_LIMITS } from "./facts.ts";
import { containsSecret } from "./redact.ts";

/**
 * Learnings: what worked and what did not (plan section 3.2, item 4; ADR 0010 "learnings carry their evidence").
 *
 * A learning is a claim with the evidence behind it and a status. Code decides the status rules:
 *  - a learning without evidence is not stored;
 *  - `supported` and `refuted` need measured evidence (a metric with a sample size of at least MIN_SAMPLE);
 *  - a learning never changes a risk tier, a cap or a brand rule (ADR 0002). It shapes drafts and rankings only.
 */

export const LEARNING_STATUSES = ["hypothesis", "supported", "refuted"] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export const EVIDENCE_KINDS = ["post", "article", "ad", "metric", "decision", "experiment"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const LEARNING_LIMITS = { claimChars: 300, evidenceItems: 12, labelChars: 160, refChars: 200, minSample: 5 } as const;

export interface Evidence {
  kind: EvidenceKind;
  /** Id of the post, article, ad, decision or metric row (never a free-form URL to follow). */
  ref: string;
  label: string;
  metric?: string;
  value?: number;
  /** Sample size behind the number. */
  n?: number;
  /** Relative change vs the baseline, e.g. 0.32 = +32%. */
  lift?: number;
  window?: string;
}

export interface Learning {
  id: string;
  tenantId: string;
  claim: string;
  status: LearningStatus;
  evidence: Evidence[];
  confidence: number;
  source: "analyst" | "person" | "system";
  createdAt: number;
  updatedAt: number;
}

export interface LearningInput {
  claim: string;
  status?: LearningStatus;
  evidence: readonly Partial<Evidence>[];
  confidence?: number;
  source?: Learning["source"];
}

export type LearningValidation = { ok: true; learning: Omit<Learning, "id" | "tenantId" | "createdAt" | "updatedAt"> } | { ok: false; reason: "empty" | "too_long" | "no_evidence" | "invalid_evidence" | "weak_evidence" | "secret" | "instruction_like" | "invalid_status"; detail: string };

const text = (value: unknown): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "");
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Measured evidence: a named metric with a number and a sample of at least `minSample`. */
export function isMeasured(e: Evidence): boolean {
  return Boolean(e.metric) && e.value !== undefined && (e.n ?? 0) >= LEARNING_LIMITS.minSample;
}

/** The status a learning may hold given its evidence: a verdict needs a measurement, otherwise it is a hypothesis. */
export function statusAllowed(status: LearningStatus, evidence: readonly Evidence[]): boolean {
  if (evidence.length === 0) return false;
  return status === "hypothesis" || evidence.some(isMeasured);
}

export function validateLearning(input: LearningInput): LearningValidation {
  const claim = text(input?.claim);
  if (!claim) return { ok: false, reason: "empty", detail: "claim is empty" };
  if (claim.length > LEARNING_LIMITS.claimChars) return { ok: false, reason: "too_long", detail: `claim is longer than ${LEARNING_LIMITS.claimChars} characters` };
  if (containsSecret(claim)) return { ok: false, reason: "secret", detail: "claim looks like it contains a credential" };
  if (assessInjection(claim).verdict !== "safe") return { ok: false, reason: "instruction_like", detail: "the claim reads like an instruction" };
  const status = input.status ?? "hypothesis";
  if (!(LEARNING_STATUSES as readonly string[]).includes(status)) return { ok: false, reason: "invalid_status", detail: "unknown status" };
  const raw = Array.isArray(input.evidence) ? input.evidence : [];
  if (raw.length === 0) return { ok: false, reason: "no_evidence", detail: "a learning without evidence is not stored" };
  if (raw.length > LEARNING_LIMITS.evidenceItems) return { ok: false, reason: "too_long", detail: `at most ${LEARNING_LIMITS.evidenceItems} evidence items` };
  const evidence: Evidence[] = [];
  for (const item of raw) {
    const kind = item?.kind as EvidenceKind;
    const ref = text(item?.ref);
    const label = text(item?.label);
    if (!(EVIDENCE_KINDS as readonly string[]).includes(kind) || !ref || !label) return { ok: false, reason: "invalid_evidence", detail: "each evidence item needs a kind, a ref and a label" };
    if (ref.length > LEARNING_LIMITS.refChars || label.length > LEARNING_LIMITS.labelChars) return { ok: false, reason: "too_long", detail: "evidence ref or label is too long" };
    if (containsSecret(`${ref} ${label}`)) return { ok: false, reason: "secret", detail: "evidence looks like it contains a credential" };
    const metric = text(item?.metric).slice(0, 60);
    const window = text(item?.window).slice(0, 60);
    const value = finite(item?.value);
    const n = finite(item?.n);
    const lift = finite(item?.lift);
    evidence.push({ kind, ref, label, ...(metric ? { metric } : {}), ...(value !== undefined ? { value } : {}), ...(n !== undefined ? { n: Math.max(0, Math.floor(n)) } : {}), ...(lift !== undefined ? { lift } : {}), ...(window ? { window } : {}) });
  }
  if (!statusAllowed(status, evidence)) return { ok: false, reason: "weak_evidence", detail: `"${status}" needs a measured metric with a sample of at least ${LEARNING_LIMITS.minSample}` };
  const confidence = Math.min(1, Math.max(0, finite(input.confidence) ?? (status === "hypothesis" ? 0.4 : 0.7)));
  return { ok: true, learning: { claim, status, evidence, confidence, source: input.source ?? "analyst" } };
}

export const learningsFull = (count: number): boolean => count >= MEMORY_LIMITS.learningsPerTenant;

/** One learning as a line of context: the claim, its status and the strongest piece of evidence. */
export function learningLine(l: Pick<Learning, "claim" | "status" | "evidence">): string {
  const best = l.evidence.find(isMeasured) ?? l.evidence[0];
  const proof = best ? ` (${best.label}${best.metric && best.value !== undefined ? `: ${best.metric} ${best.value}${best.n ? `, n=${best.n}` : ""}` : ""})` : "";
  return `[${l.status}] ${l.claim}${proof}`;
}
