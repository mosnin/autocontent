// Realistic fixture data for /preview/* (design review screenshots without
// Clerk or the API). Never imported by real pages.

import type { Activity, Inbox, Overview } from "./workspace";

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};
const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

function series(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const n = days - 1 - i;
    const wave = Math.sin(i / 2.2) * 0.35 + 1;
    return {
      day: day(n),
      content_spend_usd: (1.2 + (i % 5) * 0.35).toFixed(2),
      ad_spend_usd: (i > days / 3 ? 18 + (i % 4) * 3.5 : 0).toFixed(2),
      views: Math.round((900 + i * 120) * wave),
      posts: i % 3 === 0 ? 2 : 1,
    };
  });
}

function overview(days: number): Overview {
  const s = series(days);
  const sum = (f: (r: (typeof s)[number]) => number) => s.reduce((a, r) => a + f(r), 0);
  const content = sum((r) => Number(r.content_spend_usd));
  const ads = sum((r) => Number(r.ad_spend_usd));
  return {
    days,
    kpis: {
      total_spend_usd: (content + ads).toFixed(2),
      content_spend_usd: content.toFixed(2),
      ad_spend_usd: ads.toFixed(2),
      posts_published: sum((r) => r.posts),
      articles_published: Math.round(days / 7),
      views: sum((r) => r.views),
      engagements: Math.round(sum((r) => r.views) * 0.061),
      ad_clicks: Math.round(ads * 4.2),
      ad_conversions: Math.round(ads * 0.21),
    },
    previous_kpis: {
      total_spend_usd: ((content + ads) * 0.82).toFixed(2),
      content_spend_usd: (content * 0.9).toFixed(2),
      ad_spend_usd: (ads * 0.7).toFixed(2),
      posts_published: Math.round(sum((r) => r.posts) * 0.8),
      articles_published: Math.max(0, Math.round(days / 7) - 1),
      views: Math.round(sum((r) => r.views) * 0.78),
      engagements: Math.round(sum((r) => r.views) * 0.05),
      ad_clicks: Math.round(ads * 3.1),
      ad_conversions: Math.round(ads * 0.15),
    },
    series: s,
    pipeline: { content: { active: 2, done: 41, failed: 1 }, seo: { active: 1, done: 6, failed: 0 }, ads: { active_campaigns: 2, pending_approvals: 1 } },
    top_content: [
      { kind: "video", id: "v1", title: "3 pasta mistakes every home cook makes", platform: "tiktok", views: 48200, created_at: ago(70) },
      { kind: "video", id: "v2", title: "Why fresh tagliatelle holds sauce better", platform: "reels", views: 31900, created_at: ago(120) },
      { kind: "article", id: "a1", title: "The complete guide to fresh pasta at home", platform: null, views: null, created_at: ago(200) },
      { kind: "carousel", id: "c1", title: "5 sauces in 15 minutes", platform: "reels", views: null, created_at: ago(30) },
      { kind: "video", id: "v3", title: "Ragù in 40 minutes, not 4 hours", platform: "shorts", views: 12400, created_at: ago(26) },
    ],
  };
}

export const FIXTURE_WEEK = overview(7);
export const FIXTURE_MONTH = overview(30);
export const FIXTURE_HISTORY = overview(182);

export const FIXTURE_INBOX: Inbox = {
  items: [
    { id: "ad_change:1", kind: "ad_change", ref_id: "1", title: "Scale ‘Fresh pasta, Spring’", detail: "Raise daily budget $20 → $35 on Meta · CPA $11.40, 31% under target", niche_id: null, created_at: ago(1) },
    { id: "video:2", kind: "video", ref_id: "2", title: "The one salt rule for pasta water", detail: "TikTok · Pasta at home", niche_id: "n1", created_at: ago(3) },
    { id: "carousel:3", kind: "carousel", ref_id: "3", title: "5 sauces in 15 minutes", detail: "Reels · Pasta at home", niche_id: "n1", created_at: ago(5) },
  ],
  counts: { total: 3, video: 1, carousel: 1, ad_change: 1, required_action: 2 },
  required_actions: [
    {
      id: "7b0c2f1e-5a44-4c1b-9d7e-3f2b8a6c1d90",
      kind: "indeterminate_outcome",
      action: "content.post.send",
      title: "We can't confirm the post went out",
      detail: "Check video_post 3f2b9c4a before trying again. Nothing will retry on its own.",
      target_type: "video_post",
      target_id: "3f2b9c4a-1e77-4d0a-8b65-0c9d2e4f6a12",
      principal: "system",
      created_at: ago(2),
      resolve_path: "/api/v1/workspace/required-actions/7b0c2f1e-5a44-4c1b-9d7e-3f2b8a6c1d90/resolve",
      resolutions: ["confirmed_succeeded", "confirmed_failed"],
    },
    {
      id: "c41d8e77-02ab-4f39-b6a1-9e5d3c7f2b08",
      kind: "indeterminate_outcome",
      action: "ads.budget.change",
      title: "We can't confirm the budget change reached the ad platform",
      detail: "Check ad_campaign 9a1e44d2 before trying again. Nothing will retry on its own.",
      target_type: "ad_campaign",
      target_id: "9a1e44d2-6b3c-4e58-a7f0-1d2c3b4a5e6f",
      principal: "agent",
      created_at: ago(7),
      resolve_path: "/api/v1/workspace/required-actions/c41d8e77-02ab-4f39-b6a1-9e5d3c7f2b08/resolve",
      resolutions: ["confirmed_succeeded", "confirmed_failed"],
    },
  ],
};

export const FIXTURE_ACTIVITY: Activity = {
  events: [
    { id: "e1", at: ago(0.4), kind: "video", status: "done", title: "Ragù in 40 minutes, not 4 hours", detail: "Posted to Shorts", ref_id: "v3" },
    { id: "e2", at: ago(1), kind: "approval", status: "pending", title: "Scale ‘Fresh pasta, Spring’", detail: "Media buyer asked to raise the daily budget", ref_id: "1" },
    { id: "e3", at: ago(2.5), kind: "article", status: "done", title: "The complete guide to fresh pasta at home", detail: "2,140 words · QA 91", ref_id: "a1" },
    { id: "e4", at: ago(4), kind: "video", status: "failed", title: "Knife skills for pasta night", detail: "QA rejected the hook: too slow to the point", ref_id: "v9" },
    { id: "e5", at: ago(6), kind: "ad_action", status: "done", title: "Paused ‘Winter comfort’ ad set", detail: "CPA rose 48% over 3 days", ref_id: "2" },
    { id: "e6", at: ago(9), kind: "campaign", status: "running", title: "Spring launch", detail: "Started · 3 videos, 1 article and 1 ad set a week", ref_id: "c1" },
  ],
  next_before: null,
};
