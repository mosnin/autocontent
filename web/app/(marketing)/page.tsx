import type { Metadata } from "next";

import { AgentsBand } from "@/components/marketing/home/agents-band";
import { Formats } from "@/components/marketing/home/formats";
import { Hero } from "@/components/marketing/home/hero";
import { LearningLoop } from "@/components/marketing/home/learning-loop";
import { NightShift } from "@/components/marketing/home/night-shift";
import { PipelineStory } from "@/components/marketing/home/pipeline-story";
import { PricingTeaser } from "@/components/marketing/home/pricing-teaser";
import { Stats } from "@/components/marketing/home/stats";
import { TrustBand } from "@/components/marketing/home/trust-band";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "The autonomous marketing platform. One brief in, video and SEO articles ideated, produced, published, and improved, with hard caps on every dollar spent.";

export const metadata: Metadata = {
  title: "marketer.sh: Marketing that runs itself",
  description: DESCRIPTION,
  openGraph: {
    title: "marketer.sh: Marketing that runs itself",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "marketer.sh",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://marketer.sh",
  description: DESCRIPTION,
  offers: {
    "@type": "Offer",
    price: "5.00",
    priceCurrency: "USD",
    description: "Prepaid credit packs from $5. No subscription.",
  },
};

export default function HomePage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <Hero />
      <NightShift />
      <Formats />
      <PipelineStory />
      <AgentsBand />
      <Stats />
      <LearningLoop />
      <TrustBand />
      <PricingTeaser />
      <SectionCta
        headline="Put your marketing on autopilot."
        kicker="Get started"
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        secondaryHref="/pricing"
        secondaryLabel="See pricing"
        sub="Five dollars of credit. A cap you set. A gate you hold. Your first short ships today."
      />
    </main>
  );
}
