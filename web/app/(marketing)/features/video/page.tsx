import type { Metadata } from "next";

import { FeatureHero } from "@/components/marketing/features/feature-hero";
import {
  ApprovalGateBand,
  CharacterBand,
  PlatformRow,
  QueueMoment,
  VideoStats,
} from "@/components/marketing/features/video-sections";
import { VideoWalkthrough } from "@/components/marketing/features/video-walkthrough";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "Ideation, scene-by-scene scripts, on-model keyframes, voiceover, karaoke captions, QA, and scheduled publishing to TikTok, Reels, and Shorts. One brief in.";

export const metadata: Metadata = {
  title: "Video pipeline — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Video pipeline — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/video" },
};

export default function VideoFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="video"
            label="Studio demo — brief to published short"
            ratio="16/9"
          />
        }
        kicker="Short-form video"
        lede="Give it a niche brief. It writes the script, generates the frames, voices the lines, cuts the edit, and posts on schedule. You review the result, not the work."
        magneticPrimary
        titleText="One brief in. A finished short out."
        variant="sky"
      />
      <VideoWalkthrough />
      <QueueMoment />
      <CharacterBand />
      <ApprovalGateBand />
      <PlatformRow />
      <VideoStats />
      <SectionCta
        headline="Ship your first short today."
        kicker="Get started"
        sub="Describe your niche once. The pipeline handles the other ten stages."
      />
    </main>
  );
}
