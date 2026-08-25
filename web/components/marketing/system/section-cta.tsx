"use client";

import { MagneticLink } from "@/components/marketing/magnetic-link";
import { useReducedMotion } from "@/lib/marketing/motion";
import { cn } from "@/lib/utils";
import { motion, useScroll, useTransform } from "motion/react";
import * as React from "react";
import { useRef } from "react";

import { CtaPill } from "./cta-pill";

/**
 * Closing inverted-surface CTA. Matches the Cortex final-cta panel
 * (dark rounded stage, large medium-weight headline, two pills).
 */
export function SectionCta({
  kicker: _kicker = "Get started",
  headline = "Put your marketing on autopilot.",
  sub = "Describe your brand once. Review what ships. Keep every dollar under a cap you set.",
  primaryLabel = "Start creating",
  primaryHref = "/sign-up",
  secondaryLabel = "See pricing",
  secondaryHref = "/pricing",
  className,
}: {
  kicker?: string;
  headline?: string;
  sub?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "center center"],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [0.93, 1]);
  const panelY = useTransform(scrollYProgress, [0, 1], [40, 0]);

  return (
    <section
      ref={sectionRef}
      aria-label="Get started"
      className={cn(
        "mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10",
        className,
      )}
    >
      <motion.div
        style={{
          backgroundColor: "var(--surface)",
          color: "var(--surface-foreground)",
          ...(reduce ? {} : { scale, y: panelY }),
        }}
        className="flex flex-col items-center overflow-hidden rounded-[40px] px-6 py-20 text-center sm:py-28"
      >
        <h2 className="max-w-3xl text-[clamp(34px,5.5vw,68px)] leading-[1.06] font-medium tracking-tight">
          {headline}
        </h2>
        <p className="mt-6 max-w-md text-base leading-relaxed opacity-65">
          {sub}
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <MagneticLink
            href={primaryHref}
            reduce={reduce}
            style={{
              backgroundColor: "var(--surface-foreground)",
              color: "var(--surface)",
            }}
            className="focus-ring inline-flex h-13 items-center rounded-full px-8 text-sm font-medium"
          >
            {primaryLabel}
          </MagneticLink>
          <CtaPill
            href={secondaryHref}
            variant="secondary"
            size="lg"
            className="border-current/25 bg-transparent text-inherit hover:bg-transparent hover:opacity-70"
          >
            {secondaryLabel}
          </CtaPill>
        </div>
      </motion.div>
    </section>
  );
}
