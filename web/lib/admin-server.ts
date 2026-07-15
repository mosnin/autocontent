// Server-only admin fetchers (RSC initial data). Imports the `api` helper
// which pulls in @clerk/nextjs/server, so this module must NEVER be
// imported from a "use client" component — keep it out of the client
// bundle. Client code uses admin-api.ts (proxy-based) instead.
import "server-only";

import { cache } from "react";

import { api } from "@/lib/api";
import { adminKeys } from "@/lib/admin-api";
import type {
  AdminOverview,
  AdminUserRow,
  AuditEntry,
  AuditQuery,
  FeatureFlag,
  SystemHealth,
  UsersQuery,
} from "@/lib/admin-types";

// Deduped per request: the /admin layout guard and the overview page both
// call this within a single render, and React.cache collapses them into one
// backend round-trip.
export const fetchAdminOverview = cache(
  (): Promise<AdminOverview> => api<AdminOverview>(adminKeys.overview()),
);

export function fetchAdminUsers(q: UsersQuery = {}): Promise<AdminUserRow[]> {
  return api<AdminUserRow[]>(adminKeys.users(q));
}

export function fetchAdminUser(id: string): Promise<AdminUserRow> {
  return api<AdminUserRow>(adminKeys.user(id));
}

export function fetchAdminAudit(q: AuditQuery = {}): Promise<AuditEntry[]> {
  return api<AuditEntry[]>(adminKeys.audit(q));
}

export function fetchAdminFlags(): Promise<FeatureFlag[]> {
  return api<FeatureFlag[]>(adminKeys.flags());
}

export function fetchAdminHealth(): Promise<SystemHealth> {
  return api<SystemHealth>(adminKeys.health());
}

/** True when an error thrown by `api` (server) represents an HTTP 403. */
export function isForbidden(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.startsWith("403");
}
