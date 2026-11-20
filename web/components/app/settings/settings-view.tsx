"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SecuritySettings, PasskeysSection, PasswordSection, SessionsSection, TwoFactorSection } from "@/components/auth/security-settings";
import { TeamSettings } from "@/components/auth/team-settings";
import { WorkspaceSecurity } from "@/components/auth/workspace-security";
import { Callout, Column, PageHeader, Segmented, useAllowed } from "@/design-system";
import type { AuthSettingsData } from "@/lib/auth/settings-data";
import type { SessionSummary } from "@/lib/auth/actions";
import type { BillingBalance, User } from "@/lib/types";
import { ObservabilitySection, type ObservabilitySettings } from "./observability";
import { AppearanceSection, BillingSection, PrivacySection, ProfileSection, SpendCapSection } from "./sections";

export type SettingsTab = "general" | "security" | "team" | "workspace" | "spend" | "billing" | "privacy";
const ALL_TABS: { value: SettingsTab; label: string; needs?: string }[] = [
  { value: "general", label: "General" },
  { value: "security", label: "Security" },
  { value: "team", label: "Team", needs: "member:read" },
  { value: "workspace", label: "Workspace", needs: "security:read" },
  { value: "spend", label: "Spend", needs: "spend:read" },
  { value: "billing", label: "Billing", needs: "billing:read" },
  { value: "privacy", label: "Privacy" },
];

/** Settings (ref 07, column md): one segmented control, one tab of sections at a time. */
export function SettingsView({
  user,
  billing,
  auth,
  observability = null,
  initialTab = "general",
  previewSessions,
}: {
  user: User | null;
  billing: BillingBalance | null;
  auth: AuthSettingsData | null;
  /** The workspace's observability content setting; null when it couldn't be read. */
  observability?: ObservabilitySettings | null;
  initialTab?: SettingsTab;
  /** Fixture previews only: sessions to show instead of asking the server. */
  previewSessions?: SessionSummary[];
}) {
  const allowed = {
    "member:read": useAllowed("member:read"),
    "security:read": useAllowed("security:read"),
    "spend:read": useAllowed("spend:read"),
    "billing:read": useAllowed("billing:read"),
  } as Record<string, boolean>;
  const tabs = ALL_TABS.filter((t) => !t.needs || allowed[t.needs]);
  const isTab = (v: string): v is SettingsTab => tabs.some((t) => t.value === v);
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // Deep links (#billing, #security, Stripe's ?purchase= return) pick the tab.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (new URLSearchParams(window.location.search).has("purchase")) setTab("billing");
    else if (isTab(hash)) setTab(hash);
    // The account menu links to #security while Settings may already be open.
    const onHash = () => {
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (t: SettingsTab) => {
    setTab(t);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${t}`);
  };
  const preview = previewSessions !== undefined;

  return (
    <>
      <PageHeader icon={<Settings />} title="Settings" />
      <Column
        title="Settings"
        description={
          <>
            Your account and workspace. Voice lives on <Link href="/brand" className="text-fg hover:underline">Brand</Link>, tokens on <Link href="/integrations" className="text-fg hover:underline">Integrations</Link>.
          </>
        }
        control={<Segmented label="Settings sections" value={isTab(tab) ? tab : "general"} onChange={pick} options={tabs} />}
      >
        {user === null && <Callout tone="attention">Couldn&apos;t load your profile, so some values below may be defaults.</Callout>}
        {tab === "general" && (
          <>
            <ProfileSection email={user?.email ?? null} initialNotifications={user?.email_notifications ?? true} />
            <AppearanceSection />
          </>
        )}
        {tab === "security" &&
          (auth ? (
            preview ? (
              <>
                {auth.hasPassword && <PasswordSection />}
                <TwoFactorSection enabled={auth.twoFactorEnabled} />
                <PasskeysSection initial={[]} />
                <SessionsSection initial={previewSessions} />
              </>
            ) : (
              <SecuritySettings twoFactorEnabled={auth.twoFactorEnabled} hasPassword={auth.hasPassword} />
            )
          ) : (
            <Callout tone="attention">Couldn&apos;t load your security settings. Refresh in a moment.</Callout>
          ))}
        {tab === "security" && <ObservabilitySection initial={observability} preview={preview} />}
        {tab === "team" && allowed["member:read"] && auth && <TeamSettings organizationId={auth.organizationId} me={auth.me} members={auth.members} invitations={auth.invitations} preview={preview} />}
        {tab === "workspace" && allowed["security:read"] && auth && (
          <WorkspaceSecurity organizationId={auth.organizationId} requireTwoFactor={auth.requireTwoFactor} providers={auth.providers} audit={auth.audit} baseUrl={auth.baseUrl} preview={preview} />
        )}
        {tab === "spend" && allowed["spend:read"] && <SpendCapSection initialCap={user?.global_daily_cap_usd ?? null} />}
        {tab === "billing" && allowed["billing:read"] && <BillingSection billing={billing} />}
        {tab === "privacy" && <PrivacySection email={user?.email ?? null} />}
      </Column>
    </>
  );
}
