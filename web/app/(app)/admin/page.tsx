import { AdminUnavailable } from "@/components/app/admin/admin-unavailable";
import { AdminOverviewView } from "@/components/app/admin/overview-view";
import { fetchAdminOverview } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const overview = await fetchAdminOverview().catch(() => null);
  if (!overview) return <AdminUnavailable what="the overview" />;
  return <AdminOverviewView overview={overview} />;
}
