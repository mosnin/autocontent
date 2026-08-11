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
export const VIGNETTE_SCENES = {
  /** Soft daylight blue. */
  sky: "bg-[radial-gradient(120%_130%_at_80%_-15%,#dbeafe_0%,#eff6ff_55%,#f8fafc_100%)]",
  /** Barely-there indigo pearl, the quiet default. */
  pearl:
    "bg-[radial-gradient(115%_125%_at_50%_-12%,#e8edfb_0%,#f7f8fc_58%,#f5f6f8_100%)]",
  /** Low-saturation lavender into blush. */
  mist: "bg-[radial-gradient(120%_135%_at_18%_-12%,#e0e7ff_0%,#eef2ff_45%,#fdf2f8_100%)]",
  /** First-light amber into rose, very low saturation. */
  dawn: "bg-[radial-gradient(120%_135%_at_18%_-12%,#fef3c7_0%,#fde8ea_52%,#fdf7f2_100%)]",
  /** Deeper periwinkle into violet, for evening-story cards. */
  dusk: "bg-[radial-gradient(120%_135%_at_82%_-15%,#c7d2fe_0%,#e0e7ff_48%,#f2f0fb_100%)]",
  /** The warm wash (replaces any mint/green scene): peach into blush. */
  warm: "bg-[radial-gradient(120%_125%_at_50%_-15%,#ffedd5_0%,#fdeeee_55%,#fdfaf7_100%)]",
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
  scene = "pearl",
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
    "group flex h-full flex-col rounded-[1.5rem] border border-zinc-900/[0.06] bg-white p-2 shadow-[0_2px_16px_rgba(15,23,42,0.04)]",
    href &&
      "transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_44px_rgba(15,23,42,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
    className,
  );

  const body = (
    <>
      {vignette != null && (
        <div
          className={cn(
            "relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl p-5 ring-1 ring-inset ring-zinc-900/[0.05] sm:p-6",
            VIGNETTE_SCENES[scene],
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
        <h3 className="font-display text-lg font-semibold tracking-tight text-zinc-900">
          {title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
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
