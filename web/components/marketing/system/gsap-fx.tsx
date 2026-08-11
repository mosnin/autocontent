"use client";

import * as React from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { cn } from "@/lib/utils";

/**
 * GSAP effects kit for the marketing surface. One motion language, Apple
 * taste: masked text reveals, gentle scroll parallax, at most ONE pinned
 * scrub scene per page, marquees that drift rather than race, magnetic
 * CTAs. Every effect collapses to static/opacity-only under
 * prefers-reduced-motion via gsap.matchMedia.
 *
 * Pair with the existing motion/react primitives (<Reveal>/<Stagger>) —
 * GSAP owns text choreography and scroll-linked effects; motion keeps
 * owning simple in-view fades and springs.
 */

gsap.registerPlugin(ScrollTrigger, useGSAP);

const REDUCED = "(prefers-reduced-motion: reduce)";
const FULL = "(prefers-reduced-motion: no-preference)";

/* ------------------------------------------------------------------ */
/* Text: masked word-by-word rise on scroll                            */
/* ------------------------------------------------------------------ */

/**
 * Splits its string children into words, masks each, and rises them in
 * word-by-word when the element scrolls into view. Use on display
 * headlines only (h1/h2) — body copy keeps plain reveals.
 */
export function TextReveal({
  children,
  as: Tag = "h2",
  className,
  stagger = 0.045,
  delay = 0,
}: {
  /** Plain string only — the splitter owns the markup inside. */
  children: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const ref = React.useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const words = el.querySelectorAll<HTMLElement>("[data-word]");
      const mm = gsap.matchMedia();
      mm.add(FULL, () => {
        gsap.from(words, {
          yPercent: 110,
          duration: 0.9,
          ease: "power4.out",
          stagger,
          delay,
          scrollTrigger: { trigger: el, start: "top 82%", once: true },
        });
      });
      mm.add(REDUCED, () => {
        gsap.set(words, { yPercent: 0, opacity: 1 });
      });
    },
    { scope: ref },
  );

  return (
    <Tag
      className={className}
      ref={ref as React.Ref<never>}
    >
      {children.split(" ").map((word, i) => (
        <span
          className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom"
          key={i}
        >
          <span className="inline-block will-change-transform" data-word>
            {word}
          </span>
          {i < children.split(" ").length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Parallax drift                                                      */
/* ------------------------------------------------------------------ */

/**
 * Scroll-linked vertical drift. speed is a fraction of the element's
 * height it travels across the viewport: negative floats up. Keep small
 * (−0.2…0.2); never on body text.
 */
export function Parallax({
  children,
  speed = -0.12,
  className,
}: {
  children: React.ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(FULL, () => {
        gsap.fromTo(
          el,
          { yPercent: -speed * 50 },
          {
            yPercent: speed * 50,
            ease: "none",
            scrollTrigger: { trigger: el, scrub: 0.6, start: "top bottom", end: "bottom top" },
          },
        );
      });
    },
    { scope: ref },
  );

  return (
    <div className={cn("will-change-transform", className)} ref={ref}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pinned scrub scene (max ONE per page)                               */
/* ------------------------------------------------------------------ */

/**
 * Pins its child for `lengthVh` of scroll and drives `build`'s timeline
 * with the scrub. Reduced motion (and touch-first small screens) render
 * the child statically. Strictly one per page.
 */
export function PinScene({
  children,
  lengthVh = 160,
  build,
  className,
}: {
  children: React.ReactNode;
  lengthVh?: number;
  /** Receives the pinned element; return a timeline to scrub. */
  build: (el: HTMLDivElement, tl: gsap.core.Timeline) => void;
  className?: string;
}) {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const wrap = outer.current;
      const el = inner.current;
      if (!wrap || !el) return;
      const mm = gsap.matchMedia();
      mm.add(`${FULL} and (min-width: 768px)`, () => {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: wrap,
            start: "top top",
            end: `+=${lengthVh}%`,
            pin: el,
            scrub: 0.8,
            anticipatePin: 1,
          },
        });
        build(el, tl);
      });
    },
    { scope: outer },
  );

  return (
    <div className={className} ref={outer}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Marquee                                                             */
/* ------------------------------------------------------------------ */

/**
 * Infinite drift marquee. Children are duplicated for the seamless loop;
 * wrap logical content once. Reduced motion renders a static row.
 */
export function Marquee({
  children,
  seconds = 28,
  reverse = false,
  pauseOnHover = true,
  className,
  itemClassName,
  ariaLabel,
}: {
  children: React.ReactNode;
  /** Seconds per full loop — bigger is calmer. */
  seconds?: number;
  reverse?: boolean;
  pauseOnHover?: boolean;
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "group/marquee flex overflow-hidden [--marquee-duration:28s]",
        className,
      )}
      style={{ "--marquee-duration": `${seconds}s` } as React.CSSProperties}
    >
      {[0, 1].map((copy) => (
        <div
          aria-hidden={copy === 1}
          className={cn(
            "flex w-max shrink-0 items-center motion-safe:animate-[marquee_var(--marquee-duration)_linear_infinite]",
            reverse && "motion-safe:[animation-direction:reverse]",
            pauseOnHover &&
              "group-hover/marquee:[animation-play-state:paused]",
            itemClassName,
          )}
          key={copy}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Magnetic hover                                                      */
/* ------------------------------------------------------------------ */

/**
 * Magnetic pull toward the pointer for primary CTAs. Subtle by design —
 * strength is the max pixel offset. No-op under reduced motion and on
 * touch devices.
 */
export function Magnetic({
  children,
  strength = 8,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(`${FULL} and (pointer: fine)`, () => {
        const xTo = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3.out" });
        const yTo = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3.out" });
        const onMove = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          xTo(dx * strength);
          yTo(dy * strength);
        };
        const onLeave = () => {
          xTo(0);
          yTo(0);
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        return () => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerleave", onLeave);
        };
      });
    },
    { scope: ref },
  );

  return (
    <div className={cn("inline-block will-change-transform", className)} ref={ref}>
      {children}
    </div>
  );
}
