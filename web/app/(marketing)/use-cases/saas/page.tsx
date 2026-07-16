import type { Metadata } from "next";

import { SectionCta } from "@/components/marketing/system";
import { SaasAnalyticsMock } from "@/components/marketing/use-cases/mocks/saas-analytics";
import {
  MockBand,
  OutcomesBand,
  PainBand,
  StepsBand,
  UseCaseHero,
} from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "A content engine for growth teams: educational shorts up the funnel, comparison articles with FAQ JSON-LD at the bottom, and metrics that feed ideation.";

export const metadata: Metadata = {
  title: "SaaS | marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "SaaS | marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/use-cases/saas" },
};

export default function SaasPage() {
  return (
    <main>
      <UseCaseHero
        headline={["The content engine", "you never staffed."]}
        kicker="For SaaS growth teams"
        lede="Educational shorts at the top of the funnel, comparison articles at the bottom, and every post's metrics feeding the next round. No new headcount."
        scene="tide"
      />
      <PainBand
        heading="Growth wants content. Nobody owns it."
        lede="The roadmap is full and the blog is from March."
        pains={[
          {
            title: "Engineers won't write it",
            copy: "The people who understand the product are shipping the product. Drafting explainers loses to the sprint every time.",
          },
          {
            title: "Comparison pages go stale",
            copy: "Bottom-funnel searches are where deals start, and your versus pages still cite a competitor's old pricing.",
          },
          {
            title: "Video is a separate vendor",
            copy: "Short-form needs its own agency, its own budget, its own review loop. So it quietly never happens.",
          },
        ]}
      />
      <StepsBand
        heading="Brief the product. Cover the funnel."
        steps={[
          {
            title: "Brief the product and the buyer",
            copy: "What it does, who evaluates it, and the questions they ask before they sign. That's the whole setup.",
          },
          {
            title: "Both ends ship weekly",
            copy: "Educational shorts that teach the concept, comparison and alternative articles underneath, with FAQ JSON-LD for rich results.",
          },
          {
            title: "Metrics steer the next round",
            copy: "Retention, visits, and rankings flow back into ideation. The topics that pull sign-ups get the next slots.",
          },
        ]}
      />
      <MockBand
        bullets={[
          "Hook retention and follow-through per post",
          "Winning angles seed the next ideation round automatically",
          "FAQ JSON-LD on comparison articles for rich results",
        ]}
        heading="Every post reports for duty."
        kicker="The product moment"
        lede="A published short's numbers, and the two ideas it just earned: a sibling short and a bottom-funnel comparison article."
        scene="tide"
      >
        <SaasAnalyticsMock />
      </MockBand>
      <OutcomesBand
        heading="A funnel that feeds itself."
        stats={[
          { value: 2, label: "funnel ends covered, teach and compare" },
          { value: 1, label: "FAQ JSON-LD block on every comparison piece" },
          { value: 0, label: "extra hires to keep the cadence" },
        ]}
      />
      <SectionCta
        headline="Ship the content roadmap without staffing it."
        kicker="Get started"
        primaryLabel="Start creating"
        sub="Brief your product once. Review the first week's shorts and articles before anything ships."
      />
    </main>
  );
}
