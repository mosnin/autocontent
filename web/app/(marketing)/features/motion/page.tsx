import type { Metadata } from "next";

import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { StageGrid } from "@/components/marketing/features/detail-a/stage-grid";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import {
  Band,
  MediaCard,
  Section,
  SectionHead,
  Stats,
} from "@/components/site/sections";

const DESCRIPTION =
  "Narration becomes timed beats; every beat gets its own b-roll and its own line of kinetic type, composited into one video. The plan is kept, so you can see what supplied each beat.";

export const metadata: Metadata = {
  title: "Motion graphics · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Motion graphics · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/motion" },
};

/** The six statuses a motion project moves through, in pipeline order. */
const STAGES = [
  {
    label: "Voicing",
    copy: "The narration is synthesized - or borrowed from an existing job, which pays for no TTS at all.",
  },
  {
    label: "Transcribing",
    copy: "Word-level timings come back from transcription, which is what lets type land on the word rather than near it.",
    tag: "word timings",
  },
  {
    label: "Planning beats",
    copy: "Sentence boundaries become beats, and beats decide both the cuts and the type. One batched call names the search term for every stock beat at once.",
  },
  {
    label: "Rendering b-roll",
    copy: "Each beat gets its picture: an art-directed keyframe in the chosen style, or real footage found for its keyword. Fan-out is bounded.",
  },
  {
    label: "Compositing",
    copy: "Clips are concatenated, the kinetic type is burned in, and the narration is muxed on exactly once.",
    tag: "ffmpeg",
  },
  {
    label: "Done",
    copy: "One video, plus the beat-by-beat plan showing which strategy supplied each picture and the exact term it searched.",
  },
];

const STYLES = [
  {
    name: "Explainer flat",
    copy: "Bold flat-colour vector cut-outs, a limited contemporary palette, crisp editorial layout.",
  },
  {
    name: "American retro",
    copy: "1950s–60s advertising and pulp-magazine paper collage. Heavy wood-type caps over halftone dots.",
  },
  {
    name: "Swiss modern",
    copy: "Two colours, one red accent, a lot of white. Grotesque caps slide in and sit still.",
  },
  {
    name: "Punk zine",
    copy: "Ransom-note collage: photocopied halftone, one fluorescent spot colour, one word at a time.",
  },
  {
    name: "Newsprint editorial",
    copy: "A mid-century front page brought to life: cut-out photographs, heavy halftone, condensed caps.",
  },
  {
    name: "Gilded deco",
    copy: "1920s art-deco press page: aged cream paper, champagne-gold foil, thin geometric frames.",
  },
  {
    name: "Atomic age",
    copy: "1950s retro-futurism: starbursts, teal and orange, optimistic geometry. Type pops on the beat.",
  },
  {
    name: "Photo collage",
    copy: "Cinematic documentary collage: archival black-and-white cut-outs, one restrained accent colour.",
  },
];

export default function MotionFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="Kinetic type"
        illustration={
          <MediaCard
            kind="video"
            label="Motion project - narration to composited kinetic type"
            ratio="16/9"
          />
        }
        kicker="Motion graphics"
        lede="Paste a script. Sentence boundaries become beats, every beat gets its own picture and its own line of type, and the whole thing composites into one video with your narration intact underneath."
        magneticPrimary
        titleText="Narration in. Kinetic type over b-roll, out."
        variant="mist"
      />

      {/* 1 - pipeline */}
      <StageGrid
        eyebrow="The pipeline"
        heading="Six stages, and the plan survives all of them."
        highlight="the plan survives"
        label="The motion pipeline"
        lede="Narration goes in at the top and an mp4 comes out at the bottom, but the interesting part is the middle: a plan you can read afterwards, beat by beat."
        media={{
          kind: "illustration",
          label: "Motion pipeline - narration, beats, picture, composite",
        }}
        stages={STAGES}
      />

      {/* 2 - sourcing */}
      <Band
        bullets={[
          "Generated: every beat gets an art-directed keyframe in the chosen style.",
          "Stock footage: every beat is searched for real footage, and a miss falls back to a generated frame rather than failing the render.",
          "Mixed: concrete beats use stock, abstract beats are generated.",
        ]}
        eyebrow="B-roll"
        extraCopy="Keywords for the stock beats are decided in one batched call, not one call per beat - a sixteen-beat project is a single request, which is a cost decision rather than a style preference."
        flip
        heading="Three ways to fill the picture track."
        highlight="the picture track."
        label="B-roll sourcing"
        lede="You choose how the visuals are sourced, and the finished plan records which strategy actually supplied each beat - including the beats that fell back."
        media={
          <MediaCard kind="image" label="B-roll sourcing - generated, stock, mixed" />
        }
      />

      {/* 3 - audio invariant */}
      <Band
        bullets={[
          "Every per-beat clip is rendered with no audio stream at all.",
          "The concatenated picture track is silent by construction.",
          "The narration is muxed on exactly once, at the end.",
        ]}
        eyebrow="The audio rule"
        heading="B-roll replaces the picture. Never the voice."
        highlight="Never the voice."
        label="The audio rule"
        lede="There is no mixer here and no ducking, because there is nothing to duck. No stock clip's own soundtrack can displace, shorten, or talk over a word of the voiceover you paid for."
        media={
          <MediaCard
            kind="illustration"
            label="Silent picture track with the narration muxed once"
          />
        }
      />

      {/* 4 - styles */}
      <Section label="The style catalog">
        <SectionHead
          eyebrow="Style"
          heading="Eight art directions, each one a whole look."
          highlight="a whole look."
          lede="A style is two coordinated halves: the typography - font, casing, colour, position and the animation the words use - and the art direction that goes into every generated keyframe. The picker draws each one in its own treatment, so you can judge a look before paying for a render."
        />
        <SpecCards className="os-mt-48" cols={4} items={STYLES} />
        <Note title="Type that lands where it can be read.">
          Vertical feeds paint their own chrome over the video: captions and
          handles eat the bottom, the status bar and follow button eat the top.
          Every overlay is clamped inside a safe area and centred within
          horizontal margins, so no wrap, animation, or font size can push a
          word off-canvas or under the app's own furniture.
        </Note>
      </Section>

      {/* 5 - reuse */}
      <Band
        bullets={[
          "Reuse a voiceover from an existing job and pay for no TTS on this project.",
          "Up to six thousand characters of narration per project.",
          "Render at 9:16, 16:9, or 1:1 - every beat is composited to the canvas you pick.",
        ]}
        eyebrow="Reuse"
        flip
        heading="The voice you already bought is a voice you already own."
        highlight="already own."
        label="Reusing a voiceover"
        lede="A motion project can borrow the voiceover and transcript from a job you have already rendered, which skips synthesis and its spend entirely. Everything metered here runs through the same caps and the same prepaid balance as the rest of the product."
        media={
          <MediaCard kind="image" label="Composer - narration, style, source, aspect" />
        }
      />

      <Section label="Motion by the numbers" size="tight">
        <Stats
          items={[
            { value: "8", label: "art directions in the style catalog" },
            { value: "3", label: "b-roll strategies: generated, stock, mixed" },
            { value: "6,000", label: "characters of narration per project" },
          ]}
        />
      </Section>

      <SectionCta
        headline="Paste a script. Watch it become a picture track."
        highlight="a picture track."
        kicker="Get started"
        sub="Pick a style, pick how the b-roll is sourced, and read the plan the render leaves behind."
      />
    </main>
  );
}
