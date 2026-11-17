"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Callout, Column, PageHeader, Segmented } from "@/design-system";
import type { BillingBalance, User } from "@/lib/types";
import { AppearanceSection, BillingSection, PrivacySection, ProfileSection, SpendCapSection } from "./sections";

type Tab = "general" | "spend" | "billing" | "privacy";
const TABS: { value: Tab; label: string }[] = [
  { value: "general", label: "General" },
  { value: "spend", label: "Spend" },
  { value: "billing", label: "Billing" },
  { value: "privacy", label: "Privacy" },
];
const isTab = (v: string): v is Tab => TABS.some((t) => t.value === v);

/** Settings (ref 07, column md): one segmented control, one tab of sections at a time. */
export function SettingsView({ user, billing, initialTab = "general" }: { user: User | null; billing: BillingBalance | null; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Deep links (#billing, Stripe's ?purchase= return) pick the tab.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (new URLSearchParams(window.location.search).has("purchase")) setTab("billing");
    else if (isTab(hash)) setTab(hash);
  }, []);

  const pick = (t: Tab) => {
    setTab(t);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${t}`);
  };

  return (
    <>
      <PageHeader icon={<Settings />} title="Settings" />
      <Column
        title="Settings"
        description={
          <>
            Your account. Voice lives on <Link href="/brand" className="text-fg hover:underline">Brand</Link>, tokens on <Link href="/integrations" className="text-fg hover:underline">Integrations</Link>.
          </>
        }
        control={<Segmented label="Settings sections" value={tab} onChange={pick} options={TABS} />}
      >
        {user === null && <Callout tone="attention">Couldn't load your profile, so some values below may be defaults.</Callout>}
        {tab === "general" && (
          <>
            <ProfileSection email={user?.email ?? null} initialNotifications={user?.email_notifications ?? true} />
            <AppearanceSection />
          </>
        )}
        {tab === "spend" && <SpendCapSection initialCap={user?.global_daily_cap_usd ?? null} />}
        {tab === "billing" && <BillingSection billing={billing} />}
        {tab === "privacy" && <PrivacySection email={user?.email ?? null} />}
      </Column>
    </>
  );
}
