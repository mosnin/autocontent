import type { Metadata } from "next";

import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { HubBands } from "@/components/marketing/features/hub-bands";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "Two production pipelines from one niche brief: short-form video and SEO articles, plus an agent surface and spend controls that keep every dollar capped.";

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
        kicker="Features"
        lede="One niche brief drives two production pipelines, an agent surface, and a ledger that watches every dollar. Nothing to stitch together, nothing to babysit."
        title={
          <>
            Everything the campaign needs.
            <br className="hidden md:block" /> One system.
          </>
        }
        variant="sky"
      />
      <HubBands />
      <SectionCta
        className="pt-6"
        headline="See the whole system work."
        kicker="Get started"
        sub="One brief. Video and articles ideated, produced, published, and improved, inside caps you set."
      />
    </main>
  );
}
