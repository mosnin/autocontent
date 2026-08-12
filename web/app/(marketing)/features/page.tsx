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
  "Fourteen surfaces on one platform: six ways to make the work, three to get it out, and five that keep it measured, automated, and inside the caps you set.";

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
            label="Platform overview — the fourteen surfaces"
            ratio="4/3"
          />
        }
        kicker="Features"
        lede="Video, articles, UGC, dramas, motion, templates. Scheduling, campaigns, ads. Niches, analytics, agents, library, audits. All of it on one ledger, under one set of caps."
        magneticPrimary
        titleText="Everything the campaign needs. One system."
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
