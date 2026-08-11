import * as React from "react";
import Link from "next/link";

import { Eyebrow, Title } from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * Scene names are kept so the six audience pages keep their call sites, but
 * on the transcribed ground there is one surface, not six pastel washes.
 * Each name now selects where the accent bleeds into the vignette frame, so
 * the cards still differ by a degree without leaving the palette.
 */
export const VIGNETTE_SCENES = {
  sky: "os-vignette--sky",
  pearl: "os-vignette--pearl",
  mist: "os-vignette--mist",
  dawn: "os-vignette--dawn",
  dusk: "os-vignette--dusk",
  warm: "os-vignette--warm",
} as const;

export type VignetteScene = keyof typeof VIGNETTE_SCENES;

/**
 * The card: a product miniature staged in a hairline frame, then title and
 * one-line description below. Never an icon. With `href` the whole card is a
 * link and lifts on hover.
 */
export function VignetteCard({
  title,
  description,
  vignette,
  href,
  footer,
  kicker,
  scene = "pearl",
  className,
}: {
  title: string;
  description: string;
  /** A miniature (or media slot) staged in the vignette frame. */
  vignette: React.ReactNode;
  href?: string;
  /** Optional quiet row pinned to the card bottom (link label, meta). */
  footer?: React.ReactNode;
  /** Optional uppercase eyebrow above the title. */
  kicker?: string;
  scene?: VignetteScene;
  className?: string;
}) {
  const cardClassName = cn("os-card", "os-vcard", className);

  const body = (
    <>
      {vignette != null && (
        <div className={cn("os-vignette", VIGNETTE_SCENES[scene])}>
          <div className="os-vignette__inner">{vignette}</div>
        </div>
      )}
      <div className="os-vcard__body">
        {kicker ? <Eyebrow className="os-vcard__kicker">{kicker}</Eyebrow> : null}
        <Title size="sm">{title}</Title>
        <p className="os-body os-mt-8">{description}</p>
        {footer ?? null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link className={cardClassName} href={href}>
        {body}
      </Link>
    );
  }
  return <div className={cardClassName}>{body}</div>;
}
