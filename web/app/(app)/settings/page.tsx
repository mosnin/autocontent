import { SettingsView } from "@/components/mk/settings/settings-view";
import type { BillingBalance, User } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Settings · Marketer" };

export default async function SettingsPage() {
  const [user, billing] = await Promise.all([safe<User>("/api/v1/users/me"), safe<BillingBalance>("/api/v1/billing/balance")]);
  return <SettingsView user={user} billing={billing} />;
}
