"use client";

import {
  Reveal,
  Stagger,
  TaggedPlaceholder,
  TextReveal,
} from "@/components/marketing/system";

const STEPS = [
  {
    title: "You set the brief and the cap",
    desc: "Name the audience, the goal, and a daily budget. That is the whole job description. The cap is enforced fail-closed, so the system stops before the money does.",
  },
  {
    title: "It plans and produces every format",
    desc: "Hooks are ideated, scripts written, scenes rendered, voiceover recorded, captions burned in. Articles are built from live SERP research. Ad creatives follow the same brief.",
  },
  {
    title: "It publishes, measures, and learns",
    desc: "Posts land on schedule across TikTok, Reels, Shorts, and your blog. Two QA gates run before anything ships, and the performance loop feeds the next plan.",
  },
];

export function Sprawl() {
  return (
    <section aria-label="How it works" className="bg-white py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <TextReveal
            as="h2"
            className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl"
          >
            You write the brief. It runs the campaign.
          </TextReveal>
          <Reveal>
            <p className="mt-5 text-lg leading-relaxed text-zinc-600">
              One pipeline carries a brief from idea to published campaign.
              No handoffs, no export-and-reupload, no invoice surprises.
            </p>
          </Reveal>
        </div>

        <Reveal>
          <div className="mx-auto mt-14 max-w-4xl aspect-[16/4] overflow-hidden rounded-[2rem]">
            <TaggedPlaceholder
              kind="illustration"
              label="Pipeline diagram — brief to campaign live"
              tone="warm"
            />
          </div>
        </Reveal>

        <Stagger className="mx-auto mt-16 grid max-w-5xl gap-10 md:grid-cols-3">
          {STEPS.map((p) => (
            <div className="text-center md:text-left" key={p.title}>
              <h3 className="text-lg font-semibold text-zinc-900">{p.title}</h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-600">
                {p.desc}
              </p>
            </div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
