import type { Metadata } from "next";

import {
  FeatureIndex,
  HubStats,
  SharedSpine,
} from "@/components/marketing/features/detail-b/hub-index";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "Video, articles, scheduling, and campaigns on one ledger, under one set of caps. Extra studios stay off until you turn them on.";

export const metadata: Metadata = {
  title: "Product · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Product · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features" },
};

export default function FeaturesPage() {
  return (
    <main>
      <FeatureHero
        kicker="Product"
        lede="Video and articles ship today. Scheduling and campaigns share the same ledger. Paid ads stay off until they are actually live."
        titleText="Content and SEO, under one cap."
      />
      <FeatureIndex />
      <SharedSpine />
      <HubStats />
      <SectionCta
        headline="Start with the line you need."
        sub="Every service runs on the same credit pack. Start at five dollars."
      />
    </main>
  );
}
