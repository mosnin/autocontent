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
  "Video, articles, scheduling, and campaigns on one ledger, under one set of caps. Extra studios stay off until you turn them on.";

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
            label="Platform overview — the surfaces you turn on"
            ratio="4/3"
          />
        }
        kicker="Features"
        lede="Video and articles ship today. Scheduling, campaigns, and analytics share the same ledger. Paid ads and extra studios stay off until they are actually live."
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
