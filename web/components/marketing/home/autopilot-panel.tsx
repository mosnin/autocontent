"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import {
  TaggedPlaceholder,
  TextReveal,
  PinScene,
  Magnetic,
} from "@/components/marketing/system";
import CountUp from "@/components/reactbits/CountUp";
import { EASE, VIEWPORT } from "@/components/marketing/system/motion";

const CARDS = [
  {
    kicker: "Always on",
    title: "Autopilot runs the channel 24/7",
    desc: "Give it a niche and a daily cap. It plans, produces, and publishes on schedule, and never spends past the cap.",
    placeholder: { label: "Autopilot queue — screenshot", tone: "warm" as const },
  },
  {
    kicker: "Instant answers",
    title: "Ask your marketing anything",
    desc: "Spend, performance, and queue state live in one system, so the answer comes from data, not from a hunt across tabs.",
    placeholder: { label: "Agent chat — screenshot", tone: "sky" as const },
  },
  {
    kicker: "Agent surfaces",
    title: "Your agents ship the campaign",
    desc: "REST API, Python SDK, CLI, and an MCP server. Whatever runs your agents can run your marketing.",
    placeholder: { label: "CLI session — screenshot", tone: "violet" as const },
  },
];

const STATS: Array<{
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label: string;
}> = [
  { value: 10, suffix: " min", label: "brief to first published short" },
  { value: 0, prefix: "$", decimals: 2, label: "ever spent past your cap" },
  { value: 24, suffix: "/7", label: "the pipeline keeps shipping" },
];

/* ------------------------------------------------------------------ */

export function AutopilotPanel() {
  const reduced = useReducedMotion();
  return (
    <section aria-label="Autopilot" className="bg-white px-3 pb-24 md:px-6 md:pb-32">
      <PinScene
        build={(el, tl) => {
          const cards = Array.from(
            el.querySelectorAll<HTMLElement>("[data-autopilot-card]"),
          );
          const stats = el.querySelector<HTMLElement>("[data-autopilot-stats]");
          tl.from(cards[0], { y: 60, opacity: 0, duration: 0.33, ease: "power2.out" }, 0)
            .from(cards[1], { y: 60, opacity: 0, duration: 0.33, ease: "power2.out" }, 0.33)
            .from(cards[2], { y: 60, opacity: 0, duration: 0.33, ease: "power2.out" }, 0.66)
            .from(stats, { opacity: 0, duration: 0.34, ease: "power2.out" }, 1);
        }}
        lengthVh={140}
      >
        <motion.div
          className="mx-auto max-w-[88rem] overflow-hidden rounded-[2.5rem] bg-zinc-950 px-6 py-20 md:px-14 md:py-28"
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 32 }}
          transition={{ duration: 0.8, ease: EASE }}
          viewport={VIEWPORT}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center">
              <p className="flex items-center justify-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
                <span
                  aria-hidden
                  className="size-2 rounded-full bg-[linear-gradient(135deg,#f59e0b,#f43f5e)]"
                />
                marketer.sh autopilot
              </p>
              <TextReveal
                as="h2"
                className="mt-5 font-display text-4xl font-semibold tracking-tight text-white md:text-5xl"
              >
                The only marketing that works while you sleep.
              </TextReveal>
              <div className="mt-8">
                <Magnetic>
                  <Link
                    className="inline-flex min-h-12 items-center rounded-xl bg-white px-7 text-[15px] font-semibold text-zinc-950 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    href="/sign-up"
                  >
                    Start tonight&apos;s shift
                  </Link>
                </Magnetic>
              </div>
            </div>

            <div className="mt-16 grid gap-5 lg:grid-cols-3">
              {CARDS.map((card) => (
                <div
                  className="flex flex-col rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6"
                  data-autopilot-card
                  key={card.title}
                >
                  <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                    {card.kicker}
                  </p>
                  <h3 className="mt-2.5 text-lg font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">
                    {card.desc}
                  </p>
                  <div className="mt-5 aspect-[16/11] overflow-hidden rounded-xl border border-white/10">
                    <TaggedPlaceholder
                      kind="image"
                      label={card.placeholder.label}
                      tone={card.placeholder.tone}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Stat strip along the panel foot, like the reference's metric cards. */}
            <div
              className="mt-14 grid gap-5 border-t border-white/[0.08] pt-10 sm:grid-cols-3"
              data-autopilot-stats
            >
              {STATS.map((s) => (
                <div className="text-center" key={s.label}>
                  <p className="font-display text-4xl font-semibold tracking-tight text-white">
                    {s.prefix ?? ""}
                    <CountUp duration={1.4} to={s.value} />
                    {s.suffix ?? ""}
                  </p>
                  <p className="mt-1.5 text-sm text-zinc-500">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </PinScene>
    </section>
  );
}
