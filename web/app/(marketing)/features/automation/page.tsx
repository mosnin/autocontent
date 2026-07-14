import type { Metadata } from "next";

import {
  ReliabilityBand,
  SurfaceCards,
  WindowsBand,
} from "@/components/marketing/features/automation-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { AgentGridIllustration } from "@/components/marketing/illustrations";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "REST API, typed Python SDK, the marketer CLI, and an MCP server with cost-aware tools. Agents create niches, enqueue videos, and publish inside your caps.";

export const metadata: Metadata = {
  title: "Automation & agents — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Automation & agents — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/automation" },
};

export default function AutomationFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={<AgentGridIllustration />}
        kicker="Automation & agents"
        lede="Everything a person can do here, an agent can do through the REST API, the typed Python SDK, the marketer CLI, or the MCP server. Inside the caps you set."
        secondary={{ label: "Read the API docs", href: "/resources/api" }}
        title={
          <>
            Point your agents at it.
            <br /> Walk away.
          </>
        }
        variant="sky"
      />
      <SurfaceCards />
      <WindowsBand />
      <ReliabilityBand />
      <SectionCta
        headline="Give your agents a marketing arm."
        kicker="Get started"
        sub="Four surfaces, one platform. Your agents brief, produce, and publish while the caps hold."
      />
    </main>
  );
}
