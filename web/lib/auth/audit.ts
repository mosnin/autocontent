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

type Env = Record<string, string | undefined>;

/**
 * Which headers carry the client address, and which proxies may have appended
 * to them. One policy for the audit log and Better Auth's rate limits
 * (config.ts passes the same values to advanced.ipAddress):
 *
 * - AUTH_IP_HEADER (+ AUTH_TRUSTED_PROXIES, comma-separated IPs or IPv4 CIDRs):
 *   self-hosted behind a known proxy. With trusted proxies, the address is the
 *   rightmost hop that is not one of them.
 * - On Vercel: x-vercel-forwarded-for, then x-real-ip. The platform sets both
 *   and overwrites anything the client sent. x-forwarded-for is not read.
 * - Elsewhere in production with nothing configured: no header is trusted, so
 *   there is no address (rate limits fall back to one shared bucket: stricter,
 *   never bypassable).
 * - Development: x-forwarded-for, single value only.
 *
 * A header with several hops and no trusted proxies is ignored: its first hop
 * is whatever the client wrote.
 */
export function ipPolicy(env: Env = process.env): { headers: string[]; trustedProxies: string[] } {
  const trustedProxies = (env.AUTH_TRUSTED_PROXIES ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(s));
  const configured = env.AUTH_IP_HEADER?.trim().toLowerCase();
  if (configured && /^[a-z0-9-]+$/.test(configured)) return { headers: [configured], trustedProxies };
  if (env.VERCEL) return { headers: ["x-vercel-forwarded-for", "x-real-ip"], trustedProxies };
  if (env.NODE_ENV === "production") return { headers: [], trustedProxies };
  return { headers: ["x-forwarded-for"], trustedProxies };
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function isTrusted(ip: string, proxies: string[]): boolean {
  return proxies.some((p) => {
    const [base, bits] = p.split("/");
    if (bits === undefined) return base!.toLowerCase() === ip.toLowerCase();
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(base!);
    const n = Number(bits);
    if (a === null || b === null || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

const looksLikeIp = (s: string) => ipv4ToInt(s) !== null || (/^[0-9a-fA-F:]+$/.test(s) && s.includes(":"));

/** The client address under ipPolicy(env), or null when no header can be trusted. */
export function clientIp(headers: Headers | null | undefined, env: Env = process.env): string | null {
  if (!headers) return null;
  const { headers: names, trustedProxies } = ipPolicy(env);
  for (const name of names) {
    const raw = headers.get(name);
    if (!raw) continue;
    const hops = raw.split(",").map((h) => h.trim()).filter(Boolean);
    if (trustedProxies.length) {
      for (let i = hops.length - 1; i >= 0; i--) {
        if (!looksLikeIp(hops[i]!)) break;
        if (!isTrusted(hops[i]!, trustedProxies)) return hops[i]!;
      }
      continue;
    }
    if (hops.length === 1 && looksLikeIp(hops[0]!)) return hops[0]!;
  }
  return null;
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
