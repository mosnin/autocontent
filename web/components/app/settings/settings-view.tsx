"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { SecuritySettings, PasskeysSection, PasswordSection, SessionsSection, TwoFactorSection } from "@/components/auth/security-settings";
import { TeamSettings } from "@/components/auth/team-settings";
import { WorkspaceSecurity } from "@/components/auth/workspace-security";
import { Callout, PageHeader, cx, useAllowed } from "@/design-system";
import type { AuthSettingsData } from "@/lib/auth/settings-data";
import type { SessionSummary } from "@/lib/auth/actions";
import type { BillingBalance, User } from "@/lib/types";
import { ObservabilitySection, type ObservabilitySettings } from "./observability";
import { AppearanceSection, BillingSection, PrivacySection, ProfileSection, SpendCapSection } from "./sections";

export type SettingsTab = "general" | "security" | "team" | "workspace" | "spend" | "billing" | "privacy";
type Group = "You" | "Workspace";
const ALL_TABS: { value: SettingsTab; label: string; group: Group; needs?: string }[] = [
  { value: "general", label: "General", group: "You" },
  { value: "security", label: "Security", group: "You" },
  { value: "privacy", label: "Privacy", group: "You" },
  { value: "team", label: "Team", group: "Workspace", needs: "member:read" },
  { value: "workspace", label: "Workspace", group: "Workspace", needs: "security:read" },
  { value: "spend", label: "Spend", group: "Workspace", needs: "spend:read" },
  { value: "billing", label: "Billing", group: "Workspace", needs: "billing:read" },
];
const GROUPS: Group[] = ["You", "Workspace"];

/**
 * The settings index: a calm vertical list grouped into You and Workspace on
 * wide screens, one scrollable row on a phone. It is a tablist (one tab stop,
 * arrows move and select), like Segmented.
 */
function SettingsIndex({ tabs, value, onChange }: { tabs: typeof ALL_TABS; value: SettingsTab; onChange: (t: SettingsTab) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.value === value);
    const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
    const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const next = fwd ? (i + 1) % tabs.length : back ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0 || next === i) return;
    e.preventDefault();
    onChange(tabs[next]!.value);
    ref.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label="Settings sections" aria-orientation="vertical" onKeyDown={onKeyDown} className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6 md:mx-0 md:flex-col md:gap-5 md:overflow-visible md:p-0">
      {GROUPS.map((g) => {
        const items = tabs.filter((t) => t.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g} role="presentation" className="flex shrink-0 gap-1 md:flex-col md:gap-px">
            <div role="presentation" className="hidden px-2 pb-1 text-[12px] text-fg-faint md:block">
              {g}
            </div>
            {items.map((t) => {
              const on = t.value === value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  id={`settings-tab-${t.value}`}
                  aria-selected={on}
                  aria-controls="settings-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => onChange(t.value)}
                  className={cx(
                    "ds-press flex h-7 shrink-0 items-center whitespace-nowrap rounded-ds-sm px-2.5 text-left text-[13px] md:w-full md:px-2",
                    on ? "bg-surface-3 font-medium text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Settings (ref 07): a grouped index beside one section's settings at a time. */
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
  const current: SettingsTab = isTab(tab) ? tab : "general";

  return (
    <>
      <PageHeader icon={<Settings />} title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-5 pb-20 pt-12 sm:px-6">
          <h2 className="text-[22px] font-medium leading-tight">Settings</h2>
          <p className="mt-1.5 text-[14px] text-fg-muted">
            Your account and this workspace. Voice lives on <Link href="/brand" className="text-fg hover:underline">Brand</Link>, tokens on <Link href="/integrations" className="text-fg hover:underline">Integrations</Link>.
          </p>
          <div className="mt-8 md:grid md:grid-cols-[168px_minmax(0,1fr)] md:gap-12">
            <nav aria-label="Settings" className="md:sticky md:top-0 md:self-start">
              <SettingsIndex tabs={tabs} value={current} onChange={pick} />
            </nav>
            <div key={current} id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${current}`} className="ds-swap mt-8 min-w-0 max-w-[680px] space-y-10 md:mt-0">
              {user === null && <Callout tone="attention">Couldn&apos;t load your profile, so some values below may be defaults.</Callout>}
              {current === "general" && (
                <>
                  <ProfileSection email={user?.email ?? null} initialNotifications={user?.email_notifications ?? true} />
                  <AppearanceSection />
                </>
              )}
              {current === "security" &&
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
              {current === "security" && <ObservabilitySection initial={observability} preview={preview} />}
              {current === "team" && allowed["member:read"] && auth && <TeamSettings organizationId={auth.organizationId} me={auth.me} members={auth.members} invitations={auth.invitations} preview={preview} />}
              {current === "workspace" && allowed["security:read"] && auth && (
                <WorkspaceSecurity organizationId={auth.organizationId} requireTwoFactor={auth.requireTwoFactor} providers={auth.providers} audit={auth.audit} baseUrl={auth.baseUrl} preview={preview} />
              )}
              {current === "spend" && allowed["spend:read"] && <SpendCapSection initialCap={user?.global_daily_cap_usd ?? null} />}
              {current === "billing" && allowed["billing:read"] && <BillingSection billing={billing} />}
              {current === "privacy" && <PrivacySection email={user?.email ?? null} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
