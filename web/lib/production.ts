export const CREATIVE_FORMATS = [
  "video",
  "article",
  "image-post",
  "ad",
  "ad-slot",
  "ugc",
  "drama",
  "design",
  "motion",
  "headshot",
  "composition",
  "asset",
];
export type CreativeItem = {
  id: string;
  kind: string;
  title: string;
  status: string;
  updatedAt: string;
  sourceUrl: string;
  productionUrl: string;
  campaignIds: string[];
  groupId: string;
};
export type LibraryPage = {
  items: CreativeItem[];
  nextCursor: string | null;
  asOf: string;
};
export type Brief = {
  objective: string;
  audience: string;
  owner: string;
  deliverable: string;
  due_date: string;
  inputs: {
    id: string;
    label: string;
    status: "missing" | "available" | "unverified";
    evidence: string;
  }[];
  context: { label: string; url: string; revision: string; excerpt: string }[];
  variant_of: string;
  hypothesis: string;
};
export const emptyBrief: Brief = {
  objective: "",
  audience: "",
  owner: "",
  deliverable: "",
  due_date: "",
  inputs: [],
  context: [],
  variant_of: "",
  hypothesis: "",
};
export type ReviewNote = {
  id: string;
  text: string;
  anchor: string;
  blocking: boolean;
  source_fingerprint: string;
  created_at: string;
  resolved_at?: string;
  resolution?: string;
};
export type Handoff = {
  version: number;
  source_fingerprint: string;
  brief_version: number;
  at: string;
  text: string;
  url: string;
};
export type ProductionRecord = {
  source: {
    item: CreativeItem;
    fingerprint: string;
    excerpt: string;
    preview_count: number;
    anchors: { id: string; label: string; text?: string }[];
  };
  version: number;
  brief_version: number;
  readiness: string[];
  approved: boolean;
  state: {
    brief?: Brief;
    notes?: ReviewNote[];
    approval?: {
      source_fingerprint: string;
      at: string;
      brief_version: number;
    };
    handoffs?: Handoff[];
    outcomes?: {
      text: string;
      url: string;
      at: string;
      handoff_version: number;
      source_fingerprint: string;
    }[];
  };
  events: {
    version: number;
    action: string;
    created_at: string;
    source_fingerprint: string;
  }[];
};

export async function productionRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/proxy/api/v1/production${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : response.status === 422
          ? "Check the fields and try again. URLs must be valid and required values cannot be blank."
          : "Could not load the production workspace. Try again.",
    );
  }
  return response.json();
}
