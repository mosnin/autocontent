import type { Metadata } from "next";

import {
  CalendarBand,
  ComposerSection,
  ExactlyOnceSection,
  QueueSection,
  SchedulingStats,
  WindowsBand,
} from "@/components/marketing/features/detail-b/scheduling-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "Per-niche posting windows, one calendar across video, articles, and ads, a composer for eleven platforms, recurring weekly slots, and a dispatcher that cannot post twice.";

export const metadata: Metadata = {
  title: "Scheduling & publishing · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Scheduling & publishing · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/scheduling" },
};

export default function SchedulingFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="image"
            label="Calendar agenda - the next thirty days"
            ratio="16/9"
          />
        }
        kicker="Scheduling & publishing"
        lede="Set the windows once. The pipeline produces to meet them, the calendar shows what is coming, and the dispatcher puts each post out exactly once - in the timezone you meant."
        magneticPrimary
        titleText="It knows what ships, and when."
        variant="sky"
      />
      <WindowsBand />
      <CalendarBand />
      <ComposerSection />
      <ExactlyOnceSection />
      <QueueSection />
      <SchedulingStats />
      <SectionCta
        headline="Pick your windows. Stop watching the clock."
        highlight="Stop watching the clock."
        kicker="Get started"
        sub="One calendar for every pipeline, one queue when something needs you, and nothing published twice."
      />
    </main>
  );
}
