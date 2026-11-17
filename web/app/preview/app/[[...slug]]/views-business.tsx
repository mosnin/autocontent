// Preview views for the business pages. key = path after /preview/app/.
import type { ReactNode } from "react";
import { BrandView } from "@/components/app/brand/brand-view";
import { DistributionCampaignView } from "@/components/app/distribution/campaign-detail-view";
import { DistributionView } from "@/components/app/distribution/distribution-view";
import { IntegrationsView } from "@/components/app/integrations/integrations-view";
import { AdAccountsView } from "@/components/app/paid/ad-accounts-view";
import { CampaignDetailView } from "@/components/app/paid/campaign-detail-view";
import { NewCampaignView } from "@/components/app/paid/new-campaign-view";
import { PaidView } from "@/components/app/paid/paid-view";
import { SettingsView } from "@/components/app/settings/settings-view";
import { FIXTURE_INBOX, FIXTURE_MONTH } from "@/lib/fixtures";
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
  settings: () => <SettingsView user={FX_USER} billing={FX_BILLING} />,
};
