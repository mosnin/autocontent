import * as React from "react";

import { VignetteCard, type VignetteScene } from "./vignette-card";

/**
 * Feature link card: composes `<VignetteCard>` (Amendment 2 card
 * language) with the illustration staged in the vignette frame and a
 * quiet arrow link pinned to the bottom. Whole card is clickable.
 *
 * Props are backward compatible with the original FeatureCard; `scene`
 * is a new optional wash selector.
 */
export function FeatureCard({
  title,
  description,
  href,
  linkLabel = "Learn more",
  kicker,
  illustration,
  scene = "pearl",
  className,
}: {
  title: string;
  description: string;
  href: string;
  linkLabel?: string;
  kicker?: string;
  illustration?: React.ReactNode;
  scene?: VignetteScene;
  className?: string;
}) {
  return (
    <VignetteCard
      className={className}
      description={description}
      footer={
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900">
          {linkLabel}
          <svg
            aria-hidden
            className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
        </span>
      }
      href={href}
      kicker={kicker}
      scene={scene}
      title={title}
      vignette={illustration ?? null}
    />
  );
}
