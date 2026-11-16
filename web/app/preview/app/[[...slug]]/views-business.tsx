// Preview views for the business pages. key = path after /preview/app/.
import type { ReactNode } from "react";
import { AdAccountsView } from "@/components/mk/paid/ad-accounts-view";
import { CampaignDetailView } from "@/components/mk/paid/campaign-detail-view";
import { NewCampaignView } from "@/components/mk/paid/new-campaign-view";
import { PaidView } from "@/components/mk/paid/paid-view";
import { FIXTURE_INBOX, FIXTURE_MONTH } from "@/lib/fixtures";
import { FX_AD_ACCOUNTS, FX_AD_ACTIONS, FX_AD_CAMPAIGNS, FX_AD_METRICS, FX_ADS_OVERVIEW } from "@/lib/fixtures-business";

const adApprovals = FIXTURE_INBOX.items.filter((i) => i.kind === "ad_change");

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  paid: () => <PaidView overview={FX_ADS_OVERVIEW} workspace={FIXTURE_MONTH} accounts={FX_AD_ACCOUNTS} campaigns={FX_AD_CAMPAIGNS} approvals={adApprovals} actions={FX_AD_ACTIONS} />,
  "paid/empty": () => <PaidView overview={{ ...FX_ADS_OVERVIEW, accounts: 0, active_accounts: 0 }} workspace={null} accounts={[]} campaigns={[]} approvals={[]} actions={[]} />,
  "paid/campaigns/1": () => <CampaignDetailView campaign={FX_AD_CAMPAIGNS[0]!} metrics={FX_AD_METRICS} account={FX_AD_ACCOUNTS[0]!} />,
  "paid/campaigns/new": () => <NewCampaignView accounts={FX_AD_ACCOUNTS} />,
  "paid/connect": () => <AdAccountsView accounts={FX_AD_ACCOUNTS} />,
};
