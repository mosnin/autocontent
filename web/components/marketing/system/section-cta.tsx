import * as React from "react";

import { cn } from "@/lib/utils";
import { CtaPill } from "./cta-pill";
import { Magnetic, TextReveal } from "./gsap-fx";
import { GradientScene } from "./gradient-scene";
import { Reveal } from "./reveal";
import { Kicker, Lede } from "./typography";

/**
 * The closing CTA band. Every marketing page ends with one (spec).
 * Headline + two pill CTAs on a soft gradient scene.
 */
export function SectionCta({
  kicker = "Get started",
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
  return (
    <section aria-label="Get started" className={cn("px-4 pb-6 md:px-6", className)}>
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="mist"
      >
        <div className="mx-auto max-w-6xl px-6 py-24 text-center md:py-32">
          <Reveal>
            <Kicker>{kicker}</Kicker>
            <TextReveal
              as="h2"
              className="mx-auto mt-4 max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-900 md:text-5xl"
            >
              {headline}
            </TextReveal>
            <Lede className="mx-auto mt-5">{sub}</Lede>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Magnetic>
                <CtaPill href={primaryHref} size="lg">
                  {primaryLabel}
                </CtaPill>
              </Magnetic>
              <CtaPill href={secondaryHref} size="lg" variant="secondary">
                {secondaryLabel}
              </CtaPill>
            </div>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}
