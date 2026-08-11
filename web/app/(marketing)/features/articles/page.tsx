import type { Metadata } from "next";

import {
  MetadataBand,
  OutlineBand,
  QaBand,
  SerpBand,
} from "@/components/marketing/features/articles-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "Live SERP research, structured outlines, sections written in parallel under E-E-A-T rules, QA scoring, full SEO metadata, JSON-LD, and internal links.";

export const metadata: Metadata = {
  title: "Articles & SEO — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Articles & SEO — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/articles" },
};

export default function ArticlesFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="video"
            label="Press demo — SERP research to published article"
            ratio="16/9"
          />
        }
        kicker="Articles & SEO"
        lede="Every piece starts with research into what currently ranks, gets written under E-E-A-T rules, and is scored before it ships. With metadata, schema, and internal links included."
        magneticPrimary
        titleText="Articles that rank. Not blog filler."
        variant="pearl"
      />
      <SerpBand />
      <OutlineBand />
      <MetadataBand />
      <QaBand />
      <SectionCta
        headline="Publish your first ranked page."
        kicker="Get started"
        sub="Pick a niche. The pipeline researches, writes, scores, and hands you a ship-ready article."
      />
    </main>
  );
}
