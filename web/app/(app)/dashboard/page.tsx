import { api } from "@/lib/api";
import type { Niche, TodaySpend, User } from "@/lib/types";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

// Best-effort: probe the optional ayrshare-status endpoint another agent
// may be adding. If the route 404s, we treat it as "feature absent" and
// skip the banner entirely (return null).
async function fetchAyrshareConnected(): Promise<boolean | null> {
  try {
    const res = await api<{ connected: boolean }>("/api/v1/connect/ayrshare/status");
    return Boolean(res?.connected);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) return null;
    return null;
  }
}

async function fetchUser(): Promise<User | null> {
  try {
    return await api<User>("/api/v1/users/me");
  } catch {
    return null;
  }
}

export default async function Dashboard() {
  const [niches, spend, ayrshareConnected, user] = await Promise.all([
    api<Niche[]>("/api/v1/niches"),
    api<TodaySpend>("/api/v1/spend/today"),
    fetchAyrshareConnected(),
    fetchUser(),
  ]);

  return (
    <DashboardClient
      initial={{ niches, spend, ayrshareConnected, globalCap: user?.global_daily_cap_usd ?? null }}
    />
  );
}
