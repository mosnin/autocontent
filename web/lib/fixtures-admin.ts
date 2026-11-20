// Fixture data for the admin console preview (/preview/app/admin/*). Not used by the product.
import type { ConfigHealthReport, OpsSnapshot } from "@/app/(app)/admin/health/HealthClient";
import type { Template } from "@/app/(app)/admin/templates/AdminTemplatesClient";
import type { AdminOverview, AdminUserRow, AuditEntry, FeatureFlag, SystemHealth } from "@/lib/admin-types";

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

export const FX_ADMIN_OVERVIEW: AdminOverview = {
  total_users: 1284,
  admin_users: 3,
  suspended_users: 2,
  new_users_7d: 46,
  total_niches: 2210,
  total_jobs: 18342,
  jobs_24h: 412,
  failed_jobs_24h: 19,
  total_articles: 5120,
  articles_24h: 88,
  spend_today_usd: "214.80",
  spend_30d_usd: "6420.15",
  credit_liability_usd: "9310.00",
};

const user = (id: string, email: string, hours: number, extra: Partial<AdminUserRow["user"]> = {}) => ({
  id,
  email,
  role: "user" as const,
  suspended_at: null,
  suspended_reason: null,
  global_daily_cap_usd: null,
  credit_balance_usd: "12.40",
  created_at: ago(hours),
  ...extra,
});

export const FX_ADMIN_USERS: AdminUserRow[] = [
  { user: user("u1", "sam@pastaclub.co", 2, { role: "admin", global_daily_cap_usd: "25.00", credit_balance_usd: "18.42" }), niche_count: 4, job_count: 312, article_count: 48, spend_total_usd: "412.30" },
  { user: user("u2", "maya@northwind.studio", 30), niche_count: 2, job_count: 120, article_count: 12, spend_total_usd: "96.10" },
  { user: user("u3", "ops@brightlane.io", 80, { suspended_at: ago(20), suspended_reason: "Chargeback, pending review" }), niche_count: 1, job_count: 41, article_count: 0, spend_total_usd: "38.75" },
  { user: user("u4", "leo@ferment.club", 140), niche_count: 3, job_count: 260, article_count: 33, spend_total_usd: "301.00" },
  { user: user("u5", "hello@tinyatlas.app", 300), niche_count: 1, job_count: 8, article_count: 2, spend_total_usd: "4.20" },
  { user: user("u6", "growth@loomandline.com", 700), niche_count: 6, job_count: 940, article_count: 120, spend_total_usd: "1288.90" },
];

export const FX_ADMIN_AUDIT: AuditEntry[] = [
  { id: 41, actor_id: "u1", actor_email: "sam@pastaclub.co", action: "user.suspend", target_type: "user", target_id: "u3", ip: "81.2.69.160", user_agent: "Mozilla/5.0 (Macintosh)", metadata: { reason: "Chargeback, pending review" }, created_at: ago(20) },
  { id: 40, actor_id: "u1", actor_email: "sam@pastaclub.co", action: "user.credits_grant", target_type: "user", target_id: "u2", ip: "81.2.69.160", user_agent: null, metadata: { amount_usd: 25, note: "Goodwill, ticket #987" }, created_at: ago(26) },
  { id: 39, actor_id: "u1", actor_email: "sam@pastaclub.co", action: "flag.update", target_type: "flag", target_id: "new_editor", ip: "81.2.69.160", user_agent: null, metadata: { enabled: true }, created_at: ago(50) },
  { id: 38, actor_id: "u6", actor_email: "growth@loomandline.com", action: "user.role_change", target_type: "user", target_id: "u4", ip: null, user_agent: null, metadata: null, created_at: ago(120) },
  { id: 37, actor_id: "u1", actor_email: "sam@pastaclub.co", action: "user.unsuspend", target_type: "user", target_id: "u5", ip: "81.2.69.160", user_agent: null, metadata: null, created_at: ago(200) },
];

export const FX_ADMIN_FLAGS: FeatureFlag[] = [
  { key: "new_editor", enabled: true, description: "The rebuilt article editor", updated_by: "sam@pastaclub.co", updated_at: ago(50), created_at: ago(900) },
  { key: "x402_payments", enabled: false, description: "Agents top up credit over HTTP 402", updated_by: null, updated_at: ago(400), created_at: ago(400) },
  { key: "meta_ads.scaling", enabled: true, description: "Let the Media buyer propose budget increases on Meta", updated_by: "sam@pastaclub.co", updated_at: ago(8), created_at: ago(300) },
];

export const FX_ADMIN_HEALTH: SystemHealth = { db_ok: true, stuck_jobs: 1, failed_jobs_24h: 19 };

export const FX_ADMIN_OPS: OpsSnapshot = {
  generated_at: ago(0),
  db_ok: true,
  thresholds: { error_rate_warn: 0.1, stuck_after_minutes: 45 },
  spend_1h: { window_minutes: 60, total_usd: "8.9200", by_provider: [{ provider: "fal", cost_usd: "6.1000", units: "38" }, { provider: "openai", cost_usd: "2.8200", units: "412000" }] },
  spend_24h: { window_minutes: 1440, total_usd: "214.8000", by_provider: [{ provider: "fal", cost_usd: "151.2000", units: "902" }, { provider: "openai", cost_usd: "48.6000", units: "8120000" }, { provider: "elevenlabs", cost_usd: "15.0000", units: "210" }] },
  provider_error_rates: [
    { provider: "fal", total: 902, failed: 31, error_rate: 0.034, warn: false },
    { provider: "elevenlabs", total: 210, failed: 26, error_rate: 0.124, warn: true },
    { provider: "openai", total: 1240, failed: 4, error_rate: 0.003, warn: false },
  ],
  error_window_minutes: 1440,
  stuck: { stuck_after_minutes: 45, jobs_stuck: 1, jobs_oldest_stuck_seconds: 5400, image_posts_stuck: 0, image_posts_oldest_stuck_seconds: null, jobs_awaiting_approval: 6, image_posts_awaiting_approval: 2 },
  top_skus: [
    { provider: "fal", sku: "kling-v2.1-720p", cost_usd: "98.4000", units: "410" },
    { provider: "openai", sku: "gpt-image-1.medium", cost_usd: "31.2000", units: "780" },
    { provider: "elevenlabs", sku: "tts.multilingual-v2", cost_usd: "15.0000", units: "210" },
  ],
  any_provider_warn: true,
  any_stuck: true,
};

export const FX_ADMIN_CONFIG: ConfigHealthReport = {
  available: true,
  overall_status: "warn",
  checks: [
    { capability: "video.render", status: "ok", message: "fal key present", details: {} },
    { capability: "social.publish", status: "ok", message: "Ayrshare configured", details: {} },
    { capability: "ads.meta", status: "warn", message: "Composio Meta auth config missing", details: {} },
  ],
};

export const FX_ADMIN_TEMPLATES: Template[] = [
  { id: "t1", kind: "image", name: "Glossy studio product shot", description: "Clean seamless background, soft key light", prompt: "…", reference_key: "", is_published: true, created_at: ago(300) },
  { id: "t2", kind: "carousel", name: "Recipe flat-lay", description: "Top-down steps on a wooden board", prompt: "…", reference_key: "", is_published: false, created_at: ago(90) },
  { id: "t3", kind: "video", name: "Handheld kitchen b-roll", description: "", prompt: "…", reference_key: "", is_published: true, created_at: ago(40) },
];
