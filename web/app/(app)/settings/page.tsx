import type { ObservabilitySettings } from "@/components/app/settings/observability";
import { SettingsView } from "@/components/app/settings/settings-view";
import { getAuthContext } from "@/lib/auth/session";
import { loadAuthSettings } from "@/lib/auth/settings-data";
import type { BillingBalance, User } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Settings · Marketer" };

export default async function SettingsPage() {
  const ctx = await getAuthContext();
  const [user, billing, auth, observability] = await Promise.all([
    safe<User>("/api/v1/users/me"),
    safe<BillingBalance>("/api/v1/billing/balance"),
    ctx?.membership ? loadAuthSettings({ ...ctx, membership: ctx.membership }).catch(() => null) : Promise.resolve(null),
    safe<ObservabilitySettings>("/api/v1/observability/settings"),
  ]);
  return <SettingsView user={user} billing={billing} auth={auth} observability={observability} />;
}
