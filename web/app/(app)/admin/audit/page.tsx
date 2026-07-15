import { fetchAdminAudit } from "@/lib/admin-server";
import type { AuditQuery } from "@/lib/admin-types";
import { AuditClient, AUDIT_PAGE_SIZE } from "./AuditClient";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) || undefined;

  const initialFilters: AuditQuery = {
    actor_id: one(sp.actor_id),
    action: one(sp.action),
    target_type: one(sp.target_type),
    target_id: one(sp.target_id),
  };

  const initial = await fetchAdminAudit({
    ...initialFilters,
    limit: AUDIT_PAGE_SIZE,
  });

  return <AuditClient initial={initial} initialFilters={initialFilters} />;
}
