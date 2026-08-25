import type { Metadata } from "next";

import {
  CapsBand,
  CreativeDna,
  EngineRoom,
  NicheAnatomy,
  NicheScreen,
  NicheStats,
} from "@/components/marketing/features/detail-b/niches-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "A niche is the brief the pipeline keeps: audience, look, voice, models, posting windows, and its own daily spend cap that fails closed before it fails you.";

export const metadata: Metadata = {
  title: "Niches & spend caps — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Niches & spend caps — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/niches" },
};

export default function NichesFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="image"
            label="Niche detail — spend today against the daily cap"
            ratio="16/9"
          />
        }
        kicker="Niches & spend caps"
        lede="Describe the channel once: who it is for, how it looks, who narrates, when it posts, and the most it may spend in a day. Everything downstream reads from that."
        magneticPrimary
        titleText="One brief. Its own channel, its own ceiling."
        variant="sky"
      />
      <NicheAnatomy />
      <CreativeDna />
      <EngineRoom />
      <CapsBand />
      <NicheScreen />
      <NicheStats />
      <SectionCta
        headline="Start with fifty cents a day."
        highlight="fifty cents a day."
        kicker="Get started"
        sub="Write one brief, set the cap where you're comfortable, and raise it when the numbers earn it."
      />
    </main>
  );
}
