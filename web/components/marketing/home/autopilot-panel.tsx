"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { CountUp, Stagger } from "@/components/marketing/system";
import { EASE, VIEWPORT } from "@/components/marketing/system/motion";

/* ------------------------------------------------------------------ */
/* Mini UI mocks inside the dark cards (hand-built, never screenshots) */
/* ------------------------------------------------------------------ */

function MockAutopilot() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[12px]">
      {[
        { label: "Ideate 3 hooks — fitness niche", state: "done" },
        { label: "Render short — scene 4 of 6", state: "live" },
        { label: "Publish 9:00 AM slot", state: "queued" },
      ].map((row) => (
        <div
          className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-0"
          key={row.label}
        >
          <span className="text-zinc-300">{row.label}</span>
          {row.state === "done" && <span className="text-amber-400">done</span>}
          {row.state === "live" && (
            <span className="flex items-center gap-1.5 text-rose-400">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-rose-400" />
              </span>
              live
            </span>
          )}
          {row.state === "queued" && <span className="text-zinc-500">queued</span>}
        </div>
      ))}
    </div>
  );
}

function MockAsk() {
  return (
    <div className="space-y-2 text-[12px]">
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-white/10 px-3 py-2 text-zinc-200">
        What was our cost per published short last week?
      </div>
      <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3 py-2 text-zinc-300">
        $0.84 across 21 shorts. Tuesday&apos;s batch ran cheapest, want the
        breakdown by niche?
      </div>
    </div>
  );
}

function MockMcp() {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-zinc-400">
      <p>
        <span className="text-amber-400">$</span> marketer campaign create \
      </p>
      <p className="pl-4">--brief &quot;spring launch&quot; --cap 25.00</p>
      <p className="text-zinc-500">✓ queued 4 videos, 2 articles</p>
      <p className="text-zinc-500">✓ cap enforced: $25.00 / day</p>
    </div>
  );
}

const CARDS = [
  {
    kicker: "Always on",
    title: "Autopilot runs the channel 24/7",
    desc: "Give it a niche and a daily cap. It plans, produces, and publishes on schedule, and never spends past the cap.",
    mock: <MockAutopilot />,
  },
  {
    kicker: "Instant answers",
    title: "Ask your marketing anything",
    desc: "Spend, performance, and queue state live in one system, so the answer comes from data, not from a hunt across tabs.",
    mock: <MockAsk />,
  },
  {
    kicker: "Agent surfaces",
    title: "Your agents ship the campaign",
    desc: "REST API, Python SDK, CLI, and an MCP server. Whatever runs your agents can run your marketing.",
    mock: <MockMcp />,
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
            <h2 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
              The only marketing that works
              <br className="hidden md:block" /> while you sleep.
            </h2>
            <div className="mt-8">
              <Link
                className="inline-flex min-h-12 items-center rounded-xl bg-white px-7 text-[15px] font-semibold text-zinc-950 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href="/sign-up"
              >
                Start tonight&apos;s shift
              </Link>
            </div>
          </div>

          <Stagger className="mt-16 grid gap-5 lg:grid-cols-3">
            {CARDS.map((card) => (
              <div
                className="flex flex-col rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6"
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
                <div className="mt-5 flex-1">{card.mock}</div>
              </div>
            ))}
          </Stagger>

          {/* Stat strip along the panel foot, like the reference's metric cards. */}
          <div className="mt-14 grid gap-5 border-t border-white/[0.08] pt-10 sm:grid-cols-3">
            {STATS.map((s) => (
              <div className="text-center" key={s.label}>
                <p className="font-display text-4xl font-semibold tracking-tight text-white">
                  <CountUp
                    decimals={s.decimals ?? 0}
                    prefix={s.prefix ?? ""}
                    suffix={s.suffix ?? ""}
                    value={s.value}
                  />
                </p>
                <p className="mt-1.5 text-sm text-zinc-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
