"use client";

import * as React from "react";
import Link from "next/link";

import { Magnetic, Reveal, Stagger, TextReveal } from "@/components/marketing/system";
import CountUp from "@/components/reactbits/CountUp";

/** Product economics band — the reference's ROI columns, with numbers
 *  from how the pipeline actually prices, not invented customer studies. */
const STATS: Array<{
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  title: string;
  desc: string;
}> = [
  {
    value: 400,
    suffix: "%",
    title: "more content shipped",
    desc: "One brief fans out to shorts, articles, and scheduled posts instead of a single asset.",
  },
  {
    value: 5,
    prefix: "$",
    title: "is all it takes to start",
    desc: "Prepaid credit packs. No subscription, no seat pricing, no card left on autopay.",
  },
  {
    value: 10,
    suffix: " min",
    title: "from brief to first short",
    desc: "Ideation, script, visuals, voiceover, captions, and QA run as one pipeline.",
  },
  {
    value: 100,
    suffix: "%",
    title: "of spend under a cap",
    desc: "Every niche and every campaign has a hard daily cap the system cannot cross.",
  },
];

export function Roi() {
  return (
    <section aria-label="Why it pays off" className="bg-white py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <TextReveal className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
              It&apos;s like adding a full content team.
            </TextReveal>
            <p className="mt-5 text-lg leading-relaxed text-zinc-600">
              Writers, editors, a media buyer, and an analyst, running as one
              pipeline you steer with briefs and caps.
            </p>
          </div>
          <Magnetic className="shrink-0">
            <Link
              className="inline-flex min-h-12 items-center rounded-xl bg-zinc-900 px-7 text-[15px] font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
              href="/sign-up"
            >
              Get started
            </Link>
          </Magnetic>
        </Reveal>

        <Stagger className="mt-16 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div className="border-t-2 border-zinc-900 pt-6" key={s.title}>
              <p className="font-display text-5xl font-semibold tracking-tight text-zinc-950">
                {s.prefix ?? ""}
                <CountUp duration={1.4} separator="," to={s.value} />
                {s.suffix ?? ""}
              </p>
              <p className="mt-2 text-[15px] font-semibold text-zinc-900">
                {s.title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
                {s.desc}
              </p>
            </div>
          ))}
        </Stagger>

        <p className="mt-10 text-xs text-zinc-400">
          Figures describe how the platform is built and priced, not audited
          customer results. Your output depends on your briefs and caps.
        </p>
      </div>
    </section>
  );
}
