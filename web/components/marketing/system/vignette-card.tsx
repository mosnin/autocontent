import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Kicker } from "./typography";

/**
 * The six vignette scene washes: soft, light-mode gradient backdrops the
 * product miniature is staged on. Cool scenes mirror `GradientScene`;
 * `dawn` / `warm` are the warm-family washes (Amendment 2 — no green,
 * no mint).
 */
const MUTED = "bg-muted";

export const VIGNETTE_SCENES = {
  sky: MUTED,
  pearl: MUTED,
  mist: MUTED,
  dawn: MUTED,
  dusk: MUTED,
  warm: MUTED,
} as const;

export type VignetteScene = keyof typeof VIGNETTE_SCENES;

/**
 * The card (Amendment 2): a real product-UI miniature staged on a soft
 * gradient wash, plain title + short description below. Never an icon.
 *
 * Anatomy: hairline white card → inset vignette frame (fixed 16/10,
 * scene wash, inner hairline, overflow hidden) → text block. With `href`
 * the whole card is a link: it lifts on hover and the vignette scales a
 * touch. No self-animation beyond hover — pages wrap cards in
 * `<Reveal>`/`<Stagger>`.
 */
export function VignetteCard({
  title,
  description,
  vignette,
  href,
  footer,
  kicker,
  scene: _scene = "pearl",
  className,
}: {
  title: string;
  description: string;
  /** A miniature from `components/marketing/vignettes` (or any staged JSX). */
  vignette: React.ReactNode;
  href?: string;
  /** Optional quiet row pinned to the card bottom (link label, meta). */
  footer?: React.ReactNode;
  /** Optional uppercase eyebrow above the title. */
  kicker?: string;
  scene?: VignetteScene;
  className?: string;
}) {
  const cardClassName = cn(
    "group border-border bg-background flex h-full flex-col rounded-3xl border p-2",
    href &&
      "focus-ring transition-opacity hover:opacity-90",
    className,
  );

  const body = (
    <>
      {vignette != null && (
        <div
          className={cn(
            "relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-2xl bg-muted p-5 sm:p-6",
          )}
        >
          <div
            className={cn(
              "w-full max-w-[400px]",
              href &&
                "transition-transform duration-500 ease-out group-hover:scale-[1.02]",
            )}
          >
            {vignette}
          </div>
        </div>
      )}
      <div className="flex flex-1 flex-col px-3 pb-4 pt-4 sm:px-4 sm:pb-5">
        {kicker ? <Kicker className="mb-2.5">{kicker}</Kicker> : null}
        <h3 className="text-foreground text-lg font-medium tracking-tight">
          {title}
        </h3>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {description}
        </p>
        {footer ? (
          <div className="mt-auto flex items-center gap-2 pt-4">{footer}</div>
        ) : null}
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
