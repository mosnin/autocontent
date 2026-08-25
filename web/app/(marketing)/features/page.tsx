import type { Metadata } from "next";

import {
  FeatureIndex,
  HubStats,
  SharedSpine,
} from "@/components/marketing/features/detail-b/hub-index";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "Content, SEO, and ads on one platform. One brief in, every format out, every dollar capped.";

export const metadata: Metadata = {
  title: "Product — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Product — marketer.sh",
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
        lede="Three services: short-form content, SEO articles, and paid ads. One login, one ledger, prepaid credits from $5."
        titleText="Content. SEO. Ads."
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
