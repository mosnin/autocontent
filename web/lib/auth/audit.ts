// Rows for public.security_audit_log (created by db/migrations/0031_rbac.sql;
// append-only). auditRow() is pure and tested; writeAudit() inserts one row
// and never throws, because a sign-in must not fail on a logging problem.

import type { Pool } from "pg";

export type ActorType = "user" | "agent" | "token" | "platform_admin" | "system";
export type Outcome = "success" | "denied" | "failure";

export interface AuditEvent {
  action: string;
  outcome: Outcome;
  actorType?: ActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  orgId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Keys that never reach the log, at any depth. */
const SECRET_KEY = /pass(word)?|secret|token|code|otp|key|cookie|authorization|hash|credential|backup/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY.test(k)) out[k] = scrub(v, depth + 1);
    return out;
  }
  if (typeof value === "string") return value.slice(0, 512);
  return value;
}

export interface AuditRow {
  org_id: string | null;
  actor_id: string | null;
  actor_email: string;
  actor_type: ActorType;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: Outcome;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
}

export function auditRow(e: AuditEvent): AuditRow {
  if (!/^[a-z_]+(\.[a-z_]+)+$/.test(e.action)) throw new Error(`audit action must be dotted: ${e.action}`);
  return {
    org_id: e.orgId || null,
    actor_id: e.actorId || null,
    actor_email: (e.actorEmail ?? "").slice(0, 320),
    actor_type: e.actorType ?? "user",
    action: e.action,
    target_type: e.targetType || null,
    target_id: e.targetId || null,
    outcome: e.outcome,
    ip: e.ip ? e.ip.slice(0, 64) : null,
    user_agent: e.userAgent ? e.userAgent.slice(0, 512) : null,
    metadata: (scrub(e.metadata ?? {}) as Record<string, unknown>) ?? {},
  };
}

/** The client address from the proxy headers (first hop of x-forwarded-for). */
export function clientIp(headers: Headers | null | undefined): string | null {
  const vercel = headers?.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim() || null;
  const xff = headers?.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return headers?.get("x-real-ip")?.trim() || null;
}

export async function writeAudit(pool: Pool, e: AuditEvent): Promise<void> {
  try {
    const r = auditRow(e);
    // tenant_id comes from the workspace itself, so callers can't get it wrong.
    await pool.query(
      `insert into public.security_audit_log (org_id, tenant_id, actor_id, actor_email, actor_type, action, target_type, target_id, outcome, ip, user_agent, metadata)
       values ($1, (select "tenantId" from auth.organization where id = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [r.org_id, r.actor_id, r.actor_email, r.actor_type, r.action, r.target_type, r.target_id, r.outcome, r.ip, r.user_agent, JSON.stringify(r.metadata)],
    );
  } catch (err) {
    // The action itself already happened; record that the record failed, without the event's details.
    console.error(`[audit] could not write ${e.action}: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}`);
  }
}
