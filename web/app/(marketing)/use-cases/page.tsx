import type { Metadata } from "next";

import { SectionCta } from "@/components/marketing/system";
import { HubGrid } from "@/components/marketing/use-cases/hub-grid";
import { UseCaseHero } from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "Six ways people use marketer.sh: creators, shops, software teams, agencies, local businesses, and AI agents. Same videos, articles, and ads. Your job.";

export const metadata: Metadata = {
  title: "Use cases · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Use cases · marketer.sh",
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
        lede="One platform, six jobs. The same videos, articles, and ads, pointed at whatever you are trying to grow."
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
