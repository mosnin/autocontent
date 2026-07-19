import { api } from "@/lib/api";
import { fetchAdminHealth } from "@/lib/admin-server";
import { HealthClient } from "./HealthClient";
import { OpsClient, type OpsSnapshot } from "./OpsClient";

export const dynamic = "force-dynamic";

interface ConfigHealthReport {
  available: boolean;
  overall_status?: "ok" | "warn" | "error";
  checks?: Array<{
    capability: string;
    status: "ok" | "warn" | "error";
    message: string;
    details: Record<string, unknown>;
  }>;
}

// The ops endpoints are new (Cycle-2 Team 4) and mounted by the orchestrator
// separately from this file. Fetch defensively so a not-yet-wired router
// degrades to "loading via client poll" instead of a 500 page — the
// OpsClient panel re-fetches client-side regardless.
async function fetchOpsMetricsSafe(): Promise<OpsSnapshot | null> {
  try {
    return await api<OpsSnapshot>("/api/v1/ops/metrics");
  } catch {
    return null;
  }
}

async function fetchOpsConfigHealthSafe(): Promise<ConfigHealthReport | null> {
  try {
    return await api<ConfigHealthReport>("/api/v1/ops/config-health");
  } catch {
    return null;
  }
}

export default async function AdminHealthPage() {
  const [initial, initialOps, initialConfigHealth] = await Promise.all([
    fetchAdminHealth(),
    fetchOpsMetricsSafe(),
    fetchOpsConfigHealthSafe(),
  ]);
  return (
    <div className="space-y-8">
      <HealthClient initial={initial} />
      <OpsClient initial={initialOps} initialConfigHealth={initialConfigHealth} />
    </div>
  );
}
