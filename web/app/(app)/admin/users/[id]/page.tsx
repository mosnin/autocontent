import { notFound } from "next/navigation";

import { fetchAdminAudit, fetchAdminUser } from "@/lib/admin-server";
import type { AuditEntry } from "@/lib/admin-types";
import { UserDetailClient } from "./UserDetailClient";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let user;
  try {
    user = await fetchAdminUser(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("404")) notFound();
    throw err;
  }

  let audit: AuditEntry[] = [];
  try {
    audit = await fetchAdminAudit({
      target_type: "user",
      target_id: id,
      limit: 20,
    });
  } catch {
    audit = [];
  }

  return <UserDetailClient initialUser={user} initialAudit={audit} />;
}
