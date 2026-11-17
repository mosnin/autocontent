import { AdminOverviewView } from "@/components/app/admin/overview-view";
import { fetchAdminOverview } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  return <AdminOverviewView overview={await fetchAdminOverview()} />;
}
