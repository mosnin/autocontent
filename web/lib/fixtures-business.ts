// Fixture data for the business pages' /preview views (paid media,
// distribution, brand, integrations, settings). Never imported by real pages.

import type { AdAccount, AdActionEntry, AdApproval, AdCampaign, AdMetricsDaily, AdsOverview } from "./ads-client";
import type { BrandKit } from "./brand-kit-client";
import type { CalendarItem, PlaybookRef, X402Config } from "./business";
import type { AyrshareConnectStatus, BillingBalance, Campaign, CampaignOverview, Kit, PersonalAccessToken, User } from "./types";
import type { WebhookEndpoint } from "./webhooks-client";

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const ahead = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

/* ----------------------------------------------------------------- paid */

export const FX_ADS_OVERVIEW: AdsOverview = {
  accounts: 2,
  active_accounts: 2,
  campaigns: 5,
  active_campaigns: 2,
  spend_today_usd: "41.20",
  spend_30d_usd: "812.40",
  pending_approvals: 1,
  month_start: day(15),
};

export const FX_AD_ACCOUNTS: AdAccount[] = [
  { id: "acc-meta", user_id: "u1", platform: "meta_ads", external_account_id: "act_2210948", name: "Pasta Club · Meta", status: "active", currency: "USD", daily_cap_usd: "60.00", monthly_cap_usd: "1500.00", killswitch: false, last_error: "", created_at: ago(900), updated_at: ago(20) },
  { id: "acc-google", user_id: "u1", platform: "google_ads", external_account_id: "482-119-0042", name: "Pasta Club Search", status: "active", currency: "USD", daily_cap_usd: "25.00", monthly_cap_usd: null, killswitch: true, last_error: "", created_at: ago(600), updated_at: ago(5) },
];

export const FX_AD_CAMPAIGNS: AdCampaign[] = [
  { id: "1", user_id: "u1", ad_account_id: "acc-meta", external_campaign_id: "238491", name: "Fresh pasta, Spring", objective: "conversions", status: "active", daily_budget_usd: "20.00", lifetime_budget_usd: null, niche_id: "n1", last_error: "", created_at: ago(300), updated_at: ago(2) },
  { id: "2", user_id: "u1", ad_account_id: "acc-meta", external_campaign_id: "238492", name: "Winter comfort", objective: "traffic", status: "paused", daily_budget_usd: "15.00", lifetime_budget_usd: null, niche_id: "n1", last_error: "", created_at: ago(900), updated_at: ago(6) },
  { id: "3", user_id: "u1", ad_account_id: "acc-google", external_campaign_id: "99120", name: "Fresh pasta near me", objective: "sales", status: "active", daily_budget_usd: "12.50", lifetime_budget_usd: null, niche_id: null, last_error: "", created_at: ago(500), updated_at: ago(30) },
  { id: "4", user_id: "u1", ad_account_id: "acc-google", external_campaign_id: "", name: "Ragù recipe, prospecting", objective: "awareness", status: "draft", daily_budget_usd: "30.00", lifetime_budget_usd: null, niche_id: null, last_error: "", created_at: ago(26), updated_at: ago(26) },
  { id: "5", user_id: "u1", ad_account_id: "acc-meta", external_campaign_id: "238100", name: "Holiday gift boxes", objective: "sales", status: "ended", daily_budget_usd: "40.00", lifetime_budget_usd: null, niche_id: null, last_error: "", created_at: ago(2400), updated_at: ago(1900) },
];

export const FX_AD_METRICS: AdMetricsDaily[] = Array.from({ length: 14 }, (_, i) => {
  const n = 13 - i;
  const wave = Math.sin(i / 2) * 0.25 + 1;
  const spend = 18 * wave + (i % 3);
  return {
    date: day(n),
    impressions: Math.round(5200 * wave + i * 140),
    clicks: Math.round(96 * wave + i * 3),
    spend_usd: spend.toFixed(2),
    conversions: (spend / 11.4).toFixed(2),
    revenue_usd: (spend * 2.6).toFixed(2),
  };
});

export const FX_AD_APPROVALS: AdApproval[] = [
  { id: "1", action: "campaign.budget", summary: "Raise daily budget $20 → $35 on ‘Fresh pasta, Spring’", dollar_delta_usd: "15.00", status: "pending", requested_by: "agent", decided_by: "", created_at: ago(1) },
];

export const FX_AD_ACTIONS: AdActionEntry[] = [
  { id: 9, actor: "agent", actor_email: "", action: "approval.requested", platform: "meta_ads", target_type: "ad_campaign", target_id: "1", dollar_delta_usd: "15.00", created_at: ago(1) },
  { id: 8, actor: "user", actor_email: "sam@pastaclub.co", action: "account.governance", platform: "google_ads", target_type: "ad_account", target_id: "acc-google", dollar_delta_usd: "0", created_at: ago(5) },
  { id: 7, actor: "agent", actor_email: "", action: "campaign.paused", platform: "meta_ads", target_type: "ad_campaign", target_id: "2", dollar_delta_usd: "0", created_at: ago(6) },
  { id: 6, actor: "agent", actor_email: "", action: "campaign.budget.denied", platform: "google_ads", target_type: "ad_campaign", target_id: "3", dollar_delta_usd: "20.00", created_at: ago(9) },
  { id: 5, actor: "user", actor_email: "sam@pastaclub.co", action: "approval.approved", platform: "meta_ads", target_type: "ad_approval", target_id: "a4", dollar_delta_usd: "5.00", created_at: ago(30) },
  { id: 4, actor: "agent", actor_email: "", action: "campaign.budget.change", platform: "meta_ads", target_type: "ad_campaign", target_id: "1", dollar_delta_usd: "5.00", created_at: ago(30) },
  { id: 3, actor: "user", actor_email: "sam@pastaclub.co", action: "campaign.create", platform: "google_ads", target_type: "ad_campaign", target_id: "4", dollar_delta_usd: "0", created_at: ago(26) },
];

/* --------------------------------------------------------- distribution */

export const FX_AYRSHARE: AyrshareConnectStatus = { connected: true, profile_key: "prof_8f2a19c03d71" };

export const FX_PLAYBOOKS: PlaybookRef[] = [
  { id: "n1", title: "Pasta at home" },
  { id: "n2", title: "Weeknight sauces" },
];

export const FX_CAMPAIGNS: Campaign[] = [
  { id: "c1", user_id: "u1", name: "Spring launch", objective: "Drive signups for the spring pasta box", status: "running", starts_at: ago(200), ends_at: ahead(24 * 20), budget_usd: "120.00", created_at: ago(220), updated_at: ago(9) },
  { id: "c2", user_id: "u1", name: "Sauce week", objective: "Grow Reels followers with five sauces in five days", status: "draft", starts_at: ago(10), ends_at: null, budget_usd: "40.00", created_at: ago(12), updated_at: ago(12) },
  { id: "c3", user_id: "u1", name: "Holiday gift boxes", objective: "", status: "completed", starts_at: ago(2600), ends_at: ago(1900), budget_usd: "80.00", created_at: ago(2700), updated_at: ago(1900) },
];

export const FX_CAMPAIGN_OVERVIEW: CampaignOverview = {
  campaign: FX_CAMPAIGNS[0]!,
  items: [
    { id: "i1", campaign_id: "c1", user_id: "u1", kind: "video", ref_id: "n1", enabled: true, cadence_per_week: 3, config: {}, created_at: ago(200) },
    { id: "i2", campaign_id: "c1", user_id: "u1", kind: "article", ref_id: "n1", enabled: true, cadence_per_week: 1, config: {}, created_at: ago(200) },
    { id: "i3", campaign_id: "c1", user_id: "u1", kind: "ad", ref_id: "1", enabled: false, cadence_per_week: 3, config: {}, created_at: ago(190) },
  ],
  spent_usd: "46.80",
  videos_total: 9,
  articles_total: 2,
};

export const FX_CALENDAR: CalendarItem[] = [
  { kind: "video", id: "v10", niche_id: "n1", title: "The one salt rule for pasta water", status: "awaiting_approval", platform: "tiktok", at: ahead(3) },
  { kind: "video", id: "v11", niche_id: "n1", title: "Cacio e pepe without clumps", status: "scheduling", platform: "reels", at: ahead(22) },
  { kind: "article", id: "a2", niche_id: "n1", title: "How to dry fresh pasta for later", status: "writing", platform: null, at: ahead(30) },
  { kind: "video", id: "v12", niche_id: "n2", title: "Brown butter sage in 4 minutes", status: "queued", platform: "shorts", at: ahead(50) },
  { kind: "video", id: "v13", niche_id: "n1", title: "Why you should never rinse pasta", status: "queued", platform: "tiktok", at: ahead(74) },
];

/* ---------------------------------------------------------------- brand */

export const FX_BRAND_KIT: BrandKit = {
  brand_name: "Pasta Club",
  tagline: "Fresh pasta, made at home, any night of the week.",
  tone_of_voice: "Warm, practical and a little cheeky. Short sentences. Talk like a friend who cooks, not a chef who lectures.",
  target_audience: "Home cooks in their 20s and 30s who want a weeknight win",
  banned_words: ["authentic", "elevate", "game-changer"],
  preferred_hashtags: ["#freshpasta", "#pastanight", "#homecooking"],
  color_hex: "#d9542b",
  updated_at: ago(30),
  created_at: ago(900),
};

export const FX_KITS: Kit[] = [
  { id: "k1", user_id: "u1", kind: "design", name: "Kitchen close-ups", description: "Hands, steam and texture first", content: "Open on hands in motion, never a static establishing shot.\nCut on action. One slow push-in per video.", rules: {}, is_default: true, created_at: ago(400), updated_at: ago(40) },
  { id: "k2", user_id: "u1", kind: "design", name: "Overhead flat-lay", description: "Top-down recipes for carousels", content: "Shoot top-down on the wooden board. Keep props to three.", rules: {}, is_default: false, created_at: ago(300), updated_at: ago(300) },
  { id: "k3", user_id: "u1", kind: "writing", name: "Friendly cook", description: "Article voice", content: "Short declarative sentences. Never use ‘delve’ or ‘unlock’.", rules: {}, is_default: true, created_at: ago(500), updated_at: ago(80) },
  { id: "k4", user_id: "u1", kind: "ad", name: "Scale slowly", description: "Conservative scaling for small budgets", content: "Never scale a campaign twice in 48h.", rules: { target_roas: 2.5, scale_up_pct: 15, max_daily_budget_usd: 60 }, is_default: true, created_at: ago(200), updated_at: ago(20) },
];

/* --------------------------------------------------------- integrations */

export const FX_TOKENS: PersonalAccessToken[] = [
  { id: "t1", user_id: "u1", name: "claude-desktop", prefix: "mkt_7Hq2", last_used_at: ago(0.3), created_at: ago(400), expires_at: null },
  { id: "t2", user_id: "u1", name: "ci-weekly-report", prefix: "mkt_Pz91", last_used_at: ago(70), created_at: ago(900), expires_at: ahead(24 * 60) },
];

export const FX_WEBHOOKS: WebhookEndpoint[] = [
  { id: "w1", user_id: "u1", url: "https://hooks.pastaclub.co/marketer", events: [], enabled: true, description: "Slack relay", last_status: 200, last_delivery_at: ago(2), created_at: ago(500), secret: null },
  { id: "w2", user_id: "u1", url: "https://n8n.pastaclub.co/webhook/approvals", events: ["job.awaiting_approval"], enabled: false, description: "", last_status: 502, last_delivery_at: ago(48), created_at: ago(300), secret: null },
];

export const FX_X402: X402Config = { enabled: true, network: "base", asset: "USDC", pay_to: "0x8a3f…41c2", min_usd: "1.00", max_usd: "500.00" };

/* ------------------------------------------------------------- settings */

export const FX_USER: User = {
  id: "u1",
  email: "sam@pastaclub.co",
  ayrshare_profile_key: "prof_8f2a19c03d71",
  global_daily_cap_usd: "25.00",
  email_notifications: true,
  created_at: ago(2000),
};

export const FX_BILLING: BillingBalance = {
  balance_usd: "18.42",
  billing_enabled: true,
  margin: 1.3,
  transactions: [
    { id: "tx1", user_id: "u1", amount_usd: "-0.84", kind: "debit", reference: "job:v3", description: "Video · Ragù in 40 minutes", created_at: ago(1) },
    { id: "tx2", user_id: "u1", amount_usd: "-0.31", kind: "debit", reference: "article:a1", description: "Article · The complete guide to fresh pasta", created_at: ago(3) },
    { id: "tx3", user_id: "u1", amount_usd: "20.00", kind: "purchase", reference: "cs_1", description: "Creator pack", created_at: ago(50) },
    { id: "tx4", user_id: "u1", amount_usd: "2.00", kind: "grant", reference: null, description: "Welcome credit", created_at: ago(900) },
  ],
};
