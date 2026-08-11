import * as React from "react";

import {
  Body,
  Eyebrow,
  Heading,
  Lede as SiteLede,
} from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * The page typography, expressed in the transcribed site's language.
 *
 * These three names are what every marketing page imports, so rather than
 * changing forty call sites they now delegate to the section primitives in
 * `components/site/sections`: the mono uppercase eyebrow chip, the heavy
 * display heading, and the Inter Display standfirst. Colour and face live in
 * `sections.css` — nothing here paints.
 */

/** Uppercase mono eyebrow above a heading. */
export function Kicker({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <Eyebrow className={className}>{children}</Eyebrow>;
}

/**
 * Display heading in the site's display face. `level` controls the tag
 * (exactly one h1 per page); `size` the scale. `highlight` accents one
 * phrase in teal, the way each homepage section does.
 */
export function DisplayHeading({
  children,
  className,
  level = 2,
  size = "lg",
  highlight,
}: {
  children: React.ReactNode;
  className?: string;
  level?: 1 | 2 | 3;
  size?: "xl" | "lg" | "md";
  highlight?: string;
}) {
  return (
    <Heading
      className={className}
      highlight={highlight}
      level={level}
      size={size}
    >
      {children}
    </Heading>
  );
}

/** One-to-two sentence standfirst under a heading. */
export function Lede({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <SiteLede className={className}>{children}</SiteLede>;
}

/** Small supporting copy — captions, notes, card bodies. */
export function Note({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <Body className={cn(className)}>{children}</Body>;
}
