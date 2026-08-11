import * as React from "react";

import {
  Band,
  Card,
  CardGrid,
  MediaCard,
  Section,
  SectionHead,
  Body,
} from "@/components/site/sections";

/* ------------------------------------------------------------------ */
/* SERP research                                                       */
/* ------------------------------------------------------------------ */

export function SerpBand() {
  return (
    <Band
      bullets={[
        "Live SERP research on every article, not a stale keyword list.",
        "The outline targets what the top results miss, not what they already cover.",
        "Deduped against your archive. The same article never ships twice.",
      ]}
      eyebrow="Research first"
      heading="It reads the results page before writing one."
      highlight="before writing one"
      label="SERP research"
      lede="Each topic is picked and deduped against your recent posts, so nothing repeats. Then Exa pulls what currently ranks, and the pipeline studies the angles, the depth, and the gaps."
      media={
        <MediaCard
          kind="image"
          label="SERP research scan — ranked results for a topic"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Outline → parallel writing                                          */
/* ------------------------------------------------------------------ */

export function OutlineBand() {
  return (
    <Band
      bullets={[
        "First-hand, specific prose. Numbers over adjectives, no filler paragraphs.",
        "Parallel drafting means a full article in minutes, not an afternoon.",
        "Every section knows the outline, so the piece reads as one argument.",
      ]}
      eyebrow="Structure, then speed"
      flip
      heading="One outline. Sections written in parallel."
      highlight="in parallel"
      label="Outline and writing"
      lede="The research becomes a structured outline: one H1, five to ten H2s, each with a job to do. Then every section is drafted at the same time, under E-E-A-T prose rules."
      media={
        <MediaCard
          kind="illustration"
          label="Outline structure — H1, H2 sections drafted in parallel"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* SEO metadata card                                                   */
/* ------------------------------------------------------------------ */

export function MetadataBand() {
  return (
    <Band
      bullets={[
        "Internal-link suggestions connect the new piece to your existing posts.",
        "An editorial hero image is generated to match the piece, not a stock photo.",
        "Paste-ready output: prose, metadata, schema, and links in one payload.",
      ]}
      eyebrow="Ship-ready"
      heading="Metadata handled. Schema included."
      highlight="Schema included."
      label="SEO metadata"
      lede="Every article leaves the pipeline with a title, slug, meta description, and keywords, plus JSON-LD for Article and FAQPage so search engines read it the way you meant it."
      media={
        <MediaCard
          kind="image"
          label="SEO metadata card — title, slug, schema tags"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* QA scores                                                           */
/* ------------------------------------------------------------------ */

const QA_SCORES = [
  {
    label: "Keyword density",
    score: 92,
    note: "On target without stuffing.",
  },
  {
    label: "E-E-A-T",
    score: 88,
    note: "Experience and expertise signals present.",
  },
  {
    label: "Readability",
    score: 95,
    note: "Short sentences, clean structure.",
  },
];

export function QaBand() {
  return (
    <Section label="Quality scoring">
      <div className="os-split">
        <SectionHead
          eyebrow="Quality gate"
          heading="Scored before it ships."
          highlight="before it ships"
          lede="Every draft is scored on keyword density, E-E-A-T, and readability. Fall short and it gets one corrective rewrite, then it's re-scored. Then it ships, or it doesn't."
        />
        <MediaCard
          kind="illustration"
          label="QA gate diagram — draft, score, rewrite, ship"
        />
      </div>
      <CardGrid className="os-mt-48">
        {QA_SCORES.map((q) => (
          <Card key={q.label}>
            <div className="os-scorehead">
              <p className="os-label">{q.label}</p>
              <p className="os-score">
                {q.score}
                <span className="os-score__of">/100</span>
              </p>
            </div>
            <div className="os-meter os-mt-20">
              <div className="os-meter__fill" style={{ width: `${q.score}%` }} />
            </div>
            <Body className="os-mt-16">{q.note}</Body>
          </Card>
        ))}
      </CardGrid>
      <Body className="os-mt-32">
        One corrective rewrite, maximum. If a piece can&apos;t clear the bar in
        two passes, it doesn&apos;t go out under your name.
      </Body>
    </Section>
  );
}
