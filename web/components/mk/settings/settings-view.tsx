import { Settings } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader, PageIntro, Panel } from "../page";
import { AppearanceSection, BillingSection, PrivacySection, ProfileSection, SpendCapSection } from "./sections";
import type { BillingBalance, User } from "@/lib/types";

export function SettingsView({ user, billing }: { user: User | null; billing: BillingBalance | null }) {
  return (
    <>
      <PageHeader icon={<Settings />} title="Settings" />
      <PageBody width="3xl">
        <PageIntro title="Your account">
          Profile, spend, billing and privacy. Brand voice lives on <Link href="/brand" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">Brand</Link>; tokens, webhooks and channels on <Link href="/integrations" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">Integrations</Link>.
        </PageIntro>
        <div className="t-stagger space-y-4">
          {user === null && <p className="rounded-[14px] bg-subtle px-4 py-3 text-[13px] text-muted-foreground">We couldn't load your profile right now, so some values below may be defaults.</p>}
          <div id="profile" className="scroll-mt-4">
            <Panel label="Profile">
              <ProfileSection email={user?.email ?? null} initialNotifications={user?.email_notifications ?? true} />
            </Panel>
          </div>
          <div id="spend" className="scroll-mt-4">
            <Panel label="Spend caps">
              <SpendCapSection initialCap={user?.global_daily_cap_usd ?? null} />
            </Panel>
          </div>
          <div id="billing" className="scroll-mt-4">
            <Panel label="Billing">
              <BillingSection billing={billing} />
            </Panel>
          </div>
          <div id="appearance" className="scroll-mt-4">
            <Panel label="Appearance">
              <AppearanceSection />
            </Panel>
          </div>
          <div id="privacy" className="scroll-mt-4">
            <Panel label="Data and privacy">
              <PrivacySection email={user?.email ?? null} />
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
