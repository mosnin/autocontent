// Typed client for the admin API (/api/v1/admin). Every route is
// admin-gated and audited server-side; non-admins get HTTP 403.
//
// Two layers live here:
//   • Server fetchers (fetchAdmin*) — call the backend directly through
//     the `api` helper (attaches the Clerk JWT server-side). Used by RSC
//     pages/layout for initial data. `api` throws `Error("<status> …")`,
//     so callers detect 403 with isForbidden(err).
//   • Client helpers (adminGet / admin* mutations) — run in the browser
//     and route through the Next proxy (/api/proxy/…) which attaches the
//     JWT. SWR keys are the plain "/api/v1/admin/…" paths; clientFetch
//     prefixes /api/proxy automatically.
//
// This module is client-safe: it imports NO server-only code. Server
// fetchers (which pull in Clerk server auth) live in admin-server.ts and
// must only be imported from RSC.

import { clientFetch } from "@/lib/client-fetcher";
import type {
  AdminUserRow,
  AuditQuery,
  CreditGrantResult,
  FeatureFlag,
  FlagUpsertBody,
  UsersQuery,
} from "@/lib/admin-types";

const ADMIN = "/api/v1/admin";

// --- SWR key builders (client polling) ----------------------------------
// Pass these straight to useSWR(key, clientFetch). They are pure strings,
// safe on both server and client.

export const adminKeys = {
  overview: () => `${ADMIN}/overview`,
  users: (q: UsersQuery = {}) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.limit != null) p.set("limit", String(q.limit));
    if (q.offset != null) p.set("offset", String(q.offset));
    const qs = p.toString();
    return `${ADMIN}/users${qs ? `?${qs}` : ""}`;
  },
  user: (id: string) => `${ADMIN}/users/${id}`,
  audit: (q: AuditQuery = {}) => {
    const p = new URLSearchParams();
    if (q.actor_id) p.set("actor_id", q.actor_id);
    if (q.target_type) p.set("target_type", q.target_type);
    if (q.target_id) p.set("target_id", q.target_id);
    if (q.action) p.set("action", q.action);
    if (q.before_id != null) p.set("before_id", String(q.before_id));
    if (q.limit != null) p.set("limit", String(q.limit));
    const qs = p.toString();
    return `${ADMIN}/audit-log${qs ? `?${qs}` : ""}`;
  },
  flags: () => `${ADMIN}/flags`,
  health: () => `${ADMIN}/health`,
};

// --- Client helpers (browser, through the proxy) ------------------------

/** Client-side GET through the proxy. Handy for one-off reads. */
export function adminGet<T>(path: string): Promise<T> {
  return clientFetch<T>(path);
}

async function adminWrite<T>(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
): Promise<T> {
  const url = `/api/proxy${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

function adminPost<T>(path: string, body: unknown): Promise<T> {
  return adminWrite<T>("POST", path, body);
}

export function adminSetSuspension(
  id: string,
  suspended: boolean,
  reason: string,
): Promise<AdminUserRow> {
  return adminPost<AdminUserRow>(`${ADMIN}/users/${id}/suspension`, {
    suspended,
    reason,
  });
}

export function adminSetRole(
  id: string,
  role: "user" | "admin",
): Promise<AdminUserRow> {
  return adminPost<AdminUserRow>(`${ADMIN}/users/${id}/role`, { role });
}

export function adminGrantCredits(
  id: string,
  amountUsd: number,
  note: string,
): Promise<CreditGrantResult> {
  return adminPost<CreditGrantResult>(`${ADMIN}/users/${id}/credits`, {
    amount_usd: amountUsd,
    note,
  });
}

/**
 * Upsert a feature flag through the proxy. Creating a new key and toggling
 * an existing one are the same PUT — the backend upserts by key and audits
 * the change.
 */
export function adminUpsertFlag(
  key: string,
  body: FlagUpsertBody,
): Promise<FeatureFlag> {
  return adminWrite<FeatureFlag>(
    "PUT",
    `${ADMIN}/flags/${encodeURIComponent(key)}`,
    body,
  );
}
