"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { Reveal, Parallax, TextReveal } from "@/components/marketing/system";
import { EASE, VIEWPORT } from "@/components/marketing/system/motion";
import { MediaSlot } from "@/components/media-slot";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const REDUCED = "(prefers-reduced-motion: reduce)";
const FULL = "(prefers-reduced-motion: no-preference)";

/* ------------------------------------------------------------------ */
/* The capability chips                                                */
/* ------------------------------------------------------------------ */

type Cap = { label: string; href: string };
type CapGroup = { kicker: string; items: Cap[] };

/** Every capability the platform covers, grouped by the product that owns
 *  it. Text-only chips — no icon standing in for the words. */
const GROUPS: CapGroup[] = [
  {
    kicker: "Studio",
    items: [
      { label: "Ideation", href: "/features/video" },
      { label: "Scripts", href: "/features/video" },
      { label: "Keyframes", href: "/features/video" },
      { label: "Animation", href: "/features/video" },
      { label: "Voiceover", href: "/features/video" },
      { label: "Music", href: "/features/video" },
      { label: "Captions", href: "/features/video" },
      { label: "QA gates", href: "/features/video" },
      { label: "Publishing", href: "/features/video" },
      { label: "Scheduling", href: "/features/video" },
    ],
  },
  {
    kicker: "Press",
    items: [
      { label: "SERP research", href: "/features/articles" },
      { label: "Outlines", href: "/features/articles" },
      { label: "Articles", href: "/features/articles" },
      { label: "JSON-LD", href: "/features/articles" },
      { label: "Hero images", href: "/features/articles" },
    ],
  },
  {
    kicker: "Ads",
    items: [
      { label: "Ad campaigns", href: "/features" },
      { label: "Spend caps", href: "/features/analytics" },
      { label: "Approvals", href: "/features/analytics" },
    ],
  },
  {
    kicker: "Platform",
    items: [
      { label: "Analytics", href: "/features/analytics" },
      { label: "Learning loop", href: "/features/analytics" },
      { label: "Brand kit", href: "/features" },
      { label: "Niches", href: "/features" },
      { label: "REST API", href: "/resources/api" },
      { label: "MCP server", href: "/resources/api" },
    ],
  },
];

function CapChip({ cap }: { cap: Cap }) {
  return (
    <Link
      className="rounded-full border border-zinc-900/10 bg-white px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:border-zinc-900/30 hover:text-zinc-950"
      data-cap-tile
      href={cap.href}
    >
      {cap.label}
    </Link>
  );
}

/** Scroll-triggered cascade for the capability chips — they rise into place
 *  once as the grid enters view. Reduced motion renders them settled. */
function CapGrid() {
  const gridRef = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const grid = gridRef.current;
      if (!grid) return;
      const tiles = grid.querySelectorAll<HTMLElement>("[data-cap-tile]");
      const mm = gsap.matchMedia();

      mm.add(FULL, () => {
        gsap.from(tiles, {
          y: 12,
          opacity: 0,
          stagger: { each: 0.018, from: "start" },
          ease: "power3.out",
          duration: 0.5,
          scrollTrigger: { trigger: grid, start: "top 85%", once: true },
        });
      });

      mm.add(REDUCED, () => {
        gsap.set(tiles, { y: 0, opacity: 1 });
      });
    },
    { scope: gridRef },
  );

  return (
    <div className="divide-y divide-zinc-900/[0.06]" ref={gridRef}>
      {GROUPS.map((group) => (
        <div
          className="py-6 first:pt-0 last:pb-0 md:flex md:items-start md:gap-8 md:py-7"
          key={group.kicker}
        >
          <p className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400 md:w-28 md:pt-2.5">
            {group.kicker}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 md:mt-0">
            {group.items.map((cap) => (
              <CapChip cap={cap} key={cap.label} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Floating product cards over the grid                                */
/* ------------------------------------------------------------------ */

const FLOATERS: Array<{
  name: string;
  slotId: string;
  className: string;
  delay: number;
  parallaxSpeed: number;
}> = [
  {
    name: "Studio",
    slotId: "mk-converged-studio",
    className: "left-[4%] top-[8%] w-64 -rotate-2",
    delay: 0,
    parallaxSpeed: -0.16,
  },
  {
    name: "Press",
    slotId: "mk-converged-press",
    className: "right-[5%] top-[16%] w-60 rotate-2",
    delay: 0.1,
    parallaxSpeed: -0.08,
  },
  {
    name: "Agents",
    slotId: "mk-converged-agents",
    className: "left-[14%] bottom-[6%] w-60 rotate-1",
    delay: 0.2,
    parallaxSpeed: 0.1,
  },
  {
    name: "Ads",
    slotId: "mk-converged-ads",
    className: "right-[12%] bottom-[10%] w-64 -rotate-1",
    delay: 0.3,
    parallaxSpeed: 0.16,
  },
];

function Floater({ f }: { f: (typeof FLOATERS)[number] }) {
  const reduced = useReducedMotion();
  return (
    <Parallax
      className={cn("pointer-events-none absolute hidden xl:block", f.className)}
      speed={f.parallaxSpeed}
    >
      <motion.div
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 28 }}
        transition={{ duration: 0.8, ease: EASE, delay: f.delay }}
        viewport={VIEWPORT}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <div className="overflow-hidden rounded-2xl border border-zinc-900/[0.08] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.16)]">
          <div className="flex items-center border-b border-zinc-900/[0.06] px-3 py-2">
            <span className="text-[11px] font-medium text-zinc-500">
              {f.name}
            </span>
          </div>
          <div className="group aspect-[16/11]">
            <MediaSlot id={f.slotId} showChip={false} />
          </div>
        </div>
      </motion.div>
    </Parallax>
  );
}

/* ------------------------------------------------------------------ */

export function Converged() {
  return (
    <section
      aria-label="The converged platform"
      className="bg-[#f5f6f8] py-24 md:py-32"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <TextReveal
            as="h2"
            className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl"
          >
            Everything you need in one converged marketing platform.
          </TextReveal>
          <Reveal>
            <p className="mt-5 text-lg leading-relaxed text-zinc-600">
              Ideation to publish to learning, every step lives in the same
              system and shares the same budget.
            </p>
          </Reveal>
        </div>

        <Reveal className="relative mt-16" delay={0.1}>
          {/* Dim the grid edges so the floating cards pop, like the reference. */}
          <div className="rounded-[2rem] border border-zinc-900/[0.05] bg-white/60 p-6 md:p-10">
            <CapGrid />
          </div>
          {FLOATERS.map((f) => (
            <Floater f={f} key={f.name} />
          ))}
        </Reveal>
      </div>
    </section>
  );
}
