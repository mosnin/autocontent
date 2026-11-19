// Preview views for the business pages. key = path after /preview/app/.
import type { ReactNode } from "react";
import { AuditClient } from "@/app/(app)/admin/audit/AuditClient";
import { FlagsClient } from "@/app/(app)/admin/flags/FlagsClient";
import { HealthClient } from "@/app/(app)/admin/health/HealthClient";
import { MediaClient } from "@/app/(app)/admin/media/MediaClient";
import { AdminTemplatesClient } from "@/app/(app)/admin/templates/AdminTemplatesClient";
import { UserDetailClient } from "@/app/(app)/admin/users/[id]/UserDetailClient";
import { UsersClient } from "@/app/(app)/admin/users/UsersClient";
import { AdminOverviewView } from "@/components/app/admin/overview-view";
import { SecurityView } from "@/components/app/admin/security-view";
import { BrandView } from "@/components/app/brand/brand-view";
import { DistributionCampaignView } from "@/components/app/distribution/campaign-detail-view";
import { DistributionView } from "@/components/app/distribution/distribution-view";
import { IntegrationsView } from "@/components/app/integrations/integrations-view";
import { AdAccountsView } from "@/components/app/paid/ad-accounts-view";
import { CampaignDetailView } from "@/components/app/paid/campaign-detail-view";
import { NewCampaignView } from "@/components/app/paid/new-campaign-view";
import { PaidView } from "@/components/app/paid/paid-view";
import { SettingsView } from "@/components/app/settings/settings-view";
import { FX_SESSIONS, fxAuthSettings } from "@/lib/fixtures-auth";
import { FIXTURE_INBOX, FIXTURE_MONTH } from "@/lib/fixtures";
import { FX_ADMIN_AUDIT, FX_ADMIN_CONFIG, FX_ADMIN_FLAGS, FX_ADMIN_HEALTH, FX_ADMIN_OPS, FX_ADMIN_OVERVIEW, FX_ADMIN_TEMPLATES, FX_ADMIN_USERS } from "@/lib/fixtures-admin";
import {
  FX_AD_ACCOUNTS,
  FX_AD_ACTIONS,
  FX_AD_CAMPAIGNS,
  FX_AD_METRICS,
  FX_ADS_OVERVIEW,
  FX_AYRSHARE,
  FX_BILLING,
  FX_BRAND_KIT,
  FX_CALENDAR,
  FX_CAMPAIGN_OVERVIEW,
  FX_CAMPAIGNS,
  FX_KITS,
  FX_PLAYBOOKS,
  FX_TOKENS,
  FX_USER,
  FX_WEBHOOKS,
  FX_X402,
} from "@/lib/fixtures-business";

const adApprovals = FIXTURE_INBOX.items.filter((i) => i.kind === "ad_change");

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  paid: () => <PaidView overview={FX_ADS_OVERVIEW} workspace={FIXTURE_MONTH} accounts={FX_AD_ACCOUNTS} campaigns={FX_AD_CAMPAIGNS} approvals={adApprovals} actions={FX_AD_ACTIONS} />,
  "paid/empty": () => <PaidView overview={{ ...FX_ADS_OVERVIEW, accounts: 0, active_accounts: 0 }} workspace={null} accounts={[]} campaigns={[]} approvals={[]} actions={[]} />,
  "paid/campaigns/1": () => <CampaignDetailView campaign={FX_AD_CAMPAIGNS[0]!} metrics={FX_AD_METRICS} account={FX_AD_ACCOUNTS[0]!} />,
  "paid/campaigns/new": () => <NewCampaignView accounts={FX_AD_ACCOUNTS} />,
  "paid/connect": () => <AdAccountsView accounts={FX_AD_ACCOUNTS} />,
  distribution: () => <DistributionView ayrshare={FX_AYRSHARE} campaigns={FX_CAMPAIGNS} calendar={FX_CALENDAR} playbooks={FX_PLAYBOOKS} />,
  "distribution/empty": () => <DistributionView ayrshare={{ connected: false, profile_key: null }} campaigns={[]} calendar={[]} playbooks={[]} />,
  "distribution/campaigns/c1": () => <DistributionCampaignView overview={FX_CAMPAIGN_OVERVIEW} playbooks={FX_PLAYBOOKS} adCampaigns={FX_AD_CAMPAIGNS.map((a) => ({ id: a.id, name: a.name }))} />,
  brand: () => <BrandView kit={FX_BRAND_KIT} kits={FX_KITS} />,
  integrations: () => <IntegrationsView ayrshare={FX_AYRSHARE} adAccounts={FX_AD_ACCOUNTS} tokens={FX_TOKENS} webhooks={FX_WEBHOOKS} x402={FX_X402} apiBase="https://api.marketer.sh" />,
  settings: () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings()} previewSessions={FX_SESSIONS} />,
  "settings/billing": () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings()} previewSessions={FX_SESSIONS} initialTab="billing" />,
  // Auth settings. Add ?role=analyst (or admin, marketer, billing) to see what each role sees.
  "settings/security": () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings()} previewSessions={FX_SESSIONS} initialTab="security" />,
  "settings/team": () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings()} previewSessions={FX_SESSIONS} initialTab="team" />,
  "settings/team/admin": () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings("admin")} previewSessions={FX_SESSIONS} initialTab="team" />,
  "settings/team/analyst": () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings("analyst")} previewSessions={FX_SESSIONS} initialTab="team" />,
  "settings/workspace/analyst": () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings("analyst")} previewSessions={FX_SESSIONS} initialTab="workspace" />,
  "settings/workspace": () => <SettingsView user={FX_USER} billing={FX_BILLING} auth={fxAuthSettings()} previewSessions={FX_SESSIONS} initialTab="workspace" />,
  admin: () => <AdminOverviewView overview={FX_ADMIN_OVERVIEW} />,
  "admin/users": () => <UsersClient initial={FX_ADMIN_USERS} />,
  "admin/users/u3": () => <UserDetailClient initialUser={FX_ADMIN_USERS[2]!} initialAudit={FX_ADMIN_AUDIT.filter((e) => e.target_id === "u3")} />,
  "admin/audit": () => <AuditClient initial={FX_ADMIN_AUDIT} initialFilters={{}} />,
  "admin/health": () => <HealthClient initial={FX_ADMIN_HEALTH} initialOps={FX_ADMIN_OPS} initialConfigHealth={FX_ADMIN_CONFIG} />,
  "admin/flags": () => <FlagsClient initial={FX_ADMIN_FLAGS} />,
  "admin/security": () => <SecurityView />,
  "admin/media": () => <MediaClient />,
  "admin/templates": () => <AdminTemplatesClient initial={FX_ADMIN_TEMPLATES} />,
};
