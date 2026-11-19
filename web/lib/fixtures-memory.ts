// Fixture data for the Memory page preview (/preview/app/memory). No API.
import type { MemoryFact, MemoryLearning, RecallPage, RecallSettings } from "@/components/app/memory/types";

const base: Omit<MemoryFact, "id" | "subject_type" | "subject_name" | "subject_key" | "predicate" | "value"> = {
  kind: "attribute",
  object_type: null,
  object_name: null,
  object_key: null,
  source_kind: "message",
  source_ref: "chat:m3k1:9x2f",
  source_at: "2026-10-02T09:14:00Z",
  source_excerpt: null,
  trust: "unconfirmed",
  confidence: 0.6,
  valid_from: "2026-10-02T09:14:00Z",
  invalid_at: null,
  invalid_reason: null,
  superseded_by: null,
  pending: false,
  challenges: null,
  created_at: "2026-10-02T09:14:00Z",
};

const fact = (id: string, subject: [type: string, name: string], predicate: string, value: string, over: Partial<MemoryFact> = {}): MemoryFact => ({
  ...base,
  id,
  subject_type: subject[0],
  subject_name: subject[1],
  subject_key: subject[1].toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  predicate,
  value,
  ...over,
});

const BRAND: [string, string] = ["brand", "Pasta Club"];
const person = { trust: "trusted" as const, source_kind: "person" as const, source_ref: "memory-page", confidence: 1 };

export const FX_MEMORY_FACTS: MemoryFact[] = [
  fact("f-voice", BRAND, "voice", "Warm, practical, a little dry. Never salesy.", { ...person, source_kind: "message", source_ref: "chat:m3k1:9x2f", source_excerpt: "our voice is warm and practical, a little dry, and never salesy", valid_from: "2026-10-21T16:02:00Z", source_at: "2026-10-21T16:02:00Z" }),
  fact("f-tagline", BRAND, "tagline", "Dinner in ten.", { ...person, valid_from: "2026-09-12T10:00:00Z", source_at: "2026-09-12T10:00:00Z" }),
  fact("f-positioning", BRAND, "positioning", "Fresh pasta kits for people who like cooking but not on a Tuesday.", { source_excerpt: "we're fresh pasta kits for people who like cooking but not on a Tuesday" }),
  fact("f-rule-emoji", ["rule", "No emoji in captions"], "text", "Never use emoji in captions.", { ...person, valid_from: "2026-09-12T10:04:00Z", source_at: "2026-09-12T10:04:00Z" }),
  fact("f-claim", ["claim", "Ready in ten minutes"], "status", "approved", { ...person, valid_from: "2026-09-20T08:30:00Z", source_at: "2026-09-20T08:30:00Z" }),
  fact("f-aud", ["audience", "Busy home cooks"], "description", "Couples aged 28 to 40 in big cities who cook at home three nights a week.", { source_excerpt: "mostly couples, late twenties to forty, big cities, they cook maybe three nights a week" }),
  fact("f-aud-pain", ["audience", "Busy home cooks"], "pain_point", "Weeknight dinners feel like a chore.", {}),
  fact("f-aud-pain2", ["audience", "Busy home cooks"], "pain_point", "Meal kits create too much packaging.", { source_kind: "job", source_ref: "job:comment-digest-41", valid_from: "2026-11-03T07:00:00Z", source_at: "2026-11-03T07:00:00Z" }),
  fact("f-offer", ["offer", "First box half price"], "price", "$14.50 for the first box, then $29.", { ...person, valid_from: "2026-10-01T12:00:00Z", source_at: "2026-10-01T12:00:00Z" }),
  fact("f-comp-price", ["competitor", "Noodle Co"], "price", "$9 per box, four-box minimum.", { trust: "untrusted", source_kind: "web", source_ref: "https://noodleco.example/pricing", valid_from: "2026-11-10T13:20:00Z", source_at: "2026-11-10T13:20:00Z", source_excerpt: "Boxes from $9. Minimum order: four boxes per delivery." }),
  fact("f-comp-weak", ["competitor", "Noodle Co"], "weakness", "Dried pasta only, no fresh range.", { trust: "untrusted", source_kind: "web", source_ref: "https://noodleco.example/range", valid_from: "2026-11-10T13:21:00Z", source_at: "2026-11-10T13:21:00Z" }),
  fact("f-chan", ["channel", "TikTok"], "cadence", "Five posts a week, weekdays.", {}),
  fact("f-chan-time", ["channel", "TikTok"], "best_time", "6pm to 8pm local time.", { source_kind: "metric", source_ref: "post_metrics:30d", valid_from: "2026-11-08T06:00:00Z", source_at: "2026-11-08T06:00:00Z" }),
  // Waiting for the person.
  fact("p-rule", ["rule", "No price in hooks"], "text", "Never mention the price in the first three seconds.", { pending: true, source_excerpt: "and please never mention the price in the first three seconds", valid_from: "2026-11-16T11:40:00Z", source_at: "2026-11-16T11:40:00Z" }),
  fact("p-voice", BRAND, "voice", "Bold, loud, a bit cheeky.", { pending: true, challenges: "f-voice", trust: "untrusted", source_kind: "web", source_ref: "https://pastaclub.example/about", valid_from: "2026-11-15T09:05:00Z", source_at: "2026-11-15T09:05:00Z" }),
];

/** History per fact, as GET /facts/{id}/history returns it (oldest first, the current one last). */
export const FX_MEMORY_HISTORY: Record<string, MemoryFact[]> = {
  "f-voice": [
    fact("h-voice-1", BRAND, "voice", "Friendly and upbeat.", { valid_from: "2026-09-12T10:01:00Z", invalid_at: "2026-10-02T09:14:00Z", invalid_reason: "superseded", superseded_by: "h-voice-2" }),
    fact("h-voice-2", BRAND, "voice", "Warm and practical.", { valid_from: "2026-10-02T09:14:00Z", invalid_at: "2026-10-21T16:02:00Z", invalid_reason: "corrected", superseded_by: "f-voice" }),
    FX_MEMORY_FACTS[0]!,
  ],
  "f-offer": [
    fact("h-offer-1", ["offer", "First box half price"], "price", "", { value: null, valid_from: "2026-09-14T12:00:00Z", invalid_at: "2026-10-01T12:00:00Z", invalid_reason: "forgotten" }),
    FX_MEMORY_FACTS[8]!,
  ],
};

export const FX_MEMORY_LEARNINGS: MemoryLearning[] = [
  {
    id: "l1",
    claim: "Hooks that name a number beat hooks that don't on TikTok.",
    status: "supported",
    confidence: 0.8,
    source: "analyst",
    created_at: "2026-10-28T07:00:00Z",
    updated_at: "2026-11-12T07:00:00Z",
    evidence: [
      { kind: "metric", ref: "post_metrics:tiktok:oct", label: "12 posts with a number in the hook", metric: "3s view rate", value: 0.41, n: 12, lift: 0.32, window: "Oct 1 to Oct 31" },
      { kind: "post", ref: "job:8f2c", label: "“3 pastas in 10 minutes”", metric: "views", value: 48200 },
      { kind: "decision", ref: "decision:hook_score:771", label: "Hook check passed with a specific promise" },
    ],
  },
  {
    id: "l2",
    claim: "Posting after 6pm gets more saves than the lunch slot.",
    status: "supported",
    confidence: 0.7,
    source: "analyst",
    created_at: "2026-11-01T07:00:00Z",
    updated_at: "2026-11-08T07:00:00Z",
    evidence: [{ kind: "metric", ref: "post_metrics:30d", label: "22 evening posts vs 19 lunch posts", metric: "save rate", value: 0.036, n: 41, lift: 0.18, window: "Last 30 days" }],
  },
  {
    id: "l3",
    claim: "Discount-first ad creative lifts click-through.",
    status: "refuted",
    confidence: 0.7,
    source: "analyst",
    created_at: "2026-10-20T07:00:00Z",
    updated_at: "2026-11-05T07:00:00Z",
    evidence: [{ kind: "ad", ref: "ad_metrics:camp-12", label: "Half-price creative vs recipe creative", metric: "CTR", value: 0.009, n: 8400, lift: -0.21, window: "Oct 20 to Nov 3" }],
  },
  {
    id: "l4",
    claim: "Carousels may outperform video on Instagram for recipes.",
    status: "hypothesis",
    confidence: 0.4,
    source: "analyst",
    created_at: "2026-11-14T07:00:00Z",
    updated_at: "2026-11-14T07:00:00Z",
    evidence: [{ kind: "post", ref: "image_post:c41", label: "One carousel, 2.1x the usual saves" }],
  },
];

// ── Recall (Supermemory) previews: /preview/app/memory/personal, /team, /recall-off ─────────────────────────────


export const FX_RECALL_SETTINGS: RecallSettings = { configured: true, enabled: true, updated_at: "2026-11-02T10:00:00Z" };
export const FX_RECALL_OFF: RecallSettings = { configured: true, enabled: false, updated_at: "2026-11-02T10:00:00Z" };

export const FX_RECALL_PERSONAL: RecallPage = {
  enabled: true,
  page: 1,
  total: 5,
  items: [
    { id: "mem_p1", memory: "Prefers captions under 80 characters, no emoji.", updated_at: "2026-11-17T09:12:00Z" },
    { id: "mem_p2", memory: "Is preparing the spring launch of the fresh pasta kits for March.", updated_at: "2026-11-16T15:40:00Z" },
    { id: "mem_p3", memory: "Reviews drafts on Monday mornings and wants them ready by Friday.", updated_at: "2026-11-12T08:05:00Z" },
    { id: "mem_p4", memory: "Moved the newsletter from Thursday to Tuesday.", updated_at: "2026-11-04T11:20:00Z" },
    { id: "mem_p5", memory: "Likes reports as a short table first, details after.", updated_at: "2026-10-29T17:55:00Z" },
  ],
};

export const FX_RECALL_TEAM: RecallPage = {
  enabled: true,
  page: 1,
  total: 4,
  items: [
    { id: "mem_t1", memory: "Brand voice is warm, practical, a little dry, never salesy.", updated_at: "2026-11-15T10:00:00Z" },
    { id: "mem_t2", memory: "The tagline is “Dinner in ten.”", updated_at: "2026-11-10T10:00:00Z" },
    { id: "mem_t3", memory: "The first box is $14.50, then $29 a box.", updated_at: "2026-11-01T12:00:00Z" },
    { id: "mem_t4", memory: "Published article: Five weeknight pasta dinners under ten minutes.", updated_at: "2026-10-28T09:00:00Z" },
  ],
};
