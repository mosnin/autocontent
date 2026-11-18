import { AdminUnavailable } from "@/components/app/admin/admin-unavailable";
import { fetchAdminFlags } from "@/lib/admin-server";
import { FlagsClient } from "./FlagsClient";

export const dynamic = "force-dynamic";

export default async function AdminFlagsPage() {
  const initial = await fetchAdminFlags().catch(() => null);
  if (!initial) return <AdminUnavailable title="Flags" what="feature flags" />;
  return <FlagsClient initial={initial} />;
}
