import type { Metadata } from "next";

import {
  AnalyticsStats,
  LoopBand,
  MetricsMoment,
  SpendBand,
} from "@/components/marketing/features/analytics-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta, TaggedPlaceholder } from "@/components/marketing/system";

const DESCRIPTION =
  "Per-post views, watch time, and completion feed the next ideation round. Every model call is metered to a ledger with hard caps that fail closed, not open.";

export const metadata: Metadata = {
  title: "Analytics & spend — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Analytics & spend — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/analytics" },
};

export default function AnalyticsFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <div className="aspect-video overflow-hidden rounded-[2rem]">
            <TaggedPlaceholder
              kind="illustration"
              label="Performance loop — spend caps diagram"
              tone="sky"
            />
          </div>
        }
        kicker="Analytics & spend"
        lede="Every post reports back with views, watch time, and completion. Every dollar is metered as it's spent. The system learns from the first and is bound by the second."
        magneticPrimary
        titleText="It learns what works. It never overspends."
        variant="sky"
      />
      <LoopBand />
      <SpendBand />
      <MetricsMoment />
      <AnalyticsStats />
      <SectionCta
        headline="Put the loop to work."
        kicker="Get started"
        sub="Start with a small cap. Watch the metrics steer the next round. Raise it when the numbers earn it."
      />
    </main>
  );
}
