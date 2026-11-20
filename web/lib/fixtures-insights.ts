// Fixture data for the insights pages (analytics, activity, plan, library)
// in /preview/*. Never imported by real pages.

import type { AnalyticsData } from "@/components/app/analytics/analytics-view";
import type { PlanItem } from "@/components/app/plan/plan-data";
import { FIXTURE_ACTIVITY, FIXTURE_MONTH } from "./fixtures";
import type { Composition, ImagePost, MediaAsset, Niche, SpendHistory } from "./types";
import type { Activity, DecisionEntry, DecisionPage, SeriesRow } from "./workspace";

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const ahead = (days: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dayStr = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

export const FIXTURE_PLAYBOOKS = [
  { id: "n1", title: "Pasta at home" },
  { id: "n2", title: "Weeknight dinners" },
  { id: "n3", title: "Spring launch" },
];

/* ---------------------------------------------------------------- analytics */

const previousSeries: SeriesRow[] = FIXTURE_MONTH.series.map((r, i) => ({
  ...r,
  day: dayStr(59 - i),
  views: Math.round(r.views * (0.68 + Math.cos(i / 3) * 0.12)),
}));

const spend: SpendHistory = {
  days: 30,
  total_usd: FIXTURE_MONTH.kpis.content_spend_usd,
  rows: FIXTURE_MONTH.series.flatMap((r, i) => [
    { day: r.day, niche_id: "n1", cost_usd: (Number(r.content_spend_usd) * 0.55).toFixed(4) },
    { day: r.day, niche_id: "n2", cost_usd: (Number(r.content_spend_usd) * 0.3).toFixed(4) },
    ...(i % 4 === 0 ? [{ day: r.day, niche_id: "n3", cost_usd: (Number(r.content_spend_usd) * 0.6).toFixed(4) }] : []),
  ]),
};

export const FIXTURE_ANALYTICS: AnalyticsData = {
  days: 30,
  overview: FIXTURE_MONTH,
  previousSeries,
  spend,
  ads: { accounts: 1, active_accounts: 1, campaigns: 3, active_campaigns: 2, spend_today_usd: "24.50", spend_30d_usd: FIXTURE_MONTH.kpis.ad_spend_usd, pending_approvals: 1, month_start: dayStr(15) },
  metrics: { total_views: FIXTURE_MONTH.kpis.views, sampled_videos: 38, best_job_id: "v1", best_views: 48200, days: 30 },
  playbooks: [
    { id: "n1", title: "Pasta at home", summary: { total_videos: 24, total_spend_usd: "31.20", total_views: 162400, avg_views_per_video: 6767, best_job_id: "v1", worst_job_id: null } },
    { id: "n2", title: "Weeknight dinners", summary: { total_videos: 14, total_spend_usd: "18.75", total_views: 54800, avg_views_per_video: 3914, best_job_id: "v2", worst_job_id: null } },
    { id: "n3", title: "Spring launch", summary: { total_videos: 3, total_spend_usd: "4.10", total_views: 6100, avg_views_per_video: 2033, best_job_id: null, worst_job_id: null } },
  ],
};

/* ----------------------------------------------------------------- activity */

export const FIXTURE_ACTIVITY_FULL: Activity = {
  events: [
    ...FIXTURE_ACTIVITY.events,
    { id: "e7", at: ago(26), kind: "carousel", status: "done", title: "5 sauces in 15 minutes", detail: "Posted to Reels · 7 slides", ref_id: "c1" },
    { id: "e8", at: ago(28), kind: "approval", status: "approved", title: "Launch ‘Spring pasta kit’", detail: "You approved $20/day on Meta", ref_id: "3" },
    { id: "e9", at: ago(31), kind: "video", status: "done", title: "Why fresh tagliatelle holds sauce better", detail: "Posted to Reels", ref_id: "v2" },
    { id: "e10", at: ago(50), kind: "article", status: "failed", title: "Semolina vs 00 flour", detail: "Research step timed out", ref_id: "a2" },
    { id: "e11", at: ago(54), kind: "ad_action", status: "budget_change", title: "Raised ‘Fresh pasta, Spring’ to $35/day", detail: "CPA 31% under target", ref_id: "1" },
    { id: "e12", at: ago(75), kind: "video", status: "done", title: "3 pasta mistakes every home cook makes", detail: "Posted to TikTok", ref_id: "v1" },
  ],
  next_before: ago(80),
};

/* --------------------------------------------------------------------- plan */

export const FIXTURE_PLAN: PlanItem[] = [
  { kind: "video", id: "p1", title: "The one salt rule for pasta water", status: "awaiting_approval", platform: "tiktok", playbook: "Pasta at home", at: ahead(0, 17, 30) },
  { kind: "carousel", id: "p2", title: "5 sauces in 15 minutes", status: "scheduling", platform: "reels", playbook: "Pasta at home", at: ahead(0, 19) },
  { kind: "video", id: "p3", title: "Ragù in 40 minutes, not 4 hours", status: "scheduling", platform: "shorts", playbook: "Weeknight dinners", at: ahead(1, 16) },
  { kind: "article", id: "p4", title: "The complete guide to fresh pasta at home", status: "writing", platform: null, playbook: "Pasta at home", at: ahead(2, 9) },
  { kind: "video", id: "p5", title: "Why fresh tagliatelle holds sauce better", status: "queued", platform: "reels", playbook: "Pasta at home", at: ahead(2, 18) },
  { kind: "ad", id: "p6", title: "Spring pasta kit", status: "active", platform: "meta_ads", playbook: "Spring launch", at: ahead(3, 8) },
  { kind: "campaign", id: "p7", title: "Spring launch", status: "running", platform: null, playbook: "Spring launch", at: ahead(4, 8) },
  { kind: "video", id: "p8", title: "Knife skills for pasta night", status: "queued", platform: "tiktok", playbook: "Weeknight dinners", at: ahead(4, 17) },
  { kind: "video", id: "p9", title: "Cacio e pepe without clumps", status: "queued", platform: "tiktok", playbook: "Pasta at home", at: ahead(8, 17) },
  { kind: "article", id: "p10", title: "Semolina vs 00 flour", status: "queued", platform: null, playbook: "Pasta at home", at: ahead(10, 9) },
  { kind: "video", id: "p11", title: "Pesto that stays green", status: "queued", platform: "shorts", playbook: "Weeknight dinners", at: ahead(12, 16) },
  { kind: "video", id: "p12", title: "Lasagna sheets from scratch", status: "done", platform: "reels", playbook: "Pasta at home", at: ahead(-2, 18) },
];

/* ------------------------------------------------------------------ library */

const asset = (id: string, kind: MediaAsset["kind"], title: string, niche: string | null, dur: number | null, hours: number, type = "video/mp4"): MediaAsset => ({
  id,
  user_id: "u1",
  niche_id: niche,
  job_id: null,
  kind,
  scene_index: kind === "clip" ? Number(id.replace(/\D/g, "")) % 6 : null,
  storage: "wasabi",
  object_key: `${id}.mp4`,
  content_type: type,
  size_bytes: 4_200_000,
  duration_sec: dur == null ? null : String(dur),
  title,
  created_at: ago(hours),
});

export const FIXTURE_NICHES = FIXTURE_PLAYBOOKS.map((p) => ({ id: p.id, title: p.title }) as Niche);

export const FIXTURE_FINALS: MediaAsset[] = [
  asset("f1", "final", "3 pasta mistakes every home cook makes", "n1", 34, 70),
  asset("f2", "final", "Why fresh tagliatelle holds sauce better", "n1", 41, 120),
  asset("f3", "final", "Ragù in 40 minutes, not 4 hours", "n2", 28, 26),
  asset("f4", "final", "The one salt rule for pasta water", "n1", 22, 3),
  asset("f5", "composition", "Best hooks, March", null, 58, 10),
];

export const FIXTURE_CLIPS: MediaAsset[] = Array.from({ length: 10 }, (_, i) =>
  asset(`k${i + 1}`, "clip", ["Boiling water close-up", "Salt pour", "Dough knead", "Rolling sheet", "Cutting ribbons", "Sauce toss", "Plating", "Steam rise", "Cheese grate", "Fork twirl"][i], i % 3 === 0 ? "n2" : "n1", 4 + (i % 4), 20 + i * 6),
);

export const FIXTURE_IMAGES: MediaAsset[] = Array.from({ length: 6 }, (_, i) => asset(`i${i + 1}`, "keyframe", `Slide ${i + 1}`, "n1", null, 30 + i, "image/png"));

export const FIXTURE_COMPOSITIONS: Composition[] = [
  { id: "cmp1", user_id: "u1", title: "Best hooks, March", clip_asset_ids: ["k1", "k2", "k3", "k4"], audio_mode: "keep", status: "done", output_asset_id: "f5", error: null, created_at: ago(10), updated_at: ago(9.8) },
  { id: "cmp2", user_id: "u1", title: "Sauce montage", clip_asset_ids: ["k6", "k7", "k10"], audio_mode: "keep", status: "rendering", output_asset_id: null, error: null, created_at: ago(0.2), updated_at: ago(0.1) },
];

export const FIXTURE_IMAGE_POSTS: ImagePost[] = [
  { id: "ip1", user_id: "u1", niche_id: "n1", campaign_id: null, kind: "carousel", topic: "5 sauces in 15 minutes", status: "awaiting_approval", payload: { slide_count: 7 }, provider_post_id: null, error: null, created_at: ago(5), updated_at: ago(4) },
  { id: "ip2", user_id: "u1", niche_id: "n2", campaign_id: null, kind: "single", topic: "Weeknight pantry list", status: "failed", payload: {}, provider_post_id: null, error: "Image model returned an empty frame", created_at: ago(9), updated_at: ago(8) },
];

const decision = (id: string, hours: number, d: Partial<DecisionEntry> & Pick<DecisionEntry, "point" | "mode" | "action_taken" | "fallback_used">): DecisionEntry => ({
  id,
  model: null,
  questions_version: "2026-11-01",
  answers: null,
  reason: null,
  latency_ms: 420,
  cost_usd: "0.0004",
  rule_action: null,
  table_action: null,
  subject_kind: null,
  subject_id: null,
  outcome: null,
  correction: null,
  outcome_at: null,
  created_at: ago(hours),
  ...d,
});

export const FIXTURE_DECISIONS: DecisionPage = {
  items: [
    decision("d1", 0.3, {
      point: "approval_risk",
      mode: "enforce",
      action_taken: "require_review",
      rule_action: "auto_approve",
      table_action: "require_review",
      fallback_used: false,
      subject_kind: "ad_change",
      subject_id: "1",
      answers: { changes_spend: { type: "yesno", probability: 0.97 }, reversible: { type: "yesno", probability: 0.22 } },
    }),
    decision("d2", 1.5, {
      point: "routing",
      mode: "shadow",
      action_taken: "content-producer",
      rule_action: "content-producer",
      table_action: "seo-editor",
      fallback_used: true,
      answers: { department: { type: "choice", choice: "seo-editor", confidence: 0.61 } },
    }),
    decision("d3", 4, {
      point: "approval_risk",
      mode: "enforce",
      action_taken: "require_review",
      rule_action: "auto_approve",
      fallback_used: true,
      reason: "timeout",
      subject_kind: "video",
      subject_id: "2",
    }),
    decision("d4", 9, {
      point: "memory_gate",
      mode: "shadow",
      action_taken: "keep",
      rule_action: "keep",
      table_action: "keep",
      fallback_used: true,
      answers: { durable_fact: { type: "yesno", probability: 0.88 } },
      correction: { note: "Don't keep one-off promo codes." },
    }),
    decision("d5", 26, {
      point: "autopilot",
      mode: "shadow",
      action_taken: "no_proposal",
      rule_action: "no_proposal",
      table_action: "propose_video",
      fallback_used: true,
      answers: { worth_proposing: { type: "yesno", probability: 0.71 } },
    }),
  ],
  next_cursor: null,
};
