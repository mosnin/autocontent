"use client";

import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { Reveal, Stagger, TextReveal } from "@/components/marketing/system";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const REDUCED = "(prefers-reduced-motion: reduce)";
const FULL = "(prefers-reduced-motion: no-preference)";

const PAINS = [
  {
    title: "Tool switching",
    desc: "A video editor, a CMS, a scheduler, an ads console, a spreadsheet of budgets. Every handoff between them loses an hour and a little context.",
  },
  {
    title: "Budget blind spots",
    desc: "Generation and ad spend live in five dashboards, so nobody knows the real cost per post until the invoice lands. Overruns surface weeks late.",
  },
  {
    title: "Manual stitching",
    desc: "Someone still copies the script into the editor, the export into the scheduler, and the results into the report. That someone is your bottleneck.",
  },
];

/** Tangled scribble that resolves into a straight line — the reference's
 *  centerpiece graphic, drawn as an animated SVG path scrubbed by scroll. */
function SprawlLine() {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const pathRef = React.useRef<SVGPathElement>(null);
  const dotRef = React.useRef<SVGCircleElement>(null);
  const chipRef = React.useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const wrap = wrapRef.current;
      const path = pathRef.current;
      const dot = dotRef.current;
      const chip = chipRef.current;
      if (!wrap || !path || !dot || !chip) return;

      const mm = gsap.matchMedia();

      mm.add(FULL, () => {
        const length = path.getTotalLength();
        gsap.set(path, {
          strokeDasharray: length,
          strokeDashoffset: length,
        });
        gsap.set(dot, { scale: 0, opacity: 0, transformOrigin: "50% 50%" });
        gsap.set(chip, { opacity: 0, y: 8 });

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: wrap,
            scrub: 0.8,
            start: "top 75%",
            end: "bottom 55%",
          },
        });

        tl.to(path, { strokeDashoffset: 0, ease: "none" }, 0)
          .to(
            dot,
            { scale: 1, opacity: 1, duration: 0.15, ease: "power2.out" },
            0.85,
          )
          .to(
            chip,
            { opacity: 1, y: 0, duration: 0.15, ease: "power2.out" },
            0.85,
          );
      });

      mm.add(REDUCED, () => {
        gsap.set(path, { strokeDasharray: "none", strokeDashoffset: 0 });
        gsap.set(dot, { scale: 1, opacity: 1 });
        gsap.set(chip, { opacity: 1, y: 0 });
      });
    },
    { scope: wrapRef },
  );

  return (
    <div aria-hidden className="relative mx-auto mt-14 max-w-4xl px-6" ref={wrapRef}>
      <svg
        className="w-full"
        fill="none"
        viewBox="0 0 800 160"
      >
        <path
          d="M10 80 C 60 20, 90 150, 150 90 S 220 10, 260 90 S 320 160, 360 80 S 420 20, 470 80 C 510 128, 540 80, 590 80 L 740 80"
          ref={pathRef}
          stroke="url(#sprawl-grad)"
          strokeLinecap="round"
          strokeWidth="3"
        />
        <defs>
          <linearGradient id="sprawl-grad" x1="0" x2="800" y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#a1a1aa" />
            <stop offset="0.6" stopColor="#f59e0b" />
            <stop offset="1" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
        <circle cx="740" cy="80" fill="#f43f5e" r="6" ref={dotRef} />
      </svg>
      <span
        className="absolute right-0 top-1/2 hidden -translate-y-[150%] rounded-full border border-zinc-900/10 bg-white px-3 py-1 text-[12px] font-medium text-zinc-700 shadow-sm md:inline-block"
        ref={chipRef}
      >
        one pipeline
      </span>
    </div>
  );
}

export function Sprawl() {
  return (
    <section aria-label="The problem" className="bg-white py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <TextReveal
            as="h2"
            className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl"
          >
            It&apos;s time to end tool sprawl.
          </TextReveal>
          <Reveal>
            <p className="mt-5 text-lg leading-relaxed text-zinc-600">
              Most teams run marketing across six disconnected tools. The work
              isn&apos;t hard, the stitching is.
            </p>
          </Reveal>
        </div>

        <SprawlLine />

        <Stagger className="mx-auto mt-16 grid max-w-5xl gap-10 md:grid-cols-3">
          {PAINS.map((p) => (
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
