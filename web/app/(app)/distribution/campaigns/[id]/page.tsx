import { Send } from "lucide-react";
import { notFound } from "next/navigation";
import { DistributionCampaignView } from "@/components/mk/distribution/campaign-detail-view";
import { PageBody, PageHeader } from "@/components/mk/page";
import { ButtonLink, Empty } from "@/components/mk/ui";
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
        <PageHeader icon={<Send />} title="Distribution" />
        <PageBody width="4xl">
          <Empty art="meetings" title="This campaign is out of reach" action={<ButtonLink href="/distribution">Back to distribution</ButtonLink>}>
            We couldn't load it right now. Refresh in a moment.
          </Empty>
        </PageBody>
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
