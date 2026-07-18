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
import { VideoPipelineIllustration } from "@/components/marketing/illustrations";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "Ideation, scene-by-scene scripts, on-model keyframes, voiceover, karaoke captions, QA, and scheduled publishing to TikTok, Reels, and Shorts. One brief in.";

export const metadata: Metadata = {
  title: "Video pipeline | marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Video pipeline | marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/video" },
};

export default function VideoFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={<VideoPipelineIllustration />}
        kicker="Short-form video"
        lede="Give it a channel brief. It writes the script, generates the frames, voices the lines, cuts the edit, and posts on schedule. You review the result, not the work."
        title={
          <>
            One brief in.
            <br /> A finished short out.
          </>
        }
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
        sub="Describe your channel once. The pipeline handles the other ten stages."
      />
    </main>
  );
}
