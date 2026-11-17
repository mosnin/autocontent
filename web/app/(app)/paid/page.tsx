import { PaidView } from "@/components/app/paid/paid-view";
import type { AdAccount, AdActionEntry, AdApproval, AdCampaign, AdsOverview } from "@/lib/ads-client";
import { formatUsd } from "@/lib/format";
import type { InboxItem } from "@/lib/workspace";
import { getInbox, getOverview, safe } from "@/lib/workspace-server";

export const metadata = { title: "Paid media · Marketer" };

export default async function PaidPage() {
  const [overview, workspace, accounts, campaigns, inbox, actions] = await Promise.all([
    safe<AdsOverview>("/api/v1/ads/overview"),
    getOverview(30),
    safe<AdAccount[]>("/api/v1/ads/accounts"),
    safe<AdCampaign[]>("/api/v1/ads/campaigns"),
    getInbox(),
    safe<AdActionEntry[]>("/api/v1/ads/actions?limit=200"),
  ]);

  // Pending ad changes come from the one inbox; if it's unreachable, fall
  // back to the ads approvals API (same decide path either way).
  let approvals: InboxItem[] = inbox?.items.filter((i) => i.kind === "ad_change") ?? [];
  if (!inbox) {
    const pending = await safe<AdApproval[]>("/api/v1/ads/approvals?status_filter=pending");
    approvals = (pending ?? []).map((a) => ({
      id: `ad_change:${a.id}`,
      kind: "ad_change",
      ref_id: a.id,
      title: a.summary,
      detail: `${a.action} · ${formatUsd(a.dollar_delta_usd)}/day · requested by ${a.requested_by}`,
      niche_id: null,
      created_at: a.created_at,
    }));
  }

  return <PaidView overview={overview} workspace={workspace} accounts={accounts} campaigns={campaigns} approvals={approvals} actions={actions} />;
}
