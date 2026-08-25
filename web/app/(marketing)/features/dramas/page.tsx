import type { Metadata } from "next";

import { Note } from "@/components/marketing/features/detail-a/note";
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
  "One premise becomes a screenplay, a locked cast, a shot list, and a stitched vertical short. Each character's portrait is generated once and reused in every shot they appear in.";

export const metadata: Metadata = {
  title: "Micro-dramas — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Micro-dramas — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/dramas" },
};

/** The seven statuses a drama moves through, in pipeline order. */
const STAGES = [
  {
    label: "Queued",
    copy: "The run is accepted and the niche's daily cap is checked before any stage starts spending.",
  },
  {
    label: "Screenwriting",
    copy: "Your premise becomes a title, a logline, beats and a shot list. Supply a finished script and this stage is skipped entirely.",
  },
  {
    label: "Casting",
    copy: "The recurring, visible characters are extracted and each one gets a single reference portrait.",
    tag: "locked",
  },
  {
    label: "Storyboarding",
    copy: "One prompt per shot, with the locked cast written into it verbatim so the model describes the same people it was told about.",
  },
  {
    label: "Rendering shots",
    copy: "Each shot is a keyframe generated against its character's portrait, then animated. Shots run concurrently, but bounded.",
  },
  {
    label: "Editing",
    copy: "Clips are concatenated in order and the spoken lines are laid over the cut in one pass.",
    tag: "ffmpeg",
  },
  {
    label: "Done",
    copy: "One vertical short, plus the plan that produced it — screenplay, cast, and every shot.",
  },
];

export default function DramasFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="A cast that doesn't change."
        illustration={
          <MediaCard
            kind="video"
            label="Micro-drama — premise to stitched vertical short"
            ratio="16/9"
          />
        }
        kicker="Micro-dramas"
        lede="Give the screenwriter one sentence of premise. It comes back with a cast you can look in the eye — and the same faces are still there in the last shot."
        magneticPrimary
        titleText="One premise in. A cast that doesn't change."
        variant="sky"
      />

      {/* 1 — the pipeline */}
      <StageGrid
        eyebrow="The pipeline"
        heading="Seven stages, and you can watch which one it's in."
        highlight="which one it's in."
        label="The drama pipeline"
        lede="A drama is an idea driven through screenplay, cast, shot list, per-shot clips, and one stitched short. Each stage checkpoints its work to the run before the next one starts."
        media={{
          kind: "illustration",
          label: "Drama pipeline — seven stages from premise to short",
        }}
        stages={STAGES}
      />

      {/* 2 — character consistency */}
      <Band
        bullets={[
          "A character's reference portrait is generated exactly once and never regenerated for the life of the drama.",
          "Every shot they appear in is produced as an edit of that portrait, not as a fresh reading of a description.",
          "Shots with nobody in them fall back to the niche's style sheet, so the art direction holds in empty frames too.",
        ]}
        eyebrow="Casting"
        extraCopy="The casting brief is specific for a reason: apparent age, build, face shape, hair, one distinctive identifying detail, and a single outfit worn for the whole film. Vague descriptions produce a different person every render."
        flip
        heading="The face is locked before the first shot is bought."
        highlight="locked"
        label="Character consistency"
        lede="Up to five recurring characters are extracted from the screenplay, and each gets one portrait. That portrait becomes the image reference for every shot they are in — which is the whole reason the actor doesn't change mid-film."
        media={
          <MediaCard
            kind="image"
            label="Locked cast portraits reused across shots"
          />
        }
      />

      {/* 3 — idea or script */}
      <Band
        bullets={[
          "From an idea: one or two sentences of premise is enough to start.",
          "From a script: paste a finished screenplay and the writer stage is skipped — and never paid for.",
          "Two to twelve shots per drama, six by default, in 9:16, 16:9, or 1:1.",
        ]}
        eyebrow="Two ways in"
        heading="Bring a premise, or bring the whole screenplay."
        highlight="or bring the whole screenplay."
        label="Idea or script"
        lede="The screenwriter turns a premise into a title, a logline, beats and a shot list. If you already have the script, that work is yours and there is nothing to pay for it."
        media={
          <MediaCard
            kind="image"
            label="Composer — idea or finished script, shots, aspect"
          />
        }
      />

      {/* 4 — spend */}
      <Band
        bullets={[
          "Every call is gated by the niche's daily cap, your global daily cap, and your prepaid credit.",
          "The cap is re-checked between stages, so a run that can no longer afford the next stage stops instead of starting it.",
          "Per-shot work fans out concurrently but capped, because a dozen simultaneous calls can cross a cap before the ledger reacts.",
        ]}
        eyebrow="Spend"
        flip
        heading="The most expensive thing in the product, kept on a leash."
        highlight="kept on a leash."
        label="Spend control"
        lede="A drama buys one image and one video generation per shot, plus a portrait per cast member. That makes it the priciest artifact here, so it gets the tightest metering."
        media={
          <MediaCard
            kind="illustration"
            label="Per-shot spend against the niche cap"
          />
        }
      />

      <Section label="Resuming a drama" size="tight">
        <Note title="A retry never re-buys what already worked.">
          The plan is checkpointed to the run after every stage and every
          expensive artifact is addressed by a fixed path, so a resumed drama
          adopts the screenplay, the portraits, the keyframes and the finished
          shots it already has. A drama that fails on the last shot has already
          spent real money on the others — losing that would be the expensive
          kind of retry.
        </Note>
      </Section>

      <Section label="Dramas by the numbers" size="tight">
        <Stats
          items={[
            { value: "2–12", label: "shots per drama, six by default" },
            { value: "5", label: "recurring cast members, hard maximum" },
            { value: "1", label: "portrait per character, generated once" },
          ]}
        />
      </Section>

      <SectionCta
        headline="One sentence. One cast. One short."
        highlight="One cast."
        kicker="Get started"
        sub="Start at two shots to see the look, then run the same premise longer once the cast is right."
      />
    </main>
  );
}
