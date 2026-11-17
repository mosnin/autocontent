import { notFound } from "next/navigation";
import { CampaignDetailView } from "@/components/app/paid/campaign-detail-view";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
import { api } from "@/lib/api";
import type { AdAccount, AdCampaign, AdMetricsDaily } from "@/lib/ads-client";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Campaign · Paid media · Marketer" };

export default async function PaidCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: { campaign: AdCampaign; metrics: AdMetricsDaily[] } | null = null;
  try {
    detail = await api(`/api/v1/ads/campaigns/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("404")) notFound();
  }
  if (!detail) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Paid media", href: "/paid" }, { label: "Campaign" }]} />
        <Column width="md">
          <EmptyLine action={<ButtonLink href="/paid">Back to paid media</ButtonLink>}>This campaign is out of reach right now. Nothing has changed on the platform.</EmptyLine>
        </Column>
      </>
    );
  }
  const accounts = await safe<AdAccount[]>("/api/v1/ads/accounts");
  const account = accounts?.find((a) => a.id === detail.campaign.ad_account_id) ?? null;
  return <CampaignDetailView campaign={detail.campaign} metrics={detail.metrics} account={account} />;
}
