import type { Metadata } from "next";

import {
  BudgetBand,
  CampaignAnatomy,
  CampaignContext,
  CampaignStats,
  LaneCards,
  TickBand,
} from "@/components/marketing/features/detail-b/campaigns-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "Set a budget and a window, add video and article lanes, link an ad campaign for reporting. An hourly runner paces the work and completes the campaign at the budget.";

export const metadata: Metadata = {
  title: "Campaigns — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Campaigns — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/campaigns" },
};

export default function CampaignsFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="image"
            label="Campaign detail — lanes, budget, and status"
            ratio="16/9"
          />
        }
        kicker="Campaigns"
        lede="Name the push, give it a budget of credits and a window, then add the lanes it should run. The runner paces the work across the week and stops the moment the budget is spent."
        magneticPrimary
        secondary={{ label: "See pricing", href: "/pricing" }}
        titleText="One push. Every lane pulling the same way."
        variant="sky"
      />
      <CampaignAnatomy />
      <LaneCards />
      <TickBand />
      <BudgetBand />
      <CampaignContext />
      <CampaignStats />
      <SectionCta
        headline="Give the next launch a budget and a deadline."
        highlight="a budget and a deadline."
        kicker="Get started"
        sub="Add the lanes, press start, and watch the spend roll up against the number you set."
      />
    </main>
  );
}
