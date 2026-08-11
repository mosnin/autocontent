// TypeScript mirrors of the admin API payloads served under
// /api/v1/admin. Every route requires an admin role and is audited
// server-side; a non-admin caller receives HTTP 403 from all of them.
//
// Keep these in sync with the backend admin schemas.

export type UserRole = "user" | "admin";

/** Platform-wide rollup for the admin overview dashboard. */
export interface AdminOverview {
  total_users: number;
  admin_users: number;
  suspended_users: number;
  new_users_7d: number;
  total_niches: number;
  total_jobs: number;
  jobs_24h: number;
  failed_jobs_24h: number;
  total_articles: number;
  articles_24h: number;
  /** Decimal serialized as string by the backend, e.g. "12.34". */
  spend_today_usd: string;
  spend_30d_usd: string;
  credit_liability_usd: string;
}

/** The user record embedded in every AdminUserRow. */
export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  /** ISO timestamp when the account was suspended, else null. */
  suspended_at: string | null;
  suspended_reason: string | null;
  /** Per-user daily spend cap in USD (string decimal), or null for none. */
  global_daily_cap_usd: string | null;
  /** Prepaid credit balance in USD (string decimal). */
  credit_balance_usd: string;
  created_at: string;
}

/** A user plus the usage rollups the admin table surfaces. */
export interface AdminUserRow {
  user: AdminUser;
  niche_count: number;
  job_count: number;
  article_count: number;
  /** Lifetime spend in USD (string decimal). */
  spend_total_usd: string;
}

/** A single append-only audit-trail entry. */
export interface AuditEntry {
  id: number;
  actor_id: string;
  actor_email: string;
  /** Dotted action key, e.g. "user.suspend". */
  action: string;
  target_type: string;
  target_id: string;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Result of granting/deducting credits. */
export interface CreditGrantResult {
  user_id: string;
  new_balance_usd: string;
}

/** A single feature flag. Every change is audited server-side. */
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  /** Admin who last wrote the flag, or null if never touched by an admin. */
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

/** Snapshot of backend/worker health for the admin health panel. */
export interface SystemHealth {
  /** Whether the primary database responded to a probe. */
  db_ok: boolean;
  /** Jobs wedged past their expected runtime, or null if unavailable. */
  stuck_jobs: number | null;
  /** Jobs that failed in the last 24h, or null if unavailable. */
  failed_jobs_24h: number | null;
}

// --- Request bodies -----------------------------------------------------

export interface SuspensionBody {
  suspended: boolean;
  reason: string;
}

export interface RoleBody {
  role: UserRole;
}

export interface CreditsBody {
  amount_usd: number;
  note: string;
}

/** Upsert body for PUT /admin/flags/{key}. */
export interface FlagUpsertBody {
  enabled: boolean;
  description: string;
}

// --- Query params -------------------------------------------------------

export interface UsersQuery {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQuery {
  actor_id?: string;
  target_type?: string;
  target_id?: string;
  action?: string;
  /** Keyset cursor: return entries with id < before_id. */
  before_id?: number;
  limit?: number;
}
