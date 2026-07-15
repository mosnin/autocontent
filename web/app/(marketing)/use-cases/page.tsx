import type { Metadata } from "next";

import { SectionCta } from "@/components/marketing/system";
import { HubGrid } from "@/components/marketing/use-cases/hub-grid";
import { UseCaseHero } from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "Six ways teams run marketer.sh: solo creators, ecommerce, SaaS teams, agencies, local businesses, and AI agents. Same pipelines, same spend caps, your job.";

export const metadata: Metadata = {
  title: "Use cases — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Use cases — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/use-cases" },
};

export default function UseCasesPage() {
  return (
    <main>
      <UseCaseHero
        headline={["Built for how", "you actually market."]}
        kicker="Use cases"
        lede="One system, six jobs. The same video and article pipelines, the same caps and gates, pointed at whatever you're actually trying to grow."
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        scene="pearl"
        secondaryHref="/features"
        secondaryLabel="See how it works"
      />
      <HubGrid />
      <SectionCta
        headline="Find your shape, then press go."
        kicker="Get started"
        sub="Every use case runs on the same brief. Describe what you sell, set a cap, and review what ships."
      />
    </main>
  );
}
