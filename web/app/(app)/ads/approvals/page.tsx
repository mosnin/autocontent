import { api } from "@/lib/api";
import type { AdApproval, AdCampaign, AdsOverview } from "@/lib/ads-client";
import { ApprovalsClient } from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function AdsApprovalsPage() {
  let initial: AdApproval[] = [];
  let campaignNames: Record<string, string> = {};
  let threshold: string | undefined;
  try {
    const [approvals, campaigns, overview] = await Promise.all([
      api<AdApproval[]>("/api/v1/ads/approvals?status_filter=pending"),
      api<AdCampaign[]>("/api/v1/ads/campaigns"),
      api<AdsOverview>("/api/v1/ads/overview"),
    ]);
    initial = approvals;
    campaignNames = Object.fromEntries(campaigns.map((c) => [c.id, c.name]));
    threshold = overview.approval_threshold_usd;
  } catch {
    initial = [];
  }
  return (
    <ApprovalsClient
      approvalThresholdUsd={threshold}
      campaignNames={campaignNames}
      initial={initial}
    />
  );
}
