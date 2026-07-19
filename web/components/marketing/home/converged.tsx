"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { ImagePlaceholder, Reveal } from "@/components/marketing/system";
import { EASE, VIEWPORT } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* The capability grid                                                 */
/* ------------------------------------------------------------------ */

type Cap = { label: string; href: string; tint: string; glyph: React.ReactNode };

const g = (d: string) => <path d={d} />;

/** Every capability the platform covers, as small labeled icon tiles —
 *  the reference's wall-of-features grid, tailored to marketer.sh. */
const CAPS: Cap[] = [
  { label: "Ideation", href: "/features/video", tint: "text-amber-500", glyph: g("M12 3a6 6 0 0 0-4 10.5c.7.6 1 1.5 1 2.5h6c0-1 .3-1.9 1-2.5A6 6 0 0 0 12 3ZM9.5 19h5M10.5 22h3") },
  { label: "Scripts", href: "/features/video", tint: "text-sky-500", glyph: g("M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6") },
  { label: "Keyframes", href: "/features/video", tint: "text-violet-500", glyph: g("M3 5h18v14H3ZM3 9h18M7 5v14M17 5v14") },
  { label: "Animation", href: "/features/video", tint: "text-rose-500", glyph: g("M4 6h11v12H4ZM15 10l5-3v10l-5-3") },
  { label: "Voiceover", href: "/features/video", tint: "text-orange-500", glyph: g("M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 12a6 6 0 0 0 12 0M12 18v3") },
  { label: "Music", href: "/features/video", tint: "text-fuchsia-500", glyph: g("M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z") },
  { label: "Captions", href: "/features/video", tint: "text-cyan-600", glyph: g("M4 5h16v14H4ZM7 15h4M13 15h4M7 11h10") },
  { label: "QA gates", href: "/features/video", tint: "text-amber-600", glyph: g("M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6ZM9 12l2 2 4-4") },
  { label: "Publishing", href: "/features/video", tint: "text-indigo-500", glyph: g("M12 19V5M5 12l7-7 7 7") },
  { label: "SERP research", href: "/features/articles", tint: "text-sky-600", glyph: g("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.5-4.5") },
  { label: "Outlines", href: "/features/articles", tint: "text-violet-600", glyph: g("M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01") },
  { label: "Articles", href: "/features/articles", tint: "text-rose-600", glyph: g("M5 3h14v18H5ZM9 8h6M9 12h6M9 16h4") },
  { label: "JSON-LD", href: "/features/articles", tint: "text-slate-500", glyph: g("M8 4c-2 0-3 1-3 3v2c0 1.5-1 2-2 2 1 0 2 .5 2 2v3c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 2 2 2-1 0-2 .5-2 2v3c0 2-1 3-3 3") },
  { label: "Hero images", href: "/features/articles", tint: "text-pink-500", glyph: g("M4 5h16v14H4ZM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM20 15l-5-5-9 9") },
  { label: "Ad campaigns", href: "/features", tint: "text-orange-600", glyph: g("M3 11l14-6v14L3 13v-2ZM17 8a4 4 0 0 1 0 8M7 14v5h3") },
  { label: "Spend caps", href: "/features/analytics", tint: "text-amber-500", glyph: g("M12 3v18M7 7.5C7 6 8.5 5 12 5s5 1 5 2.5S15.5 10 12 10s-5 1-5 2.5S8.5 15 12 15s5 1 5 2.5S15.5 20 12 20s-5-1-5-2.5") },
  { label: "Approvals", href: "/features/analytics", tint: "text-emerald-600", glyph: g("M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9") },
  { label: "Scheduling", href: "/features/video", tint: "text-indigo-600", glyph: g("M5 5h14v15H5ZM5 9h14M9 3v4M15 3v4M9 14l2 2 4-4") },
  { label: "Analytics", href: "/features/analytics", tint: "text-sky-500", glyph: g("M4 20h16M6 16v-4M11 16V8M16 16v-6M21 16V6") },
  { label: "Learning loop", href: "/features/analytics", tint: "text-rose-500", glyph: g("M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6") },
  { label: "Brand kit", href: "/features", tint: "text-violet-500", glyph: g("M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-.5-2 1-2h2a4 4 0 0 0 4-4c0-5-4-10-9-10ZM7.5 12a1 1 0 1 0 0-2M12 8a1 1 0 1 0 0-2M16.5 12a1 1 0 1 0 0-2") },
  { label: "Niches", href: "/features", tint: "text-cyan-500", glyph: g("M12 3l9 5-9 5-9-5ZM3 13l9 5 9-5") },
  { label: "REST API", href: "/resources/api", tint: "text-slate-600", glyph: g("M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14") },
  { label: "MCP server", href: "/resources/api", tint: "text-amber-600", glyph: g("M5 8h6v8H5ZM13 8h6v8h-6ZM11 12h2M2 12h3M19 12h3") },
];

function CapTile({ cap }: { cap: Cap }) {
  return (
    <Link
      className="group flex flex-col items-center gap-2 rounded-2xl px-2 py-4 transition-colors hover:bg-zinc-900/[0.03]"
      href={cap.href}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-11 items-center justify-center rounded-xl border border-zinc-900/[0.06] bg-white shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5",
          cap.tint,
        )}
      >
        <svg
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          viewBox="0 0 24 24"
        >
          {cap.glyph}
        </svg>
      </span>
      <span className="text-center text-[12px] font-medium leading-tight text-zinc-600 group-hover:text-zinc-900">
        {cap.label}
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Floating product cards over the grid                                */
/* ------------------------------------------------------------------ */

const FLOATERS: Array<{
  name: string;
  file: string;
  label: string;
  className: string;
  delay: number;
}> = [
  {
    name: "Studio",
    file: "converged-studio.png",
    label: "Studio — video queue",
    className: "left-[4%] top-[8%] w-64 -rotate-2",
    delay: 0,
  },
  {
    name: "Press",
    file: "converged-press.png",
    label: "Press — article SEO panel",
    className: "right-[5%] top-[16%] w-60 rotate-2",
    delay: 0.1,
  },
  {
    name: "Agents",
    file: "converged-agents.png",
    label: "Agent chat — campaign brief",
    className: "left-[14%] bottom-[6%] w-60 rotate-1",
    delay: 0.2,
  },
  {
    name: "Ads",
    file: "converged-ads.png",
    label: "Ads — budget guardrails",
    className: "right-[12%] bottom-[10%] w-64 -rotate-1",
    delay: 0.3,
  },
];

function Floater({ f }: { f: (typeof FLOATERS)[number] }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={cn("pointer-events-none absolute hidden xl:block", f.className)}
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 28 }}
      transition={{ duration: 0.8, ease: EASE, delay: f.delay }}
      viewport={VIEWPORT}
      whileInView={{ opacity: 1, y: 0 }}
    >
      <div className="overflow-hidden rounded-2xl border border-zinc-900/[0.08] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.16)]">
        <div className="flex items-center gap-1.5 border-b border-zinc-900/[0.06] px-3 py-2">
          <span className="size-2 rounded-full bg-zinc-200" />
          <span className="size-2 rounded-full bg-zinc-200" />
          <span className="ml-1 text-[11px] font-medium text-zinc-500">
            {f.name}
          </span>
        </div>
        <ImagePlaceholder
          aspect="aspect-[16/11]"
          className="rounded-none border-0"
          file={f.file}
          label={f.label}
        />
      </div>
    </motion.div>
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
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
            Everything you need in one
            <br className="hidden md:block" /> converged marketing platform.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-zinc-600">
            Ideation to publish to learning, every step lives in the same
            system and shares the same budget.
          </p>
        </Reveal>

        <Reveal className="relative mt-16" delay={0.1}>
          {/* Dim the grid edges so the floating cards pop, like the reference. */}
          <div className="rounded-[2rem] border border-zinc-900/[0.05] bg-white/60 p-4 md:p-8">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
              {CAPS.map((cap) => (
                <CapTile cap={cap} key={cap.label} />
              ))}
            </div>
          </div>
          {FLOATERS.map((f) => (
            <Floater f={f} key={f.name} />
          ))}
        </Reveal>
      </div>
    </section>
  );
}
