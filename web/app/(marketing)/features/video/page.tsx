import type { Metadata } from "next";

import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { Panel } from "@/components/marketing/features/detail-c/panel";
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
import {
  Band,
  Body,
  Card,
  CardGrid,
  CardLink,
  MediaCard,
  Section,
  SectionHead,
  Title,
} from "@/components/site/sections";

const DESCRIPTION =
  "Ideation, scene-by-scene scripts, on-model keyframes, voiceover, karaoke captions, QA, and scheduled publishing to TikTok, Reels, and Shorts. One brief in.";

export const metadata: Metadata = {
  title: "Video pipeline · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Video pipeline · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/video" },
};

/**
 * The four render paths that exist in the product, each with its own
 * module: the scene pipeline (`pipeline.py`), micro-dramas (`drama/`),
 * motion graphics (`motion/`) and the UGC studio (`ugc/`). Three have
 * their own page; the scene pipeline is this one.
 */
const ENGINES: Array<{
  kicker: string;
  title: string;
  copy: string;
  href?: string;
  linkLabel?: string;
}> = [
  {
    kicker: "Scene pipeline",
    title: "Brief to short, ten stages",
    copy: "A hook, a scene-by-scene script, one keyframe and one animated clip per scene, voice, music, captions and QA. The default path, and the one the rest of this page describes.",
  },
  {
    kicker: "Micro-dramas",
    title: "A cast that stays cast",
    copy: "Two to twelve shots with a screenplay structure and a recurring cast. Each character's reference portrait is generated once and reused for every shot they appear in, so nobody gets re-cast halfway through.",
    href: "/features/dramas",
    linkLabel: "Micro-dramas",
  },
  {
    kicker: "Motion graphics",
    title: "Narration into kinetic type",
    copy: "Sentence boundaries become beats. Every beat gets its own picture - generated or real stock footage - and its own line of animated type, with the narration muxed on once at the end.",
    href: "/features/motion",
    linkLabel: "Motion graphics",
  },
  {
    kicker: "UGC studio",
    title: "Lip-synced spokespeople",
    copy: "A catalog of video models behind one registry, with each model's allowed aspect ratios, durations and resolutions declared once and validated server-side before any money is spent.",
    href: "/features/ugc",
    linkLabel: "UGC studio",
  },
];

/**
 * The deterministic render gate, straight from `services/video_qa.py`.
 * Every entry is one check the module actually runs on the mp4.
 */
const RENDER_CHECKS = [
  {
    name: "It is a real file",
    chips: ["probeable"],
    copy: "The container opens, carries both a video and an audio stream, and is bigger than a broken render would be.",
  },
  {
    name: "Nothing is cut off",
    chips: ["vo coverage"],
    copy: "The measured duration has to cover the voiceover. Narration may end fractionally before the picture does; it may never end after.",
  },
  {
    name: "It isn't silent",
    chips: ["loudness floor"],
    copy: "Mean volume is measured against a floor, so a mix that failed quietly doesn't reach a feed as a mute video.",
  },
  {
    name: "It is the length you asked for",
    chips: ["drift tolerance"],
    copy: "Real duration is compared with the niche's target and refused if it has drifted too far - except in lip-sync mode, where the narration decides the length.",
  },
  {
    name: "It will actually upload",
    chips: ["size budget"],
    copy: "A file over the publishing upload ceiling is re-encoded to a bitrate budget and re-verified, rather than failing at the last step.",
  },
  {
    name: "Then, and only then, the content pass",
    chips: ["llm judge"],
    copy: "The content judge reads the script and the transcript - it never sees the file. Passing it is the only route to scheduling.",
  },
];

export default function VideoFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="A finished short out."
        illustration={
          <MediaCard
            kind="video"
            label="Studio demo - brief to published short"
            ratio="16/9"
          />
        }
        kicker="Short-form video"
        lede="Give it a channel brief. It writes the script, generates the frames, voices the lines, cuts the edit, and posts on schedule. You review the result, not the work."
        magneticPrimary
        titleText="One brief in. A finished short out."
        variant="sky"
      />

      <VideoWalkthrough />

      {/* Four render paths */}
      <Section label="Ways to make a video">
        <div className="os-split">
          <SectionHead
            eyebrow="Four render paths"
            heading="One queue. Four different ways to make the video."
            highlight="Four different ways"
            lede="They share the ledger, the caps, the approval gate and the publishing queue. What differs is what happens between the brief and the mp4."
          />
          <MediaCard
            kind="illustration"
            label="Render paths - scenes, drama, motion, UGC"
          />
        </div>
        <CardGrid className="os-mt-48" cols={2}>
          {ENGINES.map((e) => (
            <Card href={e.href} key={e.kicker}>
              <p className="os-meta">{e.kicker}</p>
              <Title className="os-mt-12">{e.title}</Title>
              <Body className="os-mt-12">{e.copy}</Body>
              {e.linkLabel ? <CardLink>{e.linkLabel}</CardLink> : null}
            </Card>
          ))}
        </CardGrid>
      </Section>

      {/* Fan-out */}
      <Band
        bullets={[
          "Scene work runs concurrently, but the number of scenes in flight at once is capped - it is a spend-rate control as much as a rate-limit one.",
          "A scene that fails doesn't discard its siblings: the clips that succeeded are written to the job before the failure is raised.",
          "A retry resumes. The script, the finished clips and the voiceover are reused; only the missing pieces are bought again.",
        ]}
        eyebrow="Fan-out"
        extraCopy="The exception is a content rejection. There the artifacts are the problem, so the run starts clean rather than re-judging the same script to death."
        heading="Scenes render in parallel, but never unboundedly."
        highlight="never unboundedly."
        label="Bounded fan-out and resume"
        lede="Six scenes means six image calls and six animation calls. Fired all at once they can cross a daily cap in the gap between the pre-flight check and the first ledger write, so the pipeline holds a fixed number of scenes in flight and lets the rest wait."
        media={
          <MediaCard
            kind="illustration"
            label="Scene fan-out - bounded concurrency and per-scene resume"
          />
        }
      />

      <QueueMoment />

      <CharacterBand />

      {/* Providers */}
      <Band
        bullets={[
          "Fallback means a different vendor. A provider's own transient retries already ran inside that provider; the same model is never called twice in a row here.",
          "A lip-synced job only ever falls back to another lip-sync model - silently dropping to a mute animation would destroy the format instead of failing loudly.",
          "A spend-cap breach is never fallen back past. It propagates untouched from whichever attempt raised it.",
        ]}
        eyebrow="When a vendor fails"
        extraCopy="A misconfigured voice provider is caught before the run starts, not at the voicing stage - after a script, six keyframes and six animations have already been paid for."
        flip
        heading="A dead vendor shouldn't strand a video you already paid for."
        highlight="shouldn't strand a video"
        label="Provider fallback"
        lede="Every provider's own retry policy is transient-only, so an error that escapes one is a real, persistent problem with that vendor - a rotated key, a retired model, an outage. The answer is to render the same thing somewhere else."
        media={
          <MediaCard
            kind="image"
            label="Provider chain - primary model and its fallback"
          />
        }
      />

      {/* QA */}
      <Section label="Quality gates">
        <SectionHead
          eyebrow="Two gates"
          heading="A machine checks the file. A judge checks the video."
          highlight="A judge checks the video."
          lede="The first gate is deterministic and runs on the rendered mp4 itself - no model involved, no opinion. Only a file that clears it reaches the content pass, and only a video that clears both can be scheduled."
        />
        <SpecCards className="os-mt-48" items={RENDER_CHECKS} />
        <Note title="One regenerate, and only when the script is the problem.">
          When the content judge says the script is what failed, the run
          rewrites it once and tries again - failing there would throw away
          rendering that came out fine. That second attempt is bounded: it
          cannot ask for a third, and every call it makes is metered and
          capped like the first.
        </Note>
      </Section>

      <ApprovalGateBand />

      <PlatformRow />

      <Panel
        body="A niche runs one job at a time, and an account runs a small fixed number at once. So a bad brief costs you one video, and a busy day can't quietly become a bill."
        bullets={[
          "Every model call - ideation, script, images, animation, voice, transcription - is priced and written to the ledger as it happens.",
          "Per-niche and global daily caps are re-checked after every one of those writes, not just before the job starts.",
          "The queue shows the estimate before you run anything, and what it actually cost afterwards.",
        ]}
        eyebrow="What a video can cost you"
        heading="The pipeline is the expensive part, so it is the metered part."
        highlight="the metered part."
        label="Video spend"
      />

      <VideoStats />

      <SectionCta
        headline="Ship your first short today."
        highlight="your first short"
        kicker="Get started"
        sub="Describe your channel once. The pipeline handles the other ten stages."
      />
    </main>
  );
}
