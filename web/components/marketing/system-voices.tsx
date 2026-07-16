"use client";

import { BarChart3, Bot, ShieldCheck, Timer } from "lucide-react";

import { Power } from "@/components/marketing/power";
import { Reveal } from "@/components/marketing/reveal";
import { ScrollFadeEffect } from "@/components/scroll-fade-effect";

/**
 * No fabricated customer quotes. The subsystems introduce themselves —
 * every line here maps to real behavior in the codebase.
 */
const VOICES = [
  {
    icon: ShieldCheck,
    system: "Spend Guard",
    file: "spend_context.py",
    quote:
      "I check the price of every API call before it happens. If a keyframe would put today over your cap, that call never leaves the building.",
  },
  {
    icon: BarChart3,
    system: "The Loop",
    file: "performance_context.py",
    quote:
      "I read your last thirty days (winners and flops) and brief the ideation agent before it writes a single word. Your best hook is my training data.",
  },
  {
    icon: Timer,
    system: "Scheduler",
    file: "scheduler.py",
    quote:
      "You pick the posting window once. I hit it every day, in your timezone, across every platform you enabled, and I tell you if a post bounces.",
  },
  {
    icon: Bot,
    system: "Agent Surface",
    file: "mcp_server.py",
    quote:
      "Dashboards are optional. Hand any agent a token and it can create niches, enqueue runs, and read the ledger. Same API, same guardrails.",
  },
];

export function SystemVoices() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24">
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          No testimonials. Receipts.
        </p>
        <h2 className="mt-3 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          The subsystems can{" "}
          <Power>speak for themselves</Power>.
        </h2>
      </Reveal>

      <ScrollFadeEffect
        className="mt-12 flex snap-x snap-mandatory gap-4 pb-4"
        orientation="horizontal"
      >
        {VOICES.map(({ icon: Icon, system, file, quote }) => (
          <figure
            className="min-w-[19rem] max-w-sm shrink-0 snap-start rounded-xl border border-border/60 bg-card/40 p-6 sm:min-w-[22rem]"
            key={system}
          >
            <blockquote className="text-sm leading-relaxed text-foreground">
              “{quote}”
            </blockquote>
            <figcaption className="mt-5 flex items-center gap-3 border-t border-border/60 pt-4">
              <span className="flex size-8 items-center justify-center rounded-md bg-brand/10">
                <Icon className="size-4 text-brand" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{system}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {file}
                </span>
              </span>
            </figcaption>
          </figure>
        ))}
      </ScrollFadeEffect>
    </section>
  );
}
