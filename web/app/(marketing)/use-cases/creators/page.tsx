import type { Metadata } from "next";

import { SectionCta, TaggedPlaceholder } from "@/components/marketing/system";
import {
  MockBand,
  OutcomesBand,
  PainBand,
  StepsBand,
  UseCaseHero,
} from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "Turn one brief into daily TikToks, Reels, and Shorts. A character sheet keeps your face and world consistent, and an approval gate reviews every post.";

export const metadata: Metadata = {
  title: "Creators — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Creators — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/use-cases/creators" },
};

export default function CreatorsPage() {
  return (
    <main>
      <UseCaseHero
        headline={["Post daily.", "Edit never."]}
        kicker="For creators and faceless channels"
        lede="One brief becomes tonight's shorts: scripted, voiced, animated, captioned, and scheduled. Your character stays consistent. Nothing posts until you say so."
        placeholderLabel="Creators in the product — hero still"
        placeholderTone="warm"
        scene="dusk"
      />
      <PainBand
        heading="Daily content eats the day."
        lede="The algorithm rewards showing up every day. The work says otherwise."
        pains={[
          {
            title: "Every short is an afternoon",
            copy: "Ideate, script, record, cut, caption, schedule. One post costs three hours, and you need seven a week.",
          },
          {
            title: "Consistency dies by week three",
            copy: "The channels that grow post daily for months. Most creators run out of steam long before the algorithm notices them.",
          },
          {
            title: "Your face is the bottleneck",
            copy: "On camera or nothing. A faceless channel sounds like the fix until you try keeping a character coherent across fifty videos.",
          },
        ]}
      />
      <StepsBand
        heading="Brief once. Queue fills nightly."
        steps={[
          {
            title: "Brief your channel",
            copy: "Niche, tone, and a character sheet: face, wardrobe, world. It locks, so video forty matches video four.",
          },
          {
            title: "The pipeline produces",
            copy: "Ideas become scripts, scripts become on-model keyframes, then animation, voiceover, captions, and a QA pass.",
          },
          {
            title: "You approve, it posts",
            copy: "Tonight's queue waits at your approval gate. Keep the gate on while you build trust, drop it when you have.",
          },
        ]}
      />
      <MockBand
        bullets={[
          "Character sheet keeps one consistent face and world",
          "Posts render for TikTok, Reels, and Shorts from one pass",
          "Approval gate holds everything until you tap approve",
        ]}
        heading="Tonight's three, ready by dinner."
        kicker="The product moment"
        lede="This is the queue for a faceless channel. Two posts approved, one waiting on you, all scheduled for the evening window."
        scene="dusk"
      >
        <div className="aspect-[4/3] w-full max-w-md overflow-hidden rounded-[1.75rem] border border-zinc-900/[0.06] shadow-[0_16px_50px_rgba(15,23,42,0.10)]">
          <TaggedPlaceholder
            kind="image"
            label="Creators workflow — screenshot"
            tone="warm"
          />
        </div>
      </MockBand>
      <OutcomesBand
        heading="The cadence, without the grind."
        stats={[
          { value: 3, label: "platforms filled from one nightly render" },
          {
            value: 0.5,
            decimals: 2,
            prefix: "$",
            label: "roughly what a finished short costs",
          },
          {
            value: 100,
            suffix: "%",
            label: "of posts held at the gate until you approve",
          },
        ]}
      />
      <SectionCta
        headline="Your channel, posting nightly."
        kicker="Get started"
        sub="Write the brief and the character sheet once. Review tonight's queue over dinner."
      />
    </main>
  );
}
