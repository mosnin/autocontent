import { AdminUnavailable } from "@/components/app/admin/admin-unavailable";
import { fetchAdminHealth } from "@/lib/admin-server";
import { api } from "@/lib/api";
import { type ConfigHealthReport, HealthClient, type OpsSnapshot } from "./HealthClient";

export const dynamic = "force-dynamic";

// The ops endpoints are mounted separately; fetch defensively so a missing
// router degrades to the client poll instead of a 500 page.
async function safeApi<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch {
    return null;
  }
}

export default async function AdminHealthPage() {
  const [initial, initialOps, initialConfigHealth] = await Promise.all([fetchAdminHealth().catch(() => null), safeApi<OpsSnapshot>("/api/v1/ops/metrics"), safeApi<ConfigHealthReport>("/api/v1/ops/config-health")]);
  if (!initial) return <AdminUnavailable title="Health" what="system health" />;
  return <HealthClient initial={initial} initialOps={initialOps} initialConfigHealth={initialConfigHealth} />;
}
