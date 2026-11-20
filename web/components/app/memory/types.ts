// Wire types of /api/v1/memory (backend/routes/memory.py). Client-safe.

export type Trust = "trusted" | "unconfirmed" | "untrusted";
export type InvalidReason = "superseded" | "corrected" | "merged" | "forgotten" | "dismissed";

export interface MemoryFact {
  id: string;
  subject_type: string;
  subject_name: string;
  subject_key: string;
  predicate: string;
  kind: "attribute" | "relation";
  /** Null on relations and on forgotten facts. */
  value: string | null;
  object_type: string | null;
  object_name: string | null;
  object_key: string | null;
  source_kind: "person" | "message" | "approval" | "job" | "metric" | "tool" | "document" | "web";
  source_ref: string;
  source_at: string;
  source_excerpt: string | null;
  trust: Trust;
  confidence: number;
  valid_from: string;
  invalid_at: string | null;
  invalid_reason: InvalidReason | null;
  superseded_by: string | null;
  /** Waiting for the person: a rule from a source that isn't them, or a value that disagrees with a confirmed one. */
  pending: boolean;
  challenges: string | null;
  created_at: string;
}

export interface FactPage {
  items: MemoryFact[];
  counts: { current: number; pending: number; total: number };
  limits: { active: number; value_chars: number };
}

export interface Evidence {
  kind: "post" | "article" | "ad" | "metric" | "decision" | "experiment";
  ref: string;
  label: string;
  metric?: string;
  value?: number;
  n?: number;
  lift?: number;
  window?: string;
}

export interface MemoryLearning {
  id: string;
  claim: string;
  status: "hypothesis" | "supported" | "refuted";
  evidence: Evidence[];
  confidence: number;
  source: "analyst" | "person" | "system";
  created_at: string;
  updated_at: string;
}

/** Entity types in the order the page shows them, with their section titles. */
export const ENTITY_GROUPS: { type: string; title: string }[] = [
  { type: "brand", title: "Brand" },
  { type: "rule", title: "Rules" },
  { type: "claim", title: "Claims" },
  { type: "audience", title: "Audience" },
  { type: "offer", title: "Offers" },
  { type: "product", title: "Products" },
  { type: "competitor", title: "Competitors" },
  { type: "channel", title: "Channels" },
  { type: "campaign", title: "Campaigns" },
  { type: "creative", title: "Creatives" },
  { type: "preference", title: "Preferences" },
];

export const predicateLabel = (predicate: string): string => {
  const text = predicate.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** What a fact says, as text: the value, or the entity a relation points at. */
export const factText = (f: Pick<MemoryFact, "value" | "object_name">): string => f.value ?? f.object_name ?? "";

const SOURCE_LABEL: Record<MemoryFact["source_kind"], string> = {
  person: "You, on this page",
  message: "Something you said in chat",
  approval: "An approval you gave",
  job: "A finished job",
  metric: "Measured results",
  tool: "A tool result",
  document: "A document",
  web: "A web page",
};

export const sourceLabel = (kind: MemoryFact["source_kind"]): string => SOURCE_LABEL[kind] ?? kind;

/** Only http(s) references are shown as text a person may recognise as a link; nothing here is ever followed. */
export const sourceRef = (f: Pick<MemoryFact, "source_kind" | "source_ref">): string | null => (/^https?:\/\//.test(f.source_ref) ? f.source_ref.replace(/^https?:\/\//, "").slice(0, 80) : null);

// ── Recall (Supermemory): /api/v1/memory/recall/*, /personal*, /team* ─────────────────────────────────────────────

export type RecallScope = "personal" | "team";

export interface RecallSettings {
  configured: boolean;
  enabled: boolean;
  updated_at?: string | null;
}

export interface RecallItem {
  id: string;
  memory: string;
  updated_at?: string | null;
}

export interface RecallPage {
  enabled: boolean;
  items: RecallItem[];
  total: number;
  page: number;
}
