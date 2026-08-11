import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { SettingsShell } from "./SettingsShell";

export const dynamic = "force-dynamic";

// Index page for the settings sub-tree. Contains a Spend Caps section
// plus nav cards for Connect and Tokens.
export default async function SettingsPage() {
  // Best-effort: if the user fetch fails we still render the page.
  let user: User | null = null;
  try {
    user = await api<User>("/api/v1/users/me");
  } catch {
    // ignore — form renders with empty default
  }

  return (
    <SettingsShell
      initialCap={user?.global_daily_cap_usd ?? null}
      initialNotifications={user?.email_notifications ?? true}
    />
  );
}
