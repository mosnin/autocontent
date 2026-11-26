import { notFound } from "next/navigation";
import { DistributionCampaignView } from "@/components/app/distribution/campaign-detail-view";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
import { api } from "@/lib/api";
import type { AdCampaign } from "@/lib/ads-client";
import type { CampaignOverview, Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Campaign · Distribution · Marketer" };

export default async function DistributionCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let overview: CampaignOverview | null = null;
  try {
    overview = await api<CampaignOverview>(`/api/v1/campaigns/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("404")) notFound();
  }
  if (!overview) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Distribution", href: "/distribution" }, { label: "Campaign" }]} />
        <Column width="md">
          <EmptyLine action={<ButtonLink href="/distribution">Back to distribution</ButtonLink>}>This campaign is out of reach right now. Refresh in a moment.</EmptyLine>
        </Column>
      </>
    );
  }
  const [niches, ads] = await Promise.all([safe<Niche[]>("/api/v1/niches"), safe<AdCampaign[]>("/api/v1/ads/campaigns")]);
  return (
    <DistributionCampaignView
      overview={overview}
      playbooks={(niches ?? []).map((n) => ({ id: n.id, title: n.title }))}
      adCampaigns={(ads ?? []).map((a) => ({ id: a.id, name: a.name }))}
    />
  );
}
