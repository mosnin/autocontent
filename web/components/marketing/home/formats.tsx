"use client";

import * as React from "react";

import {
  ArticleFlowIllustration,
  VideoPipelineIllustration,
} from "@/components/marketing/illustrations";
import {
  DisplayHeading,
  FeatureCard,
  Kicker,
  Lede,
  Reveal,
  Stagger,
} from "@/components/marketing/system";

/** "One brief. Every format." — the two production lines. */
export function Formats() {
  return (
    <section aria-label="Content formats" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <Reveal className="max-w-2xl">
        <Kicker>Two pipelines, one brief</Kicker>
        <DisplayHeading className="mt-4">One brief. Every format.</DisplayHeading>
        <Lede className="mt-5">
          The brief that ran the night shift drives both lines. Short-form
          video for reach, SEO articles for search. Each learns from the
          other.
        </Lede>
      </Reveal>

      <Stagger className="mt-14 grid gap-6 md:grid-cols-2" gap={0.1}>
        <FeatureCard
          description="Scripted, voiced, cut, and posted to your channels on a schedule. A finished short costs about $0.50, not an afternoon."
          href="/features/video"
          illustration={<VideoPipelineIllustration />}
          kicker="Short-form video"
          linkLabel="Explore video"
          title="Video, end to end"
        />
        <FeatureCard
          description="Live SERP research becomes an outline, the outline becomes a ranked article with clean meta, internal links, and your voice."
          href="/features/articles"
          illustration={<ArticleFlowIllustration />}
          kicker="Articles & SEO"
          linkLabel="Explore articles"
          title="Articles that rank"
        />
      </Stagger>
    </section>
  );
}
