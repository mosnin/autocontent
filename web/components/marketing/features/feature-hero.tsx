import * as React from "react";

import {
  Actions,
  Btn,
  SectionHead,
  Section,
} from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * Shared hero for the features pages: eyebrow → h1 → lede → CTAs inside the
 * ruled section container. With `illustration` it splits into a two-column
 * scene; without it the copy sits centred. Owns the page's single h1.
 */
export function FeatureHero({
  kicker,
  title,
  titleText,
  lede,
  variant: _variant = "sky",
  illustration,
  primary = { label: "Start creating", href: "/sign-up" },
  secondary = { label: "See pricing", href: "/pricing" },
  magneticPrimary: _magneticPrimary = false,
  highlight,
}: {
  kicker: string;
  title?: React.ReactNode;
  /** Plain-string title. Takes precedence over `title` when provided. */
  titleText?: string;
  lede: React.ReactNode;
  variant?: "sky" | "pearl" | "mist";
  illustration?: React.ReactNode;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
  /** Kept for call-site compatibility. */
  magneticPrimary?: boolean;
  /** Phrase of the title to paint in the accent. */
  highlight?: string;
}) {
  const split = Boolean(illustration);

  return (
    <Section label="Introduction" size="top">
      <div className={cn(split && "os-split")}>
        <div>
          <SectionHead
            align={split ? "left" : "center"}
            eyebrow={kicker}
            heading={titleText ?? title}
            highlight={highlight}
            lede={lede}
            level={1}
            size="xl"
          >
            <Actions align={split ? "left" : "center"} className="os-mt-16">
              <Btn href={primary.href} size="lg">
                {primary.label}
              </Btn>
              <Btn href={secondary.href} size="lg" variant="secondary">
                {secondary.label}
              </Btn>
            </Actions>
          </SectionHead>
        </div>
        {split ? <div>{illustration}</div> : null}
      </div>
    </Section>
  );
}
