import * as React from "react";

import { Section, SectionHead } from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * Shared sub-page hero for Resources / Company / Pricing: the ruled section
 * container with a centred eyebrow → h1 → standfirst. Owns the page's
 * single `<h1>`.
 */
export function PageHero({
  kicker,
  headline,
  sub,
  variant: _variant = "sky",
  size = "lg",
  children,
  className,
  highlight,
}: {
  kicker: string;
  headline: string;
  sub?: string;
  variant?: "sky" | "pearl" | "mist";
  size?: "xl" | "lg";
  children?: React.ReactNode;
  className?: string;
  /** Phrase of the headline to paint in the accent. */
  highlight?: string;
}) {
  return (
    <Section className={cn(className)} label="Introduction" size="top">
      <SectionHead
        align="center"
        eyebrow={kicker}
        heading={headline}
        highlight={highlight}
        lede={sub}
        level={1}
        size={size}
      >
        {children}
      </SectionHead>
    </Section>
  );
}
