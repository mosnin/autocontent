import * as React from "react";

import { CtaBand } from "@/components/site/sections";

/**
 * The closing CTA band every marketing page ends with (spec): headline, one
 * line of standfirst and two CTAs inside a corner-ticked frame, on the same
 * ground as the rest of the page.
 */
export function SectionCta({
  kicker = "Get started",
  headline = "Put your marketing on autopilot.",
  sub = "Describe your brand once. Review what ships. Keep every dollar under a cap you set.",
  primaryLabel = "Start creating",
  primaryHref = "/sign-up",
  secondaryLabel = "See pricing",
  secondaryHref = "/pricing",
  highlight,
  className: _className,
}: {
  kicker?: string;
  headline?: string;
  sub?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  /** Phrase of the headline to paint in the accent. */
  highlight?: string;
  className?: string;
}) {
  return (
    <CtaBand
      eyebrow={kicker}
      heading={headline}
      highlight={highlight}
      primary={{ label: primaryLabel, href: primaryHref }}
      secondary={{ label: secondaryLabel, href: secondaryHref }}
      sub={sub}
    />
  );
}
