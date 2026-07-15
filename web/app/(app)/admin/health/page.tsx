import { fetchAdminHealth } from "@/lib/admin-server";
import { HealthClient } from "./HealthClient";

export const dynamic = "force-dynamic";

export default async function AdminHealthPage() {
  const initial = await fetchAdminHealth();
  return <HealthClient initial={initial} />;
}
