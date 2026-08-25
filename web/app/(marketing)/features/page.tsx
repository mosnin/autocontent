import type { Metadata } from "next";

import {
  FeatureIndex,
  HubStats,
  SharedSpine,
} from "@/components/marketing/features/detail-b/hub-index";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "Twenty surfaces on one platform: video, articles, ads, and the controls that keep every dollar under a cap you set.";

export const metadata: Metadata = {
  title: "Features — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Features — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features" },
};

export default function FeaturesPage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="image"
            label="Platform overview — every surface on one ledger"
            ratio="4/3"
          />
        }
        kicker="Features"
        lede="Video, articles, UGC, dramas, motion, templates, headshots. Scheduling, campaigns, ads, ad studio, queue. Niches, analytics, agents, library, audits, brand, personas. One ledger, one set of caps."
        magneticPrimary
        titleText="Every surface the campaign needs."
        variant="sky"
      />
      <FeatureIndex />
      <SharedSpine />
      <HubStats />
      <SectionCta
        headline="Turn on the parts you need."
        highlight="the parts you need."
        kicker="Get started"
        sub="Every feature works on every credit pack. Start at five dollars and add surfaces as you go."
      />
    </main>
  );
}
