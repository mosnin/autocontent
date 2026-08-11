import * as React from "react";

import { CardLink } from "@/components/site/sections";

import { VignetteCard, type VignetteScene } from "./vignette-card";

/**
 * Feature link card: composes `<VignetteCard>` with the illustration staged
 * in the vignette frame and the quiet mono arrow link pinned to the bottom.
 * The whole card is clickable.
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
      footer={<CardLink>{linkLabel}</CardLink>}
      href={href}
      kicker={kicker}
      scene={scene}
      title={title}
      vignette={illustration ?? null}
    />
  );
}
