import { api } from "@/lib/api";
import type { AdApproval, AdCampaign, AdsOverview } from "@/lib/ads-client";
import { ApprovalsClient } from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function AdsApprovalsPage() {
  // Independent best-effort fetches: a failed enrichment (names, threshold)
  // must never blank the approvals themselves.
  let initial: AdApproval[] = [];
  let campaignNames: Record<string, string> = {};
  let threshold: string | undefined;
  try {
    initial = await api<AdApproval[]>("/api/v1/ads/approvals?status_filter=pending");
  } catch {
    initial = [];
  }
  try {
    const campaigns = await api<AdCampaign[]>("/api/v1/ads/campaigns");
    campaignNames = Object.fromEntries(campaigns.map((c) => [c.id, c.name]));
  } catch {
    campaignNames = {};
  }
  try {
    const overview = await api<AdsOverview>("/api/v1/ads/overview");
    threshold = overview.approval_threshold_usd;
  } catch {
    threshold = undefined;
  }
  return (
    <ApprovalsClient
      approvalThresholdUsd={threshold}
      campaignNames={campaignNames}
      initial={initial}
    />
  );
}
