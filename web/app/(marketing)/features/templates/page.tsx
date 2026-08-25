import type { Metadata } from "next";

import {
  OutputBand,
  RemixSection,
  TemplateAnatomy,
  TemplateNotes,
  TemplateStats,
} from "@/components/marketing/features/detail-b/templates-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "Curated looks with their exact prompt attached. Remix one with a photo of your product and get the same aesthetic, your subject, straight into your library.";

export const metadata: Metadata = {
  title: "Templates & remix · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Templates & remix · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/templates" },
};

export default function TemplatesFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="image"
            label="Template shelf - curated looks with prompts"
            ratio="16/9"
          />
        }
        kicker="Templates & remix"
        lede="Start from a look that already works. Every template shows the reference image and the prompt behind it, and a remix puts your product inside that aesthetic in a couple of minutes."
        magneticPrimary
        titleText="Borrow the look. Keep the product."
        variant="sky"
      />
      <TemplateAnatomy />
      <RemixSection />
      <OutputBand />
      <TemplateNotes />
      <TemplateStats />
      <SectionCta
        headline="Find a look. Put your product in it."
        highlight="Put your product in it."
        kicker="Get started"
        sub="Prepaid credit, metered per image, with the same caps holding as everywhere else."
      />
    </main>
  );
}
