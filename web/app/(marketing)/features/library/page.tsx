import type { Metadata } from "next";

import {
  ImageOpsSection,
  RecutBand,
  ShelvesSection,
  StorageSection,
} from "@/components/marketing/features/detail-b/library-sections";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard } from "@/components/site/sections";

const DESCRIPTION =
  "Final videos, every scene clip, every still, and every recut on four shelves you can filter by niche - plus a server-side stitch that turns old clips into new videos.";

export const metadata: Metadata = {
  title: "Media library · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Media library · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/library" },
};

export default function LibraryFeaturePage() {
  return (
    <main>
      <FeatureHero
        illustration={
          <MediaCard
            kind="image"
            label="Library grid - finals, clips, images, recuts"
            ratio="16/9"
          />
        }
        kicker="Media library"
        lede="Every finished video, every scene it was cut from, every still, and every recut - in one grid, filtered by niche, playable without downloading anything."
        magneticPrimary
        titleText="Everything it made, still yours."
        variant="sky"
      />
      <ShelvesSection />
      <RecutBand />
      <ImageOpsSection />
      <StorageSection />
      <SectionCta
        headline="Produce once. Use it again."
        highlight="Use it again."
        kicker="Get started"
        sub="Scene clips are saved as they render, so your second video costs less work than your first."
      />
    </main>
  );
}
